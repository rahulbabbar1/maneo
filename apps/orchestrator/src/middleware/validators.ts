// ─────────────────────────────────────────────────────────────────────────────
// Request Body Validators using Zod (WS1: Hardening / G15).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { ReturnSchema } from '@uk-sa-app/return-model';

export const CalculateRequestSchema = z.object({
  returnObj: ReturnSchema,
  taxYear: z.string().default('2025-26'),
});

export const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(4000, 'Message exceeds maximum length'),
  returnObj: ReturnSchema,
  taxYear: z.string().default('2025-26'),
  phase: z.string().optional(),
  history: z.array(z.any()).optional().default([]),
});

export const ExtractDocumentSchema = z.object({
  fileBase64: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  files: z.array(z.object({
    fileBase64: z.string(),
    mimeType: z.string(),
    fileName: z.string().optional(),
  })).optional(),
});

export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const errorDetails = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Validation Error: ${errorDetails}`);
  }
  return result.data;
}
