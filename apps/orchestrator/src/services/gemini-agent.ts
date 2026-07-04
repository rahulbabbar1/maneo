import { VertexAI, FunctionDeclaration, SchemaType } from '@google-cloud/vertexai';
import { computeIncomeTax, computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig, CONFIGS } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { PromptBuilder } from './prompt-builder.js';
import { StateMachine, PhaseKey } from './state-machine.js';
import { enforceFigureGuardrail } from './guardrail.js';

// ─── Tool Declarations ───────────────────────────────────────────────────────

const computeIncomeTaxDeclaration: FunctionDeclaration = {
  name: 'compute_income_tax',
  description: `Computes UK personal income tax for a given tax year.
IMPORTANT: Call this tool immediately whenever the user provides income figures — don't ask the user to confirm before calling.
Convert any £ amounts to pence yourself (multiply by 100) before calling.
Supported tax years: ${Object.keys(CONFIGS).join(', ')}.`,
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      taxYear:   { type: SchemaType.STRING, description: 'Tax year e.g. "2024-25". Supported: ' + Object.keys(CONFIGS).join(', ') },
      region:    { type: SchemaType.STRING, description: 'Tax region: rUK, scotland, or wales' },
      nonSavingsIncome: { type: SchemaType.NUMBER, description: 'Gross employment income in PENCE (£1 = 100 pence)' },
      savingsIncome:    { type: SchemaType.NUMBER, description: 'Savings interest in PENCE' },
      dividendIncome:   { type: SchemaType.NUMBER, description: 'Dividend income in PENCE' },
      giftAidGrossedUp:              { type: SchemaType.NUMBER, description: 'Grossed-up Gift Aid in PENCE' },
      relievablePensionContributions: { type: SchemaType.NUMBER, description: 'Pension contributions in PENCE' },
      blindPersonsAllowanceClaimed:   { type: SchemaType.BOOLEAN, description: 'Whether Blind Person\'s Allowance is claimed' },
    },
    required: ['taxYear', 'region', 'nonSavingsIncome', 'savingsIncome', 'dividendIncome'],
  },
};

const computeFullReturnDeclaration: FunctionDeclaration = {
  name: 'compute_full_return',
  description: 'Runs the full HMRC calculation on a complete Return object, returning income tax, CGT, charges, and balancing payment. Call this when the return data is sufficiently complete to give a summary.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      taxYear:   { type: SchemaType.STRING, description: 'Tax year e.g. "2024-25"' },
      returnObj: { type: SchemaType.OBJECT, description: 'The complete Return object' },
    },
    required: ['taxYear', 'returnObj'],
  },
};

// Data residency: model calls must stay in an approved UK/EU region (spec 9.3).
const APPROVED_REGION_PREFIXES = ['europe-', 'eu'];
function assertApprovedRegion(region: string) {
  const ok = APPROVED_REGION_PREFIXES.some(p => region.startsWith(p));
  if (!ok) {
    throw new Error(
      `Refusing to initialise Vertex AI in non-EU/UK region "${region}". ` +
      `Set GCP_REGION to an approved region (e.g. europe-west2).`
    );
  }
}

// ─── GeminiAgent ─────────────────────────────────────────────────────────────

export class GeminiAgent {
  private vertexAI: VertexAI | null = null;
  private stateMachine: StateMachine;

  constructor(project: string, region: string, currentPhase?: PhaseKey) {
    this.stateMachine = new StateMachine(currentPhase);
    try {
      assertApprovedRegion(region);
      // Use the injected, region-pinned location — never a hardcoded US region.
      this.vertexAI = new VertexAI({ project, location: region });
    } catch (e: any) {
      // Fail closed: no non-compliant fallback. AI is simply unavailable.
      console.error('Vertex AI initialisation failed:', e?.message || e);
      this.vertexAI = null;
    }
  }

  getCurrentPhase(): PhaseKey {
    return this.stateMachine.getCurrentPhase();
  }

  // ── Tool executor ────────────────────────────────────────────────────────

  private executeTool(name: string, args: any): any {
    // Resolve tax year — accept shorthand like "24-25" → "2024-25"
    let taxYear: string = args.taxYear || '2025-26';
    if (/^\d{2}-\d{2}$/.test(taxYear)) {
      taxYear = `20${taxYear}`;
    }
    // Default to most recent supported year if not found
    if (!CONFIGS[taxYear]) {
      const available = Object.keys(CONFIGS).sort().reverse();
      console.warn(`[Tax Config] Year "${taxYear}" not found, defaulting to ${available[0]}`);
      taxYear = available[0];
    }
    const config = getConfig(taxYear);

    if (name === 'compute_income_tax') {
      return computeIncomeTax(
        {
          region:                        args.region || 'rUK',
          nonSavingsIncome:              args.nonSavingsIncome || 0,
          savingsIncome:                 args.savingsIncome    || 0,
          dividendIncome:                args.dividendIncome   || 0,
          giftAidGrossedUp:              args.giftAidGrossedUp || 0,
          relievablePensionContributions: args.relievablePensionContributions || 0,
          blindPersonsAllowanceClaimed:  args.blindPersonsAllowanceClaimed || false,
        },
        config
      );
    }

    if (name === 'compute_full_return') {
      return computeFullReturn(args.returnObj as Return, config);
    }

    throw new Error(`Tool ${name} not found`);
  }

