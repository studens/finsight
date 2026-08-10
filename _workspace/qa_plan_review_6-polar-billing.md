# QA 계획 검증 — 6-polar-billing (Codex 실행 전)

검증일: 2026-08-07
검증자: qa 에이전트 (`integration-qa` 0단계 + `phase-planning` 스키마 기준)
대상 계획: `phases/6-polar-billing/index.json`, `step0.md`~`step3.md`
대상 규약: `_workspace/00_input/scope_6-polar-billing.md`, `_workspace/02_db-schema_polar-mapping.md`, `_workspace/02_core-services_polar-interface.md`, `_workspace/03_api-routes_polar-contract.md`, `_workspace/03_frontend_polar-notes.md`

> 코드 검증은 **대상 아님** — 아직 phase 미실행. 이 문서는 계획 검증만 다룬다.
>
> **⚠️ 아래 1차 검증(2026-08-07)의 판정은 이미 무효다.** 지적된 BLOCKER 2건 + MAJOR 5건이 모두 수정됐고, 재검증 결과 **실행 승인**으로 뒤집혔다. 최종 판정은 이 문서 맨 아래 **"재검증 (2026-08-10)"** 절을 보라. 1차 검증 내용은 무엇을 왜 고쳤는지의 이력으로 보존한다.

---

## 판정 (1차 — 2026-08-10 재검증으로 대체됨)

**이대로 실행 불가.** BLOCKER 2건을 고친 뒤 실행하라. 두 건 모두 계획 안에 박혀 있는 **재현 확인된 테스트 로드 실패**이며, 각각 한두 줄 수정으로 해소된다. MAJOR 5건은 실행은 되지만 재시도 예산을 태우거나 추적/판정을 망가뜨린다.

| 심각도 | 건수 |
|---|---|
| BLOCKER | 2 |
| MAJOR | 5 |
| MINOR | 10 |

---

## 결과 요약

| 항목 | 상태 |
|---|---|
| 스키마 유효성 (execute.py 파싱) | 통과 |
| step 번호 ↔ 파일명 ↔ 본문 제목 정합 | 통과 |
| 최상위 `phases/index.json` 등록 | **실패** (MAJOR-1) |
| 보안 CRITICAL의 step 파일 내 인용 | 통과 |
| ADR-006 매핑 통일 (`canceled`/`past_due` 무시) | 통과 — 9개 문서 전수 대조, 정정 전 값 잔존 0건 |
| ADR-006 근거의 step 본문 복사 | 통과 (step0 §0-4, step2 §"ADR-006 회귀 방지") |
| step 간 인터페이스 정합 (시그니처·응답 shape·에러 코드) | 통과 |
| 웹훅 상태 코드 계약 (403/500/200/5xx) | 통과 |
| AC 기계 판정 가능성 | 대체로 통과, 2건 판정 불가 (MAJOR-2, MAJOR-5) |
| 테스트 파일 확장자 (`.ts` vs `.tsx`) | 통과 — 11개 신규/수정 테스트 전부 올바름 |
| 테스트 목킹 스캐폴드 실행 가능성 | **실패** (BLOCKER-1, BLOCKER-2) |
| `blocked` 유발 요인 (사용자 개입 요구) | 통과 — 0건 |
| 주입 가드레일(AGENTS.md/docs)과의 충돌 | **부분 실패** (MAJOR-3) |

---

## BLOCKER

### B-1. 테스트 목킹 스니펫이 `ReferenceError`로 suite 전체를 못 띄운다 — `step2.md:339-362`, `step1.md:157-166`

`step2.md` 2-3(b)가 "이 패턴을 쓰라"며 제시한 스캐폴드:

```typescript
class PolarWebhookVerificationError extends Error {}
class PolarConfigError extends Error {}

vi.mock("../../../../services/polar", () => ({
  ..., PolarWebhookVerificationError, PolarConfigError,
}))
```

`vi.mock` 팩토리는 파일 최상단으로 호이스팅되어 **모듈 본문의 `class` 선언보다 먼저 실행**된다. 실제로 재현했다:

```
Error: [vitest] There was an error when mocking a module...
Caused by: ReferenceError: Cannot access 'FakeError' before initialization
 Test Files  1 failed (1) | Tests  no tests
```

`route.test.ts`가 **테스트 0개로 로드 실패**하므로 step2의 웹훅 AC 20여 개를 하나도 판정할 수 없다. `step1.md:165`도 같은 결함이다 — `vi.mock` 팩토리에서 `PolarApiError`/`PolarConfigError`를 참조하는데 그 이름들이 `vi.hoisted` 블록에 없다. 게다가 `step1.md:169`/`step2.md:365`의 산문("목 팩토리 **안에서** 클래스를 정의해 export하라")은 스니펫과 서로 모순이며, 팩토리 안에서만 정의하면 테스트가 그 클래스 인스턴스를 만들 수 없다.

**수정 (동작 확인함).** 두 step 모두 에러 클래스를 `vi.hoisted` 안으로 옮기고, 산문의 모순된 문장을 삭제한다.

```typescript
const {
  isUnknownUserError, mapEventToSubscriptionStatus, resolveUserId,
  upsertSubscriptionStatus, verifyPolarWebhook,
  PolarWebhookVerificationError, PolarConfigError,
} = vi.hoisted(() => {
  class PolarWebhookVerificationError extends Error {}
  class PolarConfigError extends Error {}
  return {
    isUnknownUserError: vi.fn(), mapEventToSubscriptionStatus: vi.fn(),
    resolveUserId: vi.fn(), upsertSubscriptionStatus: vi.fn(),
    verifyPolarWebhook: vi.fn(),
    PolarWebhookVerificationError, PolarConfigError,
  }
})
```

담당: api-routes 플래너 (step1·step2 양쪽).

### B-2. `webhook.test.ts`에 `vi.mock("server-only")` 지시가 없어 반드시 로드 실패한다 — `step0.md:261-276`

`server-only`는 **이 저장소에 설치돼 있지 않다**(`node_modules/server-only` 부재, `require.resolve` 실패). Next 빌드는 자체 alias로 넘어가지만 **vitest는 넘어가지 못한다.** 재현:

```
Caused by: Error: Failed to load url server-only (resolved id: server-only). Does the file exist?
 Test Files  1 failed (1) | Tests  no tests
```

기존 `src/lib/supabase/service.test.ts`가 `vi.mock("server-only", () => ({}))`를 쓰는 이유가 이것이다.

step0 §0-5는 `webhook.ts` 첫 줄에 `import "server-only"`를 요구한다(AC 329도 grep으로 강제). 그런데 §0-7의 `vi.mock("server-only", () => ({}))` 지시는 **`client.test.ts`/`checkout.test.ts` 불릿 안에만** 들어 있고, `webhook.test.ts` 불릿에는 "`@polar-sh/sdk/webhooks.js`를 목킹하지 **마라**"만 적혀 있다. 지시를 문자 그대로 따르면 `webhook.test.ts`는 100% 로드 실패하고, 이 phase에서 **가장 중요한 테스트(진짜 서명으로 진짜 `validateEvent` 통과)**가 통째로 죽는다. AC 312~324의 13개 단정이 전부 판정 불가가 된다.

