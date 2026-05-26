'use client';

export function OAuthCard({ agentSlug, done }: { agentSlug: string; done?: boolean }) {
  if (done) {
    return (
      <div className="brut p-3">
        <div className="font-display font-bold text-sm mb-1">✅ Slack 연결됨</div>
        <div className="font-mono text-[11px] text-muted">본인 계정으로 OAuth 완료</div>
      </div>
    );
  }
  return (
    <div className="brut p-3 stud">
      <div className="font-display font-bold text-sm mb-1">🔗 Slack 연결하기</div>
      <div className="font-mono text-[11px] text-muted mb-2 leading-relaxed">
        본인 슬랙 계정으로 OAuth 인증해주세요.
        <br />
        새 탭에서 열리고, 끝나면 자동으로 빙고 셀이 채워져요.
      </div>
      <a
        href={`/oauth/slack?agent=${encodeURIComponent(agentSlug)}`}
        target="_blank"
        rel="noreferrer"
        className="btn btn-dark text-xs"
      >
        Slack 인증하기 →
      </a>
    </div>
  );
}
