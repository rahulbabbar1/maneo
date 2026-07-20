import { VertexAI } from '@google-cloud/vertexai';
import { computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig, CONFIGS } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { PromptBuilder } from './prompt-builder.js';
import { TAX_TOOL_DEFINITIONS, executeTaxTool } from './tax-tools.js';
import { enforceFigureGuardrail } from './guardrail.js';
import { validateReturnProvenance } from './provenance-guard.js';


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

// Coerce arbitrary client history into valid Vertex Content[]:
//   • accepts {role, parts:[{text}]} OR {sender:'bot'|'user', text}
//   • drops empty turns and anything that isn't user/model
//   • Vertex requires the history to START with a user turn -> drop leading model turns
//   • Vertex requires ALTERNATING roles -> merge consecutive same-role turns
// A malformed history is the most common cause of a hard Vertex throw mid-chat.
export function sanitizeHistory(history: any[]): any[] {
  const norm: { role: string; parts: { text: string }[] }[] = [];
  for (const h of history || []) {
    let text = '';
    if (Array.isArray(h?.parts)) text = h.parts.map((p: any) => p?.text || '').join('');
    else if (typeof h?.text === 'string') text = h.text;
    let role = h?.role || (h?.sender === 'bot' ? 'model' : h?.sender === 'user' ? 'user' : '');
    if (role !== 'user' && role !== 'model') continue;
    if (!text.trim()) continue;
    norm.push({ role, parts: [{ text }] });
  }
  while (norm.length && norm[0].role === 'model') norm.shift();
  const alt: typeof norm = [];
  for (const item of norm) {
    const last = alt[alt.length - 1];
    if (last && last.role === item.role) last.parts.push(...item.parts);
    else alt.push(item);
  }
  return alt;
}

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

// Retry transient Vertex failures (429/5xx/deadline) with exponential backoff.
// This is the difference between a momentary blip and the user seeing a dead-end.
async function sendWithRetry(chat: any, payload: any, attempts = 3): Promise<any> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chat.sendMessage(payload);
    } catch (err: any) {
      lastErr = err;
      const code = Number(err?.code || err?.status);
      const retryable =
        [429, 500, 502, 503, 504].includes(code) ||
        /deadline|unavailable|timeout|timed out|ECONNRESET|socket hang up|rate limit|overloaded/i.test(err?.message || '');
      if (i < attempts - 1 && retryable) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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
          model: 'gemini-2.5-flash',
          systemInstruction: PromptBuilder.buildSystemInstruction(returnObj),
          generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
          tools: [{ functionDeclarations: VERTEX_FUNCTION_DECLARATIONS as any }],
        });

        const chat = model.startChat({ history: sanitizeHistory(history) });

        let response = await sendWithRetry(chat, message);
        let calls = (response.response.candidates?.[0]?.content?.parts || [])
          .filter((p: any) => (p as any).functionCall);

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
          response = await sendWithRetry(chat, outputs);
          calls = (response.response.candidates?.[0]?.content?.parts || [])
            .filter((p: any) => (p as any).functionCall);
        }

        replyText = (response.response.candidates?.[0]?.content?.parts || [])
          .filter((p: any) => (p as any).text)
          .map((p: any) => (p as any).text)
          .join('\n');

        // Recover if the model ended on a tool call or hit the token cap with no prose.
        if (!replyText || !replyText.trim()) {
          const finish = response.response.candidates?.[0]?.finishReason;
          console.warn('[Vertex] empty text reply, finishReason =', finish);
          replyText = finish === 'MAX_TOKENS'
            ? "I've updated the return with that. Could you give me the next detail — or ask me to compute the tax so far?"
            : "Done — I've recorded that. What would you like to add next, or shall I compute the tax so far?";
        }
      } catch (err: any) {
        // Log the real cause so residence-turn / mid-chat failures are diagnosable.
        console.error('[Vertex AI Error]', JSON.stringify({
          message: err?.message,
          code: err?.code,
          status: err?.status,
          finishReason: err?.response?.candidates?.[0]?.finishReason,
          promptFeedback: err?.response?.promptFeedback,
          stack: (err?.stack || '').split('\n').slice(0, 4).join(' | '),
        }));
        // Fail closed: no non-ZDR fallback.
        replyText = 'The AI assistant hit a temporary problem on that step. Your details are saved and the computation panel is up to date — please try sending your last message again.';
      }
    } else {
      replyText = 'The AI assistant is not configured for this environment. Your tax computation is still running — see the computation panel.';
    }

    // Recompute against the final return state (guarded so a compute issue
    // can never turn a successful chat turn into a 500).
    let calculation: any = null;
    try {
      calculation = computeFullReturn(returnObj, config);
    } catch (e: any) {
      console.error('[Compute Error]', e?.message || e);
    }

    // C5 Safety Net Enforcement:
    // 1. Redact unverified monetary figures from model prose
    const guarded = enforceFigureGuardrail(replyText, calculation, returnObj, config);
    if (guarded.redacted) {
      console.warn('[Safety Net C5] Redacted unverified monetary figure(s) from model reply.');
    }
    replyText = guarded.text;

    // 2. Assert return & calculation provenance
    const provenance = validateReturnProvenance(returnObj, calculation);
    if (!provenance.valid) {
      console.warn('[Safety Net C5] Provenance warning(s):', provenance.violations.join('; '));
    }

    return { reply: replyText, phase: 'active', calculation };
  }
}