**수정.** `step0.md` §0-7의 목킹 규칙에 파일 무관 공통 항목을 하나 올린다:

> - **4개 테스트 파일 전부** 첫머리에 `vi.mock("server-only", () => ({}))`를 넣는다. `server-only`는 이 저장소에 npm 패키지로 설치돼 있지 않아(Next가 빌드 시 alias로 처리) vitest에서는 해석 자체가 실패한다. `client.ts`/`webhook.ts`를 (직접이든 배럴 경유든) import하는 테스트에서 이 목이 빠지면 파일이 로드조차 되지 않는다. `webhook.test.ts`에서 목킹하지 말라는 것은 `@polar-sh/sdk/webhooks.js`뿐이며 `server-only`는 반드시 목킹한다.

담당: core-services 플래너.

---

## MAJOR

### M-1. 최상위 `phases/index.json`에 `6-polar-billing`이 등록돼 있지 않다

현재 `phases/index.json`은 `0-db-schema`~`5-logout` 6개만 담고 있다. `execute.py:_update_top_index`는 일치하는 `dir`을 못 찾으면 **조용히 아무것도 하지 않는다**(`break` 없이 루프 종료). 실행은 정상 진행되지만 phase 완료/실패/차단이 최상위 인덱스에 영원히 기록되지 않아 진행률 추적이 끊긴다. 이전 5개 phase는 모두 등록돼 있으므로 관례 위반이기도 하다.

**수정(리더 몫 — QA는 `index.json` 수정 금지 지시를 받았다).** `phases/index.json`의 `phases` 배열 끝에 추가:

```json
{ "dir": "6-polar-billing", "status": "pending" }
```

### M-2. step0 AC 328의 grep이 실측과 어긋나고, 같은 step의 AC 333과 충돌한다 — `step0.md:328`

> "저장소 전체에서 … `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`·`POLAR_PRODUCT_ID` 참조가 `src/services/polar/` 밖에는 존재하지 않음을 grep으로 확인한다."

실측하면 `src/services/polar/`가 만들어지기도 전에 이미 8개 파일이 걸린다:

```
.env.example
_workspace/00_input/scope_6-polar-billing.md
_workspace/02_core-services_polar-interface.md
_workspace/02_db-schema_polar-mapping.md
_workspace/03_api-routes_polar-contract.md
phases/6-polar-billing/step0.md, step1.md, step2.md
```

Codex는 이 AC를 (a) 영원히 실패로 판정해 재시도를 소진하거나, (b) `.env.example`에서 키를 지워 "고치려" 한다. (b)는 같은 step의 **AC 333("`.env.example`에 새 키를 추가하지 않았다 / 수정되지 않았다")과 정면 충돌**한다.

**수정.** 검사 범위를 소스로 한정한다:

> - [ ] (서버 전용 CRITICAL) `grep -rn "NEXT_PUBLIC_POLAR" src/`가 **0건**이고, `grep -rln "POLAR_ACCESS_TOKEN\|POLAR_WEBHOOK_SECRET\|POLAR_PRODUCT_ID" src/`의 결과가 **`src/services/polar/` 아래 파일뿐**임을 확인한다. (`.env.example`·`_workspace/`·`phases/`는 검사 대상이 아니다 — 환경변수 이름이 문서에 적혀 있는 것은 정상이며 `.env.example`은 수정 금지다.) `src/components/` 아래 어떤 파일도 `services/polar`를 import하지 않는다.

담당: core-services 플래너.

### M-3. 주입되는 ADR-006 "트레이드오프" 문장이 step2의 마이그레이션 금지와 정면 충돌한다

`execute.py:_load_guardrails`는 `AGENTS.md` + `docs/*.md`를 **전문 그대로** 프롬프트에 붙인다(`_workspace/`는 안 붙는다 — 이 전제는 계획 문서들이 정확히 인지하고 있다). 그런데 붙는 문서 안에 이런 문장이 있다:

- `docs/ADR.md:36` — "**`polar-billing` phase에서 `subscriptions` 마이그레이션(컬럼 추가), `polar_webhook_events` 테이블**, 체크아웃/웹훅 코드와 관련 테스트가 추가로 필요하다."
- `AGENTS.md:17` — "(이번 phase는 `subscriptions` 엔타이틀먼트 스키마만 준비하고, 실제 체크아웃/웹훅 연동은 Polar 계정 준비 후 `polar-billing` phase에서 구현한다.)"
- `docs/ARCHITECTURE.md:17,31,78,84`, `docs/PRD.md:19,39`, `docs/UX-GUIDE.md:152` — 모두 "polar-billing은 아직 미구현"

`step2.md:154,307`과 AC 419·423이 "마이그레이션 0건 / `polar_webhook_events` 금지"를 강하게 못박고 있어 Codex가 결국 계획을 따를 가능성이 높지만, **반박 근거가 step 본문에 없다.** 반박은 `_workspace/02_db-schema_polar-mapping.md:28`("ADR-006 트레이드오프 절의 서술은 결정이 아니라 당시의 비용 추정")에만 있고 그 문서는 주입되지 않는다. ADR-006 매핑 근거는 성실히 복사해 넣었으면서 이 반박만 빠졌다.

**수정.** `step2.md` "절대 하지 말 것 (CRITICAL)" 첫 항목 아래에 한 문단 추가:

> **주입된 `docs/ADR.md`가 헷갈리게 만들 수 있다.** ADR-006의 *트레이드오프* 절은 "`polar-billing` phase에서 `subscriptions` 마이그레이션(컬럼 추가), `polar_webhook_events` 테이블이 필요하다"고 적고 있다. **이것은 결정이 아니라 ADR 작성 당시의 비용 추정이다.** 실제로 설계해 보니 (a) 쓰기가 `user_id` 유니크 키 upsert 1회라 구조적으로 멱등이어서 이벤트 중복 제거 테이블이 불필요하고, (b) Polar 고객 매핑은 `externalCustomerId` 역참조로 충분하다. db-schema 플래너가 2026-08-07에 "이번 phase 스키마 변경 없음"으로 확정했다. ADR-006의 *결정문*("이번 phase는 스키마만, 결제 연동은 후속 phase에서" + "취소 시에도 이미 결제된 기간이 끝날 때까지 Premium 유지")은 그대로 지켜진다. 마이그레이션 파일을 만들지 마라.

`step0.md`에도 한 줄 필요하다 — AGENTS.md L17의 "이번 phase는 스키마만"을 Codex가 "그럼 `src/services/polar/`를 만들면 안 되는 거 아닌가"로 읽을 여지가 있다. §배경에 "AGENTS.md·docs가 말하는 그 '후속 polar-billing phase'가 **바로 이 phase**다"를 명시하라.

담당: 리더 또는 api-routes/core-services 플래너.

### M-4. step0의 웹훅 픽스처가 재시도 예산을 태울 가장 유력한 지점 — `step0.md:293`

step0은 (옳게도) `@polar-sh/sdk/webhooks.js`를 목킹하지 말고 **진짜 서명 → 진짜 `validateEvent`** 를 통과시키라고 요구한다. 그러려면 `subscription.active` 픽스처가 SDK의 `Subscription` zod 스키마 **필수 필드를 전부** 갖춰야 한다. 현재 지시는 "`{ kind: "event" }`가 나올 때까지 픽스처를 채워라"뿐이라, Codex는 눈감고 필드를 추측하며 반복하게 된다. `_execute_single_step`의 재시도는 3회뿐이다.

