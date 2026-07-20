// ─────────────────────────────────────────────────────────────────────────────
// Guardrail telemetry & audit log (D4 §7).
//
// Every guardrail trigger is emitted as structured JSON telemetry.
// This satisfies the D4 recommendation: "Emit every guardrail trigger as
// telemetry; monitor pass/fail rates over time; the audit trail satisfies
// retention/compliance needs."
//
// Events are logged to stdout as structured JSON for Cloud Logging ingestion.
// In production, these can be routed to BigQuery / a compliance audit store.
// ─────────────────────────────────────────────────────────────────────────────

export enum GuardrailEventType {
  /** A monetary figure in the model's reply was redacted as unverified. */
  FIGURE_REDACTED = 'figure_redacted',
  /** Return or computation provenance validation found issues. */
  PROVENANCE_VIOLATION = 'provenance_violation',
  /** PII was detected and scrubbed from user input. */
  PII_DETECTED = 'pii_detected',
  /** The agent escalated to a human specialist. */
  ESCALATION = 'escalation',
  /** The agent refused an unsafe request (evasion, fabrication, etc.). */
  UNSAFE_REQUEST_REFUSED = 'unsafe_request_refused',
  /** A low-confidence extraction field was flagged for user confirmation. */
  LOW_CONFIDENCE_EXTRACTION = 'low_confidence_extraction',
}

export interface GuardrailEvent {
  type: GuardrailEventType;
  returnId: string;
  details: Record<string, any>;
}

interface TelemetryEntry {
  timestamp: string;
  service: 'maneo-orchestrator';
  severity: 'WARNING' | 'INFO';
  guardrail: GuardrailEvent;
}

/**
 * Emits a guardrail event as structured JSON to stdout.
 * Cloud Logging picks this up as a structured log entry when running on Cloud Run.
 */
export function emitGuardrailEvent(event: GuardrailEvent): void {
  const severity = [
    GuardrailEventType.FIGURE_REDACTED,
    GuardrailEventType.PROVENANCE_VIOLATION,
    GuardrailEventType.UNSAFE_REQUEST_REFUSED,
  ].includes(event.type) ? 'WARNING' : 'INFO';

  const entry: TelemetryEntry = {
    timestamp: new Date().toISOString(),
    service: 'maneo-orchestrator',
    severity,
    guardrail: event,
  };

  // Structured JSON log — Cloud Logging parses this automatically.
  console.log(JSON.stringify(entry));
}

/**
 * Convenience: emit a provenance violation event.
 */
export function emitProvenanceEvent(returnId: string, violations: string[]): void {
  emitGuardrailEvent({
    type: GuardrailEventType.PROVENANCE_VIOLATION,
    returnId,
    details: { violations },
  });
}

/**
 * Convenience: emit a PII detection event.
 */
export function emitPiiEvent(returnId: string, piiTypes: string[]): void {
  emitGuardrailEvent({
    type: GuardrailEventType.PII_DETECTED,
    returnId,
    details: { typesDetected: piiTypes },
  });
}

/**
 * Convenience: emit a low-confidence extraction event.
 */
export function emitLowConfidenceEvent(
  returnId: string,
  fieldName: string,
  confidence: number,
  extractedValue: string,
): void {
  emitGuardrailEvent({
    type: GuardrailEventType.LOW_CONFIDENCE_EXTRACTION,
    returnId,
    details: { fieldName, confidence, extractedValue },
  });
}
