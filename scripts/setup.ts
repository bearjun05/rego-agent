#!/usr/bin/env tsx
/* eslint-disable no-console */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const AGENTS_DIR = path.join(ROOT, 'agents');
const TEMPLATE = path.join(AGENTS_DIR, '_template');

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

const banner = `
${c.bold}${c.cyan}┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ${c.magenta}REGO-AGENT${c.cyan}  ${c.dim}스파르타 AI 에이전트 스터디${c.cyan}                  │
│                                                              │
│   ${c.reset}${c.bold}환영합니다!${c.cyan} 5분 안에 본인 에이전트가 살아 움직여요. │
│                                                              │
└──────────────────────────────────────────────────────────────┘${c.reset}
`;

async function main() {
  console.log(banner);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ask = (q: string) => rl.question(q);

  // Step 1: 본인 닉네임
  console.log(`${c.bold}[1/4]${c.reset} 본인 정보를 입력하세요.\n`);
  const slug = await askSlug(ask);
  if (!slug) {
    console.log(`${c.red}❌ 취소되었습니다.${c.reset}`);
    rl.close();
    return;
  }

  const folder = path.join(AGENTS_DIR, slug);
  if (existsSync(folder)) {
    console.log(`${c.yellow}⚠  agents/${slug}/ 폴더가 이미 있어요.${c.reset}`);
    const ans = (await ask(`기존 폴더 그대로 사용할까요? [y/N] `)).trim().toLowerCase();
    if (ans !== 'y') {
      console.log(`${c.dim}다른 이름으로 다시 실행해주세요.${c.reset}`);
      rl.close();
      return;
    }
  }

  const displayName = (await ask(`표시 이름 (한글 가능, 기본: ${slug}): `)).trim() || slug;
  const ghHandle = (await ask(`GitHub 핸들 (CODEOWNERS용, 예: bearjun05): `)).trim();
  const icon = (await ask(`프로필 이모지 (기본: 🤖): `)).trim() || '🤖';
  const color = (await ask(`테마 색깔 (hex, 기본: #000000): `)).trim() || '#000000';

  // Step 2: _template 복사
  console.log(`\n${c.bold}[2/4]${c.reset} 폴더를 만들고 있어요...`);
  if (!existsSync(folder)) {
    await copyDir(TEMPLATE, folder);
    await rewriteTemplate(folder, slug, displayName, icon, color);
    console.log(`${c.green}✅ agents/${slug}/ 생성 완료${c.reset}`);
  }

  // Step 3: CODEOWNERS 갱신
  if (ghHandle) {
    await updateCodeowners(slug, ghHandle);
    console.log(`${c.green}✅ CODEOWNERS 갱신 (본인 폴더는 본인만)${c.reset}`);
  }

  // Step 4: Telegram 연결
  console.log(`\n${c.bold}[3/4]${c.reset} 텔레그램 연결\n`);
  console.log(`텔레그램에서 ${c.cyan}@rego_agent_bot${c.reset}를 검색하고 다음 메시지를 보내세요:\n`);
  console.log(`    ${c.bold}/start ${slug}${c.reset}\n`);
  console.log(`${c.dim}(봇이 자동으로 본인을 등록하면 다음 단계로 진행됩니다)${c.reset}\n`);

  // 학습자 노트북에서는 외부 서버로 polling.
  // 운영자가 별도 서버 쓰면 REGO_API_BASE env로 override 가능.
  const baseUrl =
    process.env.REGO_API_BASE ??
    process.env.PUBLIC_BASE_URL ??
    'https://rego.jotto.in/api/runtime';
  const ok = await pollTelegramRegistration(slug, baseUrl);

  if (!ok) {
    console.log(
      `\n${c.yellow}⏱ 시간이 좀 걸리네요. 등록은 백그라운드에서 가능하고, 지금 그대로 진행해도 OK.${c.reset}`,
    );
  } else {
    console.log(`\n${c.green}✅ 텔레그램 연결 완료!${c.reset}`);
  }

  // Step 5: 다음 안내
  console.log(`\n${c.bold}[4/4]${c.reset} 다 됐어요!\n`);
  console.log(
    `${c.cyan}이제 본인 폴더에서 Claude Code를 띄우고 코드를 깎으세요:${c.reset}\n`,
  );
  console.log(`    ${c.bold}cd agents/${slug}${c.reset}`);
  console.log(`    ${c.bold}claude${c.reset}\n`);
  console.log(`그리고 첫 push:`);
  console.log(`    ${c.bold}git add agents/${slug}${c.reset}`);
  console.log(`    ${c.bold}git commit -m "feat: ${slug} 시작"${c.reset}`);
  console.log(`    ${c.bold}git push${c.reset}\n`);
  console.log(`30초 후 텔레그램으로 환영 메시지가 와요. ${c.green}행운을 빌어요! 🚀${c.reset}\n`);

  rl.close();
}

