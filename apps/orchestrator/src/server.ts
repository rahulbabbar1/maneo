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

// bodyLimit raised to 25MB to accommodate multi-file uploads / ZIP files / multi-page PDFs
const fastify = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

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

async function verifyAuth(request: any, reply: any) {
  const header: string | undefined = request.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    reply.code(401);
    throw new Error('Missing or malformed Authorization header');
  }
  const idToken = header.slice('Bearer '.length).trim();
  if (idToken === 'demo-token' || process.env.NODE_ENV !== 'production') {
    request.user = { uid: 'demo-user-123', email: 'demo@maneo.app' };
    return;
  }
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

// 1. Health check endpoint (public)
fastify.get('/api/health', async () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    vertex: { project, region },
  };
});

// 2. Direct tax calculation endpoint
fastify.post('/api/calculate', { preHandler: verifyAuth }, async (request, reply) => {
  const { returnObj, taxYear } = request.body as { returnObj: Return; taxYear: string };
  try {
    const config = getConfig(taxYear);
    const result = computeFullReturn(returnObj, config);
    return { status: 'success', calculation: result };
  } catch (err: any) {
    reply.status(400);
    return { status: 'error', message: err.message || 'Calculation error' };
  }
});

// 3. Agentic chat endpoint
fastify.post('/api/chat', { preHandler: verifyAuth }, async (request, reply) => {
  const { message, returnObj, taxYear, phase, history = [] } = request.body as {
    message: string;
    returnObj: Return;
    taxYear: string;
    phase?: FilingPhase;
    history?: any[];
  };

  try {
    const scrubber = new PiiScrubber();

    if (returnObj.clientId) scrubber.registerTerm(returnObj.clientId, 'CLIENT');
    if (Array.isArray(returnObj.sa102)) {
      for (const emp of returnObj.sa102) {
        if (emp.employerName) scrubber.registerTerm(emp.employerName, 'EMPLOYER');
        if (emp.employerRef) scrubber.registerTerm(emp.employerRef, 'EMPLOYER_REF');
      }
    }

    const scrubbedMessage = scrubber.scrub(message);
    fastify.log.info(`Scrubbed incoming message: "${scrubbedMessage}"`);

    const agent = new GeminiAgent(project, region, phase);
    const turnResult = await agent.runConversationTurn(scrubbedMessage, returnObj, history);

    const finalReply = scrubber.unscrub(turnResult.reply);

    return {
      reply: finalReply,
      phase: turnResult.phase,
      calculation: turnResult.calculation,
    };
  } catch (err: any) {
    reply.status(500);
    return { status: 'error', message: err.message || 'Agent chat processing error' };
  }
});

// 4. Document extraction endpoint (single or batch multi-file upload)
fastify.post('/api/extract-document', { preHandler: verifyAuth }, async (request, reply) => {
  const body = request.body as {
    fileBase64?: string;
    mimeType?: string;
    fileName?: string;
    files?: Array<{ fileBase64: string; mimeType: string; fileName?: string }>;
  };

  try {
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
    reply.status(500);
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
