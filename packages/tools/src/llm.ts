import { z, defineTool } from '@rego/runtime-sdk';
import type {
  LLMApi,
  LLMCallOptions,
  LLMResult,
  ClassifyOptions,
} from '@rego/runtime-sdk';

const DEFAULT_MODEL_GENERATE =
  process.env.MODEL_GENERATE ?? 'anthropic/claude-sonnet-4.5';
const DEFAULT_MODEL_CLASSIFY =
  process.env.MODEL_CLASSIFY ?? 'anthropic/claude-haiku-4.5';

/**
 * 가벼운 OpenRouter REST 클라이언트.
 * 응답에서 토큰 사용량 + cost를 추출.
 */
export interface OpenRouterCallParams {
  apiKey: string;
  model: string;
  system?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  baseUrl?: string;
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost?: number;
  };
}

export async function callOpenRouter(
  params: OpenRouterCallParams,
): Promise<{ result: OpenRouterResponse; durationMs: number }> {
  const start = Date.now();
  const baseUrl = params.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.system
      ? [{ role: 'system', content: params.system }, ...params.messages]
      : params.messages,
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.responseFormat === 'json') body.response_format = { type: 'json_object' };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.PUBLIC_BASE_URL ?? 'https://rego-agent.local',
      'X-Title': 'Rego Agent Study Platform',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as OpenRouterResponse;
  return { result: data, durationMs: Date.now() - start };
}

/**
 * 로그/기록 callback을 받아서 ctx.llm 인터페이스를 구현
 */
export interface CreateLlmApiOptions {
  apiKey: string;
  agentName: string;
  runId: string;
  defaultGenerateModel?: string;
  defaultClassifyModel?: string;
  onCallComplete?: (info: {
    model: string;
    purpose?: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
    promptPreview: string;
    responsePreview: string;
  }) => Promise<void> | void;
  onError?: (err: { model: string; error: string }) => Promise<void> | void;
}

export function createLlmApi(opts: CreateLlmApiOptions): LLMApi {
  const generateModel = opts.defaultGenerateModel ?? DEFAULT_MODEL_GENERATE;
  const classifyModel = opts.defaultClassifyModel ?? DEFAULT_MODEL_CLASSIFY;

  const _call = async (
    prompt: string,
    o: LLMCallOptions = {},
    fallbackModel: string,
  ): Promise<LLMResult> => {
    const model = o.model ?? fallbackModel;
    try {
      const { result, durationMs } = await callOpenRouter({
        apiKey: opts.apiKey,
        model,
        system: o.system,
        messages: [{ role: 'user', content: prompt }],
        temperature: o.temperature,
        maxTokens: o.maxTokens,
        responseFormat: o.responseFormat,
      });
      const text = result.choices[0]?.message?.content ?? '';
      const inputTokens = result.usage?.prompt_tokens ?? 0;
      const outputTokens = result.usage?.completion_tokens ?? 0;
      const costUsd = result.usage?.cost ?? estimateCost(model, inputTokens, outputTokens);

      await opts.onCallComplete?.({
        model,
        purpose: o.purpose,
        inputTokens,
        outputTokens,
        costUsd,
        durationMs,
        promptPreview: prompt.slice(0, 500),
        responsePreview: text.slice(0, 500),
      });

      return { text, inputTokens, outputTokens, costUsd, model, durationMs };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await opts.onError?.({ model, error });
      throw err;
    }
  };

  return {
    async generate(prompt, o) {
      return _call(prompt, o, generateModel);
    },
    async classify({ text, categories, prompt, model }) {
      const cats = categories.map((c) =>
        typeof c === 'string' ? { id: c, description: c } : c,
      );
      const system =
        prompt ??
        `너는 메시지를 카테고리로 분류하는 분류기야. 다음 카테고리 중 하나로만 분류해.\n` +
          cats.map((c) => `- ${c.id}: ${c.description}`).join('\n');
      const userPrompt = `메시지: """${text}"""\n\nJSON 형식으로 응답: {"category": "<id>", "confidence": <0~1 float>, "reason": "<짧은 설명>"}`;

      const r = await _call(
        userPrompt,
        { model: model ?? classifyModel, system, responseFormat: 'json', purpose: 'classify', maxTokens: 200 },
        classifyModel,
      );
      try {
        const parsed = JSON.parse(r.text) as {
          category: string;
          confidence: number;
          reason?: string;
        };
        return parsed;
      } catch {
        return { category: cats[0]?.id ?? 'unknown', confidence: 0, reason: 'parse-failed' };
      }
    },
    async generateJson<T>(prompt: string, schema: z.ZodType<T>, o?: LLMCallOptions): Promise<T> {
      const r = await _call(
        prompt,
        { ...o, responseFormat: 'json' },
        o?.model ?? generateModel,
      );
      const raw = JSON.parse(r.text);
      return schema.parse(raw);
    },
  };
}

