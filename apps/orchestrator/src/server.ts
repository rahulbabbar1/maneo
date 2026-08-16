import Fastify from 'fastify';
import cors from '@fastify/cors';
import admin from 'firebase-admin';
import { computeFullReturn, FullReturnComputation } from '@uk-sa-app/tax-core';
import { getConfig } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { PiiScrubber } from './services/pii-scrubber.js';
import { GeminiAgent } from './services/gemini-agent.js';
import { extractTaxDocument, extractMultipleDocuments } from './services/document-extractor.js';
import { generateTaxReturnPdf } from './services/pdf-generator.js';
import { FilingPhase } from './services/filing-state.js';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// bodyLimit raised to 25MB to accommodate multi-file uploads / ZIP files / multi-page PDFs
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: [
      'req.headers.authorization',
      '*.password',
      '*.secret',
      '*.token',
      '*.utr',
      '*.nino',
      '*.fileBase64',
    ],
  },
  bodyLimit: 25 * 1024 * 1024,
});

// ── CORS: explicit allowlist only ──────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:5173,http://localhost:3000,https://maneo.web.app,https://uk-self-assessment.web.app')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

await fastify.register(cors, {
  origin: allowedOrigins,
  credentials: true,
});

// ── Firebase Admin: verify caller identity ───────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp();
}

// ── Security headers on every response ────────────────────────────────────────
fastify.addHook('onSend', (_request, reply, payload, done) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (IS_PRODUCTION) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  done(null, payload);
});

async function verifyAuth(request: any, reply: any) {
  const header: string | undefined = request.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    reply.code(401);
    throw new Error('Missing or malformed Authorization header');
  }
  const idToken = header.slice('Bearer '.length).trim();

  // Demo token is ONLY accepted in non-production environments.
  if (!IS_PRODUCTION && idToken === 'demo-token') {
    request.user = { uid: 'demo-user-123', email: 'demo@maneo.app' };
    return;
  }

  // In production (and for non-demo tokens in dev), always verify via Firebase Admin.
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    request.user = decoded;
  } catch (err: any) {
    reply.code(401);
    throw new Error('Invalid or expired ID token');
  }
}

const project = process.env.GCP_PROJECT || 'uk-self-assessment';
const region = process.env.GCP_REGION || 'europe-west2';

import { createRateLimiter } from './middleware/rate-limiter.js';
import { CalculateRequestSchema, ChatRequestSchema, ExtractDocumentSchema, validateBody } from './middleware/validators.js';

const chatRateLimiter = createRateLimiter(30, 60000);
const extractRateLimiter = createRateLimiter(10, 60000);

// 1. Health check endpoint (public)
fastify.get('/api/health', async () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    vertex: { project, region },
  };
});

// 2. Direct tax calculation endpoint
fastify.post('/api/calculate', { preHandler: [verifyAuth, chatRateLimiter] }, async (request, reply) => {
  try {
    const { returnObj, taxYear } = validateBody(CalculateRequestSchema, request.body);
    const config = getConfig(taxYear || '2025-26');
    const result = computeFullReturn(returnObj as Return, config);
    return { status: 'success', calculation: result };
  } catch (err: any) {
    reply.status(400);
    return { status: 'error', message: err.message || 'Calculation error' };
  }
});

// 3. Agentic chat endpoint
fastify.post('/api/chat', { preHandler: [verifyAuth, chatRateLimiter] }, async (request, reply) => {
  try {
    const { message, returnObj, taxYear, phase, history } = validateBody(ChatRequestSchema, request.body);

    const scrubber = new PiiScrubber();

    if (returnObj.clientId) scrubber.registerTerm(returnObj.clientId, 'CLIENT');
    if (Array.isArray(returnObj.sa102)) {
      for (const emp of returnObj.sa102) {
        if (emp.employerName) scrubber.registerTerm(emp.employerName, 'EMPLOYER');
        if (emp.employerRef) scrubber.registerTerm(emp.employerRef, 'EMPLOYER_REF');
      }
    }

    const scrubbedMessage = scrubber.scrub(message || '');
    fastify.log.info(`Scrubbed incoming message: "${scrubbedMessage}"`);

    const agent = new GeminiAgent(project, region, phase as FilingPhase);
    const turnResult = await agent.runConversationTurn(scrubbedMessage, returnObj as Return, history);

    const finalReply = scrubber.unscrub(turnResult.reply);

    return {
      reply: finalReply,
      phase: turnResult.phase,
      calculation: turnResult.calculation,
    };
  } catch (err: any) {
    reply.status(err.message?.startsWith('Validation Error') ? 400 : 500);
    return { status: 'error', message: err.message || 'Agent chat processing error' };
  }
});

