import { VertexAI } from '@google-cloud/vertexai';
import { computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig, CONFIGS } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { PromptBuilder } from './prompt-builder.js';
import { TAX_TOOL_DEFINITIONS, executeTaxTool } from './tax-tools.js';

// ─── Model-agnostic tool defs → Vertex schema shape ──────────────────────────
// Recursively upper-cases JSON-schema "type" values to the Vertex SchemaType
// string form (OBJECT, STRING, NUMBER, ...). Keeps tax-tools.ts as the single
// source of truth for tool names, descriptions, and parameters.
function toVertexSchema(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const out: any = { ...node };
  if (typeof out.type === 'string') out.type = out.type.toUpperCase();
  if (out.properties) {
    const props: any = {};
    for (const k of Object.keys(out.properties)) props[k] = toVertexSchema(out.properties[k]);
    out.properties = props;
  }
  if (out.items) out.items = toVertexSchema(out.items);
  return out;
}

const VERTEX_FUNCTION_DECLARATIONS = TAX_TOOL_DEFINITIONS.map(d => ({
  name: d.name,
  description: d.description,
  parameters: toVertexSchema(d.parameters),
}));

// Data residency: model calls must stay in an approved UK/EU region (spec 9.3).
const APPROVED_REGION_PREFIXES = ['europe-', 'eu'];
function assertApprovedRegion(region: string) {
  if (!APPROVED_REGION_PREFIXES.some(p => region.startsWith(p))) {
    throw new Error(
      `Refusing to initialise Vertex AI in non-EU/UK region "${region}". ` +
      `Set GCP_REGION to an approved region (e.g. europe-west2).`,
    );
  }
}

// ─── GeminiAgent ─────────────────────────────────────────────────────────────

export class GeminiAgent {
  private vertexAI: VertexAI | null = null;

  // `phase` retained for API compatibility with the server; the agent no longer
  // runs an FSM — flow is driven by the model and emergent from the return data.
  constructor(project: string, region: string, _phase?: string) {
    try {
      assertApprovedRegion(region);
      this.vertexAI = new VertexAI({ project, location: region });
    } catch (e: any) {
      console.error('Vertex AI initialisation failed:', e?.message || e);
      this.vertexAI = null;
    }
  }

  async runConversationTurn(
    message: string,
    returnObj: Return,
    history: any[] = [],
  ): Promise<{ reply: string; phase: string; calculation: any }> {
    const taxYear = returnObj.taxYear && CONFIGS[returnObj.taxYear]
      ? returnObj.taxYear
      : Object.keys(CONFIGS).sort().reverse()[0];
    const config = getConfig(taxYear);

    let replyText = '';

    if (this.vertexAI) {
      try {
        const model = this.vertexAI.getGenerativeModel({
          model: 'gemini-2.5-pro',
          systemInstruction: PromptBuilder.buildSystemInstruction(returnObj),
          generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
          tools: [{ functionDeclarations: VERTEX_FUNCTION_DECLARATIONS as any }],
        });

        const chat = model.startChat({ history: [...history] });

        let response = await chat.sendMessage(message);
        let calls = (response.response.candidates?.[0]?.content?.parts || [])
          .filter(p => (p as any).functionCall);

        // Plain agentic loop: run tools, feed results back, until no more calls.
        let attempts = 0;
        while (calls.length > 0 && attempts < 8) {
          attempts++;
          const outputs: any[] = [];
          for (const call of calls) {
            const { name, args } = (call as any).functionCall;
            const res = executeTaxTool(name, args || {}, { returnObj });
            console.log(`[Tool] ${name} -> ${res.isError ? 'ERROR' : 'ok'}`);
            outputs.push({
              functionResponse: {
                name,
                response: res.isError ? { error: res.content } : { result: res.content },
              },
            });
          }
          response = await chat.sendMessage(outputs);
          calls = (response.response.candidates?.[0]?.content?.parts || [])
            .filter(p => (p as any).functionCall);
        }

        replyText = (response.response.candidates?.[0]?.content?.parts || [])
          .filter(p => (p as any).text)
          .map(p => (p as any).text)
          .join('\n');
      } catch (err: any) {
        console.error('[Vertex AI Error]', err?.message || err);
        // Fail closed: no non-ZDR fallback.
        replyText = 'The AI assistant is temporarily unavailable. Your tax computation is still running — see the computation panel.';
      }
    } else {
      replyText = 'The AI assistant is not configured for this environment. Your tax computation is still running — see the computation panel.';
    }

    // Recompute once against the final return state so the UI panel is in sync.
    const calculation = computeFullReturn(returnObj, config);

    return { reply: replyText, phase: 'active', calculation };
  }
}
