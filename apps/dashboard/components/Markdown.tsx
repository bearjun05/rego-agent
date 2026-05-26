'use client';
import React, { Fragment } from 'react';

/**
 * 가벼운 인라인 마크다운 렌더러.
 * 인솔이 메시지 + 카드 안내문에 사용.
 *
 * 지원:
 *  - **bold**, *italic*, `code`
 *  - ```language\n code block ```
 *  - [text](url) 링크 (https/http만 안전)
 *  - 줄바꿈 → <br>, 두 번 줄바꿈 → 단락
 *  - 줄 시작 - / * / 1. → 리스트 (간단)
 *
 * XSS 안전: textContent로만 처리, dangerouslySetInnerHTML 미사용.
 */
export function Markdown({ text }: { text: string }) {
  // 1) 먼저 ```code block``` 블록 분리
  const parts: Array<{ kind: 'code' | 'text'; content: string; lang?: string }> = [];
  let rest = text;
  const codeBlockRe = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = codeBlockRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ kind: 'text', content: text.slice(lastIdx, m.index) });
    }
    parts.push({ kind: 'code', lang: m[1], content: m[2] ?? '' });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ kind: 'text', content: text.slice(lastIdx) });
  }
  if (parts.length === 0) parts.push({ kind: 'text', content: text });

  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'code') {
          return (
            <pre
              key={i}
              className="my-2 p-3 bg-warm text-paper font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre"
              style={{ borderRadius: 'var(--th-card-radius, 0)' }}
            >
              {p.lang && (
                <div className="text-[9px] text-paper/60 uppercase mb-1">{p.lang}</div>
              )}
              <code>{p.content}</code>
            </pre>
          );
        }
        return <TextBlock key={i} text={p.content} />;
      })}
    </>
  );
}

function TextBlock({ text }: { text: string }) {
  // 단락 단위로 자름 (빈 줄 = 단락 구분)
  const paragraphs = text.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((para, i) => (
        <Paragraph key={i} text={para} />
      ))}
    </>
  );
}

function Paragraph({ text }: { text: string }) {
  // 리스트 처리: 모든 줄이 - 또는 *로 시작하면 ul
  const lines = text.split('\n').filter((l) => l.length > 0);
  const isBulletList = lines.length > 0 && lines.every((l) => /^[-*]\s/.test(l));
  const isNumberedList = lines.length > 0 && lines.every((l) => /^\d+\.\s/.test(l));

  if (isBulletList) {
    return (
      <ul className="list-disc list-outside pl-5 my-1 space-y-0.5">
        {lines.map((l, i) => (
          <li key={i}>
            <Inline text={l.replace(/^[-*]\s+/, '')} />
          </li>
        ))}
      </ul>
    );
  }
  if (isNumberedList) {
    return (
      <ol className="list-decimal list-outside pl-5 my-1 space-y-0.5">
        {lines.map((l, i) => (
          <li key={i}>
            <Inline text={l.replace(/^\d+\.\s+/, '')} />
          </li>
        ))}
      </ol>
    );
  }
  // 일반 단락 — 줄바꿈은 <br>로
  return (
    <p className="my-0">
      {text.split('\n').map((line, i, arr) => (
        <Fragment key={i}>
          <Inline text={line} />
          {i < arr.length - 1 && <br />}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * 인라인 토큰: **bold**, *italic*, `code`, [link](url)
 * 단순 좌→우 스캔 (중첩 처리 안 함, 의도적).
 */
function Inline({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let bufStart = 0;

  const flush = (until: number) => {
    if (until > bufStart) nodes.push(text.slice(bufStart, until));
  };

  while (i < text.length) {
    // **bold**
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush(i);
        nodes.push(<strong key={nodes.length}>{text.slice(i + 2, end)}</strong>);
        i = end + 2;
        bufStart = i;
        continue;
      }
    }
    // `code`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush(i);
        nodes.push(
          <code
            key={nodes.length}
            className="px-1 py-0.5 bg-sand font-mono text-[0.9em]"
            style={{ borderRadius: 2 }}
          >
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        bufStart = i;
        continue;
      }
    }
    // *italic* (단일 *) — **bold** 다음에 처리해야 함
    if (text[i] === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1 && text[end + 1] !== '*' && text[end - 1] !== '*') {
        flush(i);
        nodes.push(<em key={nodes.length}>{text.slice(i + 1, end)}</em>);
        i = end + 1;
        bufStart = i;
        continue;
      }
    }
    // [text](url)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket > i && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen > closeBracket) {
          const linkText = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          // 안전: http/https/relative only
          if (/^(https?:\/\/|\/)/.test(url)) {
            flush(i);
            nodes.push(
              <a
                key={nodes.length}
                href={url}
                target={url.startsWith('http') ? '_blank' : undefined}
                rel="noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-rust"
              >
                {linkText}
              </a>,
            );
            i = closeParen + 1;
            bufStart = i;
            continue;
          }
        }
      }
    }
    i += 1;
  }
  flush(text.length);
  return <>{nodes}</>;
}
