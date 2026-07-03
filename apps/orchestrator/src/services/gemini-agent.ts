import { VertexAI, FunctionDeclaration, SchemaType } from '@google-cloud/vertexai';
import { computeIncomeTax, computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { PromptBuilder } from './prompt-builder.js';
import { StateMachine, PhaseKey } from './state-machine.js';

// Define the tool declarations for Gemini
const computeIncomeTaxDeclaration: FunctionDeclaration = {
  name: 'compute_income_tax',
  description: 'Computes UK personal income tax for a given tax year, including allowances and band allocations.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      taxYear: { type: SchemaType.STRING, description: 'Tax year, e.g. "2025-26"' },
      region: { type: SchemaType.STRING, description: 'Tax region: rUK, scotland, or wales' },
      nonSavingsIncome: { type: SchemaType.NUMBER, description: 'Gross employment or non-savings income in pence' },
      savingsIncome: { type: SchemaType.NUMBER, description: 'Savings interest income in pence' },
      dividendIncome: { type: SchemaType.NUMBER, description: 'Dividend income in pence' },
      giftAidGrossedUp: { type: SchemaType.NUMBER, description: 'Grossed-up Gift Aid payments in pence' },
      relievablePensionContributions: { type: SchemaType.NUMBER, description: 'Relievable pension contributions in pence' },
      blindPersonsAllowanceClaimed: { type: SchemaType.BOOLEAN, description: 'Whether Blind Person\'s Allowance is claimed' },
    },
    required: ['taxYear', 'region', 'nonSavingsIncome', 'savingsIncome', 'dividendIncome'],
  },
};

const computeFullReturnDeclaration: FunctionDeclaration = {
  name: 'compute_full_return',
  description: 'Runs the top-level HMRC calculation assembler on a complete Return object, returning full income tax, CGT, charges, and balancing payments.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      taxYear: { type: SchemaType.STRING, description: 'Tax year, e.g. "2025-26"' },
      returnObj: { type: SchemaType.OBJECT, description: 'The complete Return object' },
    },
    required: ['taxYear', 'returnObj'],
  },
};

export class GeminiAgent {
  private vertexAI: VertexAI | null = null;
  private stateMachine: StateMachine;

  constructor(project: string, region: string, currentPhase?: PhaseKey) {
    this.stateMachine = new StateMachine(currentPhase);
    try {
      // Default to us-central1 for Vertex AI models to ensure access to Gemini foundation models
      const location = region === 'europe-west2' ? 'us-central1' : region;
      this.vertexAI = new VertexAI({ project, location });
    } catch (e) {
      console.warn('Vertex AI failed to initialize. Running in fallback/mock mode.');
    }
  }

  getCurrentPhase(): PhaseKey {
    return this.stateMachine.getCurrentPhase();
  }

  // Executes tools directly matching MCP server capabilities
  private executeTool(name: string, args: any): any {
    const taxYear = args.taxYear || '2025-26';
    const config = getConfig(taxYear);

    if (name === 'compute_income_tax') {
      return computeIncomeTax(
        {
          region: args.region || 'rUK',
          nonSavingsIncome: args.nonSavingsIncome || 0,
          savingsIncome: args.savingsIncome || 0,
          dividendIncome: args.dividendIncome || 0,
          giftAidGrossedUp: args.giftAidGrossedUp || 0,
          relievablePensionContributions: args.relievablePensionContributions || 0,
          blindPersonsAllowanceClaimed: args.blindPersonsAllowanceClaimed || false,
        },
        config
      );
    }

    if (name === 'compute_full_return') {
      return computeFullReturn(args.returnObj as Return, config);
    }

    throw new Error(`Tool ${name} not found`);
  }

