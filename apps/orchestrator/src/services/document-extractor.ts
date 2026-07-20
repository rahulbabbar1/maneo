import { VertexAI } from '@google-cloud/vertexai';

// Real P60/P45 reader. Uses Gemini multimodal to CLASSIFY the uploaded document
// and only extract figures if it is genuinely a P60/P45. Anything else (a CV,
// payslip, invoice, bank statement) is rejected with its detected type — the
// service never fabricates pay figures.

const APPROVED_REGION_PREFIXES = ['europe-', 'eu'];

export interface ExtractionResult {
  isP60: boolean;
  documentType: string;
  employerName?: string;
  employerRef?: string;
  grossPay?: number;    // POUNDS
  taxDeducted?: number; // POUNDS
  confidence?: number;
  message?: string;
}

const PROMPT = `You are a UK tax-document classifier and extractor. Examine the attached file and decide whether it is a UK P60 (End of Year Certificate) or a P45.

- If it IS a P60/P45: extract the employer name, the employer PAYE reference (often formatted like 123/AB456), the total pay for the year in this employment (grossPay), and the total tax deducted (taxDeducted). grossPay and taxDeducted must be numbers in POUNDS.
- If it is NOT a P60/P45 — for example a CV/resume, cover letter, payslip, invoice, bank statement, or anything else — set isP60 to false and set documentType to what you actually see (e.g. "CV/resume"). Do NOT output any pay figures in this case.

Never guess or invent figures. Only report grossPay/taxDeducted that you can actually read on a genuine P60/P45.

Respond with ONLY this JSON and nothing else:
{"isP60": boolean, "documentType": string, "employerName": string|null, "employerRef": string|null, "grossPay": number|null, "taxDeducted": number|null, "confidence": number}`;

export async function extractTaxDocument(
  project: string,
  region: string,
  base64: string,
  mimeType: string,
): Promise<ExtractionResult> {
  if (!APPROVED_REGION_PREFIXES.some(p => region.startsWith(p))) {
    return { isP60: false, documentType: 'unknown', message: 'Document reading is disabled outside the approved UK/EU region.' };
  }

  let vertexAI: VertexAI;
  try {
    vertexAI = new VertexAI({ project, location: region });
  } catch {
    return { isP60: false, documentType: 'unknown', message: 'Document reader is unavailable in this environment.' };
  }

  const model = vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { maxOutputTokens: 1024, temperature: 0, responseMimeType: 'application/json' },
  });

  try {
    const resp = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: PROMPT },
        ],
      }],
    });

    const text = (resp.response.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    const parsed = JSON.parse(text);

    // Hard guard: never surface figures for a non-P60, whatever the model said.
    if (!parsed?.isP60) {
      return { isP60: false, documentType: parsed?.documentType || 'unrecognised document' };
    }
    return {
      isP60: true,
      documentType: parsed.documentType || 'P60',
      employerName: parsed.employerName || undefined,
      employerRef: parsed.employerRef || undefined,
      grossPay: typeof parsed.grossPay === 'number' ? parsed.grossPay : undefined,
      taxDeducted: typeof parsed.taxDeducted === 'number' ? parsed.taxDeducted : undefined,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    };
  } catch (e: any) {
    console.error('[Document Extraction Error]', e?.message || e);
    return { isP60: false, documentType: 'unknown', message: 'Could not read that document. Please enter the figures manually.' };
  }
}
