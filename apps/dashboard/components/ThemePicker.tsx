'use client';
import { THEMES, applyTheme, type ThemeDef } from '@/lib/themes';
import { useState } from 'react';

/**
 * 인솔이가 채팅에서 띄우는 테마 추천 카드.
 * 2-4개의 테마를 큐레이션해서 보여주고, 클릭하면 즉시 적용.
 */
export function ThemePicker({
  themeIds,
  reason,
}: {
  themeIds: string[];
  reason?: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  const themes = themeIds
    .map((id) => THEMES.find((t) => t.id === id))
    .filter((t): t is ThemeDef => !!t);

  if (themes.length === 0) return null;

  const handlePick = (id: string) => {
    setPicked(id);
    applyTheme(id);
  };

  return (
    <div className="brut p-3">
      <div className="font-display font-bold text-sm mb-1">🎨 테마 추천</div>
      {reason && (
        <div className="font-mono text-[11px] text-muted mb-3 leading-relaxed">{reason}</div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {themes.map((t) => {
          const isPicked = picked === t.id;
          return (
            <button
              key={t.id}
              onClick={() => handlePick(t.id)}
              className={`text-left p-2 border-2 transition-all ${
                isPicked ? 'border-rust' : 'border-line hover:bg-sand'
              }`}
              style={{ borderRadius: 'var(--th-card-radius, 0)' }}
            >
              <div className="flex gap-1 mb-1.5" aria-hidden>
                {t.swatches.map((c, i) => (
                  <span
                    key={i}
                    className="block w-full h-5"
                    style={{ background: c, border: '1px solid rgba(0,0,0,0.1)' }}
                  />
                ))}
              </div>
              <div className="font-display font-bold text-[11px] leading-tight flex items-center gap-1">
                {t.name}
                {isPicked && <span className="text-rust">✓</span>}
              </div>
              <div className="font-mono text-[9px] text-muted leading-tight mt-0.5">{t.vibe}</div>
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="font-mono text-[10px] text-muted mt-2">
          ✨ {themes.find((t) => t.id === picked)?.name} 적용됨! 마음에 안 들면 우측 하단 버튼으로 더 골라보세요.
        </div>
      )}
    </div>
  );
}

/**
 * 카테고리 → 추천 테마 ID 4개.
 * 서버 LLM이 카테고리만 반환하면 클라이언트가 이걸로 매핑.
 */
export function themeCategoryToIds(category: string): string[] {
  switch (category) {
    case 'dark':
      return ['lego-noir', 'lego-cyber', 'lego-studio', 'lego-glass'];
    case 'pastel':
      return ['lego-pastel', 'lego-friends', 'lego-paper', 'lego-sunrise'];
    case 'simple':
      return ['lego-minimal', 'lego-classic', 'lego-mono', 'brutalist'];
    case 'vintage':
      return ['lego-vintage', 'lego-paper', 'lego-sunrise', 'lego-beach'];
    case 'lego-bright':
      return ['lego-classic', 'lego-plate', 'lego-friends', 'lego-construction'];
    case 'general':
    default:
      return ['lego-classic', 'lego-noir', 'lego-pastel', 'lego-glass'];
  }
}

export function themeCategoryReason(category: string): string {
  switch (category) {
    case 'dark':
      return '어두운 분위기 위주. 사이버는 좀 자극, 스튜디오는 차분.';
    case 'pastel':
      return '부드러운 톤. 프렌즈는 살짝 회전까지 들어가요.';
    case 'simple':
      return '심플한 톤. 모노는 진짜 순흑백.';
    case 'vintage':
      return '따뜻하고 클래식한 톤. 페이퍼는 진짜 종이질감.';
    case 'lego-bright':
      return '정통 레고 컬러팔레트.';
    case 'general':
    default:
      return '대표 4종. 우측 하단 버튼으로 20개 다 골라볼 수 있어요.';
  }
}

/**
 * 사용자 메시지에서 키워드 감지 → 추천 테마 셋 반환.
 * (Phase 2 이후 LLM tool calling 우선이지만, 클라이언트 즉시반응용 백업 — 비활성화됨)
 * null이면 추천 안 함.
 */
export function detectThemeIntent(text: string): { ids: string[]; reason: string } | null {
  const lower = text.toLowerCase();

  // 다크
  if (/다크|어둡|dark|밤|블랙|black|네온/.test(lower)) {
    return {
      ids: ['lego-noir', 'lego-cyber', 'lego-studio', 'lego-glass'],
      reason: '어두운 분위기 좋아하시는 것 같아 4개 골라봤어요. 사이버는 좀 자극적, 스튜디오는 차분.',
    };
  }
  // 파스텔/부드러움
  if (/파스텔|부드|연한|핑크|파스텔|친근/.test(lower)) {
    return {
      ids: ['lego-pastel', 'lego-friends', 'lego-paper', 'lego-sunrise'],
      reason: '부드러운 느낌으로 골랐어요. 프렌즈는 살짝 회전까지 들어가요.',
    };
  }
  // 밝은/심플
  if (/밝은|심플|미니멀|화이트|white|깔끔/.test(lower)) {
    return {
      ids: ['lego-minimal', 'lego-classic', 'lego-mono', 'brutalist'],
      reason: '심플한 톤 좋아하시면 이쪽. 모노는 진짜 순흑백.',
    };
  }
  // 빈티지/따뜻
  if (/빈티지|따뜻|레트로|페이퍼|종이/.test(lower)) {
    return {
      ids: ['lego-vintage', 'lego-paper', 'lego-sunrise', 'lego-beach'],
      reason: '따뜻하고 클래식한 톤이에요. 페이퍼는 진짜 종이질감.',
    };
  }
  // 레고스러운/유쾌
  if (/레고|장난감|유쾌|밝은|primary|컬러|rgb/.test(lower)) {
    return {
      ids: ['lego-classic', 'lego-plate', 'lego-friends', 'lego-construction'],
      reason: '정통 레고 컬러팔레트. 컨스트럭션은 줄무늬 띠가 들어가요.',
    };
  }
  // 일반 "테마", "분위기", "디자인" → 다양 4개 샘플
  if (/테마|디자인|분위기|theme|색|컬러|바꿔/.test(lower)) {
    return {
      ids: ['lego-classic', 'lego-noir', 'lego-pastel', 'lego-glass'],
      reason: '대표 4개 골라봤어요. 우측 하단 버튼으로 20개 다 골라볼 수 있어요.',
    };
  }
  return null;
}