**수정.** `step0.md` §0-7 픽스처 불릿에 탐색 경로를 명시한다:

> 픽스처를 추측하지 마라. `npm install` 직후 `node_modules/@polar-sh/sdk/dist/esm/models/components/subscription.d.ts`(및 같은 디렉토리의 `webhooksubscriptionactivepayload.d.ts`)를 열어 **필수(optional 아님) 필드 목록을 그대로 읽어** 픽스처를 만든다. `zod` 스키마의 `$inboundSchema`가 요구하는 snake_case 키를 쓴다. 3회 시도해도 파싱이 안 되면 실패 원인이 되는 zod 에러 메시지(`SDKValidationError.message`)를 픽스처 보완의 근거로 삼아라 — 그 메시지가 누락 필드를 정확히 알려준다.

담당: core-services 플래너.

### M-5. step3 AC의 "43개 파일 / 311개 테스트"가 step3 시점에는 거짓 — `step3.md:345`

> "이 step 시작 시점의 **43개 파일 / 311개 테스트**가 하나도 실패하지 않는다."

`npm run test` 실측 결과 **43 files / 311 tests**는 맞다 — 단 **phase 시작 전(= step0 시작 전)** 기준이다. step0이 테스트 4개, step1이 1개, step2가 1개(교체) 파일을 추가하므로 step3 시작 시점의 실제 수치는 47~48 files / 400+ tests다. 숫자를 그대로 확인하려는 Codex는 불일치를 보고 "뭔가 깨졌다"고 오판하거나 AC를 판정 불가로 처리한다.

**수정.**

> - [ ] (회귀 없음) `npm run test`가 전부 통과한다. 특히 **phase 시작 전부터 있던 43개 파일 / 311개 테스트**가 하나도 실패하지 않고, step 0~2가 추가한 테스트도 그대로 통과한다(step3 시작 시점의 전체 파일·테스트 수는 `npm run test` 출력을 기준으로 삼되, 이 step 때문에 줄어들면 안 된다). 변경이 허용된 테스트는 `PremiumSection.test.tsx`의 첫 테스트 분해와 `DashboardPages.test.tsx`의 호출 시그니처 수정뿐이며, 두 파일 모두 기존 단정 내용(배지 4개·설명 색·backdrop 금지·list 부재·구독자 경로·에러 모달·반경 구분)이 그대로 남아 있다.

담당: frontend 플래너.

---

## MINOR

1. **`step1.md:9` 잘못된 파일 경로.** `src/components/dashboard/PremiumSection.tsx` → 실제는 `src/components/PremiumSection.tsx`(`dashboard/` 디렉토리 없음). "건드리지 마라" 맥락이라 무해하지만 정정할 것.
2. **`step0.md:19` `src/lib/config.ts` 표기.** `@polar-sh/sdk`의 내부 파일인데 우리 레포 파일처럼 읽힌다. `@polar-sh/sdk`의 `src/lib/config.ts`로 명시하라.
3. **`step2.md`의 `VerifiedWebhook` 타입 import 누락.** §"상대 경로 import" 블록에 값 4개만 있는데 ② 스니펫이 `let verified: VerifiedWebhook`을 쓴다. `import type { VerifiedWebhook }` 한 줄 추가. (타입은 런타임에 지워지므로 목킹에는 영향 없다.)
4. **`_workspace/03_api-routes_polar-contract.md:168`의 경고가 사실이 아니다.** "db-schema 문서 §4의 표는 정정 전 값이 남아 있다"고 적혀 있으나 실제로 `_workspace/02_db-schema_polar-mapping.md:88-92`는 **이미 정정된 표**다. 스테일 경고를 지워야 후속 독자가 db-schema 문서를 불신하지 않는다.
5. **`_workspace/02_db-schema_polar-mapping.md:158`의 역사 기록이 최종 매핑과 어긋난다.** "[해결됨]" 블록 안이지만 "`revoked`/`past_due`만 `'inactive'`로 매핑하면 된다"고 적혀 있어 확정안(`past_due`는 무시)과 다르다. 역사 기록임을 더 분명히 하거나 문장을 정정하라.
6. **`_workspace/03_api-routes_polar-contract.md:120`이 step3 결정과 어긋난다.** "짧은 대기/**폴링**·재조회 UX를 고려해야 한다"고 권고하나 step3는 폴링을 명시적으로 기각했고 `docs/ARCHITECTURE.md`의 "폴링 없음" 전제를 지키기로 했다. 계약 문서를 "폴링 없이 안내 배너 1회"로 맞추라. (Codex 주입 대상이 아니라 실행에는 영향 없음.)
7. **`_workspace/02_db-schema_polar-mapping.md`에 재번호 전 step 표기 잔존.** §4의 "step 1/3 실행 시", "step 3의 테스트", §1의 "step 0(스키마 마이그레이션)" 등. 현재 배치는 0=services / 1=checkout / 2=webhook / 3=frontend다.
8. **`409 ALREADY_SUBSCRIBED`에 프론트 전용 문구 없음.** `useApiError.ERROR_MESSAGES`에 없어 기본 문구로 떨어진다. step1·step3·계약 문서가 모두 "의도적 수용"으로 명시했으므로 지적이 아니라 확인 사항이다.
9. **결제 복귀 동선의 UX 공백.** `successUrl`이 `/dashboard`인데 잠금 CTA는 `/dashboard/[analysisId]`(`PremiumSection` 렌더 위치)에 있다. 배너가 "Premium 리포트를 바로 확인할 수 있어요"라고만 하고 분석 상세로 가는 링크는 없다. `HistoryList`가 바로 아래 있어 도달은 가능하므로 MVP 허용 범위. 후속 개선 후보.
10. **step1·step2 AC의 "미커밋 변경을 커밋에 끌어들이지 마라"는 Codex가 통제할 수 없다.** `execute.py:_commit_step`이 `git add -A` 후 phase의 `index.json`/`step*-output.json`만 reset하므로, 현재 미커밋 상태인 `.env.example`(수정), `.mcp.json`·`_workspace/*`·`phases/6-polar-billing/*`(신규)는 **step0 커밋에 자동으로 쓸려 들어간다.** 시크릿 유출은 없다(`.env.local`이 `.gitignore:7 .env*.local`로 확실히 제외됨, `.mcp.json`에 토큰 없음). 정리하려면 리더가 **실행 전에** 이들을 별도 커밋해 두는 편이 낫다.

---

## 통과 항목 (근거)

### 보안 CRITICAL — 전 항목 통과

