#!/usr/bin/env tsx
/**
 * PR/push에서 본인 폴더 외 수정 여부 검사.
 * CI에서 PR_AUTHOR + 변경 파일 비교.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

interface OwnerMap {
  patterns: Array<{ glob: string; owners: string[] }>;
}

function parseCodeowners(): OwnerMap {
  const codeownersPath = path.join(ROOT, '.github', 'CODEOWNERS');
  if (!fs.existsSync(codeownersPath)) return { patterns: [] };
  const src = fs.readFileSync(codeownersPath, 'utf8');
  const patterns: OwnerMap['patterns'] = [];
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const glob = parts[0]!;
    const owners = parts.slice(1);
    patterns.push({ glob, owners });
  }
  return { patterns };
}

function matchPath(filePath: string, glob: string): boolean {
  // 가장 단순한 prefix 매칭 (full glob 미지원)
  if (glob === '*' || glob === '**') return true;
  const norm = filePath.startsWith('/') ? filePath : `/${filePath}`;
  return norm.startsWith(glob) || norm === glob.replace(/\/$/, '');
}

function findOwners(filePath: string, map: OwnerMap): string[] {
  // 가장 구체적인(긴) 매칭 우선
  let best: { glob: string; owners: string[] } | null = null;
  for (const p of map.patterns) {
    if (matchPath(filePath, p.glob)) {
      if (!best || p.glob.length > best.glob.length) best = p;
    }
  }
  return best?.owners ?? [];
}

const mode = process.argv[2] ?? 'staged';
let changedFiles: string[] = [];

if (mode === 'staged') {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
    changedFiles = out.split('\n').filter(Boolean);
  } catch {
    process.exit(0);
  }
} else {
  const base = process.env.BASE_REF ?? 'origin/main';
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' });
    changedFiles = out.split('\n').filter(Boolean);
  } catch {
    process.exit(0);
  }
}

const author = (process.env.PR_AUTHOR ?? execSync('git config user.email', { encoding: 'utf8' }).trim()).replace(/^@/, '');
const authorHandle = process.env.PR_AUTHOR_HANDLE ?? author;

const map = parseCodeowners();
const violations: Array<{ file: string; owners: string[] }> = [];

for (const file of changedFiles) {
  const owners = findOwners(file, map);
  if (owners.length === 0) continue;
  const ownedByAuthor = owners.some(
    (o) => o.replace(/^@/, '').toLowerCase() === authorHandle.replace(/^@/, '').toLowerCase(),
  );
  if (!ownedByAuthor) {
    violations.push({ file, owners });
  }
}

if (violations.length > 0) {
  console.error(`\n🚨 ${authorHandle}는 다음 파일을 직접 수정할 수 없어요 (CODEOWNERS 위반):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}  →  owners: ${v.owners.join(', ')}`);
  }
  console.error('\n공통 파일 변경은 PR로 진행해주세요.\n');
  if (mode === 'pr') {
    // PR에서는 경고만, 머지는 GitHub branch protection이 막음
    console.error('(이건 정보용 — 실제 차단은 GitHub branch protection이 합니다)');
  }
  process.exit(mode === 'staged' ? 1 : 0);
}

console.log('[codeowners] OK ✓');
