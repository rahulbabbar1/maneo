import { FilingProvider, FilingSubmissionResult, ValidationResult } from './provider.js';
import { Return } from '@uk-sa-app/return-model';

/**
 * Implementation of FilingProvider for the modern Making Tax Digital (MTD) for Income Tax rail.
 * Will act as the migration target (v2) once SA109 pages are supported natively by HMRC's ITSA REST API.
 */
export class MtdItsaProvider implements FilingProvider {
  name = 'mtd-itsa-rest';

  async validate(returnObj: Return): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!returnObj.id) errors.push('Return ID is missing');
    if (!returnObj.clientId) errors.push('Client ID is missing');
    if (!returnObj.taxYear) errors.push('Tax Year is missing');

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
      console.log('[MtdItsaProvider] Submitting JSON data to HMRC MTD REST endpoints...');
      // 1. Submit periodic / annual income updates to HMRC's income-tax-submission REST endpoints
      // 2. Trigger calculation: Individual Calculations API
      // 3. Retrieve calc and perform line-by-line check against local assembler output
      // 4. Crystallise: submit final declaration
      
      throw new Error('Making Tax Digital (ITSA) REST provider is not yet active for SA109 returns.');
    } catch (err: any) {
      return {
        success: false,
        correlationId: returnObj.id,
        errors: [err.message || 'MTD ITSA submission failed'],
      };
    }
  }
}