| 요구 | 어디서 강제되나 |
|---|---|
| 서명 검증 통과 뒤에만 `subscriptions` 갱신 | `step2.md:198` + AC 396 (`PolarWebhookVerificationError` → 403이고 `upsertSubscriptionStatus`·`resolveUserId`·`mapEventToSubscriptionStatus` **전부 미호출** 단정) |
| 검증 실패 시 거부 | AC 396(403 `INVALID_SIGNATURE`) + AC 397(에러 message가 응답 본문에 미노출) |
| 설정 오류 ≠ 서명 실패 | step0 AC 316(`PolarConfigError`가 `PolarWebhookVerificationError`가 **아님**을 `not.toBeInstanceOf`로 단정) + step2 AC 398(500) |
| `NEXT_PUBLIC_` 금지 | step0 AC 328(`NEXT_PUBLIC_POLAR` 0건), step3 AC 337(`grep POLAR_ src/components/ src/hooks/` 0건) |
| 라우트가 SDK 직접 import 금지 | step0 AC 330, step1 AC 198, step2 AC 427 — 세 step 모두 `grep -rn "@polar-sh/sdk" src/app/` 0건. `createPolarClient`를 배럴에서 재export하지 않아(step0 AC 331) 구조적으로도 차단 |
| 쓰기는 service-role 경유 | step2 AC 422(`route.ts`에 `lib/supabase/service`·`@supabase/supabase-js`·`SUPABASE_SERVICE_ROLE_KEY`·`createServiceClient` 각 0건), step1 AC 199(체크아웃 라우트는 DB 미접촉) |
| `subscriptions`에 쓰기 RLS 정책 **추가 안 함** | step2 AC 420. 실측 확인: 현재 정책은 `select_own_subscription`(`for select`) 1개뿐 |
| `userId`는 서버 세션에서만 | step1 §④ + AC 187(본문에 uuid를 실어 보내도 `createCheckoutSession`이 `{ userId: "user-1" }`으로 호출됨) + AC 188(`request.json`/`text`/`formData`/`searchParams` 각 0건 grep) |
| 로그 유출 없음 | step0 AC 327(`src/services/polar/` 전체 `console.` 0건), step1 AC 201, step2 AC 429 |
| 수동 HMAC 금지 / secret 이중 인코딩 금지 | step0 AC 325·326 (`crypto`·`createHmac`·`standardwebhooks` 0건, `toString("base64")` 0건) |
| Premium lazy-generate·403 게이팅 불변 | step2 AC 421(`src/lib/supabase/server.ts` 무변경 + `reports` 라우트 테스트 무손상), step3 AC 335·336(잠금 카드에서 `/api/reports/` 호출 0건, `role="list"` 부재, `backdrop-blur` 0건) |

### ADR-006 회귀 방지선 — 통과

step 파일 4개와 규약 문서 5개를 전수 grep했다. **정정 전 값(`canceled → inactive`)이 살아 있는 곳은 0건**이다. 유일한 잔존은 `_workspace/02_db-schema_polar-mapping.md:155-158`이지만 명시적으로 `[해결됨 — 2026-08-07 리더 수용]` + "아래는 당시 원문 기록이다"로 봉인돼 있다(MINOR-5 참조).

`_workspace/`가 주입되지 않는다는 제약도 정확히 처리됐다 — 매핑 근거가 **step 본문에 실제로 복사돼 있다**: `step0.md:166-178`(전용 인용 블록), `step2.md:270-297`(표 + ADR 결정문 인용 + 이력). ADR-006 결정문 원문("취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지")은 주입되는 `docs/ADR.md:34`에도 있어 이중으로 뒷받침된다.

회귀 방지 AC도 우회 불가능하게 짜였다. 세 겹이다:
- step0 AC 310 — `canceled`/`past_due` → `null`을 **독립 테스트 케이스**로 강제하고 "`"inactive"`를 기대하는 단정이 있으면 안 된다"까지 명시
- step0 AC 311 — `SUBSCRIPTION_STATUS_BY_EVENT_TYPE` 키가 정확히 3개임을 `Object.keys().sort()` `toEqual`로 고정 (키를 추가하면 즉시 실패)
- step2 AC 412·413·415 — step0의 테스트가 수정·삭제되지 않았고 `subscription-status.ts`가 `git diff`에 없음

라우트가 매핑을 재구현할 여지도 막았다 — step2 AC 408(`route.ts`에 `"subscription.` 문자열과 `switch` 키워드 각 0건).

### step 간 인터페이스 정합 — 통과

| 경계 | 확인 |
|---|---|
| step0 → step1 | `createCheckoutSession(input: { userId, email? }): Promise<{ checkoutId, url }>` — step0 §0-3과 step1 §"step 0이 이미 제공하는 것"이 문자 단위로 일치 |
| step0 → step2 | `verifyPolarWebhook`이 **동기**임을 step0 §0-5 시그니처와 step2:35 주석·②스니펫(`await` 없음)이 일치. `resolveUserId`/`mapEventToSubscriptionStatus`/`VerifiedWebhook` 유니온도 일치 |
| step1 → step3 | 성공 응답 `{ url }` 한 필드. step1 §⑤·AC 186(`toEqual`로 `checkoutId` 혼입 차단) ↔ step3 §3-0·AC 330. step3는 추가로 "구현 전 실제 `route.ts`를 열어 필드명 확인"이라는 안전장치까지 둠 |
| step2 신규 함수의 경계 | `upsertSubscriptionStatus`/`isUnknownUserError`는 `services/supabase-admin`에만 추가되고 step0의 `services/polar`와 겹치지 않는다. step0 AC 332가 `src/services/supabase-admin/`을 무변경으로 못박아 역방향 침범도 차단 |
| 웹훅 응답 코드 | step2 표(:257-266) ↔ 계약 문서(:139-148) ↔ core-services 문서(:74-85) ↔ db-schema §3 — 4개 문서 전부 일치. "재시도로 해결 가능한 일시적 DB 오류만 5xx"라는 경계가 세 곳 모두에 근거와 함께 서술돼 있고, AC 400·401·402·404(전부 200)와 AC 405(5xx)가 그 경계를 테스트로 고정 |

### step 순서와 실행 가능성 — 통과

- `index.json`의 step 0~3이 연속이고 `status`가 전부 `"pending"`, 필드도 `step`/`name`/`status` 3개뿐 — `phase-planning` 스키마 준수.
- `"phase": "6-polar-billing"`이 디렉토리 슬러그와 일치 → 브랜치 `feat-6-polar-billing`, 커밋 `feat(6-polar-billing): step N — ...`. `4-pdf-statement`·`5-logout`과 같은 최신 관례.
- 파일명 ↔ 본문 제목 번호가 4개 모두 일치(`step0.md` = "# Step 0", …). `_workspace/03_frontend_polar-notes.md:107`이 올렸던 "step0.md 제목이 # Step 1" 문제는 **이미 정정됨**.
- 의존성 순서가 실제 호출 방향과 일치: services(0) → 소비 라우트(1, 2) → 화면(3). step1과 step2는 서로 독립이라 순서를 바꿔도 되지만, 현재 순서가 "결제 넣기 → 결제 받기"라 자연스럽다.
- **각 step이 선행 산출물만으로 실행 가능하다.** step1/step2/step3 모두 앞 step의 시그니처를 자기 본문에 복사해 뒀고, step3은 그것도 못 믿고 실제 코드를 열어보라고 지시한다.
- **`blocked` 유발 요인 0건.** "Polar 대시보드에서 X를 설정하라" 류의 요구가 4개 step 어디에도 없다. step0:9와 scope:21이 "Codex는 Polar 대시보드 조작이나 키 발급을 요구하지 마라"를 명시. step2의 "실행 후 수동 검증" 절은 **"Codex는 이 항목 때문에 step을 blocked 처리하지 말고 완료 summary에 남겨라"**로 정확히 처리돼 있다.
- **`npm install`이 step0 §0-0에 정확히 포함.** `@polar-sh/sdk@^0.49.0`(dependencies) + `standardwebhooks@^1.0.0`(devDependencies). npm 레지스트리 실측: `@polar-sh/sdk` 최신 0.49.0, `standardwebhooks` 1.0.0 — 둘 다 해석된다. `@polar-sh/sdk`의 `exports` 맵에 `"./*.js"` 패턴이 있어 step0이 지시한 `@polar-sh/sdk/webhooks.js` 서브패스 import도 `dist/esm/webhooks.js`로 정상 해석된다.