  async runConversationTurn(
    message: string,
    returnObj: Return,
    history: any[] = []
  ): Promise<{ reply: string; phase: PhaseKey; calculation: any }> {
    const taxYear = returnObj.taxYear || '2025-26';
    const config = getConfig(taxYear);
    
    // 1. Run local calculation to set up current computation baseline
    let latestCalc = computeFullReturn(returnObj, config);

    // 2. Build current system prompt
    const systemPrompt = PromptBuilder.buildSystemInstruction(
      this.stateMachine.getCurrentPhase(),
      returnObj,
      latestCalc
    );

    let replyText = '';
    const validAmounts = this.getValidAmounts(latestCalc);

    if (this.vertexAI) {
      try {
        const model = this.vertexAI.getGenerativeModel({
          model: 'gemini-1.5-flash',
          generationConfig: {
            maxOutputTokens: 1200,
            temperature: 0.15,
          },
          tools: [{ functionDeclarations: [computeIncomeTaxDeclaration, computeFullReturnDeclaration] }],
        });

        // Setup chat sessions
        const chat = model.startChat({
          history: [
            { role: 'user', parts: [{ text: systemPrompt }] },
            ...history,
          ],
        });

        let response = await chat.sendMessage(message);
        let functionCalls = response.response.candidates?.[0]?.content?.parts?.filter(
          p => p.functionCall
        ) || [];

        // Agent function-calling loop
        let attempts = 0;
        while (functionCalls.length > 0 && attempts < 5) {
          attempts++;
          const toolOutputs = [];

          for (const call of functionCalls) {
            if (call.functionCall) {
              const { name, args } = call.functionCall;
              console.log(`[MCP Tool Invoke] calling ${name} with`, args);
              try {
                const result = this.executeTool(name, args);
                if (name === 'compute_full_return') {
                  latestCalc = result;
                }
                toolOutputs.push({
                  functionResponse: {
                    name,
                    response: { result },
                  },
                });
              } catch (err: any) {
                toolOutputs.push({
                  functionResponse: {
                    name,
                    response: { error: err.message },
                  },
                });
              }
            }
          }

          // Send tool output back to Gemini
          response = await chat.sendMessage(toolOutputs);
          functionCalls = response.response.candidates?.[0]?.content?.parts?.filter(
            p => p.functionCall
          ) || [];
        }

        replyText = response.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (err: any) {
        console.error('Error in Vertex AI Loop:', err);
        replyText = `I ran into an error communicating with Vertex AI: ${err.message}. Running calculation locally.`;
      }
    } else {
      // Fallback local mode
      replyText = `I have updated your computation. Total tax due is £${(latestCalc.incomeTax.incomeTaxTotal / 100).toLocaleString()}. Let me know if you would like to claim Overseas Workday Relief or add employment details.`;
    }

    // 3. Post-Check Guardrail (Scan for numerical hallucinations)
    const sanitizedReply = this.applyNumericalGuardrail(replyText, validAmounts);

    // 4. Update phase state machine heuristically
    const nextPhase = this.stateMachine.determineNextPhase(message, sanitizedReply);
    if (nextPhase) {
      this.stateMachine.transitionTo(nextPhase, `LLM Conversation transition`);
    }

    return {
      reply: sanitizedReply,
      phase: this.stateMachine.getCurrentPhase(),
      calculation: latestCalc,
    };
  }

  private getValidAmounts(comp: any): Set<number> {
    const valid = new Set<number>();
    if (!comp) return valid;
    valid.add(comp.balancingPayment / 100);
    valid.add(comp.incomeTax?.incomeTaxTotal / 100);
    valid.add(comp.incomeTax?.personalAllowance / 100);
    if (comp.incomeTax?.allocatedBands) {
      comp.incomeTax.allocatedBands.forEach((b: any) => {
        valid.add(b.amountAllocated / 100);
        valid.add(b.taxCharged / 100);
      });
    }
    return valid;
  }

  private applyNumericalGuardrail(reply: string, validAmounts: Set<number>): string {
    const matches = reply.match(/(?:£\s*)?(\d+(?:,\d{3})*(?:\.\d{2})?)/g) || [];
    let cleanReply = reply;

    for (const m of matches) {
      const clean = m.replace(/[£,]/g, '').trim();
      const amt = parseFloat(clean);

      // Block unverified currency figures over £100
      if (amt > 100 && !validAmounts.has(amt)) {
        console.warn(`[Numerical Guardrail] Blocked hallucinated figure: £${amt}`);
        cleanReply = cleanReply.replace(m, '[REDACTED_UNVERIFIED_FIGURE]');
      }
    }
    return cleanReply;
  }
}
