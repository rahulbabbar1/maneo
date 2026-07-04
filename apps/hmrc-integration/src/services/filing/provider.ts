import { Return } from '@uk-sa-app/return-model';

export interface FilingSubmissionResult {
  success: boolean;
  correlationId: string;
  receiptId?: string;
  irMark?: string;
  errors?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Interface representing a generic tax filing provider (legacy SA vs. MTD).
 */
export interface FilingProvider {
  name: string;
  validate(returnObj: Return): Promise<ValidationResult>;
  submit(returnObj: Return, agentId: string, headers: Record<string, string>): Promise<FilingSubmissionResult>;
}
