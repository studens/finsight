# 프로젝트: finsight

## 기술 스택
- Next.js 15 (App Router)
- TypeScript strict mode
- Tailwind CSS
- Supabase (Postgres DB + Auth, Google OAuth 전용)
- Vercel AI SDK (Claude API 기본 프로바이더, 분석 모델은 Opus 4.8)
- Polar (구독 결제 — Hosted Checkout + 웹훅)
- Vercel 배포

## 아키텍처 규칙
- CRITICAL: 외부 API 호출(Claude, Supabase, Polar)은 `src/services/`를 통해서만 수행한다. 컴포넌트나 라우트 핸들러에서 직접 호출하지 않는다.
- CRITICAL: CSV의 카드/계좌번호는 `src/services/pii-masking/`을 거쳐 뒤 4자리만 남기고 마스킹한 뒤에만 LLM에 전달한다. 이름·전화번호 등 신원 식별 컬럼은 마스킹이 아니라 컬럼 자체를 LLM 요청에서 제외한다. 원본 값을 프롬프트에 절대 포함하지 않는다.
- CRITICAL: 원본 CSV 파일은 어떤 형태로도(Storage, 디스크, 로그 등) 영구 저장하지 않는다. 업로드된 파일은 요청 처리 중 메모리에서만 다루고 응답 후 폐기한다. DB에는 마스킹된 요약 데이터(카테고리별 합계 등 구조화된 값)만 저장한다.
- CRITICAL: `SUPABASE_SERVICE_ROLE_KEY`는 API Route(서버 전용 코드)에서만 사용한다. 클라이언트 컴포넌트로 절대 전달하지 않으며 `NEXT_PUBLIC_` 접두어를 붙이지 않는다. DB 쓰기(INSERT/UPDATE)는 이 service-role 클라이언트를 통해서만 수행하고, 코드에서 소유권(user_id)을 직접 검증한다.
- CRITICAL: Polar 웹훅(`/api/webhooks/polar`)은 반드시 서명(signature)을 검증한 뒤에만 구독 상태를 갱신한다. 검증 실패 시 요청을 거부한다. (이번 phase는 `subscriptions` 엔타이틀먼트 스키마만 준비하고, 실제 체크아웃/웹훅 연동은 Polar 계정 준비 후 `polar-billing` phase에서 구현한다.)
- CRITICAL: Premium 인사이트는 Free 사용자에 대해 애초에 생성하지 않는다. 업로드 시점엔 Free 요약만 계산/저장하고, Premium 리포트는 구독 중인 사용자가 해당 리포트를 처음 조회할 때만 서버가 생성해 캐시한다(lazy-generate). 미구독 사용자의 Premium 리포트 요청은 생성을 시도하지 않고 403으로 거부한다.
- 컴포넌트는 `src/components/`, 타입은 `src/types/`, Supabase 클라이언트 래퍼는 `src/lib/supabase/`에 분리한다.
- 로그인된 사용자가 `/`(랜딩)에 접근하면 미들웨어에서 세션을 확인해 `/dashboard`로 리다이렉트한다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 유닛 테스트(게이팅 로직, PII 마스킹, 웹훅 서명 검증, 컬럼 매핑 등)는 Vitest, E2E(랜딩→로그인→CSV 업로드→결제→대시보드)는 Playwright를 사용한다.
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev       # 개발 서버
npm run build     # 프로덕션 빌드 (next build)
npm run typecheck # 타입체크 (tsc --noEmit)
npm run lint      # ESLint
npm run test      # 테스트 (Vitest)
npm run test:e2e  # E2E 테스트 (Playwright, 아직 미설정)

## 하네스: 자동 코드 리뷰 (3층)

`review-code` 스킬을 사람이 부르지 않아도 돌게 만든 구조다. 리뷰 규칙 자체는 전부 `.claude/skills/review-code/` 에 있고, 아래 3층은 **그 스킬을 언제·어떻게 호출하는지**만 정한다.

| 층 | 언제 | 무엇을 | 막나 |
|---|---|---|---|
| `scripts/githooks/pre-commit` | 커밋마다 | 스테이징 파일의 CRITICAL 규칙 grep 검사(SEC01~07, ARCH01) + ESLint + tsc. **LLM 없음** | **예** (초 단위·결정적) |
| `scripts/githooks/pre-push` | push 전 | `review-ci.sh` 로 LLM 리뷰 → 요약 출력 | **아니오** (경고만) |
| `.github/workflows/pr-review.yml` | PR 열림/갱신 | `checks` job(typecheck/lint/build/test) + `ai-review` job(LLM 리뷰 → PR 코멘트) | **예** (required check) |

