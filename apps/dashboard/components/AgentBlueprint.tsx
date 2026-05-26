'use client';

interface Blueprint {
  agent: string;
  displayName: string | null;
  triggers: string[];
  tools: string[];
  hasOnCron: boolean;
  hasOnTelegramCallback: boolean;
  handlerLines: number;
  stats: {
    runs: number;
    toolCalls: number;
    telegramSent: number;
    llmCost: number;
  };
}

/**
 * 학습자 에이전트를 SVG 청사진으로 시각화.
 * 중앙: 핸들러 박스. 왼쪽: 트리거. 오른쪽: 도구.
 */
export function AgentBlueprint({ blueprint }: { blueprint: Blueprint }) {
  const { triggers, tools } = blueprint;
  const triggerCount = triggers.length || 1;
  const toolCount = tools.length || 1;

  // SVG 좌표
  const W = 720;
  const H = Math.max(220, Math.max(triggerCount, toolCount) * 50 + 80);
  const centerX = W / 2;
  const centerY = H / 2;

  // 트리거 위치 (왼쪽 세로 배치)
  const triggerPositions = triggers.map((_, i) => ({
    x: 40,
    y: H / 2 - ((triggerCount - 1) * 50) / 2 + i * 50,
  }));

  // 도구 위치 (오른쪽 세로 배치)
  const toolPositions = tools.map((_, i) => ({
    x: W - 200,
    y: H / 2 - ((toolCount - 1) * 30) / 2 + i * 30,
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {/* 연결선: 트리거 → 핸들러 */}
      {triggerPositions.map((p, i) => (
        <line
          key={`tline-${i}`}
          x1={p.x + 140}
          y1={p.y + 18}
          x2={centerX - 80}
          y2={centerY}
          stroke="#1A1A1A"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          opacity="0.4"
        />
      ))}
      {/* 연결선: 핸들러 → 도구 */}
      {toolPositions.map((p, i) => (
        <line
          key={`oline-${i}`}
          x1={centerX + 80}
          y1={centerY}
          x2={p.x}
          y2={p.y + 10}
          stroke="#1A1A1A"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          opacity="0.4"
        />
      ))}

      {/* 트리거 카드들 (왼쪽) */}
      {triggers.length === 0 && (
        <g>
          <rect x={40} y={H / 2 - 18} width={140} height={36} fill="#FAF8F3" stroke="#1A1A1A" strokeWidth="1.5" />
          <text x={110} y={H / 2 + 4} textAnchor="middle" fontSize="11" fill="#9B9B9B" fontFamily="monospace">
            (트리거 없음)
          </text>
        </g>
      )}
      {triggers.map((t, i) => {
        const p = triggerPositions[i];
        if (!p) return null;
        return (
          <g key={`trig-${i}`}>
            {/* stud */}
            <circle cx={p.x + 130} cy={p.y + 6} r="3" fill="#4A8DD1" />
            <rect x={p.x} y={p.y} width={140} height={36} fill="#E8F2FB" stroke="#1A1A1A" strokeWidth="1.5" />
            <text x={p.x + 70} y={p.y + 22} textAnchor="middle" fontSize="12" fontWeight="600" fontFamily="monospace">
              {t}
            </text>
          </g>
        );
      })}

      {/* 핸들러 중심 박스 */}
      <g>
        <circle cx={centerX + 70} cy={centerY - 50} r="4" fill="#F4D300" />
        <circle cx={centerX - 70} cy={centerY - 50} r="4" fill="#F4D300" />
        <rect
          x={centerX - 80}
          y={centerY - 46}
          width={160}
          height={92}
          fill="#FFF8E0"
          stroke="#1A1A1A"
          strokeWidth="2"
        />
        <text x={centerX} y={centerY - 20} textAnchor="middle" fontSize="11" fill="#9B9B9B" fontFamily="monospace">
          handler.ts
        </text>
        <text x={centerX} y={centerY + 4} textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="display">
          {blueprint.displayName ?? blueprint.agent}
        </text>
        <text x={centerX} y={centerY + 24} textAnchor="middle" fontSize="10" fill="#666" fontFamily="monospace">
          {blueprint.handlerLines} lines
        </text>
        <text x={centerX} y={centerY + 38} textAnchor="middle" fontSize="9" fill="#9B9B9B" fontFamily="monospace">
          {[
            blueprint.hasOnCron && 'onCron',
            blueprint.hasOnTelegramCallback && 'onTelegramCallback',
          ]
            .filter(Boolean)
            .join(' · ')}
        </text>
      </g>

      {/* 도구들 (오른쪽) */}
      {tools.length === 0 && (
        <g>
          <rect x={W - 200} y={H / 2 - 10} width={180} height={20} fill="#FAF8F3" stroke="#1A1A1A" strokeWidth="1.5" />
          <text x={W - 110} y={H / 2 + 4} textAnchor="middle" fontSize="10" fill="#9B9B9B" fontFamily="monospace">
            (호출 도구 없음)
          </text>
        </g>
      )}
      {tools.map((t, i) => {
        const p = toolPositions[i];
        if (!p) return null;
        const isSlack = t.startsWith('slack.');
        const isTg = t.startsWith('telegram.');
        const fill = isSlack ? '#F2E8FB' : isTg ? '#E8FBF2' : '#FAF8F3';
        const studColor = isSlack ? '#9B6AC8' : isTg ? '#6AC89B' : '#1A1A1A';
        return (
          <g key={`tool-${i}`}>
            <circle cx={p.x + 170} cy={p.y + 4} r="2.5" fill={studColor} />
            <rect x={p.x} y={p.y} width={180} height={20} fill={fill} stroke="#1A1A1A" strokeWidth="1" />
            <text x={p.x + 8} y={p.y + 14} fontSize="10" fontFamily="monospace">
              {t}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
