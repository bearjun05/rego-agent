# ─────────────────────────────────────────────────────────
# rego-agent runtime — Railway deployment
# ─────────────────────────────────────────────────────────
FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# 의존성 캐싱
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc turbo.json ./
COPY apps/runtime/package.json ./apps/runtime/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/runtime-sdk/package.json ./packages/runtime-sdk/
COPY packages/tools/package.json ./packages/tools/
COPY packages/db/package.json ./packages/db/
COPY agents/_template/package.json ./agents/_template/
RUN pnpm install --frozen-lockfile=false --prefer-offline

# Build
FROM deps AS build
COPY . .
RUN pnpm --filter @rego/runtime build || echo "Build skipped (tsx runtime)"

# Production runtime — tsx로 직접 실행 (간소화)
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY . /app
WORKDIR /app

EXPOSE 3001
CMD ["pnpm", "--filter", "@rego/runtime", "exec", "tsx", "src/server.ts"]
