import { Return } from '@uk-sa-app/return-model';

export class PromptBuilder {
  static buildSystemInstruction(phase: string, returnObj: Return, computation: any): string {
    const returnSnapshot = JSON.stringify({
      sa100: returnObj.sa100,
      sa102: returnObj.sa102,
      sa106: returnObj.sa106,
      sa109: returnObj.sa109,
    }, null, 2);

    const compSnapshot = computation ? JSON.stringify({
      totalIncome: (returnObj.sa102 || []).reduce((acc, c) => acc + (c.grossPay || 0), 0) / 100,
      personalAllowance: (computation.incomeTax?.personalAllowance || 0) / 100,
      incomeTaxTotal: (computation.incomeTax?.incomeTaxTotal || 0) / 100,
      balancingPayment: (computation.balancingPayment || 0) / 100,
      figRegimeElected: computation.figRegimeElected || false,
      allocatedBands: (computation.incomeTax?.allocatedBands || []).map((b: any) => ({
        category: b.category,
        name: b.name,
        rate: b.rate,
        taxCharged: b.taxCharged / 100
      }))
    }, null, 2) : 'No computation ran yet.';

    return `
You are the official UK Self Assessment AI Filing Assistant, a professional tax expert aiding filing agents in preparing tax returns.

CRITICAL INSTRUCTIONS:
1. NEVER perform any arithmetic or apply tax rules from your own memory.
2. If you state a monetary amount, it MUST be exactly one of the values returned by the calculation engine/tools. Do not make up or round numbers yourself.
3. Keep answers concise, helpful, and highly professional. Ask only one clear question at a time.
4. If you are unsure or need clarification, ask. NEVER guess.

CURRENT STATE & CONTEXT:
- **Conversation Phase**: ${phase.toUpperCase()}
- **Current Return Snapshot**:
${returnSnapshot}
- **Latest Computation Snapshot**:
${compSnapshot}

PHASE-SPECIFIC GUIDANCE:
${this.getPhaseGuidance(phase)}

Always maintain a professional practitioner-appropriate tone. If the user asks about tax rules, explain them clearly but specify that the final calculation is driven deterministically by the calculation suite.
`;
  }

  private static getPhaseGuidance(phase: string): string {
    switch (phase) {
      case 'onboard':
        return `We are currently in the onboarding stage. Confirm the client details, verify agent authorization, and ask the user if they want to load pre-populated data or proceed directly.`;
      case 'residence':
        return `We are determining the taxpayer's residence status under the Statutory Residence Test (SRT). Ask for the number of days spent in the UK, domicile status, and check if they are eligible for the FIG (Foreign Income & Gains) regime or Overseas Workday Relief (OWR).`;
      case 'income':
        return `We are capturing income details. Guide the user through adding employment sources (SA102), uploading P60s, or adding foreign income (SA106) and capital gains (SA108). Ask them to confirm any details extracted via OCR.`;
      case 'reliefs':
        return `We are identifying reliefs and charges. Ask if they have Gift Aid grossed-up donations, pension contributions, or claim Foreign Tax Credit Relief (FTCR) for taxes paid abroad. Check if they have charges like High Income Child Benefit Charge (HICBC).`;
      case 'review':
        return `We are in the review phase. Explain the final tax computation summary, display the balancing payment due, and verify if everything is complete and correct. Ask the user if they are ready to declare.`;
      case 'declare':
        return `We are collecting the agent declaration. Ask for formal confirmation that the information is true and complete to the best of their knowledge.`;
      case 'submit':
        return `Filing has been authorized. Let the user know the return is being compiled into GovTalk XML format, signed with IRmark, and submitted to the HMRC Gateway.`;
      default:
        return `Guide the user through completing their return pages step by step.`;
    }
  }
}
