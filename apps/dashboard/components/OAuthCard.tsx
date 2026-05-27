'use client';

export function OAuthCard({ agentSlug, done }: { agentSlug: string; done?: boolean }) {
  if (done) {
    return (
      <div className="brut p-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Slack</div>
        <div className="font-display font-bold text-sm">연결됨</div>
        <div className="text-[12px] text-muted mt-1 leading-relaxed">
          본인 계정으로 OAuth 인증이 완료됐어요. 본인이 받는 채널 멘션은 이미 이 에이전트로 흘러들어오고
          있어요.
        </div>
      </div>
    );
  }
  return (
    <div className="brut p-3 stud">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">Slack</div>
      <div className="font-display font-bold text-sm">연결하기</div>
      <p className="text-[12px] text-muted mt-1.5 mb-3 leading-relaxed">
        본인 슬랙 계정으로 OAuth 인증하면, 본인이 받는 채널 멘션이 자동으로 이 에이전트로 흘러들어와
        본인이 짠 분류·답장·텔레그램 알림 흐름대로 처리돼요. 새 탭에서 인증 끝나면 빙고 한 칸이 자동으로
        채워집니다.
      </p>
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
