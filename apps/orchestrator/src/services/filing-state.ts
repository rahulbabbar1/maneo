// ─────────────────────────────────────────────────────────────────────────────
// Filing-state manager (D4 §3 — context management).
//
// Maintains an authoritative, structured filing-state object that is injected
// into the system prompt each turn. This replaces replaying the full
// conversation transcript and addresses "context rot" in long sessions.
//
// Every confirmed fact carries provenance (user_stated, document_extracted,
// agent_derived) and an optional confidence score. The state tracks:
//   - Which supplementary forms are triggered (SA102, SA106, SA108, SA109)
//   - What the agent still needs to ask (open questions)
//   - Conversation phase (replaces the rigid FSM)
//   - A compact summary of the conversation so far (compaction digest)
// ─────────────────────────────────────────────────────────────────────────────

import { Return } from '@uk-sa-app/return-model';

export type ProvenanceSource = 'user_stated' | 'document_extracted' | 'agent_derived';

export type FilingPhase =
  | 'onboarding'      // initial greeting, tax year, basic info
  | 'residence'       // SRT, split-year, FIG
  | 'income'          // employment, foreign income, UK investment
  | 'gains'           // capital gains (SA108)
  | 'reliefs'         // gift aid, pension, child benefit, student loan
  | 'review'          // pre-submission check, validate_return
  | 'declaration'     // final confirmation before submit
  | 'submitted';      // filed

export interface ConfirmedFact {
  field: string;            // e.g. 'sa102[0].grossPay', 'sa109.daysInUk'
  displayValue: string;     // human-readable, e.g. '£85,000'
  source: ProvenanceSource;
  confidence: number;       // 0–1, 1.0 = certain
  confirmedByUser: boolean; // true if the user explicitly confirmed this value
  timestamp: string;
}

export interface OpenQuestion {
  id: string;
  question: string;
  context: string;          // why this matters
  priority: 'blocking' | 'important' | 'nice_to_have';
  relatedForm: string;      // e.g. 'SA106', 'SA109'
}

export interface EscalationRecord {
  reason: string;
  timestamp: string;
  resolved: boolean;
}

