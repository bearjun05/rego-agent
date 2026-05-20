#!/usr/bin/env tsx
/**
 * 시크릿이 코드에 박혔는지 검사 (pre-commit + CI).
 * 잘 알려진 패턴 (xoxb-, sk-..., ghp_, etc) + .env 파일 staged 검사.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PATTERNS = [
  { name: 'Slack Bot Token', re: /\bxox[abp]-[A-Za-z0-9-]{10,}/ },
  { name: 'Slack User Token', re: /\bxox[eo]-[A-Za-z0-9-]{10,}/ },
  { name: 'GitHub PAT (classic)', re: /\bghp_[A-Za-z0-9]{20,}/ },
  { name: 'GitHub PAT (fine)', re: /\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { name: 'OpenAI API Key', re: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: 'Anthropic API Key', re: /\bsk-ant-[A-Za-z0-9-_]{20,}/ },
  { name: 'OpenRouter API Key', re: /\bsk-or-v1-[A-Za-z0-9]{20,}/ },
  { name: 'Telegram Bot Token', re: /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/ },
  { name: 'Generic password assignment', re: /password\s*=\s*["'][^"'$\s{][^"']{6,}["']/i },
];

const IGNORE_FILES = [
  /node_modules\//,
  /\.git\//,
  /\.next\//,
  /dist\//,
  /pnpm-lock\.yaml$/,
  /\.lock$/,
  /package-lock\.json$/,
  /check-secrets\.ts$/, // 본인 제외
];

const args = process.argv.slice(2);
const mode = args[0] === '--ci' ? 'ci' : 'staged';

let filesToCheck: string[] = [];

if (mode === 'staged') {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
    filesToCheck = out.split('\n').filter(Boolean);
  } catch {
    console.log('[secret-scan] git not initialized — skip');
    process.exit(0);
  }
} else {
  // CI: scan all tracked files
  try {
    const out = execSync('git ls-files', { encoding: 'utf8' });
    filesToCheck = out.split('\n').filter(Boolean);
  } catch {
    process.exit(0);
  }
}

const violations: Array<{ file: string; pattern: string; preview: string }> = [];

for (const file of filesToCheck) {
  if (IGNORE_FILES.some((re) => re.test(file))) continue;
  const base = path.basename(file);
  // .env.example, .env.1p (op:// 참조만)는 안전
  const isSafeEnv = base === '.env.example' || base === '.env.1p';
  if (base.startsWith('.env') && !isSafeEnv) {
    violations.push({
      file,
      pattern: '.env file committed',
      preview: '<.env files must not be committed>',
    });
    continue;
  }
  // .env.1p는 op:// 참조만 허용 — 실제 토큰 패턴 있으면 차단
  if (base === '.env.1p') {
    let content = '';
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const p of PATTERNS) {
      const m = content.match(p.re);
      if (m) {
        violations.push({
          file,
          pattern: `${p.name} (in .env.1p — must be op:// reference)`,
          preview: m[0].slice(0, 30) + '...',
        });
      }
    }
    continue;
  }
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const p of PATTERNS) {
    const m = content.match(p.re);
    if (m) {
      violations.push({
        file,
        pattern: p.name,
        preview: m[0].slice(0, 30) + '...',
      });
    }
  }
}

if (violations.length > 0) {
  console.error('\n🚨 SECRET LEAK DETECTED:\n');
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.pattern}  (${v.preview})`);
  }
  console.error('\nFix: remove the secret, add to .env (which is .gitignored), and use process.env.\n');
  process.exit(1);
}

console.log('[secret-scan] OK ✓');
