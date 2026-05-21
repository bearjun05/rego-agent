# second-brain → rego 포워더 적용 가이드 (Tier1)

이 서버의 OpenClaw second-brain Slack 모니터가 받는 채널 멘션 중, **rego 참가자가 멘션된 건**을
rego webhook으로 전달한다. 기존 "준 멘션 → 텔레그램" 동작에는 영향 없음.

> ⚠️ second-brain은 운영 중인 개인 인프라이고 git 미추적이다. 아래는 **준이 의식적으로 적용 + 재시작**
> 하는 절차다. 포워더 파일(`src/slack/forward-to-rego.ts`)은 이미 추가돼 있으나, 아무 데서도 import
> 되기 전까지 로드되지 않으므로 현재는 무영향이다. **Railway에 rego가 떠서 `REGO_WEBHOOK_URL`이
> 확정된 뒤** 적용할 것.

## 1. 추가된 파일 (적용 완료)
`~/.openclaw/extensions/second-brain/src/slack/forward-to-rego.ts` — `shouldForwardMention`,
`parseParticipantIds`, `forwardToRego` (자기완결, 의존성 없음).

## 2. 주입 (webhook.ts) — 적용 시
`~/.openclaw/extensions/second-brain/src/slack/webhook.ts` 상단 import 추가:
```ts
import { shouldForwardMention, forwardToRego, parseParticipantIds } from "./forward-to-rego";
const REGO_IDS = parseParticipantIds(process.env.REGO_PARTICIPANT_IDS);
```
`handleSlackEvents`의 `setImmediate(async () => { ... })` **맨 앞**에 추가(서명 검증 통과 후 지점):
```ts
// rego 포워딩 (참가자 멘션만, 원본 그대로). 기존 흐름과 병렬, 실패 무시.
if (process.env.REGO_WEBHOOK_URL && shouldForwardMention(body.event?.text ?? "", REGO_IDS)) {
  forwardToRego({
    regoUrl: process.env.REGO_WEBHOOK_URL,
    rawBody,                 // handleSlackEvents가 이미 가진 원본 body
    headers: req.headers,
  }).catch((e: any) => console.error(`[forward-rego] ${e?.message || e}`));
}
```
> `rawBody`, `req`는 `handleSlackEvents` 스코프에 이미 존재. `processSlackEvent`는 그대로 둔다.

## 3. 환경변수 (`~/.openclaw/.env.1p`)
```
REGO_WEBHOOK_URL=https://<rego-railway-domain>/webhooks/slack
REGO_PARTICIPANT_IDS=U07R0PZGTPA,U084P81RGGM,U07V89QPZPU,U04P8G95ZQS,U05V3VC6T44,U08L7TLBVFU,U07S2MEK518,U09UUMNHXKR,U04RSCE4DJS,U098UH079MH,U0ATG1GREG5,U05Q8QRSBGU,U09AYDQTJBC
```
(13명: 최웅준·장수미·박소희·양기철·한효승·박진영·단예진·최소연·장윤서·김초희·안형섭·태서경·주연진)

## 4. 배포 (준이 의식적으로)
```bash
# OpenClaw 재시작 (반드시 두 프로세스 모두)
kill $(pgrep -f "openclaw-gateway") $(pgrep -f "^openclaw$")
# ~3초 후
curl -s -H "Authorization: Bearer $SB_API_TOKEN" http://127.0.0.1:18789/health
```
rego 쪽: `SLACK_SIGNING_SECRET = SLACK_BOT_SIGNING_SECRET`(이 앱 서명 시크릿)로 설정해야 포워딩 원본이 검증됨.

## 5. 검증 테스트 코드 (vitest 환경에서)
포워더 로직은 순수 함수라 어떤 vitest 프로젝트에 떨궈도 검증된다(second-brain엔 러너가 없어 rego의
동일 `extractMentionedUserIds` 테스트로도 핵심 정규식이 커버됨):
```ts
import { describe, it, expect, vi } from 'vitest';
import { shouldForwardMention, parseParticipantIds, forwardToRego } from '../src/slack/forward-to-rego';

describe('shouldForwardMention', () => {
  const ids = parseParticipantIds('U084P81RGGM, U04P8G95ZQS');
  it('참가자 멘션 true', () => expect(shouldForwardMention('<@U084P81RGGM> 봐줘', ids)).toBe(true));
  it('fallback 라벨도 인식', () => expect(shouldForwardMention('<@U084P81RGGM|sumi>', ids)).toBe(true));
  it('비참가자/멘션없음 false', () => {
    expect(shouldForwardMention('<@U07R0PZGTPA>', ids)).toBe(false);
    expect(shouldForwardMention('잡담', ids)).toBe(false);
    expect(shouldForwardMention('<@U084P81RGGM>', new Set())).toBe(false);
  });
});

describe('parseParticipantIds', () => {
  it('쉼표/공백 처리', () => {
    expect([...parseParticipantIds(' U1 , U2 ,, ')]).toEqual(['U1', 'U2']);
    expect([...parseParticipantIds(undefined)]).toEqual([]);
  });
});

describe('forwardToRego', () => {
  it('원본 body + 서명 헤더 보존 POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as any);
    await forwardToRego({
      regoUrl: 'https://rego/webhooks/slack',
      rawBody: '{"event":{"text":"<@U084P81RGGM>"}}',
      headers: { 'x-slack-signature': 'v0=abc', 'x-slack-request-timestamp': '123' },
      fetchImpl,
    });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-slack-signature']).toBe('v0=abc');
    expect(String(init.body)).toContain('U084P81RGGM');
  });
});
```