### AC 품질 — (M-2, M-5 제외) 통과

- 모호한 문구가 사실상 없다. `"적절히"`/`"잘 처리한다"`/`"필요에 따라"` 전수 grep → 0건. 유일한 소프트 표현은 `step1.md:121`의 "서비스가 알아서 …"인데 지시가 아니라 서술이다.
- AC가 전부 (a) grep 결과 개수, (b) 특정 테스트의 통과, (c) HTTP status·JSON body의 `toEqual`, (d) `git diff --name-only` 포함 여부 중 하나로 판정된다.
- **테스트 파일 확장자가 전부 올바르다.** `vitest.config.ts` 실측: node = `src/**/*.test.ts`, components = `src/components/**/*.test.tsx`.
  - step0 4개 → `src/services/polar/*.test.ts` ✓
  - step1 1개 → `src/app/api/checkout/route.test.ts` ✓
  - step2 2개 → `src/app/api/webhooks/polar/route.test.ts`, `src/services/supabase-admin/index.test.ts` ✓
  - step3 → `src/components/CheckoutSuccessBanner.test.tsx`, `PremiumSection.test.tsx`, `DashboardPages.test.tsx` — 전부 `src/components/` 아래 `.tsx` ✓
  - 네 step 모두 "`npm run test` 출력의 테스트 파일 목록에 **실제로 나타난다**"를 AC로 요구해 조용한 미실행을 이중 차단 ✓
- **TDD 순서가 4개 step 전부에 "TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다"로 명시** ✓
- **기존 테스트 보호.** 기준선 실측 `npm run test` → **43 files / 311 tests 전부 통과**. 수정이 필요한 기존 테스트가 전부 명시적으로 다뤄졌다:
  - `src/app/api/webhooks/polar/route.test.ts`(501 단정 1개) → step2:16이 "의도된 교체"로 명시
  - `src/components/PremiumSection.test.tsx` → step3 §3-4(a)가 5개 단정 중 3번만 분해하고 1·2·4·5는 "한 글자도 바꾸지 않는다"로 보존, 나머지 기존 4개 테스트는 무수정
  - `src/components/DashboardPages.test.tsx` → step3 §3-4(c)가 `searchParams` 시그니처 변경 이유(`tsconfig`가 `src/**/*.tsx`를 포함해 typecheck가 깨진다)까지 설명하며 처리
  - `src/services/supabase-admin/index.test.ts` / `index.test-d.ts` → step2 AC 387이 "수정 없이 그대로 통과"를 요구

### step3의 jsdom 기법 — 실증 확인

계획이 "검증된 방식"이라 주장한 두 가지를 직접 재현했다. 둘 다 **사실이다**:
- `vi.stubGlobal("location", { href: "" })` → `window.location.href` 대입·단정 정상 동작
- `window.history.replaceState(null, "", "/dashboard")` → `location.search === ""`, `history.length` 증가 없음

---

## 미검증 (실행 후 코드 검증으로 이월)

- **SDK 런타임 동작 3가지.** ① `validateEvent`가 알 수 없는 `type`에 대해 `WebhookVerificationError`가 **아닌** 에러를 던지는가(step0 AC 317의 `{ kind: "unsupported" }` 분기가 여기 걸려 있다), ② `standardwebhooks`가 헤더 누락에도 `WebhookVerificationError`를 던지는가(AC 314), ③ `Subscription` 스키마가 `customer.externalId`로 camelCase 변환하는가(AC 318-①). 설치 전이라 타입 정의를 열어볼 수 없었다. 셋 다 step0의 테스트가 실패로 드러내주므로 실행 후 확인한다.
- **활성화 시 실제로 오는 이벤트.** `subscription.created`만 오고 `subscription.active`가 오지 않으면 구독이 영영 활성화되지 않는다. step2 "실행 후 수동 검증" 2번이 이 확인과 조건부 대응(그 경우에만 `subscription.created` + `data.status === "active"` 추가)을 정확히 지시하고 있다. **실행 후 `polar listen`으로 반드시 태워볼 것.**
- **첫 결제 시 `subscriptions` 행이 INSERT되는가.** upsert 경로의 실제 동작은 유닛 테스트(목킹)로는 확인 불가. step2 수동 검증 3번에 있다.
- **`?checkout=success` 복귀 시 웹훅 경합.** 배너 두 분기 중 어느 쪽이 실제로 나오는지는 브라우저 확인 필요.

---

## 리더에게 보내는 실행 전 체크리스트

1. **[BLOCKER-1]** api-routes 플래너 — `step1.md:157-166`, `step2.md:339-362`의 목 스캐폴드를 `vi.hoisted` 안 클래스 정의로 교체. 모순되는 산문(`step1.md:169`, `step2.md:365`) 정리.
2. **[BLOCKER-2]** core-services 플래너 — `step0.md` §0-7에 "4개 테스트 파일 **전부** `vi.mock("server-only", () => ({}))`" 공통 규칙 추가.
3. **[MAJOR-1]** 리더 — `phases/index.json`에 `{ "dir": "6-polar-billing", "status": "pending" }` 추가.
4. **[MAJOR-2]** core-services 플래너 — `step0.md:328` grep 범위를 `src/`로 한정.
5. **[MAJOR-3]** 리더 — `step2.md`에 ADR-006 트레이드오프 반박 문단, `step0.md`에 "그 후속 phase가 바로 이 phase다" 한 줄 추가.
6. **[MAJOR-4]** core-services 플래너 — `step0.md` 픽스처 지시에 `node_modules/@polar-sh/sdk/dist/esm/models/components/subscription.d.ts` 탐색 경로 명시.
7. **[MAJOR-5]** frontend 플래너 — `step3.md:345`의 "43개 파일 / 311개 테스트" 문구를 "phase 시작 전 기준"으로 정정.
8. **[선택]** 실행 전에 미커밋 상태인 `.env.example`·`.mcp.json`·`_workspace/*`·`phases/6-polar-billing/*`를 별도 커밋해 두면 step0 커밋이 깨끗해진다(MINOR-10).

---
---

# 재검증 (2026-08-10) — Codex 실행 전 2차

재검증일: 2026-08-10
검증자: qa 에이전트
대상: 1차 지적(BLOCKER 2 / MAJOR 5 / MINOR 10) 수정본 + 새 결함 유입 여부
방식: 문서 대조 + **임시 파일로 직접 재현**(vitest 스캐폴드 2종) + **스크래치패드에 `@polar-sh/sdk@0.49.0` 독립 설치 후 런타임 10종 실측**

