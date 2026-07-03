import Fastify from 'fastify';
import cors from '@fastify/cors';
import { computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { PiiScrubber } from './services/pii-scrubber.js';
import { GeminiAgent } from './services/gemini-agent.js';
import { PhaseKey } from './services/state-machine.js';

const fastify = Fastify({ logger: true });

// Register CORS for Frontend Communication
await fastify.register(cors, {
  origin: '*',
});

const project = process.env.GCP_PROJECT || 'project-db80b905-1ac5-4954-bf0';
const region = process.env.GCP_REGION || 'europe-west2';

// 1. Health check endpoint
fastify.get('/api/health', async () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    vertexConfig: {
      project,
      region,
      trainingDisabled: true,
      zdrApplied: true,
    },
  };
});

// 2. Direct tax calculation endpoint (used by UI for instant updates)
fastify.post('/api/calculate', async (request, reply) => {
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
fastify.post('/api/chat', async (request, reply) => {
  const { message, returnObj, taxYear, phase, history = [] } = request.body as {
    message: string;
    returnObj: Return;
    taxYear: string;
    phase?: PhaseKey;
    history?: any[];
  };

  try {
    // A. Initialize PII Scrubber
    const scrubber = new PiiScrubber();
    
    // Register terms to prevent leakage
    if (returnObj.clientId) scrubber.registerTerm(returnObj.clientId, 'CLIENT');
    if (returnObj.sa102) {
      for (const emp of returnObj.sa102) {
        if (emp.employerName) scrubber.registerTerm(emp.employerName, 'EMPLOYER');
        if (emp.employerRef) scrubber.registerTerm(emp.employerRef, 'EMPLOYER_REF');
      }
    }

    // Scrub incoming message
    const scrubbedMessage = scrubber.scrub(message);
    fastify.log.info(`Scrubbed incoming message: "${scrubbedMessage}"`);

    // B. Initialize/Call Gemini Agent Loop
    const agent = new GeminiAgent(project, region, phase);
    const turnResult = await agent.runConversationTurn(scrubbedMessage, returnObj, history);

    // C. Unscrub reply to restore user-specific names
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
