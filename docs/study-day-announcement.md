# 스터디 데이 안내 메시지 초안

준이 학습자 16명에게 보내는 안내 텍스트 초안 (슬랙/카톡 단톡 등에 적당히 발췌해서 사용).

---

## 📢 전체 공지 (스터디 시작 전 발송)

```
🎯 내일 (5/27) 1주차 스터디 — 빙고로 진행합니다.

📍 시작 전 준비:
1. 텔레그램에서 `@rego_agent_bot` 검색 → 채팅 시작
2. `/start <본인슬러그>` 입력 (예: `/start uj_choe`)
   ❗ 본인 슬러그는 GitHub repo의 `agents/` 폴더에 있는 본인 이름과 동일
3. 대시보드 접속: https://dashboard-production-089b.up.railway.app
4. "인솔이"가 인사하면 본인 이름 입력 → 빙고판 등장
5. 셀 1 [Slack 인증] 부터 차근차근 시작!

💡 막히면 인솔이 채팅에 자유롭게 질문하세요. 코드 수정은 본인 폴더(`agents/<본인>/`)에서 Claude Code 사용.
```

---

## 📨 텔레그램 미등록 3명에게 개별 안내

`naseung_kim`, `sy_choi`, `ys_jang` 님은 텔레그램 봇 등록이 아직 안 됐어요.

복사용 텍스트:

```
[1주차 스터디 준비] 텔레그램 봇 등록이 아직이에요.

📱 본인 텔레그램에서:
1. 상단 검색에서 `@rego_agent_bot` 검색
2. 채팅 시작
3. 메시지 입력: `/start <본인이름>`
   - naseung_kim님: /start naseung_kim
   - sy_choi님: /start sy_choi
   - ys_jang님: /start ys_jang

등록 끝나면 ✅ 등록 완료 메시지가 텔레그램에서 와요.
```

---

## 🎯 빙고판 9칸 미리보기 (학습자가 인솔이 통해 자동으로 받게 되지만, 참고용)

```
1. ✅ Slack 인증           — 대시보드 [Slack 인증하기] 버튼
2. ✅ 슬랙 → 텔레그램      — 슬랙 채널에서 본인 멘션 1건 흘려보기
3. ✅ 자동 👀 이모지       — handler.ts에 slack.reactions_add 추가
4. ✅ 텔레그램 답장 버튼   — replyMarkup + onTelegramCallback
5. ✅ 채널명/이름 표시     — slack.users_info / slack.conversations_info
6. ✅ 이모지 BEST 5        — 채팅창에 5개 적기
7. ✅ 태그 BEST 3          — 채팅창에 3명 적기
8. ✅ 아침 보고서          — agent.config.ts에 trigger.cron('0 9 * * *')
9. ✅ 와우 아이디어 2개    — 채팅창에 2개 적기
```

---

## 🛠 본인 컴퓨터 셋업 (Claude Code 작업용)

```bash
# 0. (한 번만) 저장소 클론
git clone https://github.com/bearjun05/rego-agent.git
cd rego-agent

# 1. 본인 브랜치로 이동 (rego가 자동 생성한 learner/<본인>)
git fetch origin
git checkout learner/<본인>

# (자동 브랜치 없으면)
git checkout -b learner/<본인>
git push -u origin learner/<본인>

# 2. 본인 폴더로 이동
cd agents/<본인>/

# 3. Claude Code 열기
claude

# 4. 코드 수정 후 push
git add agents/<본인>
git commit -m "fix: 빙고 셀 N"
git push

# 5. 대시보드의 [내 코드 적용하기] 버튼 클릭 → 5초 안에 서버 반영
```

---

## ⚠ 주의

- 본인 폴더 외 수정은 push 거절됩니다 (CODEOWNERS)
- 한 명 코드가 망가져도 다른 사람·서버에 영향 0 (per-learner hot reload)
- 막히면 인솔이 채팅에 그대로 물어보세요 — 셀별 코드 스니펫까지 안내해줍니다
