import { z } from 'zod';

const EnvSchema = z.object({
  // Slack
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_ID: z.string().optional(),
  /** 봇 자신의 user id (U…) — self-message 무시용 (선택, bot_id 필터가 1차 방어) */
  SLACK_BOT_USER_ID: z.string().optional(),
  /** 감시할 채널 allowlist (쉼표구분 ID 또는 이름). 비우면 전체 채널 */
  SLACK_MONITOR_CHANNELS: z.string().optional(),
  /** Tier2 OAuth (유저 토큰 발급/회전) — 기존 Slack 앱의 client id/secret */
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  /** OAuth 콜백 URL (예: https://<rego>/oauth/slack/callback) */
  SLACK_OAUTH_REDIRECT: z.string().optional(),
  /** 유저 토큰 암호화 키 (DB 저장 시 aes-256-gcm) */
  TOKEN_ENC_KEY: z.string().optional(),
  /** Tier2 폴러 on/off 및 주기(ms) */
  SLACK_POLL_ENABLED: z.string().optional(),
  SLACK_POLL_INTERVAL_MS: z.coerce.number().default(45_000),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),

  // GitHub
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Database
  DATABASE_URL: z.string().optional(),

  // Admin
  ADMIN_PASSWORD: z.string().optional(),

  // Models — OpenRouter deepseek (llm.ts 기본값과 일치)
  MODEL_CLASSIFY: z.string().default('deepseek/deepseek-v4-flash'),
  MODEL_GENERATE: z.string().default('deepseek/deepseek-v4-flash'),
  MODEL_CHAT: z.string().default('deepseek/deepseek-v4-flash'),

  // Runtime
  RUNTIME_PORT: z.coerce.number().default(3001),
  DASHBOARD_PORT: z.coerce.number().default(3000),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3001'),
  DASHBOARD_BASE_URL: z.string().default('http://localhost:3000'),

  // Limits
  RUN_TIMEOUT_MS: z.coerce.number().default(30_000),
  RUN_MAX_LLM_CALLS: z.coerce.number().default(10),
  RUN_MAX_TOOL_CALLS: z.coerce.number().default(20),
  RUNAWAY_CALLS_PER_MIN: z.coerce.number().default(200),
  RUNAWAY_LLM_PER_MIN: z.coerce.number().default(100),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function env(): Env {
  if (_env) return _env;
  _env = EnvSchema.parse(process.env);
  return _env;
}

export function secret(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required secret ${key} is not set in environment`);
  }
  return value;
}
