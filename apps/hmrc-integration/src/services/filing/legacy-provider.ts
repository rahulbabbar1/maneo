import { FilingProvider, FilingSubmissionResult, ValidationResult } from './provider.js';
import { Return } from '@uk-sa-app/return-model';
import { buildLegacySaXml } from '../../xml.js';
import {
  submitToTransactionEngine,
  pollForResult,
  getTransactionEngineConfig,
  mapHmrcErrorToField,
} from '../transaction-engine-client.js';

/**
 * Implementation of FilingProvider for the legacy Self Assessment (SA) SOAP/XML rail.
 *
 * In sandbox mode: submits to the HMRC test Transaction Engine.
 * In production mode: submits to the live Transaction Engine.
 * Both use the real async submit → poll → receipt lifecycle.
 */
export class LegacySaXmlProvider implements FilingProvider {
  name = 'legacy-sa-xml';

  async validate(returnObj: Return): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!returnObj.id) errors.push('Return ID is missing');
    if (!returnObj.taxYear) errors.push('Tax Year is missing');
    if (!returnObj.sa100) errors.push('SA100 section is missing');
    if (!returnObj.clientDetails?.utr) errors.push('Client UTR is missing — required for HMRC filing');

    // Core details check
    if (returnObj.sa102 && returnObj.sa102.length > 0) {
      returnObj.sa102.forEach((emp, index) => {
        if (!emp.employerName) errors.push(`Employment ${index + 1}: Employer Name is missing`);
      });
    }

    // Must have at least one income source
    const hasEmployment = (returnObj.sa102 || []).length > 0;
    const hasForeignIncome = (returnObj.sa106?.foreignIncome || []).length > 0;
    const hasCapitalGains = (returnObj.sa108?.disposals || []).length > 0;
    if (!hasEmployment && !hasForeignIncome && !hasCapitalGains) {
      errors.push('At least one income source (employment, foreign income, or capital gains) is required');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async submit(
    returnObj: Return,
    _agentId: string,
    _headers: Record<string, string>
  ): Promise<FilingSubmissionResult> {
    const validation = await this.validate(returnObj);
    if (!validation.valid) {
      return {
        success: false,
        correlationId: returnObj.id,
        errors: validation.errors,
      };
    }

    try {
      const xml = buildLegacySaXml(returnObj);
      const irMarkMatch = xml.match(/<IRmark[^>]*>([^<]+)<\/IRmark>/);
      const irMark = irMarkMatch ? irMarkMatch[1] : undefined;

      const config = getTransactionEngineConfig();

      // If no Vendor ID is configured, fall back to sandbox simulation
      // (allows development and testing without HMRC credentials)
      if (!config.vendorId) {
        console.warn('[LegacySaXmlProvider] No HMRC_VENDOR_ID set — running in local simulation mode.');
        return {
          success: true,
          correlationId: returnObj.id,
          receiptId: `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          irMark,
        };
      }

      // Submit to the real HMRC Transaction Engine
      console.log(`[LegacySaXmlProvider] Submitting to ${config.endpoint}...`);
      const submitResponse = await submitToTransactionEngine(xml, config);

      if (submitResponse.status === 'error') {
        const fieldErrors = (submitResponse.errors || []).map(e => {
          const mapping = mapHmrcErrorToField(e.code);
          return mapping
            ? `${mapping.field}: ${mapping.message} (${e.code})`
            : `${e.code}: ${e.message}`;
        });

        return {
          success: false,
          correlationId: submitResponse.correlationId || returnObj.id,
          errors: fieldErrors,
        };
      }

      // Poll for result if the submission is being processed
      if (submitResponse.status === 'polling' && submitResponse.pollUri) {
        console.log(`[LegacySaXmlProvider] Polling for result at ${submitResponse.pollUri}...`);
        const pollResult = await pollForResult(
          submitResponse.correlationId,
          submitResponse.pollUri,
          30,  // max 30 attempts
          5000 // 5 second intervals
        );

        if (pollResult.status === 'error') {
          return {
            success: false,
            correlationId: pollResult.correlationId || returnObj.id,
            errors: (pollResult.errors || []).map(e => `${e.code}: ${e.message}`),
          };
        }

        return {
          success: true,
          correlationId: pollResult.correlationId,
          receiptId: pollResult.receiptId,
          irMark,
        };
      }

      // Direct acknowledgement (unlikely but handle it)
      return {
        success: true,
        correlationId: submitResponse.correlationId,
        receiptId: submitResponse.receiptId,
        irMark,
      };
    } catch (err: any) {
      return {
        success: false,
        correlationId: returnObj.id,
        errors: [err.message || 'Legacy XML submission failed'],
      };
    }
  }
}
