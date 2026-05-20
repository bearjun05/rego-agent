import { eq } from 'drizzle-orm';
import { getDb, agents, telegramPending } from '@rego/db';
import { desc } from 'drizzle-orm';
import type { AgentManifest } from '@rego/runtime-sdk';
import type { LoadedAgent } from './agent-registry.js';
import { audit } from './audit.js';

/**
 * 폴더로 로드된 에이전트를 DB agents 테이블에 upsert.
 * 폴더 = DB row 동기화 → /start 시 chat_id 매핑이 정상 동작.
 * 이미 등록된 telegram_chat_id는 건드리지 않음 (보존).
 *
 * 또한 폴더가 /start보다 늦게 생겼을 수도 있으니, telegram_pending에
 * 먼저 들어온 등록 건이 있으면 그 chat_id를 끌어와서 매핑.
 */
export async function ensureAgentRow(agent: LoadedAgent): Promise<void> {
  const db = getDb();
  const m = agent.manifest;

  await db
    .insert(agents)
    .values({
      name: m.name,
      displayName: m.displayName ?? m.name,
      description: m.description,
      icon: m.icon,
      color: m.color,
      githubHandle: m.githubHandle ?? null,
      currentManifest: m,
    })
    .onConflictDoUpdate({
      target: agents.name,
      set: {
        displayName: m.displayName ?? m.name,
        description: m.description,
        icon: m.icon,
        color: m.color,
        currentManifest: m,
        updatedAt: new Date(),
        // telegramChatId는 의도적으로 제외 (기존 등록 보존)
      },
    });

  // 폴더가 /start 이후에 생긴 경우: pending에 쌓인 chat_id를 끌어와 매핑
  const [row] = await db.select().from(agents).where(eq(agents.name, m.name));
  if (row && !row.telegramChatId) {
    const [pending] = await db
      .select()
      .from(telegramPending)
      .where(eq(telegramPending.agentName, m.name))
      .orderBy(desc(telegramPending.createdAt))
      .limit(1);
    if (pending) {
      await db
        .update(agents)
        .set({
          telegramChatId: pending.chatId,
          telegramUsername: pending.username ?? null,
          updatedAt: new Date(),
        })
        .where(eq(agents.name, m.name));
    }
  }
}

/**
 * 사용자가 코드에서 사용한 도구를 추론하고 manifest.tools에 자동 추가.
 * (사용자 결정 E.b — 자동 동기화)
 *
 * 1. agent.config.ts의 tools 배열
 * 2. handler.ts에서 ctx.tools.xxx 호출 패턴을 정규식으로 추출
 * 3. 차이 있으면 manifest에 자동 추가하고 DB에 sync
 */
export async function syncManifestToolsForAgent(agent: LoadedAgent): Promise<{
  added: string[];
  effective: string[];
}> {
  const declared = new Set(agent.manifest.tools ?? []);
  const detected = await detectToolsFromHandler(agent.folderPath);
  const effective = new Set([...declared, ...detected]);

  const added: string[] = [];
  for (const t of detected) {
    if (!declared.has(t)) added.push(t);
  }

  // 변경사항 있으면 DB에 effective manifest 기록 + audit
  if (added.length > 0) {
    const effManifest: AgentManifest = {
      ...agent.manifest,
      tools: Array.from(effective),
    };
    const db = getDb();
    await db
      .update(agents)
      .set({
        currentManifest: effManifest,
        updatedAt: new Date(),
      })
      .where(eq(agents.name, agent.name));

    await audit({
      action: 'manifest.auto_synced',
      actor: 'system',
      agentName: agent.name,
      severity: 'info',
      details: { added, declared: Array.from(declared), detected },
    });
  }

  return { added, effective: Array.from(effective) };
}

async function detectToolsFromHandler(folderPath: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const result = new Set<string>();

  async function scanFile(filePath: string) {
    try {
      const src = await fs.readFile(filePath, 'utf8');
      // ctx.tools["slack.reply"] | ctx.tools['telegram.send'] | ctx.tools.slack_reply
      const reBracket = /ctx\.tools\[['"`]([^'"`]+)['"`]\]/g;
      const reDot = /ctx\.tools\.([a-zA-Z_][\w]*)/g;
      let m;
      while ((m = reBracket.exec(src))) result.add(m[1]!);
      while ((m = reDot.exec(src))) {
        // dot notation은 . 못 쓰니까 _ 또는 단일 이름 → 그대로 추가 (사용자가 alias 만든 경우)
        result.add(m[1]!);
      }

      // ctx.llm 사용 시 llm.* 자동 추가
      if (/ctx\.llm\.(generate|classify|generateJson)/.test(src)) {
        result.add('llm.generate');
      }
    } catch {}
  }

  async function walk(dir: string) {
    const fs2 = await import('node:fs/promises');
    let entries;
    try {
      entries = await fs2.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) await scanFile(full);
    }
  }

  await walk(folderPath);
  return Array.from(result);
}
