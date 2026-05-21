# Slack 멘션 수신 설정 (참가자 태그 감지)

## 왜 안 됐었나

코드가 `app_mention` 이벤트에 의존했는데, **`app_mention`은 봇이 멘션될 때만** 발생한다.
스터디 참가자(사람)가 채널에서 태그될 때를 감지하려면 **`message.channels` 이벤트**를 받아
본문의 `<@U…>`를 직접 파싱해야 한다. 이게 빠져서 "사람 태그를 감지 못 하는" 증상이었다.

추가로 코드 쪽도 정비했다(이미 적용):
- subtype(편집/삭제/봇메시지) 필터 → 노이즈/무한루프 차단
- Slack 재시도(`x-slack-retry-num`) 즉시 200 + `event_id` 중복 시 에이전트 재실행 안 함
- user/channel 이름 TTL 캐시 → 멘션당 Slack API 3회 → permalink 1회 + 캐시
- `SLACK_MONITOR_CHANNELS` allowlist (선택)

---

## 0. rego 전용 Slack 앱을 "만들어야" 한다 (아직 안 만들어짐)

rego의 Slack은 **자격증명이 한 번도 제공된 적이 없어서** 동작한 적이 없다. (코드는 있지만 토큰이 비어 있음)

- 원래 셋업 계획(`.claude/plans/rego-agent-plan.md`)에 "Slack App 생성(\"Rego Agent\")" +
  1Password에 `RegoAgent Slack Signing Secret` / `RegoAgent Slack Bot Token` 등록이 있는데
  **그 단계가 미완료**다 → 해당 1Password 항목 없음, 로컬 `.env`의 Slack 키도 비어 있음.
- 1Password에 보이는 `SLACK_BOT_*` 세트는 **rego 앱이 아니다.** OAuth redirect가
  `team-api.snoio.com/slack/callback`(다른 서비스)을 가리키고, rego 레포 어디에도 참조가 없다.
  그 앱을 빌리려면 그 앱의 단일 Event URL을 rego로 빼앗아 와야 해서(= 그 서비스가 깨짐) 부적절하다.

→ **api.slack.com/apps → Create New App** 으로 rego 전용 앱("Rego Agent")을 새로 만든다.
   생성 후 아래 설정을 적용하고, **OAuth & Permissions의 "Bot User OAuth Token"(xoxb-)** 을
   `SLACK_BOT_TOKEN`, **Basic Information의 Signing Secret** 을 `SLACK_SIGNING_SECRET`에 넣는다.
   (Token Rotation은 켜지 말 것 — 켜면 정적 xoxb가 없어지고 rego가 회전 로직을 구현해야 함)

---

## Slack 앱 콘솔 설정 (api.slack.com/apps → rego 전용 앱)

### 1) OAuth & Permissions → Bot Token Scopes
다음 스코프 추가 후 **워크스페이스에 재설치**:
- `channels:history` — 공개 채널 메시지 읽기 (**핵심**)
- `groups:history` — 비공개 채널 메시지 읽기 (비공개 채널도 감시 시)
- `users:read` — 멘션한 사람 이름 조회
- `chat:write` — 답장/메시지 전송
- `chat:write.public` — 봇이 채널에 없어도 공개채널에 전송(선택)
- `reactions:write` — 이모지 반응(선택)

### 2) Event Subscriptions
- **Enable Events: On**
- **Request URL**: `https://<runtime 공개도메인>/webhooks/slack`
  → 저장 시 Slack이 challenge를 보내고, 우리 서버가 자동 응답해 `Verified ✓` 떠야 한다.
- **Subscribe to bot events** 에 추가:
  - `message.channels` — 공개 채널 메시지 (**핵심**)
  - `message.groups` — 비공개 채널 메시지 (선택)
  - `app_mention` — 봇이 직접 멘션될 때 (선택, 기존 호환)

### 3) 봇을 감시할 채널에 초대
각 채널에서 `/invite @봇이름`.
**초대 안 하면 `message.channels` 이벤트가 그 채널에서 안 온다.**

---

## 환경변수 (runtime 서비스)

```
SLACK_SIGNING_SECRET=<Basic Information → Signing Secret>
SLACK_BOT_TOKEN=xoxb-…           <OAuth & Permissions → Bot User OAuth Token>
SLACK_BOT_USER_ID=U…             # 선택: 봇 자신의 user id (self-message 무시 강화)
SLACK_MONITOR_CHANNELS=          # 비우면 봇이 속한 전체 채널. 좁히려면 C0…,채널명
```

---

## 동작 흐름

```
참가자가 채널에서 "@홍길동 이거 확인" 작성
  → Slack message.channels 이벤트 → POST /webhooks/slack
  → 서명 검증 → 재시도/subtype/봇 필터 → <@U…> 추출
  → (allowlist 통과) → slack_mentions 저장(event_id dedup)
  → matchAgentsForEvent: <@U…> ↔ agents.slack_user_id 매핑으로 라우팅
  → 해당 에이전트 핸들러 실행 → telegram.send 등
```

> 라우팅의 핵심 키는 `agents.slack_user_id`다. 이 매핑이 비어 있으면
> 실제 `<@U…>` 멘션이 어떤 에이전트로도 가지 않는다(텍스트 `@slug` 폴백만 동작).
> 마이그레이션 시 데이터 이전 + `roster.json`의 `slackUserId` 시드로 채운다.
> (참고: [railway-deploy.md](./railway-deploy.md) 4-2/4-3)

---

## 빠른 점검 체크리스트

- [ ] Bot Token Scopes에 `channels:history` 있고 **재설치**했다
- [ ] Event Subscriptions Request URL이 `Verified ✓`
- [ ] bot events에 `message.channels` 구독했다
- [ ] 감시할 채널에 봇을 `/invite` 했다
- [ ] `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` 설정됐다
- [ ] `agents.slack_user_id`에 참가자 id가 채워져 있다
- [ ] 실제 태그 테스트 → runtime 로그 `message_with_mention` → Telegram 도착

## 증상별 원인

| 증상 | 원인 |
|------|------|
| 아무 이벤트도 안 옴 | Request URL 미검증 / `message.channels` 미구독 / 봇 미초대 |
| 봇 멘션은 되는데 사람 태그는 안 됨 | `message.channels` 미구독 (app_mention만 켜둠) |
| 이벤트는 오는데 에이전트 실행 안 됨 | `agents.slack_user_id` 매핑 비어 있음 |
| 같은 멘션 두 번 처리됨 | (해결됨) 재시도/`event_id` dedup 적용 전 코드 |
| 401 invalid signature | `SLACK_SIGNING_SECRET` 불일치 |
