import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, agents, kvState } from '@rego/db';
import { callOpenRouter, extractJson } from '@rego/tools/llm';
import type { LoadedAgent } from './agent-registry.js';
import { env } from './env.js';
import { createLogger } from './logger.js';
import { getEventBus } from './event-bus.js';

const log = createLogger('analyzer');
// 코드 변경 없으면 LLM 분석을 건너뛰기 위한 해시 캐시 (kv_state, 시스템 namespace)
const ANALYZER_NS = '__analyzer__';

const AnalysisSchema = z.object({
  summary: z.string(),
  capabilities: z.array(z.string()).default([]),
  techniques: z.array(z.string()).default([]),
});
type Analysis = z.infer<typeof AnalysisSchema>;

/**
 * 에이전트 폴더의 코드(agent.config.ts + handler.ts + prompts)를 AI로 읽고
 * "이 사람이 뭘 만들었는지"를 비개발자 시점으로 요약 → DB agents 테이블에 저장.
 *
 * push 후 변경된 에이전트에 대해 호출됨 (github webhook).
 */
export async function analyzeAgent(
  agent: LoadedAgent,
  commitSha: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const cfg = env();
  if (!cfg.OPENROUTER_API_KEY) {
    log.warn('OPENROUTER_API_KEY 없음 — 분석 스킵');
    return;
  }

  const code = await collectAgentCode(agent.folderPath);
  if (!code) return;

  // 코드 내용이 직전 분석과 동일하면 LLM 호출 생략 (idempotent — 재배포/재부팅 비용 절감)
  const hash = createHash('sha256').update(code).digest('hex');
  const db0 = getDb();
  if (!opts.force) {
    try {
      const [prev] = await db0
        .select({ value: kvState.value })
        .from(kvState)
        .where(and(eq(kvState.agentName, ANALYZER_NS), eq(kvState.key, agent.name)));
      if ((prev?.value as { hash?: string } | undefined)?.hash === hash) {
        log.debug(`분석 스킵(변경없음): ${agent.name}`);
        return;
      }
    } catch {
      /* kv 조회 실패 시 그냥 분석 진행 */
    }
  }

  const system = [
    '너는 코드 리뷰어야. 비개발자 학습자가 만든 슬랙 멘션 처리 AI 에이전트 코드를 보고,',
    '이 에이전트가 무엇을 하는지 다른 비개발자도 이해할 수 있게 친근하게 요약해.',
    '',
    '반드시 순수 JSON만 출력 (코드블록·설명 금지):',
    '{',
    '  "summary": "<이 에이전트가 뭘 하는지 1-2문장, 친근한 한국어>",',
    '  "capabilities": ["<할 수 있는 일 짧은 구>", ...],',
    '  "techniques": ["<사용한 기법: 분류/요약/버튼/조건분기/상태기억 등>", ...]',
    '}',
  ].join('\n');

  try {
    const { result } = await callOpenRouter({
      apiKey: cfg.OPENROUTER_API_KEY,
      model: cfg.MODEL_CLASSIFY, // 가벼운 모델로 충분
      system,
      messages: [{ role: 'user', content: code }],
      maxTokens: 500,
      responseFormat: 'json',
    });
    const raw = result.choices[0]?.message?.content ?? '{}';
    const parsed: Analysis = AnalysisSchema.parse(extractJson(raw));

    const db = getDb();
    await db
      .update(agents)
      .set({
        analysisSummary: parsed.summary,
        capabilities: parsed.capabilities,
        techniques: parsed.techniques,
        analyzedCommit: commitSha,
        analyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agents.name, agent.name));

    // 분석 완료 해시 저장 → 다음 분석 때 변경 없으면 스킵
    await db
      .insert(kvState)
      .values({ agentName: ANALYZER_NS, key: agent.name, value: { hash, commitSha } })
      .onConflictDoUpdate({
        target: [kvState.agentName, kvState.key],
        set: { value: { hash, commitSha }, updatedAt: new Date() },
      });

    await getEventBus().publish({
      type: 'agent.analyzed',
      agentName: agent.name,
      payload: {
        summary: parsed.summary,
        capabilities: parsed.capabilities,
        techniques: parsed.techniques,
      },
    });

    log.info(`분석 완료: ${agent.name}`, { summary: parsed.summary.slice(0, 60) });
  } catch (err) {
    log.error(`분석 실패: ${agent.name}`, err);
  }
}

/**
 * 부팅 시 호출 — 변경된(코드 해시가 다른) 에이전트만 AI 분석.
 * Railway 재배포 모델에서 "새로 배포된 컨테이너가 최신 코드를 분석"하는 경로.
 * 변경 없는 에이전트는 해시 비교로 LLM 호출 없이 즉시 스킵된다.
 */
export async function analyzeAllStale(
  agentsList: LoadedAgent[],
  commitSha: string,
): Promise<void> {
  for (const a of agentsList) {
    try {
      await analyzeAgent(a, commitSha);
    } catch (err) {
      log.error(`부팅 분석 실패: ${a.name}`, err);
    }
  }
}

/** 에이전트 폴더의 핵심 코드 파일들을 하나의 문자열로 수집 (분석 입력) */
async function collectAgentCode(folderPath: string): Promise<string | null> {
  const parts: string[] = [];

  const configPath = path.join(folderPath, 'agent.config.ts');
  if (existsSync(configPath)) {
    parts.push(`=== agent.config.ts ===\n${await fs.readFile(configPath, 'utf8')}`);
  }

  const handlerPath = path.join(folderPath, 'handler.ts');
  if (existsSync(handlerPath)) {
    parts.push(`=== handler.ts ===\n${await fs.readFile(handlerPath, 'utf8')}`);
  }

  // prompts/ 의 .md 파일들
  const promptsDir = path.join(folderPath, 'prompts');
  if (existsSync(promptsDir)) {
    const files = await fs.readdir(promptsDir);
    for (const f of files) {
      if (f.endsWith('.md')) {
        parts.push(`=== prompts/${f} ===\n${await fs.readFile(path.join(promptsDir, f), 'utf8')}`);
      }
    }
  }

  // 사용자 정의 도구
  const toolsDir = path.join(folderPath, 'tools');
  if (existsSync(toolsDir)) {
    const files = await fs.readdir(toolsDir);
    for (const f of files) {
      if (f.endsWith('.ts')) {
        parts.push(`=== tools/${f} ===\n${await fs.readFile(path.join(toolsDir, f), 'utf8')}`);
      }
    }
  }

  if (parts.length === 0) return null;
  // 너무 길면 자름 (토큰 절약)
  return parts.join('\n\n').slice(0, 12000);
}