**왜 pre-commit에 LLM 리뷰를 넣지 않았나:** 리뷰는 분 단위이고 판정이 확률적이다. 커밋을 막으면 `--no-verify`가 습관이 되어 훅 전체가 죽는다. 커밋은 발표가 아니라 저장 지점이다. 진짜 게이트는 우회할 수 없는 PR Action에 둔다.

**설치:** `npm install` 이 `prepare` 스크립트로 `core.hooksPath=scripts/githooks` 를 설정한다. 새 클론·새 워크트리에서 한 번 필요하다.

**공용 진입점** `scripts/review-ci.sh --base <sha> [--out <dir>] [--deep]` — 스킬을 `claude --print` 로 돌려 `<out>/review.json`(기계용) + `<out>/review.md`(사람용)를 남긴다. 종료 코드: `0` Approve · `1` critical/major 있음 · `2` **리뷰 미완료**(실행 실패, JSON 없음, 미검토 차원 존재).

- CRITICAL: 종료 코드 `2`를 통과로 취급하지 않는다. 스킬의 제1원칙("검토 안 됨을 문제 없음으로 바꾸지 않는다")이 코드로 표현된 지점이다.
- `review-ci.sh` 는 **커밋된 변경(`git diff <base>...HEAD`) + 미추적 신규 파일**을 본다. 추적 중인 파일의 미커밋 수정은 보지 않는다 — 그건 대화에서 `/review` 를 쓴다. 로컬에서 직접 돌릴 때는 `npm run review -- --base <sha>`.
- `REVIEW_CI=1` 환경변수가 `scripts/hooks/stop-check.sh` 의 검증 빌드를 건너뛰게 한다 — 리뷰 세션에서 lint/build/test를 중복 실행하지 않기 위함.
- pre-push는 `CLAUDECODE` 가 설정돼 있으면 건너뛴다(Claude 세션 안에 세션이 생기는 것을 막는다). 수동 우회는 `SKIP_AI_REVIEW=1 git push`.
- GitHub Action에는 Claude 인증 시크릿이 **둘 중 하나** 필요하다. `review-ci.sh` 는 둘 다 없을 때만 exit 2 로 죽고, 워크플로는 둘 다 env로 넘긴다. **둘 다 등록하면 CLI가 OAuth 토큰을 우선**하므로, API 키로 돌리려면 `CLAUDE_CODE_OAUTH_TOKEN` 을 등록하지 않은 채로 둔다.
  - `CLAUDE_CODE_OAUTH_TOKEN` — `claude setup-token` 으로 발급(Claude Pro/Max 구독 필요) → `gh secret set CLAUDE_CODE_OAUTH_TOKEN`. 종량 결제가 아니라 **구독 상한을 CI가 같이 소모한다**.
  - `ANTHROPIC_API_KEY` — Anthropic Console API 키 → `gh secret set ANTHROPIC_API_KEY`. **PR 리뷰마다 그 키가 속한 계정에 종량 과금**되고, `REVIEW_MODEL: opus` 라 PR 하나당 비용이 작지 않다.
- required status check 로 지정할 이름은 job id(`checks`/`ai-review`)가 **아니라** job의 `name:` 값이다 — **`typecheck · lint · build · test`** 와 **`AI 코드 리뷰`**. job id로 지정하면 영영 보고되지 않는 체크가 되어 모든 PR이 머지 불가가 된다. classic 브랜치 보호는 최근 7일 내 실행된 체크만 목록에 띄우므로, 지정 전에 PR을 한 번 돌려야 한다(ruleset은 이름 직접 입력 가능).
- CRITICAL: `execute.py`의 코드 커밋은 pre-commit 훅을 거친다. 훅이 거부하면 `_commit_step`이 phase를 **중단**한다(이전엔 WARN만 남기고 계속 진행해, 코드가 커밋되지 않은 채 phase가 completed로 기록되고 push까지 성공했다). Codex가 만든 코드에서 lint/타입 에러나 CRITICAL 규칙 위반이 나면 그 step부터 다시 실행해야 한다.
- 남은 위험(의도적으로 감수): 리뷰 세션은 PR이 통제하는 내용(diff·SKILL.md)을 읽으면서 Bash를 쓸 수 있다. 반출 대상에 `CLAUDE_CODE_OAUTH_TOKEN` 또는 `ANTHROPIC_API_KEY` 가 포함된다. 남은 완화책은 fork PR 리뷰 미실행 · 리뷰 스텝에 `GITHUB_TOKEN` 미주입(`persist-credentials: false`) · `WebFetch`/`WebSearch` 차단 · 기존 `dangerous-command-guard.sh`.
- **2026-09-01 저장소가 public으로 전환됐다**(required status check 가 Free 플랜 private 저장소에서 막혀 있었다 — GitHub이 제시한 선택지는 "Pro 구독" 또는 "public 전환" 둘뿐이었다). 그래서 위 완화책 중 **"private 저장소"는 더 이상 없다.** 다만 `pr-review.yml` 의 `head.repo.full_name == github.repository` 검사가 fork PR에서 `ai-review` job 자체를 실행하지 않으므로, 인젝션 표면은 **이 저장소에 push 권한이 있는 사람이 올린 PR**로 한정된다. 외부 컨트리뷰터를 실제로 받는 순간 이 가정이 깨지므로 그때는 Bash를 화이트리스트로 좁혀야 한다.
  - public 전환 시점에 히스토리 162커밋을 전수 검사했다: 토큰 패턴 0건, `.env.example` 은 값이 전부 빈칸, `handoff.local-backup.md` 는 `feat-8` 브랜치(미푸시)에만 존재. GitHub secret scanning 경보도 0건.
  - 같은 날 `secret_scanning` 과 `secret_scanning_push_protection` 을 켰다(public 저장소는 무료). 실수로 키를 커밋하면 push 단계에서 차단된다.
  - `checks` job에는 fork 가드가 없어 외부 fork PR에서도 돈다. 시크릿 미전달·읽기 전용 토큰이라 피해는 러너로 한정되지만 `npm ci` 가 남의 postinstall 을 실행할 수는 있다.
