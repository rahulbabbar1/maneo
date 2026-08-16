// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter Middleware for Orchestrator API (WS1: Hardening).
//
// Per-user sliding-window rate limiting for financial & AI endpoints.
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyRequest, FastifyReply } from 'fastify';

interface RateLimitStore {
  timestamps: number[];
}

const userRequestStore = new Map<string, RateLimitStore>();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, store] of userRequestStore.entries()) {
    store.timestamps = store.timestamps.filter(ts => now - ts < 60000);
    if (store.timestamps.length === 0) {
      userRequestStore.delete(key);
    }
  }
}, 600000);

export function createRateLimiter(maxRequests: number = 30, windowMs: number = 60000) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const identifier = user?.uid || request.ip;
    const now = Date.now();

    let store = userRequestStore.get(identifier);
    if (!store) {
      store = { timestamps: [] };
      userRequestStore.set(identifier, store);
    }

    // Filter out timestamps outside the window
    store.timestamps = store.timestamps.filter(ts => now - ts < windowMs);

    if (store.timestamps.length >= maxRequests) {
      reply.code(429);
      reply.header('Retry-After', Math.ceil(windowMs / 1000));
      throw new Error(`Too many requests. Limit is ${maxRequests} per ${windowMs / 1000}s. Please wait before retrying.`);
    }

    store.timestamps.push(now);
  };
}