## 판정

# ✅ `python3 scripts/execute.py 6-polar-billing` 실행해도 된다.

**남은 BLOCKER 0건, MAJOR 0건.** 1차 지적 7건이 전부 실질적으로 해소됐고, 재현 검증에서 **새로 유입된 결함은 없다.** 남은 MINOR 4건은 전부 `_workspace/` 문서 위생 또는 커밋 노이즈이며 실행·보안·판정에 영향이 없다.

부수 성과: 1차에서 "미검증(실행 후로 이월)"으로 남겼던 **SDK 런타임 동작 3건이 전부 실측으로 종결**됐다(아래 §5). 이월 항목이 줄었다.

| 항목 | 1차 | 재검증 |
|---|---|---|
| BLOCKER | 2 | **0** |
| MAJOR | 5 | **0** |
| MINOR | 10 | 4 (전부 비차단) |
| 기준선 테스트 | 43 files / 311 tests 통과 | **동일 (재실행 확인)** |

---

## 1. BLOCKER 해소 — 재현으로 확인

### B-1 (목 호이스팅 TDZ) — **해소**

`step1.md:157-183`, `step2.md:339-380`의 수정본 스캐폴드를 임시 파일로 그대로 옮겨 실행했다. 목킹 경계를 넘는 `instanceof` 분기(502/500 분기)까지 포함해 검증했다:

```
✓ |node| src/__qa_tmp__/b1.test.ts (3 tests)
  ✓ 정상 경로
  ✓ PolarApiError -> 502 (목킹 경계 넘어 instanceof 동일성 유지)
  ✓ PolarConfigError -> 500 (502로 뭉개지지 않음)
```

1차의 `ReferenceError: Cannot access ... before initialization`이 재현되지 않는다. `vi.hoisted` 콜백 안에서 선언된 클래스가 `vi.mock` 팩토리 평가보다 먼저 준비되고, **라우트가 목 모듈에서 import한 클래스와 테스트가 던진 인스턴스가 동일 객체**라 `instanceof` 분기가 정상 판정된다. 리더 보고대로다.

부수 발견도 확인했다 — 1차 시점 `step1.md`의 `PolarApiError`/`PolarConfigError`는 `vi.hoisted`에도 최상위에도 **선언 자체가 없던** 미정의 식별자였고, 현재는 `vi.hoisted` 콜백 안에서 선언·반환된다.

방어 AC 2개도 실제로 들어갔다:
- `step1.md:202` / `step2.md:454` — "`Tests no tests`이거나 `ReferenceError`/`Failed to load url`로 로드 실패하면 **불합격**"
- `step1.md:203` / `step2.md:455` — "모듈 최상위 `class ... extends Error` 선언 **0건**, `vi.mock` 팩토리가 참조하는 모든 식별자가 `vi.hoisted` 반환값에서 온다"

동기 함수 목킹 지시도 정확하다(`step2.md:383`): `verifyPolarWebhook`은 동기이므로 `mockRejectedValue`가 아니라 `mockImplementation(() => { throw ... })`, 정상 케이스는 `mockReturnValue`. 1차 리포트가 짚지 않았던 부분인데 선제적으로 잡혔다.

### B-2 (`server-only` 미목킹) — **해소**

`step0.md:279-286`이 목킹 규칙 **맨 위 공통 항목**으로 승격됐고, 예외 조항까지 명시적으로 닫혔다("뒤에 나오는 '`webhook.test.ts`에서는 목킹하지 마라'는 **`@polar-sh/sdk/webhooks.js`에만 해당한다. `server-only`는 `webhook.test.ts`에서도 반드시 목킹한다**"). `step0.md:299-308`에 `webhook.test.ts` 전용 6줄 헤더 스니펫도 별도로 박혔다.

재현 확인:
```
✓ |node| src/__qa_tmp__/b2.test.ts (1 test)
  ✓ server-only를 import하는 모듈이 로드된다
```

AC도 기계 판정 가능하게 들어갔다(`step0.md:417`): `grep -c 'vi.mock("server-only"' src/services/polar/*.test.ts`가 4개 파일 모두 1 이상 + `Failed to load url server-only` 0건 + `Tests no tests` 파일 0건.

> 임시 검증 파일 4개(`src/__qa_tmp__/`)는 전부 삭제했고, 삭제 후 `npm run test`가 **43 files / 311 tests 전부 통과**함을 재확인했다. 저장소에 잔여물 없다.

---

## 2. MAJOR 해소

| # | 조치 | 확인 |
|---|---|---|
| M-1 | `phases/index.json`에 등록 | `{"dir": "6-polar-billing", "status": "pending"}` 존재 확인. `_update_top_index`가 이제 정상 매칭된다 |
| M-2 | grep 범위 `src/` 한정 | `step0.md:414-415`. **"왜" 한정하는지가 AC 본문에 들어갔다** — "이 히트를 고치려고 `.env.example`을 건드리지 마라, 아래 무수정 AC와 정면 충돌한다". 1차에 지적한 AC 간 자기모순이 닫혔다 |
| M-3 | 삼중 주입 | §3에서 별도 검증 — **모순 없음** |
| M-4 | 픽스처 완성본 삽입 | §4에서 독립 실측 — **실제로 파싱된다** |
| M-5 | 고정 수치 제거 | `step3.md:356`. "절대 수치가 아니라 **step 2 완료 시점 대비**", 작업 전 `npm run test`로 기준선 기록 → 작업 후 실패 0건 + 테스트 수 ≥ 기록값. 1차에 지적한 "43/311은 phase 시작 전 값" 문제가 정확히 해소됐다 |

---

## 3. M-3 삼중 주입 — 모순 없음, 과잉도 아님

세 곳의 내용을 대조했다.

| 위치 | 성격 | 핵심 주장 |
|---|---|---|
| `docs/ADR.md` ADR-006 하단 개정 블록 (신규, **주입됨**) | 권위 문서의 자기 정정 | 트레이드오프의 "마이그레이션·`polar_webhook_events` 필요" 예상은 **실현되지 않았다**(결정 아닌 비용 추정) / `externalCustomerId` 역참조로 매핑 충분 / upsert가 구조적 멱등 / `polar_subscription_id` unique는 새 실패 모드 / **`supabase/migrations/` 파일 추가 안 함, `src/types/database.ts` 안 바꿈** / 구독 해제는 `revoked` 하나로만 |
| `step0.md:11` (배경) | "지금이 그 phase다" 오인 차단 | 그 후속 phase가 **바로 이 phase**다 → 건너뛰거나 blocked 처리 금지 / 단, **마이그레이션·`polar_webhook_events`는 만들지 마라** |
| `step2.md` "절대 하지 말 것" 블록인용 | 유혹이 실제로 발생하는 지점에서의 반박 | 위와 동일 + "체크아웃·웹훅 코드를 만드는 것은 **맞고**, 마이그레이션과 `polar_webhook_events`를 만드는 것은 **아니다**"로 경계를 명시 분리 |

**세 문서가 서로 어긋나는 문장이 없다.** 사실 주장(마이그레이션 0건 / 이벤트 테이블 0건 / `externalCustomerId` 매핑 / upsert 멱등 / `revoked`만 해제)이 전부 일치하고, 결론도 동일하다.