- 알려진 공백: (1) 하네스 자체(종료 코드 2 판정, hunk 라인 파서)에 유닛 테스트가 없다. (2) pre-commit의 grep 규칙은 인덱스를, ESLint/tsc는 작업 트리를 검사하므로 부분 스테이징에서 판정이 갈릴 수 있다. (3) `SEC04`는 CLAUDE.md의 3개 저장 경로 중 디스크만 막고 Storage 업로드·로그는 검사하지 않는다.

## 하네스: finsight MVP 계획·실행 오케스트레이션

**역할 분담:** 실제 코드 구현은 `scripts/execute.py` + Codex CLI가 담당한다(`phases/{phase}/index.json` + `step{N}.md` 순차 실행). Claude Code 에이전트 팀(db-schema/core-services/api-routes/frontend/qa)은 코드를 직접 작성하지 않고, **execute.py가 실행할 phase/step 계획을 세우고, QA로 검증하고, execute.py 실행을 트리거·모니터링**한다.

**트리거:** "phase 계획 짜줘", "MVP 구현 계획 세워줘", "execute.py 실행해줘", "Codex에게 넘겨줘", "계획대로 진행해줘" 등 요청 시 `finsight-build` 스킬을 사용하라. 특정 phase 계획 재작성, QA 지적사항 반영, blocked/error 난 step 재실행 같은 후속 요청도 동일 스킬을 사용한다. execute.py 실행(`--dangerously-bypass-approvals-and-sandbox`로 승인 없이 코드/커밋 생성)은 되돌리기 어려우므로 **phase 하나를 실행하기 전마다 반드시 사용자 확인**을 받는다.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-20 | 초기 구성 (db-schema/core-services/api-routes/frontend/qa 5인 팀 + 4개 스킬 + finsight-build 오케스트레이터, 팀이 코드 직접 구현) | 전체 | 코드 구현 전 설계 문서(PRD/ARCHITECTURE/ADR)가 명확한 역할 경계를 이미 갖고 있어, 그 경계를 그대로 에이전트 분리 기준으로 사용 |
| 2026-07-20 | 상태를 "보류/참고용"으로 변경, 자동 트리거 비활성화 | CLAUDE.md 포인터 | 실제 구현 경로로 `scripts/execute.py`(Codex) 채택 확정 — 두 실행 경로 혼동 방지 |
| 2026-07-20 | 아키텍처 전면 변경: 5개 에이전트를 "코드 구현"에서 "phase/step 계획 작성"으로 재정의, qa는 계획 검증+실행 후 코드 검증 겸임, `phase-planning` 스킬 신규 추가(execute.py 스키마), 오케스트레이터가 계획 확정 후 사용자 확인을 받아 `execute.py`를 직접 실행하도록 재작성 | 전체 (agents 5개, phase-planning 스킬 신규, finsight-build 재작성) | Claude 팀은 계획·검증, Codex는 실제 구현을 맡는 역할 분담으로 확정 |
| 2026-08-31 | 자동 코드 리뷰 3층 추가 (pre-commit 규칙 훅 / pre-push 경고 / PR GitHub Action), `review-code` 스킬에 CI 모드(JSON 계약) 신설 | scripts/githooks, scripts/review-ci.sh, scripts/ci/post-review.mjs, .github/workflows/pr-review.yml, review-code SKILL.md | 리뷰를 사람이 부를 때만 도는 상태에서 자동 게이트로 전환. LLM 리뷰는 확률적이므로 커밋이 아니라 PR을 막게 배치 |