// 4. Document extraction endpoint (single or batch multi-file upload)
fastify.post('/api/extract-document', { preHandler: [verifyAuth, extractRateLimiter] }, async (request, reply) => {
  try {
    const body = validateBody(ExtractDocumentSchema, request.body);

    if (body.files && Array.isArray(body.files) && body.files.length > 0) {
      const extractions = await extractMultipleDocuments(project, region, body.files);
      return { status: 'success', extractions, isBatch: true };
    }

    if (!body.fileBase64 || !body.mimeType) {
      reply.status(400);
      return { status: 'error', message: 'Missing fileBase64 or mimeType.' };
    }

    const extraction = await extractTaxDocument(project, region, body.fileBase64, body.mimeType, body.fileName);
    return { status: 'success', extraction, isBatch: false };
  } catch (err: any) {
    reply.status(err.message?.startsWith('Validation Error') ? 400 : 500);
    return { status: 'error', message: err?.message || 'Extraction error' };
  }
});

// 5. Final Return PDF Generation endpoint
fastify.post('/api/generate-pdf', { preHandler: verifyAuth }, async (request, reply) => {
  const { returnObj, calculation } = request.body as { returnObj: Return; calculation?: FullReturnComputation };
  if (!returnObj) {
    reply.status(400);
    return { status: 'error', message: 'Missing returnObj in request body.' };
  }

  try {
    // If calculation wasn't passed in, compute it locally
    let calc = calculation;
    if (!calc) {
      const config = getConfig(returnObj.taxYear || '2025-26');
      calc = computeFullReturn(returnObj, config);
    }

    const pdfBuffer = generateTaxReturnPdf(returnObj, calc);
    const taxYear = returnObj.taxYear || '2025-26';

    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="Tax_Return_${taxYear}_${returnObj.clientId || 'SA100'}.pdf"`)
      .send(pdfBuffer);
  } catch (err: any) {
    reply.status(500);
    return { status: 'error', message: err?.message || 'PDF generation error' };
  }
});

// ── Return Persistence API (WS2: Server-side return storage) ─────────────────

import {
  listReturns,
  getReturn,
  createReturn,
  updateReturn,
  saveComputation,
  getAuditTrail,
} from './services/return-store.js';

// 6. List all returns for the authenticated user
fastify.get('/api/returns', { preHandler: verifyAuth }, async (request) => {
  const userId = (request as any).user?.uid;
  const returns = await listReturns(userId);
  return { status: 'success', returns };
});

// 7. Get a specific return
fastify.get('/api/returns/:id', { preHandler: verifyAuth }, async (request, reply) => {
  const userId = (request as any).user?.uid;
  const { id } = request.params as { id: string };
  const ret = await getReturn(userId, id);
  if (!ret) {
    reply.status(404);
    return { status: 'error', message: 'Return not found' };
  }
  return { status: 'success', return: ret };
});

// 8. Create a new return
fastify.post('/api/returns', { preHandler: verifyAuth }, async (request) => {
  const userId = (request as any).user?.uid;
  const { returnObj } = request.body as { returnObj: Return };
  const id = await createReturn(userId, returnObj);
  return { status: 'success', id };
});

// 9. Update an existing return
fastify.put('/api/returns/:id', { preHandler: verifyAuth }, async (request, reply) => {
  const userId = (request as any).user?.uid;
  const { id } = request.params as { id: string };
  const { updates, auditAction, auditDetails } = request.body as {
    updates: Partial<Return>;
    auditAction?: string;
    auditDetails?: Record<string, any>;
  };
  try {
    await updateReturn(userId, id, updates, auditAction, auditDetails);
    return { status: 'success' };
  } catch (err: any) {
    reply.status(400);
    return { status: 'error', message: err.message };
  }
});

// 10. Get audit trail for a return
fastify.get('/api/returns/:id/audit', { preHandler: verifyAuth }, async (request) => {
  const userId = (request as any).user?.uid;
  const { id } = request.params as { id: string };
  const events = await getAuditTrail(userId, id);
  return { status: 'success', events };
});


// Start Fastify Server
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Orchestrator BFF server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
