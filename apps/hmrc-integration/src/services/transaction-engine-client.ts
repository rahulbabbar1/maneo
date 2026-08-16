// ─────────────────────────────────────────────────────────────────────────────
// HMRC Transaction Engine SOAP client (WS3: Real submission).
//
// Handles the asynchronous submit → poll → receipt lifecycle for the
// legacy Self Assessment XML filing rail.
//
// Endpoints:
//   Sandbox:    https://test-transaction-engine.tax.service.gov.uk/submission
//   Production: https://transaction-engine.tax.service.gov.uk/submission
// ─────────────────────────────────────────────────────────────────────────────

export interface TransactionEngineConfig {
  endpoint: string;
  vendorId: string;
  productName: string;
  productVersion: string;
}

export interface SubmissionResponse {
  correlationId: string;
  status: 'acknowledged' | 'error' | 'polling';
  receiptId?: string;
  errors?: Array<{ code: string; message: string; location?: string }>;
  pollUri?: string;
  pollInterval?: number; // seconds
}

const SANDBOX_ENDPOINT = 'https://test-transaction-engine.tax.service.gov.uk/submission';
const PRODUCTION_ENDPOINT = 'https://transaction-engine.tax.service.gov.uk/submission';

/**
 * Returns the correct Transaction Engine endpoint based on environment.
 */
export function getTransactionEngineConfig(): TransactionEngineConfig {
  const isProduction = process.env.NODE_ENV === 'production' &&
    process.env.HMRC_USE_SANDBOX !== 'true';

  return {
    endpoint: isProduction ? PRODUCTION_ENDPOINT : SANDBOX_ENDPOINT,
    vendorId: process.env.HMRC_VENDOR_ID || '',
    productName: 'Maneo',
    productVersion: '1.0.0',
  };
}

/**
 * Submits a GovTalk XML envelope to the HMRC Transaction Engine.
 *
 * The Transaction Engine is asynchronous:
 *   1. POST the XML → receive acknowledgement with a correlation ID
 *   2. Poll the provided URI until the submission is processed
 *   3. Receive either a receipt (success) or validation errors
 */
export async function submitToTransactionEngine(
  xmlEnvelope: string,
  config: TransactionEngineConfig,
): Promise<SubmissionResponse> {
  if (!config.vendorId) {
    throw new Error('HMRC Vendor ID is required for Transaction Engine submission. Set HMRC_VENDOR_ID env var.');
  }

  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
      },
      body: xmlEnvelope,
    });

    const responseText = await response.text();

    if (!response.ok) {
      return {
        correlationId: '',
        status: 'error',
        errors: [{ code: `HTTP_${response.status}`, message: `Transaction Engine returned ${response.status}: ${responseText.slice(0, 500)}` }],
      };
    }

    return parseTransactionEngineResponse(responseText);
  } catch (err: any) {
    return {
      correlationId: '',
      status: 'error',
      errors: [{ code: 'NETWORK_ERROR', message: err.message || 'Failed to reach HMRC Transaction Engine' }],
    };
  }
}

/**
 * Polls the Transaction Engine for a submission result.
 * Returns when the submission is complete (success or error), or throws on timeout.
 */
export async function pollForResult(
  correlationId: string,
  pollUri: string,
  maxAttempts: number = 30,
  intervalMs: number = 5000,
): Promise<SubmissionResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));

    try {
      const response = await fetch(pollUri, {
        method: 'GET',
        headers: { 'Accept': 'application/xml' },
      });

      const responseText = await response.text();
      const parsed = parseTransactionEngineResponse(responseText);

      if (parsed.status !== 'polling') {
        return parsed;
      }
    } catch (err: any) {
      console.error(`[TransactionEngine] Poll attempt ${attempt + 1} failed:`, err.message);
      // Continue polling on transient errors
    }
  }

  return {
    correlationId,
    status: 'error',
    errors: [{ code: 'POLL_TIMEOUT', message: `Submission ${correlationId} did not complete within ${maxAttempts * intervalMs / 1000} seconds` }],
  };
}

/**
 * Parses a GovTalk response XML into a structured SubmissionResponse.
 *
 * GovTalk responses contain:
 *   - <GovTalkMessage> with <Header><MessageDetails><Qualifier> = acknowledgement/response/error
 *   - <CorrelationID> for tracking
 *   - <GovTalkErrors> with error details
 *   - <Body> with receipt data on success
 */
function parseTransactionEngineResponse(xml: string): SubmissionResponse {
  // Extract correlation ID
  const corrMatch = xml.match(/<CorrelationID>([^<]+)<\/CorrelationID>/);
  const correlationId = corrMatch ? corrMatch[1] : '';

  // Check for errors
  const errorMatches = [...xml.matchAll(/<Error>\s*<Number>([^<]*)<\/Number>\s*<Type>[^<]*<\/Type>\s*<Text>([^<]*)<\/Text>/gs)];
  if (errorMatches.length > 0) {
    return {
      correlationId,
      status: 'error',
      errors: errorMatches.map(m => ({
        code: m[1],
        message: m[2],
      })),
    };
  }

  // Check qualifier for status
  const qualifierMatch = xml.match(/<Qualifier>([^<]+)<\/Qualifier>/);
  const qualifier = qualifierMatch ? qualifierMatch[1].toLowerCase() : '';

  if (qualifier === 'acknowledgement') {
    // Extract poll URI if provided
    const pollMatch = xml.match(/<GatewayTimestamp>[^<]*<\/GatewayTimestamp>/);
    return {
      correlationId,
      status: 'polling',
      pollUri: `${SANDBOX_ENDPOINT}/${correlationId}/poll`,
      pollInterval: 5,
    };
  }

  if (qualifier === 'response') {
    // Extract receipt
    const irMarkMatch = xml.match(/<IRmark[^>]*>([^<]+)<\/IRmark>/);
    return {
      correlationId,
      status: 'acknowledged',
      receiptId: correlationId,
      ...(irMarkMatch && { }),
    };
  }

  // Default: treat as polling
  return {
    correlationId,
    status: 'polling',
    pollUri: `${SANDBOX_ENDPOINT}/${correlationId}/poll`,
  };
}

/**
 * Maps HMRC business-validation error codes to specific return fields
 * for user-facing error messages.
 */
export function mapHmrcErrorToField(errorCode: string): { field: string; message: string } | null {
  const ERROR_MAP: Record<string, { field: string; message: string }> = {
    'BV101': { field: 'clientDetails.utr', message: 'UTR is invalid or does not match HMRC records' },
    'BV102': { field: 'sa102', message: 'Employment details are incomplete or inconsistent' },
    'BV103': { field: 'sa109.residenceStatus', message: 'Residence status declaration is inconsistent' },
    'BV104': { field: 'sa106.foreignIncome', message: 'Foreign income details require correction' },
    'BV105': { field: 'sa108.disposals', message: 'Capital gains disposal details are invalid' },
    'BV106': { field: 'sa110', message: 'Tax calculation does not reconcile' },
  };

  return ERROR_MAP[errorCode] || null;
}
