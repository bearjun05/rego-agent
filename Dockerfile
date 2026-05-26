# ─────────────────────────────────────────────────────────
# rego-agent runtime — Railway 배포 (Hono API + webhooks)
# tsx로 TS 소스를 직접 실행 (workspace 패키지들이 src/*.ts를 export)
# ─────────────────────────────────────────────────────────
FROM node:20-slim AS base
# git: T5 hot reload(학습자 브랜치 부분 checkout)에 필요
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# ── deps: lockfile 기준 재현 가능한 설치 (dev deps 포함 — tsx 필요) ──
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc turbo.json ./
COPY apps/runtime/package.json ./apps/runtime/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/runtime-sdk/package.json ./packages/runtime-sdk/
COPY packages/tools/package.json ./packages/tools/
COPY packages/db/package.json ./packages/db/
COPY agents/_template/package.json ./agents/_template/
RUN pnpm install --frozen-lockfile --prefer-offline

# ── runtime: deps 트리(workspace symlink 포함) + 소스 ──
# .dockerignore가 node_modules/.env/빌드산출물을 제외하므로
# `COPY . .`가 deps의 node_modules를 덮어쓰지 않음 (pnpm symlink 보존)
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY . .
# Railway가 PORT를 동적 주입 → server.ts가 process.env.PORT 사용 (EXPOSE 불필요)
CMD ["pnpm", "--filter", "@rego/runtime", "exec", "tsx", "src/server.ts"]
