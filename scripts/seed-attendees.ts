#!/usr/bin/env tsx
/**
 * 인프피 솔루션 스터디 참석자 16명 프로필 시드.
 * - scripts/roster.json 을 단일 소스로 사용 (slug/displayName/github/email/icon/color)
 * - agents 테이블에 upsert
 * - 기존 시연용 데모 에이전트(uj.choe/sumi/minho/jiwon) 행 제거
 *
 * 사용법: pnpm tsx scripts/seed-attendees.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb, agents, inArray } from '@rego/db';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

interface RosterEntry {
  slug: string;
  displayName: string;
  github: string;
  email: string;
  icon: string;
  color: string;
}

// 폴더 slug별 텔레그램 연결 (현재 최웅준만 보유)
const TELEGRAM: Record<string, { chatId: string; username: string }> = {
  uj_choe: { chatId: '6631216371', username: 'ujchoe' },
};

// 인프피 솔루션 일정에서 거절(declined)한 참석자
const DECLINED = new Set(['naseung_kim']);

// 더 이상 쓰지 않는 데모 행
const LEGACY = ['uj.choe', 'sumi', 'minho', 'jiwon'];

async function main() {
  const roster = JSON.parse(
    await fs.readFile(path.join(ROOT, 'scripts', 'roster.json'), 'utf8'),
  ) as RosterEntry[];

  const db = getDb();
  const now = new Date();

  for (const r of roster) {
    const tg = TELEGRAM[r.slug];
    const desc = `인프피 솔루션 스터디 · ${r.email}${DECLINED.has(r.slug) ? ' (일정 거절)' : ''}`;
    const row = {
      name: r.slug,
      displayName: r.displayName,
      githubHandle: r.github,
      telegramChatId: tg?.chatId ?? null,
      telegramUsername: tg?.username ?? null,
      icon: r.icon,
      color: r.color,
      description: desc,
      updatedAt: now,
    };
    await db
      .insert(agents)
      .values(row)
      .onConflictDoUpdate({
        target: agents.name,
        set: {
          displayName: row.displayName,
          githubHandle: row.githubHandle,
          telegramChatId: row.telegramChatId,
          telegramUsername: row.telegramUsername,
          icon: row.icon,
          color: row.color,
          description: row.description,
          updatedAt: now,
        },
      });
    console.log(`✓ ${r.icon} ${r.displayName} (${r.slug})`);
  }

  // 데모 행 정리
  const deleted = await db.delete(agents).where(inArray(agents.name, LEGACY)).returning();
  if (deleted.length) console.log(`🗑  데모 행 ${deleted.length}개 제거: ${deleted.map((d) => d.name).join(', ')}`);

  const total = await db.select().from(agents);
  console.log(`\n완료: agents 테이블 ${total.length}행`);
  process.exit(0);
}

main().catch((err) => {
  console.error('seed-attendees 실패:', err);
  process.exit(1);
});
