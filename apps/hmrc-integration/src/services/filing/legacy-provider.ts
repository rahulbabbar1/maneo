import { FilingProvider, FilingSubmissionResult, ValidationResult } from './provider.js';
import { Return } from '@uk-sa-app/return-model';
import { buildLegacySaXml } from '../../xml.js';

/**
 * Implementation of FilingProvider for the legacy Self Assessment (SA) SOAP/XML rail.
 */
export class LegacySaXmlProvider implements FilingProvider {
  name = 'legacy-sa-xml';

  async validate(returnObj: Return): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!returnObj.id) errors.push('Return ID is missing');
    if (!returnObj.taxYear) errors.push('Tax Year is missing');
    if (!returnObj.sa100) errors.push('SA100 section is missing');
    
    // Core details check
    if (returnObj.sa102 && returnObj.sa102.length > 0) {
      returnObj.sa102.forEach((emp, index) => {
        if (!emp.employerName) errors.push(`Employment ${index + 1}: Employer Name is missing`);
      });
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

      const isSandbox = process.env.NODE_ENV !== 'production' || process.env.HMRC_USE_SANDBOX === 'true';

      if (isSandbox) {
        console.log('[LegacySaXmlProvider] Simulating legacy XML submission to HMRC sandbox...');
        return {
          success: true,
          correlationId: returnObj.id,
          receiptId: `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          irMark,
        };
      }

      // Real HMRC SOAP POST request to HMRC Transaction Engine goes here.
      // (Requires agent credentials, HMRC certificates, and SOAP payload wrapping)
      throw new Error('Real production HMRC Transaction Engine endpoint is not yet configured.');
    } catch (err: any) {
      return {
        success: false,
        correlationId: returnObj.id,
        errors: [err.message || 'Legacy XML submission failed'],
      };
    }
  }
}
