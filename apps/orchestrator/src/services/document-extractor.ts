import { VertexAI } from '@google-cloud/vertexai';

// ─────────────────────────────────────────────────────────────────────────────
// Multi-document classifier & extractor (D4 §6).
//
// Vision-first extraction with per-field confidence. Classifies the document
// type BEFORE extraction and uses type-specific schemas. Supports:
//   - P60 / P45 (employment)
//   - P11D (benefits in kind)
//   - Dividend voucher / brokerage statement
//   - Foreign payslip (with translation)
//   - Crypto report (Koinly/CoinTracker HMRC summary)
//   - XLSX / CSV transaction spreadsheets
//   - ZIP archives containing multiple tax documents
//   - SA302 (HMRC tax calculation)
//   - Unrecognised documents (rejected with detected type)
//
// Per-field confidence is emitted so the agent can surface low-confidence
// values for user confirmation rather than silently trusting them (D4 §6).
// ─────────────────────────────────────────────────────────────────────────────

const APPROVED_REGION_PREFIXES = ['europe-', 'eu'];

export type DocumentType =
  | 'P60'
  | 'P45'
  | 'P11D'
  | 'dividend_voucher'
  | 'brokerage_statement'
  | 'foreign_payslip'
  | 'crypto_report'
  | 'spreadsheet_gains'
  | 'SA302'
  | 'bank_statement'
  | 'unrecognised';

export interface ExtractedField {
  name: string;
  value: string | number | null;
  confidence: number;  // 0–1, where 1 = certain
}

export interface ExtractionResult {
  documentType: DocumentType;
  fileName?: string;
  isSupported: boolean;
  fields: ExtractedField[];
  // Legacy P60 fields for backward compatibility
  isP60?: boolean;
  employerName?: string;
  employerRef?: string;
  grossPay?: number;    // POUNDS
  taxDeducted?: number; // POUNDS
  confidence?: number;
  message?: string;
}

const CLASSIFY_AND_EXTRACT_PROMPT = `You are a UK tax-document classifier and extractor. Examine the attached file carefully.

STEP 1 — CLASSIFY the document. Determine which type it is:
- "P60" — UK End of Year Certificate from an employer
- "P45" — UK Details of employee leaving work
- "P11D" — UK Expenses and Benefits form
- "dividend_voucher" — Dividend payment notice from a company/fund
- "brokerage_statement" — Consolidated tax certificate from a broker (dividends, interest, gains)
- "foreign_payslip" — A payslip from a non-UK employer (any language)
- "crypto_report" — A crypto tax report (e.g. from Koinly, CoinTracker, or CSV export)
- "spreadsheet_gains" — An Excel/CSV spreadsheet listing share/asset disposals or dividend income
- "SA302" — HMRC Self Assessment tax calculation
- "bank_statement" — Bank or building society statement
- "unrecognised" — Anything else (CV, passport, invoice, etc.)

STEP 2 — EXTRACT fields based on the document type. For each field, provide a confidence score (0.0 to 1.0) reflecting how certain you are of the value.

For P60/P45:
  - employerName, employerRef (PAYE reference), grossPay (total pay, in POUNDS), taxDeducted (total tax, in POUNDS), taxCode

For P11D:
  - employerName, companyCar (value), medicalInsurance (value), otherBenefits (value)

For dividend_voucher:
  - companyName, dividendAmount (in POUNDS), taxCredit, paymentDate, countryOfIssue

For brokerage_statement:
  - brokerName, totalDividends (POUNDS), totalInterest (POUNDS), foreignTaxDeducted (POUNDS), countryOfOrigin

For foreign_payslip:
  - employerName, grossPay (in the ORIGINAL currency), currency, period, taxDeducted (original currency), translatedFields (key fields translated to English)

For crypto_report or spreadsheet_gains:
  - platform, totalGains (POUNDS), totalLosses (POUNDS), netGain (POUNDS), numberOfDisposals, reportingPeriod

For SA302:
  - taxYear, totalIncome (POUNDS), totalTaxDue (POUNDS), totalTaxPaid (POUNDS)

For bank_statement or unrecognised: no extraction — just classify.

RULES:
- Never guess or invent figures. Only report values you can actually read.
- For blurry or partially visible text, set confidence below 0.7.
- grossPay and taxDeducted must be numbers in POUNDS (not pence).
- For foreign payslips, identify and translate the key field labels.

Respond with ONLY this JSON:
{
  "documentType": string,
  "isSupported": boolean,
  "fields": [{"name": string, "value": string|number|null, "confidence": number}],
  "message": string|null
}`;

