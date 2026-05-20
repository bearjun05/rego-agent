import { z } from 'zod';

const EnvSchema = z.object({
  // Slack
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_ID: z.string().optional(),

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

  // Models
  MODEL_CLASSIFY: z.string().default('anthropic/claude-haiku-4.5'),
  MODEL_GENERATE: z.string().default('anthropic/claude-sonnet-4.5'),
  MODEL_CHAT: z.string().default('anthropic/claude-sonnet-4.5'),

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
