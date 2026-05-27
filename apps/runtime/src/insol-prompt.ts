import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.js';
import { currentWeek, weekLabel } from './study-week.js';

const log = createLogger('insol-prompt');

/**
 * 인솔이 시스템 프롬프트는 `prompts/insol/*.md` 파일에서 동적으로 로드.
 * 파일 핫리로드 가능 — 매 요청마다 디스크 read (작은 파일들이라 비용 무시).
 * 런타임 재시작 안 해도 prompt 변경 즉시 반영.
 *
 * 변수 치환: `{{key}}` → vars[key]
 * 누락된 변수는 빈 문자열로.
 */

const PROMPT_DIR = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../prompts/insol');
})();

export interface PromptVars {
  weekLabel: string;
  week: number;
  callName: string;
  agentName: string;
  /** 추가 변수는 자유롭게 — 누락은 빈 문자열로 대체 */
  [key: string]: string | number | undefined;
}

function render(template: string, vars: PromptVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

function loadPromptFile(name: string): string {
  const file = path.join(PROMPT_DIR, `${name}.md`);
  if (!existsSync(file)) {
    log.warn(`prompt file missing: ${name}.md`);
    return '';
  }
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    log.warn(`prompt load fail: ${name}.md`, err);
    return '';
  }
}

/** 정적 인솔이 프롬프트 — 6개 .md를 조립해 반환. */
export function buildInsolStaticPrompt(opts: {
  callName?: string | null;
  agentName?: string | null;
}): string {
  const vars: PromptVars = {
    week: currentWeek(),
    weekLabel: weekLabel(),
    callName: opts.callName ?? '',
    agentName: opts.agentName ?? '',
  };

  // 순서: guardrails(최상단, 절대 양보 X) → identity → study → philosophy → mission → style → cards
  const parts = ['guardrails', 'identity', 'study', 'philosophy', 'mission', 'style', 'cards']
    .map((n) => loadPromptFile(n))
    .filter((s) => s.length > 0)
    .map((s) => render(s, vars));

  return parts.join('\n\n---\n\n');
}