  // ── Main conversation turn ───────────────────────────────────────────────

  async runConversationTurn(
    message: string,
    returnObj: Return,
    history: any[] = []
  ): Promise<{ reply: string; phase: PhaseKey; calculation: any }> {
    const taxYear = returnObj.taxYear || '2025-26';
    const config  = CONFIGS[taxYear] ? getConfig(taxYear) : getConfig(Object.keys(CONFIGS).sort().reverse()[0]);

    // Baseline calculation with current return data
    let latestCalc = computeFullReturn(returnObj, config);

    // Build system prompt
    const systemPrompt = PromptBuilder.buildSystemInstruction(
      this.stateMachine.getCurrentPhase(),
      returnObj,
      latestCalc
    );

    let replyText = '';

    if (this.vertexAI) {
      try {
        // Try Pro first, fall back to Flash if unavailable
        const PREFERRED_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash'];
        let model;
        let modelName = '';
        for (const m of PREFERRED_MODELS) {
          try {
            model = this.vertexAI.getGenerativeModel({
              model: m,
              generationConfig: {
                maxOutputTokens: 8192,
                temperature:     0.4,
              },
              // Deterministic posture: calculation tools only. No web/search
              // grounding — the model must not source tax rules from the web.
              tools: [{ functionDeclarations: [computeIncomeTaxDeclaration, computeFullReturnDeclaration] }],
            });
            modelName = m;
            break;
          } catch {
            console.warn(`[Vertex AI] Model ${m} not available, trying next...`);
          }
        }
        if (!model) throw new Error('No Vertex AI model available');
        console.log(`[Vertex AI] Using model: ${modelName}`);

        const chat = model.startChat({
          history: [
            { role: 'user',  parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Understood. I am Maneo, your UK Self Assessment Filing Assistant. I will help prepare this return accurately, using the computation engine for all tax figures.' }] },
            ...history,
          ],
        });

        let response = await chat.sendMessage(message);
        let functionCalls = response.response.candidates?.[0]?.content?.parts?.filter(
          p => p.functionCall
        ) || [];

        // Agent function-calling loop (max 8 iterations to allow complex workflows)
        let attempts = 0;
        while (functionCalls.length > 0 && attempts < 8) {
          attempts++;
          const toolOutputs = [];

          for (const call of functionCalls) {
            if (call.functionCall) {
              const { name, args } = call.functionCall;
              console.log(`[Tool Call] ${name}(`, JSON.stringify(args).slice(0, 200), ')');
              try {
                const result = this.executeTool(name, args);
                if (name === 'compute_full_return') latestCalc = result;
                toolOutputs.push({
                  functionResponse: { name, response: { result } },
                });
              } catch (err: any) {
                console.error(`[Tool Error] ${name}:`, err.message);
                toolOutputs.push({
                  functionResponse: { name, response: { error: err.message } },
                });
              }
            }
          }

          response = await chat.sendMessage(toolOutputs);
          functionCalls = response.response.candidates?.[0]?.content?.parts?.filter(
            p => p.functionCall
          ) || [];
        }

        replyText = response.response.candidates?.[0]?.content?.parts
          ?.filter(p => p.text)
          .map(p => p.text)
          .join('\n') || '';

      } catch (err: any) {
        console.error('[Vertex AI Error]', err.message);
        // Fail closed. Do NOT route return data to any non-ZDR endpoint.
        replyText = 'The AI assistant is temporarily unavailable. Your tax computation is still running — see the computation panel on the left.';
      }
    } else {
      replyText = 'The AI assistant is not configured for this environment. Your tax computation is still running — see the computation panel on the left.';
    }

    // Fabrication guardrail (spec 6.2): strip any monetary figure the model
    // produced that does not trace to a calculation-tool result.
    const guarded = enforceFigureGuardrail(replyText, latestCalc, returnObj, config);
    if (guarded.redacted) {
      console.warn('[Guardrail] Redacted unverified monetary figure(s) from model reply.');
    }
    replyText = guarded.text;

    // Update phase state machine
    const nextPhase = this.stateMachine.determineNextPhase(message, replyText);
    if (nextPhase) {
      this.stateMachine.transitionTo(nextPhase, 'LLM conversation transition');
    }

    return {
      reply:       replyText,
      phase:       this.stateMachine.getCurrentPhase(),
      calculation: latestCalc,
    };
  }
}