**과잉이 아니라고 판단한다.** 세 곳의 역할이 다르다 — ADR은 권위 정정(다른 곳에서 재인용할 근거), `step0`은 "이 phase를 실행해도 되는가"라는 **시작 시점의 오인**을 막고, `step2`는 "마이그레이션을 만들까"라는 **유혹이 실제로 발생하는 지점**에서 막는다. 주입되는 `AGENTS.md`+`docs/*.md`가 길어(`docs/` 6개 파일 전문) ADR 개정 블록 하나만으로는 묻힐 위험이 있으므로, step-local 재확인이 신뢰도를 올린다.

한 가지 짚어둘 것: `docs/ADR.md`·`phases/index.json`이 **아직 커밋되지 않았다**. `execute.py:_load_guardrails`는 `ROOT/docs/*.md`를 **워킹 트리에서 `read_text()`로 직접 읽으므로** 미커밋 상태여도 개정 블록이 정상 주입된다. 문제 없다.

---

## 4. 새 결함 유입 여부 — 박아 넣은 픽스처 독립 검증

리더 보고("6회 반복 검증")를 그대로 신뢰하지 않고, **스크래치패드에 `@polar-sh/sdk@0.49.0` + `standardwebhooks@1.0.0`을 독립 설치**해 `step0.md:329-374`의 픽스처를 **그대로 복사**해 실측했다(저장소 `package.json`은 건드리지 않았다).

```
PASS  ① 픽스처 파싱 + camelCase 변환 :: type=subscription.active customer.externalId=11111111-2222-4333-8444-555555555555
PASS  ② external_id=null 폴백 픽스처도 파싱 :: externalId=null metadata.user_id=11111111-...
```

- **픽스처가 실제로 `validateEvent`를 통과한다.** 1차에 "재시도 예산을 태울 최유력 지점"으로 지목했던 위험이 사실상 제거됐다.
- `step0.md:377`이 지시한 **얕은 복사 오버라이드 방식**(`{ ...fx, data: { ...fx.data, customer: { ...fx.data.customer, external_id: null } } }`)도 그대로 파싱된다. AC 404-②(폴백) 테스트가 이 방식으로 만들어지므로 중요하다.
- `.d.ts`의 `?`와 inbound 스키마가 어긋난다는 지적(`current_meter_period_start`·`trial_start`·`paused_at`·`resumes_at`가 TS상 `Date | null`인데 실제로는 문자열 필수)도 픽스처에 반영돼 있다 — 그 4개 필드에 `null`이 아닌 `NOW`가 들어가 있다.

step0의 나머지 "이미 검증된 SDK 사실"도 함께 실측해 전부 사실임을 확인했다:

| 주장 | 실측 |
|---|---|
| `validateEvent`는 루트에서 export 안 됨 | `"validateEvent" in root` → **false**. 루트 export는 `HTTPClient, Polar, SDK_METADATA, ServerList, ServerProduction, ServerSandbox, files, serverURLFromOptions` |
| 옵션 키가 `server`(≠`environment`) | `new Polar({ accessToken, server: "sandbox" })` 정상, `checkouts.create`가 function |
| **`server` 생략 시 기본값 `production`** | `config.js:24` — `const server = options.server ?? ServerProduction;` ✅ **`step0.md:387`의 "프로덕션 오발사 방지 CRITICAL" AC가 실재하는 위험을 막고 있다** |
| `CheckoutCreate` 필드 | `products: Array<string>`(필수), `successUrl?`, `externalCustomerId?`, `customerEmail?`, `metadata?` 전부 존재 |
| `Checkout`에 `id`/`url` | `checkout.d.ts:31 id: string`, `:55 url: string` |
| `SubscriptionCustomer.externalId` | `subscriptioncustomer.d.ts:28 externalId?: string \| null \| undefined` |

**새 결함 유입 0건.**

---

## 5. 이월했던 SDK 런타임 3건 — 전부 종결 가능

1차에서 "설치 전이라 확인 불가, 실행 후로 이월"했던 항목을 실측으로 닫는다.

| 이월 항목 | 실측 결과 | 판정 |
|---|---|---|
| 알 수 없는 `type` → `WebhookVerificationError`가 **아닌** 에러인가 (`{ kind: "unsupported" }` 분기의 전제) | `SDKValidationError` throw, `instanceof WebhookVerificationError` = **false** | ✅ 종결. `step0.md:227-229`의 "`WebhookVerificationError`가 아니면 전부 unsupported" 전략이 성립 |
| 헤더 누락에도 `WebhookVerificationError`인가 (AC 400) | `headers={}` → `WebhookVerificationError`, `webhook-signature`만 누락 → `WebhookVerificationError` | ✅ 종결 |
| `external_id` → camelCase 변환되는가 (AC 404-①) | `data.customer.external_id` → `data.customer.externalId`로 변환 확인 | ✅ 종결 |

추가로 서명 검증 자체도 확인했다: **body 변조 → `WebhookVerificationError`**, **다른 secret → `WebhookVerificationError`**. AC 399가 요구하는 두 케이스가 실제로 그렇게 동작한다.

### "헤더 대소문자가 아니라 `Headers` → 평범한 객체 변환이 load-bearing" 정정 — **AC를 약화시키지 않았다. 오히려 강화됐다.**

정정 내용을 실측으로 검증했다:

```
PASS  ⑧ Webhook-Id 등 대문자 섞인 평범한 객체 -> 통과 (대소문자는 standardwebhooks가 자체 처리)
PASS  ⑨ Headers 인스턴스 그대로 -> WebhookVerificationError (정규화 없으면 정상 요청도 실패)
PASS  ⑩ Headers -> 소문자 평범한 객체 정규화 후 -> 통과
```

정정이 정확하다. 그리고 **AC가 약해지지 않았다**:
- 1차 계획의 AC는 "대소문자 케이스 + `Headers` 케이스 모두 통과"였다. 현재 `step0.md:401`은 두 케이스를 **그대로 유지**하면서 "**②가 이 AC의 핵심이다 — `Headers`를 평범한 객체로 변환하지 않으면 정상 요청도 서명 검증에 실패한다**"를 덧붙였다. 케이스가 삭제된 게 아니라 **어느 쪽이 진짜 방어선인지 표시가 추가**된 것이다.
- ⑨ 실측이 보여주듯 `Headers` 케이스는 **구현이 정규화를 빠뜨리면 실제로 실패하는** 살아 있는 단정이다. 이게 없으면 "라우트가 `request.headers`를 그대로 넘긴다"는 step2 계약(`step2.md:195`, AC 395)이 프로덕션에서 **모든 웹훅을 403으로 만드는** 경로가 된다.
- 대소문자 케이스(①)는 이제 `standardwebhooks`가 자체 처리하므로 사실상 자명하게 통과하는 약한 단정이지만, 유지 비용이 0이고 계약을 문서화하는 값어치가 있다. 제거를 요구하지 않는다.
- `step0.md:219-220`의 구현 지시도 이유와 함께 정확히 적혀 있다("`standardwebhooks`는 `headers["webhook-id"]` 같은 평범한 객체 속성 접근을 하므로, `Headers` 인스턴스를 그대로 넘기면 모든 헤더가 `undefined`가 되어 정상 요청도 검증 실패한다").

