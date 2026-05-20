#!/usr/bin/env tsx
/**
 * 모든 agent의 handler에서 사용한 도구를 추출해서 agent.config.ts 의
 * tools 배열에 자동 추가 (사용자 결정 E.b — 자동 동기화).
 *
 * pre-commit 또는 CI에서 호출 가능.
 * 로컬에서 `pnpm run manifest:sync` 로도 실행 가능.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const AGENTS_DIR = path.join(ROOT, 'agents');

interface ScanResult {
  agentName: string;
  declared: Set<string>;
  used: Set<string>;
  added: string[];
}

async function main() {
  const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
  const results: ScanResult[] = [];

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;

    const folder = path.join(AGENTS_DIR, e.name);
    const configPath = path.join(folder, 'agent.config.ts');
    if (!existsSync(configPath)) continue;

    const declared = await extractDeclaredTools(configPath);
    const used = await scanHandlerForTools(folder);
    const added: string[] = [];
    for (const t of used) if (!declared.has(t)) added.push(t);

    results.push({ agentName: e.name, declared, used, added });

    if (added.length > 0) {
      await injectToolsIntoConfig(configPath, [...declared, ...added]);
      console.log(`[manifest-sync] ${e.name}: +[${added.join(', ')}]`);
    }
  }

  const totalAdded = results.reduce((s, r) => s + r.added.length, 0);
  if (totalAdded === 0) console.log('[manifest-sync] 모든 agent manifest가 최신 ✓');
  else console.log(`[manifest-sync] ${totalAdded}개 도구가 자동 추가됨`);
}

async function extractDeclaredTools(configPath: string): Promise<Set<string>> {
  const src = await fs.readFile(configPath, 'utf8');
  // tools: ['x', 'y', "z"]
  const re = /tools\s*:\s*\[([^\]]*)\]/;
  const m = src.match(re);
  if (!m) return new Set();
  const inside = m[1] ?? '';
  const tools = new Set<string>();
  const re2 = /['"]([^'"]+)['"]/g;
  let mm;
  while ((mm = re2.exec(inside))) tools.add(mm[1]!);
  return tools;
}

async function scanHandlerForTools(folder: string): Promise<Set<string>> {
  const result = new Set<string>();

  async function scanFile(filePath: string) {
    try {
      const src = await fs.readFile(filePath, 'utf8');
      const reBracket = /ctx\.tools\[['"`]([^'"`]+)['"`]\]/g;
      let m;
      while ((m = reBracket.exec(src))) result.add(m[1]!);
      if (/ctx\.llm\.(generate|classify|generateJson)/.test(src)) {
        result.add('llm.generate');
      }
    } catch {}
  }

  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) await scanFile(full);
    }
  }

  await walk(folder);
  return result;
}

async function injectToolsIntoConfig(configPath: string, effective: string[]) {
  const src = await fs.readFile(configPath, 'utf8');
  const re = /tools\s*:\s*\[[^\]]*\]/;
  const newToolsArray = `tools: [${effective.map((t) => `'${t}'`).join(', ')}]`;
  let updated = src;
  if (re.test(src)) {
    updated = src.replace(re, newToolsArray);
  } else {
    // tools 키가 없으면 description 다음에 삽입
    updated = src.replace(/(description:\s*[^,\n]+,?)/, `$1\n  ${newToolsArray},`);
  }
  await fs.writeFile(configPath, updated);
}

main().catch((err) => {
  console.error('manifest-sync failed:', err);
  process.exit(1);
});