export interface FilingState {
  phase: FilingPhase;
  triggeredForms: string[];            // e.g. ['SA102', 'SA106', 'SA109']
  confirmedFacts: ConfirmedFact[];
  openQuestions: OpenQuestion[];
  escalations: EscalationRecord[];
  compactionDigest: string | null;     // summary of compacted history
  turnCount: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createFilingState(): FilingState {
  return {
    phase: 'onboarding',
    triggeredForms: [],
    confirmedFacts: [],
    openQuestions: [],
    escalations: [],
    compactionDigest: null,
    turnCount: 0,
  };
}

// ─── State inference from the return object ──────────────────────────────────

/** Derives the triggered forms and a reasonable phase from the return data. */
export function inferStateFromReturn(returnObj: Return): FilingState {
  const state = createFilingState();

  // Triggered forms
  if (returnObj.sa102?.length) state.triggeredForms.push('SA102');
  if (returnObj.sa106?.foreignIncome?.length) state.triggeredForms.push('SA106');
  if (returnObj.sa108?.disposals?.length) state.triggeredForms.push('SA108');
  if (returnObj.sa109) state.triggeredForms.push('SA109');
  if (returnObj.sa101) state.triggeredForms.push('SA101');

  // Confirmed facts from existing data
  if (returnObj.sa102?.length) {
    for (const emp of returnObj.sa102) {
      state.confirmedFacts.push({
        field: `sa102.${emp.employerName}.grossPay`,
        displayValue: `£${(emp.grossPay / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
        source: 'user_stated',
        confidence: 1.0,
        confirmedByUser: true,
        timestamp: returnObj.updatedAt,
      });
    }
  }

  if (returnObj.sa109) {
    const rs = returnObj.sa109.residenceStatus;
    state.confirmedFacts.push({
      field: 'sa109.srtResult',
      displayValue: rs.srtResult.replace('_', '-'),
      source: 'user_stated',
      confidence: 1.0,
      confirmedByUser: true,
      timestamp: returnObj.updatedAt,
    });
  }

  // Phase inference
  if (returnObj.status === 'submitted') {
    state.phase = 'submitted';
  } else if (returnObj.status === 'review' || returnObj.status === 'ready') {
    state.phase = 'review';
  } else if (returnObj.sa109 && returnObj.sa102?.length) {
    state.phase = 'reliefs'; // has basics, likely working on reliefs/extras
  } else if (returnObj.sa102?.length) {
    state.phase = 'income';
  } else if (returnObj.sa109) {
    state.phase = 'residence';
  }

  // Open questions for foreign nationals
  const openQuestions: OpenQuestion[] = [];
  const foreignDom = returnObj.sa109?.residenceStatus?.domicileStatus === 'foreign_domiciled';

  if (!returnObj.sa109) {
    openQuestions.push({
      id: 'oq-residence',
      question: 'What is the client\'s UK residence status?',
      context: 'Required for foreign-national returns. Need days in UK, SRT status, and domicile.',
      priority: 'blocking',
      relatedForm: 'SA109',
    });
  }

  if (foreignDom && !returnObj.sa106?.foreignIncome?.length && !returnObj.sa109?.residenceStatus?.figRegimeElected) {
    openQuestions.push({
      id: 'oq-foreign-income',
      question: 'Does the client have any foreign income?',
      context: 'Foreign-domiciled but no foreign income recorded. Check for overseas dividends, interest, rental, employment.',
      priority: 'important',
      relatedForm: 'SA106',
    });
  }

  if (!returnObj.sa102?.length && !returnObj.sa106?.foreignIncome?.length) {
    openQuestions.push({
      id: 'oq-income-source',
      question: 'What are the client\'s income sources?',
      context: 'No income recorded yet. Need employment (P60), foreign income, UK investments, or other sources.',
      priority: 'blocking',
      relatedForm: 'SA102',
    });
  }

  const empTotal = (returnObj.sa102 || []).reduce((a, j) => a + (j.grossPay || 0), 0);
  if (empTotal > 6000000 && !returnObj.sa101?.highIncomeChildBenefitCharge?.benefitAmountReceived) {
    openQuestions.push({
      id: 'oq-hicbc',
      question: 'Does the client or their partner receive Child Benefit?',
      context: 'Income exceeds £60,000. HICBC may apply.',
      priority: 'important',
      relatedForm: 'SA101',
    });
  }

  state.openQuestions = openQuestions;
  return state;
}

// ─── Compact rendering for system prompt injection ───────────────────────────

/** Renders the filing state as a compact, high-signal string for the system prompt. */
export function renderFilingState(state: FilingState): string {
  const lines: string[] = [];

  lines.push(`Phase: ${state.phase} | Turn: ${state.turnCount} | Forms: ${state.triggeredForms.join(', ') || 'none yet'}`);

  if (state.confirmedFacts.length) {
    const factSummary = state.confirmedFacts
      .slice(-10) // only the most recent 10
      .map(f => `  · ${f.field}: ${f.displayValue} [${f.source}${f.confidence < 0.9 ? `, confidence ${(f.confidence * 100).toFixed(0)}%` : ''}]`)
      .join('\n');
    lines.push(`Confirmed (latest ${Math.min(state.confirmedFacts.length, 10)} of ${state.confirmedFacts.length}):\n${factSummary}`);
  }

  if (state.openQuestions.length) {
    const blocking = state.openQuestions.filter(q => q.priority === 'blocking');
    const important = state.openQuestions.filter(q => q.priority === 'important');
    if (blocking.length) {
      lines.push(`⚠ BLOCKING (${blocking.length}): ${blocking.map(q => q.question).join(' | ')}`);
    }
    if (important.length) {
      lines.push(`→ TO ASK (${important.length}): ${important.map(q => q.question).join(' | ')}`);
    }
  }

  if (state.escalations.some(e => !e.resolved)) {
    lines.push(`🚨 Pending escalation(s): ${state.escalations.filter(e => !e.resolved).map(e => e.reason).join('; ')}`);
  }

  if (state.compactionDigest) {
    lines.push(`[Compacted history]: ${state.compactionDigest}`);
  }

  return lines.join('\n');
}

// ─── History compaction ──────────────────────────────────────────────────────

const COMPACTION_THRESHOLD = 30; // turns before compaction kicks in

/**
 * Determines whether the conversation history should be compacted.
 * Called each turn; returns true when the turn count exceeds the threshold.
 */
export function shouldCompact(state: FilingState): boolean {
  return state.turnCount >= COMPACTION_THRESHOLD;
}

/**
 * Produces a compaction digest from the conversation history.
 * This is a deterministic summary (no LLM call) — it extracts confirmed facts,
 * decisions made, and unresolved items from the filing state itself.
 */
export function compactHistory(state: FilingState): string {
  const parts: string[] = [];

  if (state.confirmedFacts.length) {
    parts.push(`Facts confirmed: ${state.confirmedFacts.length} fields across forms [${state.triggeredForms.join(', ')}].`);
  }

  const resolved = state.escalations.filter(e => e.resolved);
  if (resolved.length) {
    parts.push(`Resolved escalations: ${resolved.map(e => e.reason).join('; ')}.`);
  }

  const unresolved = state.openQuestions.filter(q => q.priority === 'blocking');
  if (unresolved.length) {
    parts.push(`Still outstanding: ${unresolved.map(q => q.question).join('; ')}.`);
  }

  parts.push(`Session has run ${state.turnCount} turns, now in phase "${state.phase}".`);
  return parts.join(' ');
}
