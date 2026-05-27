import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getDb, agents, slackUserTokens } from '@rego/db';
import { agentFolderExists } from './git-sync.js';
import { createLogger } from './logger.js';

const log = createLogger('learner-status');
const execAsync = promisify(exec);

/**
 * 학습자 1주차 선행 단계 완료 여부.
 * bootstrap LLM 시스템 프롬프트에 박아서 인솔이가 미완 항목부터 안내하게.
 */
export interface LearnerPrereqs {
  slug: string;
  folderOk: boolean; // agents/<slug>/ 폴더 존재
  branchOk: boolean; // origin/learner/<slug> 브랜치 존재
  slackOk: boolean; // 슬랙 OAuth 완료 (revoked 아님)
  telegramOk: boolean; // 텔레그램 봇 연결됨 (telegramChatId 있음)
}

// origin의 learner/* 브랜치 리스트 캐시 (5분 TTL).
// 매 bootstrap 호출마다 git ls-remote 부르면 2초 추가됨 → 메모리 캐시.
let _branchCache: { at: number; branches: Set<string> } | null = null;
const BRANCH_CACHE_TTL_MS = 5 * 60 * 1000;

async function listLearnerBranches(): Promise<Set<string>> {
  if (_branchCache && Date.now() - _branchCache.at < BRANCH_CACHE_TTL_MS) {
    return _branchCache.branches;
  }
  try {
    const { stdout } = await execAsync('git ls-remote origin "refs/heads/learner/*"', {
      cwd: process.cwd(),
    });
    const branches = new Set<string>();
    for (const line of stdout.split('\n')) {
      const m = line.match(/refs\/heads\/learner\/(\S+)$/);
      if (m && m[1]) branches.add(m[1]);
    }
    _branchCache = { at: Date.now(), branches };
    return branches;
  } catch (err) {
    log.warn('failed to list learner branches', err);
    return _branchCache?.branches ?? new Set();
  }
}

/** branch 캐시 무효화 — OAuth 후 ensureLearnerBranch 직후 호출 권장 */
export function invalidateBranchCache(): void {
  _branchCache = null;
}

/**
 * 16명 학습자 prerequisites 한꺼번에 조회. bootstrap에서 시스템 프롬프트 박기용.
 * DB 2번 쿼리 + git ls-remote 1번 (캐시) → 통상 50ms 이하.
 */
export async function loadAllPrereqs(): Promise<Record<string, LearnerPrereqs>> {
  const db = getDb();
  const allAgents = await db
    .select({
      slug: agents.name,
      slackUserId: agents.slackUserId,
      telegramChatId: agents.telegramChatId,
    })
    .from(agents);

  const tokens = await db
    .select({
      slackUserId: slackUserTokens.slackUserId,
      revoked: slackUserTokens.revoked,
    })
    .from(slackUserTokens);
  const validSlackIds = new Set(
    tokens.filter((t) => !t.revoked).map((t) => t.slackUserId),
  );

  const branches = await listLearnerBranches();

  const result: Record<string, LearnerPrereqs> = {};
  for (const a of allAgents) {
    if (a.slug === '_template') continue;
    result[a.slug] = {
      slug: a.slug,
      folderOk: agentFolderExists(a.slug),
      branchOk: branches.has(a.slug),
      slackOk: !!(a.slackUserId && validSlackIds.has(a.slackUserId)),
      telegramOk: !!a.telegramChatId,
    };
  }
  return result;
}

/** 단일 학습자 prereqs (chat /send에서 쓰면 좋음) */
export async function loadPrereqsForSlug(slug: string): Promise<LearnerPrereqs | null> {
  const all = await loadAllPrereqs();
  return all[slug] ?? null;
}
