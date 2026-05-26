import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger } from './logger.js';

const exec = promisify(execFile);
const log = createLogger('git-sync');

/**
 * agent 폴더 이름 안전성 검사 — path injection / 명령 주입 방어 (순수).
 *
 * 허용: 영문 소문자 시작, 영소/숫자/_/-, 1~30자.
 * - "../etc" 같은 path traversal 거부
 * - "a;rm" 같은 셸 주입 거부 (어차피 execFile이라 셸 미사용이지만 추가 안전망)
 * - 대문자 거부 (학습자 slug 규칙 통일)
 */
export function isSafeAgentName(name: string): boolean {
  return /^[a-z][a-z0-9_-]{0,29}$/.test(name);
}

/**
 * 학습자 브랜치(learner/<name>)에서 agents/<name>/ 폴더만 부분 checkout.
 *
 * 동작:
 *   1. git fetch origin learner/<name> (depth=1로 가볍게)
 *   2. git checkout origin/learner/<name> -- agents/<name>/
 *      → 그 폴더만 그 브랜치 버전으로 덮어씀, 다른 파일/폴더는 손 안 댐
 *
 * 실패 케이스:
 *   - 브랜치 자체가 없음 → fetch 단계에서 throw
 *   - 폴더가 그 브랜치에 없음 → checkout 단계에서 throw
 *
 * @returns 가져온 커밋 SHA
 */
export async function fetchLearnerFolder(
  agentName: string,
  opts: { workdir?: string; remote?: string } = {},
): Promise<{ sha: string; branch: string }> {
  if (!isSafeAgentName(agentName)) {
    throw new Error(`unsafe agent name: ${agentName}`);
  }
  const workdir = opts.workdir ?? process.cwd();
  const remote = opts.remote ?? 'origin';
  const branch = `learner/${agentName}`;

  // 1. fetch (shallow)
  await exec('git', ['fetch', remote, branch, '--depth', '1'], { cwd: workdir });

  // 2. SHA 확인
  const { stdout: shaOut } = await exec('git', ['rev-parse', `${remote}/${branch}`], {
    cwd: workdir,
  });
  const sha = shaOut.trim();

  // 3. 폴더 부분 checkout (다른 파일 손 안 댐)
  const folder = `agents/${agentName}/`;
  await exec('git', ['checkout', `${remote}/${branch}`, '--', folder], { cwd: workdir });

  log.info(`fetched ${branch} @ ${sha.slice(0, 8)} → ${folder}`);
  return { sha, branch };
}

/** 폴더가 실제로 존재하는지 (학습자가 본인 폴더 안 만들고 reload 누른 케이스) */
export function agentFolderExists(agentName: string, workdir = process.cwd()): boolean {
  if (!isSafeAgentName(agentName)) return false;
  return existsSync(path.join(workdir, 'agents', agentName));
}
