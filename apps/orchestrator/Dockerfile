# Use Node.js production-ready base image
FROM node:20-slim AS builder

WORKDIR /usr/src/app

# Copy monorepo configurations
COPY package*.json ./
COPY tsconfig.json ./
COPY apps/orchestrator/package*.json ./apps/orchestrator/
COPY apps/web/package*.json ./apps/web/
COPY apps/hmrc-integration/package*.json ./apps/hmrc-integration/
COPY packages/return-model/package*.json ./packages/return-model/
COPY packages/tax-config/package*.json ./packages/tax-config/
COPY packages/tax-core/package*.json ./packages/tax-core/
COPY packages/knowledge/package*.json ./packages/knowledge/
COPY packages/mcp-servers/package*.json ./packages/mcp-servers/
COPY packages/hmrc-artefacts/package*.json ./packages/hmrc-artefacts/

# Install dependencies (workspaces will link packages automatically)
RUN npm ci

# Copy source code of required packages and orchestrator
COPY packages/ ./packages/
COPY apps/orchestrator/ ./apps/orchestrator/

# Build packages and orchestrator
RUN npm run build --workspace @uk-sa-app/return-model
RUN npm run build --workspace @uk-sa-app/tax-config
RUN npm run build --workspace @uk-sa-app/tax-core
RUN npm run build --workspace @uk-sa-app/knowledge
RUN npm run build --workspace @uk-sa-app/orchestrator

# Second stage: production container
FROM node:20-slim

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
COPY apps/orchestrator/package*.json ./apps/orchestrator/
COPY apps/web/package*.json ./apps/web/
COPY apps/hmrc-integration/package*.json ./apps/hmrc-integration/
COPY packages/return-model/package*.json ./packages/return-model/
COPY packages/tax-config/package*.json ./packages/tax-config/
COPY packages/tax-core/package*.json ./packages/tax-core/
COPY packages/knowledge/package*.json ./packages/knowledge/
COPY packages/mcp-servers/package*.json ./packages/mcp-servers/
COPY packages/hmrc-artefacts/package*.json ./packages/hmrc-artefacts/

# Install production-only dependencies
RUN npm ci --omit=dev

# Copy compiled files from builder
COPY --from=builder /usr/src/app/packages/return-model/dist ./packages/return-model/dist
COPY --from=builder /usr/src/app/packages/tax-config/dist ./packages/tax-config/dist
COPY --from=builder /usr/src/app/packages/tax-core/dist ./packages/tax-core/dist
COPY --from=builder /usr/src/app/packages/knowledge/dist ./packages/knowledge/dist
COPY --from=builder /usr/src/app/apps/orchestrator/dist ./apps/orchestrator/dist

EXPOSE 3001

# Start the Fastify backend server
CMD ["node", "apps/orchestrator/dist/server.js"]