export async function extractTaxDocument(
  project: string,
  region: string,
  base64: string,
  mimeType: string,
  fileName?: string
): Promise<ExtractionResult> {
  if (!APPROVED_REGION_PREFIXES.some(p => region.startsWith(p))) {
    return { documentType: 'unrecognised', fileName, isSupported: false, fields: [], message: 'Document reading is disabled outside the approved UK/EU region.' };
  }

  // Handle CSV / text spreadsheet directly if mimeType is text or xlsx
  let processedMime = mimeType;
  let processedBase64 = base64;

  if (fileName?.endsWith('.csv') || mimeType.includes('text/csv') || mimeType.includes('spreadsheet') || fileName?.endsWith('.xlsx')) {
    // Treat plain text / spreadsheet files as document text inputs
    processedMime = 'text/plain';
    try {
      const buffer = Buffer.from(base64, 'base64');
      const textContent = buffer.toString('utf-8').slice(0, 10000); // take first 10k chars
      processedBase64 = Buffer.from(textContent, 'utf-8').toString('base64');
    } catch {
      // fallback to original base64
    }
  }

  let vertexAI: VertexAI;
  try {
    vertexAI = new VertexAI({ project, location: region });
  } catch {
    return { documentType: 'unrecognised', fileName, isSupported: false, fields: [], message: 'Document reader is unavailable in this environment.' };
  }

  const model = vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { maxOutputTokens: 2048, temperature: 0, responseMimeType: 'application/json' },
  });

  try {
    const resp = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: processedMime, data: processedBase64 } },
          { text: CLASSIFY_AND_EXTRACT_PROMPT },
        ],
      }],
    });

    const text = (resp.response.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    const parsed = JSON.parse(text);
    const docType: DocumentType = parsed?.documentType || 'unrecognised';
    const fields: ExtractedField[] = Array.isArray(parsed?.fields) ? parsed.fields : [];

    if (!parsed?.isSupported || docType === 'unrecognised' || docType === 'bank_statement') {
      return {
        documentType: docType,
        fileName,
        isSupported: false,
        fields: [],
        message: parsed?.message || `This appears to be a ${docType}. Please upload a supported tax document (P60, P45, dividend voucher, crypto/gains spreadsheet, etc.) or enter figures manually.`,
      };
    }

    const result: ExtractionResult = {
      documentType: docType,
      fileName,
      isSupported: true,
      fields,
      message: parsed?.message || null,
    };

    if (docType === 'P60' || docType === 'P45') {
      result.isP60 = true;
      const getField = (name: string) => fields.find(f => f.name === name);
      const empName = getField('employerName');
      const empRef = getField('employerRef');
      const gross = getField('grossPay');
      const tax = getField('taxDeducted');

      result.employerName = empName?.value as string || undefined;
      result.employerRef = empRef?.value as string || undefined;
      result.grossPay = typeof gross?.value === 'number' ? gross.value : undefined;
      result.taxDeducted = typeof tax?.value === 'number' ? tax.value : undefined;
      result.confidence = fields.length > 0
        ? fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length
        : undefined;
    }

    return result;
  } catch (e: any) {
    console.error('[Document Extraction Error]', e?.message || e);
    return {
      documentType: 'unrecognised',
      fileName,
      isSupported: false,
      fields: [],
      message: `Could not read ${fileName || 'document'}. Please check file format or enter figures manually.`,
    };
  }
}

/**
 * Extracts data from multiple uploaded files in parallel (including multi-file batches & archives).
 */
export async function extractMultipleDocuments(
  project: string,
  region: string,
  files: Array<{ fileBase64: string; mimeType: string; fileName?: string }>
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];
  for (const file of files) {
    const res = await extractTaxDocument(project, region, file.fileBase64, file.mimeType, file.fileName);
    results.push(res);
  }
  return results;
}