/**
 * 모델별 cost 추정 (OpenRouter가 usage.cost 안 줄 때 fallback)
 * 단위: USD per 1M tokens (대략값)
 */
const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  'anthropic/claude-haiku-4.5': { input: 1.0, output: 5.0 },
  'anthropic/claude-3-5-haiku': { input: 1.0, output: 5.0 },
  'anthropic/claude-3-5-haiku-20241022': { input: 1.0, output: 5.0 },
  'anthropic/claude-sonnet-4.5': { input: 3.0, output: 15.0 },
  'anthropic/claude-sonnet-4': { input: 3.0, output: 15.0 },
  'anthropic/claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'anthropic/claude-3-7-sonnet': { input: 3.0, output: 15.0 },
  'anthropic/claude-opus-4': { input: 15.0, output: 75.0 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4o': { input: 2.5, output: 10.0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_TABLE[model] ?? { input: 3.0, output: 15.0 };
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// ─────────────────────────────────────────────────────────
// 사용자 노출용 도구 (자유롭게 fold-in)
// — 이건 manifest에 명시 안 해도 ctx.llm으로 직접 부를 수 있게 했지만,
//   tool로서 시각화/audit이 필요하면 이걸 부르면 됨.
// ─────────────────────────────────────────────────────────
export const llmGenerate = defineTool({
  id: 'llm.generate',
  name: 'LLM 텍스트 생성',
  description: 'LLM에게 자유 형식의 텍스트를 생성받습니다',
  category: 'llm',
  icon: '🧠',
  color: '#7C3AED',
  inputs: z.object({
    prompt: z.string(),
    system: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    model: z.string().optional(),
  }),
  outputs: z.object({
    text: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.number(),
  }),
  costTier: 'medium',
  latencyTier: 'medium',
  secrets: ['OPENROUTER_API_KEY'],
  async run({ prompt, system, temperature, maxTokens, model }, ctx) {
    // ctx에 llm 노출 안 됨 — 이 도구는 직접 OpenRouter 호출
    const apiKey = ctx.secret('OPENROUTER_API_KEY');
    const { result } = await callOpenRouter({
      apiKey,
      model: model ?? DEFAULT_MODEL_GENERATE,
      system,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      maxTokens,
    });
    const text = result.choices[0]?.message?.content ?? '';
    const inputTokens = result.usage?.prompt_tokens ?? 0;
    const outputTokens = result.usage?.completion_tokens ?? 0;
    const costUsd = result.usage?.cost ?? estimateCost(model ?? DEFAULT_MODEL_GENERATE, inputTokens, outputTokens);
    return { text, inputTokens, outputTokens, costUsd };
  },
});

export const llmClassify = defineTool({
  id: 'llm.classify',
  name: 'LLM 분류',
  description: '메시지를 주어진 카테고리 중 하나로 분류합니다',
  category: 'llm',
  icon: '🏷️',
  color: '#7C3AED',
  inputs: z.object({
    text: z.string(),
    categories: z.array(z.string()),
    prompt: z.string().optional(),
    model: z.string().optional(),
  }),
  outputs: z.object({
    category: z.string(),
    confidence: z.number(),
    reason: z.string().optional(),
  }),
  costTier: 'low',
  latencyTier: 'fast',
  secrets: ['OPENROUTER_API_KEY'],
  async run({ text, categories, prompt, model }, ctx) {
    const apiKey = ctx.secret('OPENROUTER_API_KEY');
    const system =
      prompt ??
      `너는 메시지를 카테고리로 분류하는 분류기야. 다음 카테고리 중 하나로만 분류해: ${categories.join(', ')}`;
    const userPrompt = `메시지: """${text}"""\n\nJSON으로 응답: {"category": "<id>", "confidence": <0~1>, "reason": "<짧은 설명>"}`;
    const { result } = await callOpenRouter({
      apiKey,
      model: model ?? DEFAULT_MODEL_CLASSIFY,
      system,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 200,
      responseFormat: 'json',
    });
    const raw = result.choices[0]?.message?.content ?? '{}';
    try {
      const parsed = JSON.parse(raw) as { category: string; confidence: number; reason?: string };
      return parsed;
    } catch {
      return { category: categories[0] ?? 'unknown', confidence: 0, reason: 'parse-failed' };
    }
  },
});

export const allLlmTools = [llmGenerate, llmClassify];
