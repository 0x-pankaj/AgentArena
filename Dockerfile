# syntax=docker/dockerfile:1
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app

# Copy only the manifests first so Docker can cache the install layer.
# All workspace package.jsons are required for the lockfile to validate.
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/

RUN bun install --frozen-lockfile --filter "agent-arena" --filter "@agent-arena/api" --filter "@agent-arena/shared"

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json turbo.json ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

# Railway sets PORT; the API reads it. Default 3001 for local docker runs.
EXPOSE 3001

CMD ["bun", "run", "apps/api/src/index.ts"]
