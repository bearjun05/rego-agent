#!/usr/bin/env tsx
/**
 * 학습자 폴더 일괄 생성.
 * 명단(roster.json)을 읽어서 각 학습자의 agents/<slug>/ 폴더를 _template에서 생성하고
 * CODEOWNERS를 한 번에 작성한다.
 *
 * 사용법:
 *   1. scripts/roster.example.json 을 scripts/roster.json 으로 복사
 *   2. 학습자 명단 채우기 (slug, displayName, github, icon, color)
 *   3. pnpm tsx scripts/bulk-create-agents.ts
 *
 * 이미 있는 폴더는 건너뜀 (덮어쓰지 않음).
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const AGENTS_DIR = path.join(ROOT, 'agents');
const TEMPLATE = path.join(AGENTS_DIR, '_template');
const ROSTER = path.join(ROOT, 'scripts', 'roster.json');

interface Learner {
  slug: string;
  displayName: string;
  github: string;
  icon?: string;
  color?: string;
}

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

async function main() {
  if (!existsSync(ROSTER)) {
    console.error(`${c.red}❌ ${ROSTER} 가 없어요.${c.reset}`);
    console.error(`   scripts/roster.example.json 을 roster.json 으로 복사하고 명단을 채우세요.`);
    process.exit(1);
  }

  const roster = JSON.parse(await fs.readFile(ROSTER, 'utf8')) as Learner[];
  console.log(`${c.bold}${c.cyan}학습자 ${roster.length}명 폴더 생성${c.reset}\n`);

  const codeownersLines: string[] = [];
  let created = 0;
  let skipped = 0;

  for (const l of roster) {
    if (!/^[a-z0-9][a-z0-9._-]{1,30}$/i.test(l.slug)) {
      console.error(`  ${c.red}✗ ${l.slug} — 잘못된 slug (영문/숫자/._- 만)${c.reset}`);
      continue;
    }

    const folder = path.join(AGENTS_DIR, l.slug);
    codeownersLines.push(`/agents/${l.slug}/  @${l.github.replace(/^@/, '')}`);

    if (existsSync(folder)) {
      console.log(`  ${c.yellow}↷ ${l.slug} — 이미 있음 (건너뜀)${c.reset}`);
      skipped += 1;
      continue;
    }

    await copyDir(TEMPLATE, folder, ['node_modules']);
    await rewriteConfig(folder, l);
    console.log(`  ${c.green}✓ ${l.icon ?? '🤖'} ${l.displayName} (agents/${l.slug}/)${c.reset}`);
    created += 1;
  }

  await updateCodeowners(codeownersLines);

  console.log(
    `\n${c.green}완료${c.reset}: ${created}개 생성, ${skipped}개 스킵. CODEOWNERS 갱신됨.`,
  );
  console.log(`${c.dim}이제 git add agents/ .github/CODEOWNERS && commit && push${c.reset}`);
  console.log(`${c.dim}학습자는 git pull 후 본인 폴더에서 작업 + 텔레그램 /start <slug> 1번${c.reset}`);
}

async function copyDir(src: string, dest: string, exclude: string[] = []) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (exclude.includes(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d, exclude);
    else await fs.copyFile(s, d);
  }
}

async function rewriteConfig(folder: string, l: Learner) {
  const configPath = path.join(folder, 'agent.config.ts');
  let cfg = await fs.readFile(configPath, 'utf8');
  cfg = cfg
    .replace('__AGENT_NAME__', l.slug)
    .replace('__AGENT_DISPLAY_NAME__', l.displayName)
    .replace("icon: '🤖'", `icon: '${l.icon ?? '🤖'}'`)
    .replace("color: '#000000'", `color: '${l.color ?? '#000000'}'`);
  await fs.writeFile(configPath, cfg);

  const pkgPath = path.join(folder, 'package.json');
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    pkg.name = `@agents/${l.slug}`;
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  } catch {}
}

async function updateCodeowners(learnerLines: string[]) {
  const codeownersPath = path.join(ROOT, '.github', 'CODEOWNERS');
  let content = await fs.readFile(codeownersPath, 'utf8');

  // 기존 학습자 라인 제거 후 재작성 (마커 사이)
  const MARKER_START = '# === 학습자 폴더 (bulk-create-agents.ts 자동 관리) ===';
  const MARKER_END = '# === 학습자 폴더 끝 ===';
  const before = content.split(MARKER_START)[0]!.trimEnd();
  const block = [MARKER_START, ...learnerLines, MARKER_END].join('\n');
  content = `${before}\n\n${block}\n`;
  await fs.writeFile(codeownersPath, content);
}

main().catch((err) => {
  console.error('bulk-create 실패:', err);
  process.exit(1);
});