async function askSlug(ask: (q: string) => Promise<string>): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const raw = (await ask(
      `본인 회사 이메일 닉네임 (영문, 예: ${c.dim}uj.choe${c.reset}): `,
    )).trim();
    if (!raw) continue;
    if (!/^[a-z0-9][a-z0-9._-]{1,30}$/i.test(raw)) {
      console.log(
        `${c.red}❌ 영문/숫자/. _ - 만 가능해요. (예: uj.choe, sumi_jang)${c.reset}`,
      );
      continue;
    }
    return raw.toLowerCase();
  }
  return null;
}

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function rewriteTemplate(
  folder: string,
  slug: string,
  displayName: string,
  icon: string,
  color: string,
) {
  // agent.config.ts 치환
  const configPath = path.join(folder, 'agent.config.ts');
  let cfg = await fs.readFile(configPath, 'utf8');
  cfg = cfg
    .replace('__AGENT_NAME__', slug)
    .replace('__AGENT_DISPLAY_NAME__', displayName)
    .replace("icon: '🤖'", `icon: '${icon}'`)
    .replace("color: '#000000'", `color: '${color}'`);
  await fs.writeFile(configPath, cfg);

  // package.json 치환
  const pkgPath = path.join(folder, 'package.json');
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
    pkg.name = `@agents/${slug}`;
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  } catch {}
}

async function updateCodeowners(slug: string, githubHandle: string) {
  const codeownersPath = path.join(ROOT, '.github', 'CODEOWNERS');
  let content = '';
  try {
    content = await fs.readFile(codeownersPath, 'utf8');
  } catch {}

  const line = `/agents/${slug}/  @${githubHandle.replace(/^@/, '')}`;

  // 이미 있으면 update, 없으면 add
  if (content.includes(`/agents/${slug}/`)) {
    content = content
      .split('\n')
      .map((l) => (l.trim().startsWith(`/agents/${slug}/`) ? line : l))
      .join('\n');
  } else {
    if (!content.endsWith('\n') && content.length > 0) content += '\n';
    content += line + '\n';
  }
  await fs.writeFile(codeownersPath, content);
}

async function pollTelegramRegistration(
  slug: string,
  baseUrl: string,
  maxAttempts = 60,
): Promise<boolean> {
  // baseUrl이 .../api/runtime 으로 끝나면 그대로 사용,
  // 아니면 /api 붙임 (localhost runtime 직접 호출 케이스).
  const apiPrefix = baseUrl.endsWith('/api/runtime') ? '' : '/api';
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${baseUrl}${apiPrefix}/agents/${slug}`);
      if (res.ok) {
        const data = (await res.json()) as { agent?: { telegramChatId?: string } };
        if (data.agent?.telegramChatId) return true;
      }
    } catch {
      // 네트워크 오류 시 한 번 더 시도하지 않고 종료
      if (i === 0) {
        process.stdout.write(`\n${c.yellow}⚠ 서버 연결 실패 (${baseUrl})${c.reset}\n`);
        return false;
      }
    }
    if (i === 0) process.stdout.write(`${c.dim}대기 중`);
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.stdout.write(c.reset + '\n');
  return false;
}

main().catch((err) => {
  console.error(`${c.red}❌ 셋업 실패:${c.reset}`, err);
  process.exit(1);
});