---

## 6. ADR-006 회귀 방지선 — 훼손 없음 (전수 grep)

step 파일 4개 + 규약 문서 5개 + `docs/ADR.md`를 전수 grep했다.

- **`canceled`/`past_due` → `'inactive'`로 매핑하는 표나 지시가 0건.** `inactive`가 등장하는 모든 히트가 (a) `revoked → inactive`(정상), (b) "~로 바꾸지 마라"는 금지문, (c) "즉시 inactive로 내리면 사용자가 이미 지불한 기간을 빼앗는다"는 반박 근거 중 하나다.
- **5개 문서의 매핑 표가 전부 일치.** `step0.md:171` / `step2.md:285` / `02_db-schema_polar-mapping.md:89` / `02_core-services_polar-interface.md:121` / `03_api-routes_polar-contract.md:159` — `subscription.revoked` 행이 모두 `inactive`, 나머지 배치도 동일.
- **`step0.md`의 회귀 방지 AC 3종이 한 글자도 안 바뀌었다.** AC 396(독립 테스트 케이스 + ADR 문구 + `"inactive"` 기대 금지), AC 397(`Object.keys().sort()`로 키 정확히 3개 고정), `step2.md`의 AC(step0 테스트 무수정 + `subscription-status.ts`가 `git diff`에 없음). core-services의 "한 글자도 건드리지 않았다" 보고가 사실이다.
- `docs/ADR.md` 개정 블록이 **주입 경로에도** "구독 해제는 오직 `subscription.revoked` 하나로만 일어난다"를 추가했다 — 방어선이 한 겹 늘었다.

---

## 7. 남은 MINOR (4건) — 전부 비차단

1차 MINOR 10건 중 6건이 해소됐다: 잘못된 `PremiumSection` 경로(`step1.md:9`), `src/lib/config.ts` 출처 모호(`step0.md:21`에 "우리 레포 파일 아님" 명시), `VerifiedWebhook` 타입 import 누락(`step2.md:89` + 주석), 계약 문서의 스테일 경고(정정됨), 계약 문서의 폴링 권고(→ "**폴링하지 않는다**"로 정정, step3와 일치), 409 문구(설계 의도로 확정).

남은 것:

1. **`_workspace/02_db-schema_polar-mapping.md:158`** — `[해결됨]` 블록 안 역사 기록이 "`revoked`/`past_due`만 `'inactive'`로 매핑하면 된다"고 적혀 있어 확정안(`past_due`는 무시)과 다르다. 봉인 표시가 있고 주입 대상이 아니라 실행 영향 0. 후속 정리 권장.
2. **`_workspace/02_db-schema_polar-mapping.md`의 재번호 전 step 표기** — 4행 "core-services(step 1), api-routes(step 2·3), frontend(step 4)", 103행 "step 3의 테스트", 104행 "step 1/3 실행 시". 현재 배치는 0=services / 1=checkout / 2=webhook / 3=frontend. 주입 대상 아님.
3. **결제 복귀 동선의 UX 공백** — `successUrl`이 `/dashboard`인데 잠금 CTA는 `/dashboard/[analysisId]`에 있다. 배너가 "Premium 리포트를 바로 확인할 수 있어요"라고만 하고 분석 상세로 가는 링크가 없다. 바로 아래 `HistoryList`로 도달 가능하므로 MVP 허용. 후속 개선 후보.
4. **커밋 노이즈** — `execute.py:_commit_step`이 `git add -A` 후 **phase 레벨** `index.json`과 `step*-output.json`만 reset하므로, 현재 미커밋 상태인 `.env.example`(수정)·`docs/ADR.md`(수정)·`phases/index.json`(수정)·`.mcp.json`·`_workspace/*`·`phases/6-polar-billing/*`가 전부 **step 0의 `feat(6-polar-billing): step 0 — ...` 커밋에 쓸려 들어간다.** 시크릿 유출은 없다(`.env.local`이 `.gitignore:7 .env*.local`로 제외됨을 재확인, `.mcp.json`에 토큰 없음). 실행 **전에** 이들을 별도 커밋해 두면 step 0 커밋이 깨끗해진다. **선택 사항.**

---

## 8. 실행 전 최종 확인 (모두 통과)

- [x] `phases/6-polar-billing/index.json` — `project`/`phase`/`steps` 3필드, step 0~3 연속, 전부 `"pending"`, 부가 필드 없음
- [x] `"phase": "6-polar-billing"` = 디렉토리 슬러그 → 브랜치 `feat-6-polar-billing`, 커밋 `feat(6-polar-billing): step N — ...`
- [x] `feat-6-polar-billing` 브랜치가 **아직 없다** → `_checkout_branch`가 `checkout -b`로 생성. 미커밋 변경은 새 브랜치로 그대로 따라간다(HEAD에서 분기하므로 충돌 없음)
- [x] `phases/index.json`에 `6-polar-billing` 등록 → `_update_top_index` 정상 동작
- [x] step 파일 4개 존재, 파일명 ↔ 본문 제목 번호 일치
- [x] `_check_blockers` — 모든 step이 `pending`이라 조기 종료 없음
- [x] 기준선 `npm run test` = **43 files / 311 tests 전부 통과** (임시 검증 파일 삭제 후 재확인)
- [x] `blocked` 유발 요인 0건 — Polar 대시보드 조작·키 발급 요구가 4개 step 어디에도 없음. `step2.md`의 수동 검증 절은 "Codex는 이 항목 때문에 blocked 처리하지 말고 완료 summary에 남겨라"로 명시
- [x] 임시 검증 파일 전량 삭제, 저장소 잔여물 없음

---

## 9. 실행 후 코드 검증(1단계)에서 볼 것

이 문서는 계획 검증까지다. 실행이 끝나면 아래를 코드로 재확인한다(Codex의 `completed` 자기 보고를 신뢰하지 않는다).

- `npm run test` 출력에서 **신규 테스트 7개 파일이 실제로 실행됐는지**(`Tests no tests` 0건) — B-1/B-2가 재발하지 않았는지의 최종 증거
- `SUBSCRIPTION_STATUS_BY_EVENT_TYPE` 키가 **실제 코드에서** 정확히 3개인지, `subscription-status.ts`가 `git diff`에 없는지
- 웹훅 라우트가 `request.text()` 1건 / `request.json` 0건, `verifyPolarWebhook` 실패 시 `upsertSubscriptionStatus` 미호출
- `subscriptions`에 쓰기 RLS 정책이 여전히 0건, `supabase/migrations/` 신규 파일 0건, `src/lib/supabase/server.ts` 무변경
- `grep -rn "@polar-sh/sdk" src/app/ src/components/` 0건, `grep -rn "POLAR_" src/components/ src/hooks/` 0건
- Premium 게이팅(403 `PAYWALL_REQUIRED`)·lazy-generate 테스트 무손상

**수동 검증(사용자 몫, `step2.md` 말미):** `polar listen`으로 샌드박스 결제를 1회 태워 ① 활성화 시 실제로 `subscription.active`가 오는지(`subscription.created`만 온다면 매핑 표에 조건부 추가 필요), ② `subscriptions`에 행이 **새로 INSERT**되고 `status='active'`·`updated_at` 갱신되는지.
