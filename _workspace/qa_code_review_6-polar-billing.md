# QA 코드 검증 — phase `6-polar-billing` (Codex 실행 후)

- 검증 시점: 2026-08-10
- 브랜치: `feat-6-polar-billing`, 대상 범위: `01fbaa3..6533391`
- `phases/6-polar-billing/index.json`: step 0~3 전부 `completed`. `error`/`blocked` **0건**
- 자체 재실행 결과: `npm run test` **49 파일 / 398 테스트 전부 통과**, `npm run build` **성공(exit 0)**
- 기준 문서: `phases/6-polar-billing/step0~3.md` AC, `_workspace/qa_plan_review_6-polar-billing.md` §9, `CLAUDE.md`/`AGENTS.md` CRITICAL, `docs/ADR.md` ADR-006/ADR-007

---

## 판정: **조건부 머지 가능**

### 보안 CRITICAL 위반: **없음 (0건)**

웹훅 서명 선행 검증, Polar 시크릿 서버 격리, `@polar-sh/sdk` 경계, 세션 유래 `userId`, service-role 단일 쓰기 경로, RLS 쓰기 정책 0건, 로그 유출 0건, ADR-007 페이월 무손상 — **전 항목 통과.** 근거는 아래 A절.

머지를 막을 결함은 없다. 다만 MAJOR 2건은 **실제 돈이 흐르기 전에** 처리되어야 한다(§조건 참조).

| 심각도 | 건수 |
|---|---|
| CRITICAL | **0** |
| MAJOR | **2** (M-1 파싱 실패 무음 폐기, M-2 이벤트 순서 역전) |
| MINOR | **4** |

---

## A. 보안 불변식 — 전 항목 통과

| 불변식 | 결과 | 근거 |
|---|---|---|
| 서명 검증 **이전** DB 쓰기 분기 없음 | ✅ | `route.ts:16-26`에서 `verifyPolarWebhook`이 먼저 실행되고, throw 시 즉시 `return`. `upsertSubscriptionStatus`는 `route.ts:43` 단 1곳뿐이며 검증 통과 경로에서만 도달. `route.test.ts:75-90`이 403 시 `resolveUserId`/`mapEventToSubscriptionStatus`/`upsertSubscriptionStatus` 전부 `not.toHaveBeenCalled()` 단정 |
| 검증→쓰기 순서 | ✅ | `route.test.ts:175-177`이 `invocationCallOrder`로 강제 |
| Polar 시크릿 클라이언트 미노출 | ✅ | `grep -rn "POLAR_" src/components/ src/hooks/` **0건**, `NEXT_PUBLIC_POLAR` 저장소 **0건**. 추가로 **빌드 산출물 실측**: `.next/static/` 전체에 `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET`/`POLAR_PRODUCT_ID`/`SUPABASE_SERVICE_ROLE_KEY`/`polar-sh`/`standardwebhooks` **0건** |
| `@polar-sh/sdk` 경계 | ✅ | `grep -rn "@polar-sh" src/` 결과가 `src/services/polar/`뿐. `src/app/`·`src/components/`·`src/lib/` 0건. `client.ts:1`·`webhook.ts:1`에 `import "server-only"` |
| `POST /api/checkout` userId = 세션 전용 | ✅ | `route.ts:21` `getSessionUser()`가 유일한 출처. `request.json`/`request.text`/`request.formData`/`searchParams`/`req.body` 문자열 **각 0건** — 본문을 아예 읽지 않는다. `route.test.ts:74-86`이 본문에 `user_id`/`userId` UUID를 실어도 `{userId:"user-1"}`로 호출됨을 단정 |
| service-role 단일 쓰기 경로 | ✅ | `subscriptions` 쓰기는 `services/supabase-admin/index.ts:66-81` 1곳. 웹훅 라우트에 `createServiceClient`/`@supabase/supabase-js`/`SUPABASE_SERVICE_ROLE_KEY` **0건** |
| 소유권 검증 | ✅ | `resolveUserId`가 UUID 정규식으로 형식 검증(`webhook.ts:26,81`), 존재하지 않는 사용자는 FK 위반 `23503` → `isUnknownUserError` → 200 무시. `"'; drop table subscriptions; --"` 케이스까지 테스트됨(`webhook.test.ts:138`) |
| 마이그레이션 신규 파일 0건 | ✅ | `git diff --name-only 01fbaa3 HEAD -- supabase/` **비어 있음** |
| `subscriptions` 쓰기 RLS 정책 0건 | ✅ | `create policy` 1건(`select_own_subscription`, `for select`)뿐. `for insert|update|delete` 저장소 전체 **0건** |
| 읽기 경로 불변 | ✅ | `src/lib/supabase/server.ts` 무변경. `getSubscriptionStatus`(`server.ts:102-116`) 그대로 |
| ADR-007 페이월·lazy-generate | ✅ | `src/app/api/reports/[analysisId]/[reportType]/route.ts` 무변경, `:54-56` 403 `PAYWALL_REQUIRED` 그대로. `src/lib/supabase/server.test.ts`(9), reports route 테스트 무손상 |
| 로그 유출 | ✅ | `src/services/polar/`·`api/checkout/`·`api/webhooks/polar/`·`CheckoutSuccessBanner.tsx`에 `console.` **0건**. 에러 메시지에 토큰/서명/원본 payload 미포함(`client.test.ts:41`, `checkout.test.ts:57-68`, `route.test.ts:86`가 각각 단정) |
| 수동 HMAC 금지 | ✅ | 비테스트 파일에 `crypto`/`createHmac`/`standardwebhooks` **0건**. `webhook.ts`에 `Buffer.from(secret`/`toString("base64")` **0건**(이중 base64 인코딩 없음) |

---

## B. ADR-006 회귀 — 통과

`src/services/polar/subscription-status.ts` 실측:

```ts
export const SUBSCRIPTION_STATUS_BY_EVENT_TYPE = {
  "subscription.active": "active",
  "subscription.uncanceled": "active",
  "subscription.revoked": "inactive",
}
```

- 키 **정확히 3개** ✅
- `subscription.canceled` / `subscription.past_due` 키 **부재** ✅
- `mapEventToSubscriptionStatus`는 `?? null` 단 한 줄(`:14`) — **우회 예외 분기 0건** ✅
- 독립 테스트 실재: `subscription-status.test.ts:24`, `:28` (각각 ADR-006 문구 포함), `:32` 키 3개 `toEqual` 단정. 라우트 레벨 회귀선도 `route.test.ts:154-166`에 주석과 함께 존재 ✅
- **step0 커밋(`984fcad`) 이후 `subscription-status.ts`·`subscription-status.test.ts` 무수정** — `git diff 984fcad HEAD` 비어 있음 ✅
- `npm run test` 출력에서 `src/services/polar/subscription-status.test.ts (14 tests)` **실제 실행 확인** ✅

---

## C. `upsert` 정합성 — 통과 (이 phase 최대 잠재 버그 회피 확인)

`src/services/supabase-admin/index.ts:66-81`:

```ts
const { error } = await supabase.from("subscriptions").upsert(
  { user_id: input.userId, status: input.status, updated_at: new Date().toISOString() },
  { onConflict: "user_id" },
)
```

- **`update`가 아니라 `upsert`** ✅ — 첫 결제 시 0행 갱신으로 조용히 실패하는 시나리오 회피
- `onConflict: "user_id"` ✅ — 마이그레이션에 `user_id uuid not null unique`가 있어 `ON CONFLICT` 타깃 성립
- `updated_at` 명시적 ISO 설정 ✅ (이 테이블에 트리거 없음)
- 테스트가 방어선 역할: `index.test.ts:45`의 목이 `{ upsert }`만 노출하고 **`update` 메서드를 아예 넣지 않아**, 구현이 `update`로 회귀하면 TypeError로 실패 ✅
- 기존 `getSubscriptionStatus`(읽기) 무수정 ✅

---

## D. 웹훅 응답 코드 계약 — 통과

`src/app/api/webhooks/polar/route.ts` 실측 분기:

| 상황 | 코드 위치 | 응답 | 계약 |
|---|---|---|---|
| 서명 실패 | `:22-23` | 403 `{code:"INVALID_SIGNATURE"}` | ✅ |
| `PolarConfigError` | `:25` | 500 `{code:"INTERNAL_ERROR"}` | ✅ (403으로 뭉개지지 않음) |
| 미지원 이벤트 | `:28-30` | 200 `{received,ignored:"unhandled_event"}` | ✅ |
| user_id 해석 불가 | `:33-35` | 200 `{received,ignored:"unresolved_customer"}` | ✅ |
| 매핑 대상 밖 | `:38-40` | 200 `{received,ignored:"unhandled_event"}` | ✅ |
| 미지 사용자(FK 23503) | `:45-47` | 200 `{received,ignored:"unknown_user"}` | ✅ |
| 일시적 DB 오류 | `:48` | 500 | ✅ (Polar 재시도 유도) |

403 본문에 원인 문자열 미포함도 `route.test.ts:86`이 단정.

---

## E. raw body 처리 — 통과

- `route.ts:16` `await request.text()` — `request.json`/`JSON.parse`/`JSON.stringify` **각 0건**, `request.text()` **정확히 1건**
- 공백 비정규 body 바이트 동일성 단정: `route.test.ts:63-73`
- **`Headers` 정규화 실재**: `webhook.ts:28-40 normalizeHeaders()`가 `Headers` 인스턴스를 `forEach`로 순회해 소문자 키 평범한 객체로 변환. 이게 없으면 정상 요청이 전부 403이 된다 — **계획 검증에서 지적한 지점이 코드에 반영됨** ✅
- 회귀 방지 테스트: `webhook.test.ts:96-99`가 `new Headers(...)`로 `{kind:"event"}`를 단정, `:85-94`가 대소문자 혼합 키를 단정
- `webhook.test.ts`는 **실제 `standardwebhooks`로 서명**하고 `@polar-sh/sdk/webhooks.js`를 목킹하지 않는다(`vi.mock` 0건) — 서명 검증이 진짜로 검증됨 ✅

---

## F. AC 이행 / 범위 — 통과

grep 판정 AC를 전부 재실행했고 **불일치 0건**이다(A~E절에 개별 결과 기재). 추가 확인:

- **범위 이탈 0건.** step별 커밋 파일 목록이 AC가 허용한 집합과 정확히 일치:
  - step0: `src/services/polar/*` 10개 + `package.json`/`package-lock.json`
  - step1: `src/app/api/checkout/route.{ts,test.ts}` 2개
  - step2: 라우트 2개 + `supabase-admin` 2개, **정확히 4개**
  - step3: 컴포넌트 4개 + `dashboard/page.tsx` + `DashboardPages.test.tsx` + 문서 2개
- `.env.example`, `vitest.config.ts`, `tsconfig.json`, `next.config.ts`, `src/middleware.ts`, `src/components/ui/`, `src/hooks/useApiError.ts`, `src/components/ErrorModal.tsx` **전부 무수정** ✅
- `polar_webhook_events` 저장소 전체 **0건** ✅
- `index.ts` 배럴이 `createPolarClient`를 재export하지 않음 ✅
- `src/services/polar/` 소스의 `process.env` 접근이 **전부 함수 본문 안**(모듈 최상단 캐싱 없음) ✅
- `standardwebhooks`가 `devDependencies`에 위치 — AC대로이며, `@polar-sh/sdk@0.49.0`의 **직접 dependency**이기도 해서 런타임 해석에 문제 없음(SDK `package.json` 확인). 비테스트 코드에서의 참조 0건

---

## G. 기존 동작 보존 — 통과 (테스트 삭제 흔적 없음)

- 삭제된 테스트 파일 **0건**(`01fbaa3` 대비 `comm` 비교)
- 신규 테스트 파일 6개 + 기존 수정 4개(`webhooks/polar/route.test.ts`는 501 스텁 교체로 AC가 허용)
- `it/test` 블록 수: `PremiumSection.test.tsx` 5→11, `DashboardPages.test.tsx` 3→4 — **감소 없음**
- **보안·디자인 불변식 단정 유지 확인**(`PremiumSection.test.tsx:88-90`): `expect(fetchMock).not.toHaveBeenCalled()`, `not.toMatch(/backdrop-(?:blur|filter)/)`, `queryByRole("list")).not.toBeInTheDocument()` **모두 원문 그대로 잔존**. 첫 테스트에서 빠진 `fireEvent.click`은 AC가 허용한 "분해"이며, 전용 테스트(`:95-111` "never requests a premium report from a locked card")가 `/api/reports/` 호출 0건을 더 강하게 단정한다 — **약화가 아니라 강화**
- `DashboardPages.test.tsx`는 시그니처 수정(`searchParams` 인자 추가)과 배너 단정 추가뿐. 기존 단정 전부 잔존

---

## 발견사항

### MAJOR

#### M-1. 지원 이벤트의 payload 파싱 실패가 "미지원 이벤트"로 뭉개져 200으로 조용히 폐기된다

**위치:** `src/services/polar/webhook.ts:56-61`

```ts
} catch (error) {
  if (error instanceof WebhookVerificationError) {
    throw new PolarWebhookVerificationError()
  }
  return { kind: "unsupported" }   // ← 서명 무관 에러 전부를 여기로 흡수
}
```

`@polar-sh/sdk`의 `parseEvent`(`node_modules/@polar-sh/sdk/src/webhooks.ts`)는 **두 가지 서로 다른 상황**을 모두 `SDKValidationError`로 던진다.
1. 알 수 없는 `type` → `SDKValidationError("Unknown event type: X")`
2. **알고 있는 `type`인데 zod 스키마 파싱 실패** → 바깥 `catch`가 `SDKValidationError("Failed to parse event", error, parsed)`로 재포장

현재 코드는 둘을 구분하지 못하고 **둘 다 `{kind:"unsupported"}`** 로 만든다. AC(step0.md 「알 수 없는 이벤트」)가 의도한 것은 ①뿐이다.

**실측 확인** (프로젝트 루트에서 실제 SDK로 재현, 검증 후 스크립트 삭제):

```
입력: 유효 서명 + {"type":"subscription.active","data":{"id":"sub_1"}}
throw class : SDKValidationError
instanceof WebhookVerificationError : false
=> 라우트 코드 경로 결과 : {kind:"unsupported"} -> 200 무시
```

**실패 시나리오:** Polar이 `subscription.active` payload의 필수 필드를 제거·개명·타입 변경하거나, 설치된 SDK 버전이 API와 어긋나면 → 결제는 완료됐는데 → `verifyPolarWebhook`이 `unsupported` 반환 → **200 `{received:true, ignored:"unhandled_event"}`** → Polar은 "정상 처리됨"으로 보고 **재시도하지 않음** → `subscriptions` 행 미생성 → **돈은 빠져나갔는데 Premium이 영원히 잠긴 상태.** 게다가 이 코드베이스는 AC상 `console.` 0건이라 **아무 흔적도 남지 않는다.**

`webhook.test.ts:13-41`의 픽스처가 약 30개 필드를 정확히 채워야 통과한다는 사실 자체가 이 스키마의 엄격함을 보여준다. (zod가 기본적으로 unknown key를 strip하므로 *필드 추가*형 변경은 안전하다. 위험은 제거/개명/타입변경과 버전 드리프트다.)

**수정 방향** (택1 또는 병행):
- `webhook.ts:56-61`에서 `error.cause`의 message가 `"Unknown event type"`으로 시작하는 경우에만 `{kind:"unsupported"}`를 반환하고, 그 외 `SDKValidationError`는 **재throw**하여 라우트가 500(재시도 유도)으로 매핑하게 한다. 재시도로 스키마가 고쳐지진 않지만 **Polar 대시보드에 실패 배달로 남아 관측 가능해진다.**
- 또는 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`에 있는 타입인지를 파싱 **전에** 판정하고(서명 검증 후 raw JSON의 `type`만 확인), 상태 변경 대상 이벤트의 파싱 실패만 별도 에러로 승격.
- 어느 쪽이든 **`console.` 0건 규칙과 이 실패 모드의 무음성이 충돌**한다는 점을 리더가 정책적으로 판단해야 한다. 최소한 이 경로 하나에는 비민감 로그(이벤트 타입만)를 허용하는 예외를 두는 것을 권고한다.

---

#### M-2. 웹훅 순서 역전 방어가 없어 재구독한 유료 사용자가 Premium을 잃을 수 있다

**위치:** `src/services/supabase-admin/index.ts:66-81` (설계 결정은 `step2.md` 「이벤트 테이블 금지」)

step2 AC는 "멱등성은 upsert가 제공하므로 중복 제거 테이블을 만들지 않는다"고 확정했다. 이는 **동일 이벤트 중복 배달**에는 맞지만 **이벤트 순서 역전**에는 해당하지 않는다. Polar은 Svix 기반이라 배달 순서를 보장하지 않고, 실패 시 최대 10회 지수 백오프(최대 수 시간)로 재시도한다.

**실패 시나리오:**
1. `t=0` 사용자 구독 해지 만료 → `subscription.revoked` 도착 → 우리 DB 일시 장애 → 500 반환
2. `t=0~10h` Polar이 재시도 대기
3. `t=+1h` 같은 사용자가 재구독 → `subscription.active` 도착 → `status='active'` ✅
4. `t=+2h` 지연된 `subscription.revoked` 재시도가 성공 → **`status='inactive'`로 덮어씀** ✗

결과: 결제 중인 사용자가 Premium을 잃고, 그 사실을 알릴 신호가 없다(로그 0건).

`upsertSubscriptionStatus`는 이벤트 시각을 보지 않고 무조건 덮어쓴다. 이벤트 payload에는 `timestamp`(이벤트)와 `data.modified_at`(구독)이 존재하므로 판정 근거는 이미 있다.

**수정 방향:** 이 phase는 마이그레이션 금지가 확정돼 있어 **여기서 고칠 수 없다.** 후속 phase에서 `subscriptions`에 `last_event_at timestamptz` 컬럼을 추가하고, upsert를 `.upsert(..., {onConflict:"user_id"})` 대신 조건부 갱신(`last_event_at < :eventTimestamp`)으로 바꾸는 것을 권고한다. 그때까지는 **알려진 제약으로 문서화**하고, `docs/ADR.md`의 ADR-006 트레이드오프 절에 한 줄 남겨야 한다.

---

### MINOR

#### m-1. `ignored` 라벨이 실제 원인과 어긋난다

**위치:** `src/app/api/webhooks/polar/route.ts:32-40`

`resolveUserId` 검사가 `mapEventToSubscriptionStatus`보다 **먼저** 온다. `resolveUserId`는 `SUBSCRIPTION_EVENT_TYPES`(7종) 밖의 이벤트에 대해 `null`을 반환하므로(`webhook.ts:70-72`), 예컨대 유효 서명된 `order.paid`·`checkout.updated`는 `ignored:"unresolved_customer"`로 응답된다. 실제 사유는 "매핑 대상 이벤트가 아님"이다. 응답 본문뿐이라 기능 영향은 없지만, 나중에 Polar 대시보드에서 배달 로그를 볼 때 오진을 유발한다.

**수정 방향:** `mapEventToSubscriptionStatus` 검사를 `resolveUserId`보다 앞으로 옮긴다. 순서를 바꿔도 "검증 후 쓰기" 불변식과 기존 테스트 단정은 유지된다.

#### m-2. `docs/ARCHITECTURE.md`에 구현 완료를 부정하는 문장이 그대로 남았다

**위치:** `docs/ARCHITECTURE.md:78`(섹션 제목), `:85`

step3이 `:84`에 복귀 배너 문장을 **추가만** 하고 바로 아래 문장을 정리하지 않았다:

- `:78` `### 4) 구독 결제 (`polar-billing` phase에서 구현 — 이번 phase는 스키마만)`
- `:85` `이번 phase에는 subscriptions 테이블 스키마만 존재하고 위 흐름의 실제 구현(체크아웃 세션 생성, 웹훅 처리)은 없다. 개발 중 Premium 흐름을 확인하려면 subscriptions 레코드를 수동으로 만들어 테스트한다.`

둘 다 이제 **거짓**이다. `CLAUDE.md`의 Polar 웹훅 CRITICAL 규칙 괄호("이번 phase는 스키마만 준비하고 … `polar-billing` phase에서 구현한다")도 같은 이유로 낡았다.

**수정 방향:** `:78` 제목에서 유보 표현 제거, `:85` 문장을 삭제하거나 "구현 완료 — 로컬 확인은 `polar listen` 사용"으로 교체. `CLAUDE.md` 갱신은 별도 판단 필요(이 리뷰에서 수정하지 않았다).

#### m-3. `CheckoutSuccessBanner`가 `/dashboard`를 하드코딩해 다른 쿼리도 함께 제거한다

**위치:** `src/components/CheckoutSuccessBanner.tsx:11`

```ts
window.history.replaceState(null, "", "/dashboard");
```

`checkout` 파라미터만 제거하는 게 아니라 URL 전체를 `/dashboard`로 치환한다. 현재 대시보드에 다른 쿼리 파라미터가 없어 실害는 없지만, 나중에 `?page=2` 같은 게 생기면 조용히 유실된다.

**수정 방향:** `const url = new URL(window.location.href); url.searchParams.delete("checkout"); window.history.replaceState(null, "", url.pathname + url.search)`. 기존 테스트(`CheckoutSuccessBanner.test.tsx:24-33`)의 `location.search === ""` 단정은 그대로 통과한다.

#### m-4. `POST /api/checkout`의 `PolarConfigError` 분기가 fallthrough와 동일하다 (죽은 분기)

**위치:** `src/app/api/checkout/route.ts:48-52`

```ts
if (error instanceof PolarConfigError) {
  return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
}
return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
```

두 분기가 완전히 같다. AC가 "`PolarConfigError`가 403이나 502로 매핑되지 않는다"를 요구했으므로 **의도는 충족**하지만, 코드로는 의미 없는 분기다. 남겨두려면 "이 분기는 의도적 명시"라는 주석이 필요하고, 아니면 제거해야 한다. 기능 영향 없음.

---

## 관찰 (결함 아님 — 후속 판단 대상)

1. **`POST /api/checkout`의 Origin 검사**(`route.ts:14-19`)가 `new URL(request.url).origin`과 비교한다. Vercel 뒤에서 `x-forwarded-host`/`x-forwarded-proto`가 정상 전달되면 문제없지만, 프록시 구성이 바뀌어 `request.url`의 오리진이 공개 도메인과 달라지면 **정상 사용자가 전부 403**이 된다. 배포 후 UC-11 브라우저 시나리오로 1회 확인 권고.
2. **`standardwebhooks`의 5분 타임스탬프 허용 범위.** Polar의 재시도가 원본 `webhook-timestamp`를 그대로 재전송하는지 새로 서명하는지에 따라, 5분 넘긴 재시도가 전부 403이 될 수 있다. 코드로 판단 불가하며 **step2 말미의 수동 샌드박스 검증에서만 확인 가능**하다.
3. `phases/6-polar-billing/index.json`과 `phases/index.json`에 개행 문자가 없다(`\ No newline at end of file`). 기존 phase들과 동일한 패턴이라 회귀 아님.

---

## 미검증 (코드로 판단 불가 — 사용자 수동 검증 대기)

`step2.md` 「실행 후 수동 검증」이 지정한 항목이며, 이 검증을 마치기 전에는 **프로덕션 결제 흐름이 미검증 상태**다:

1. 샌드박스 결제 시 실제로 `subscription.active`가 오는가. **`subscription.created`만 오고 `active`가 오지 않으면 구독이 영영 활성화되지 않는다** — 이 경우에 한해 매핑 표에 조건부 추가가 필요하다(그 외에는 아무것도 추가하지 않는다).
2. 결제 후 `subscriptions`에 해당 `user_id` 행이 **새로 INSERT**되고 `status='active'`, `updated_at`이 갱신되는가 (upsert가 실제로 동작한다는 증거).
3. Polar 대시보드의 배달 로그에 200이 기록되는가 (M-1의 무음 실패가 실제로 발생하지 않았는지 교차 확인).

---

## 결론: 이 코드를 `main`에 머지해도 되는가

**머지해도 된다 — 단, 아래 2개 조건부.**

보안 CRITICAL 위반 0건이고, 계획 검증에서 지적했던 `Headers` 정규화·`upsert` vs `update`·ADR-006 3키 고정이 **전부 코드에 정확히 반영**되어 있다. 기존 398개 테스트 전부 통과, 테스트 삭제·약화 흔적 없음, 범위 이탈 0건, 빌드 산출물에 시크릿 유출 0건. 머지를 막을 결함은 없다.

**조건 1 (배포 전, 필수).** `step2.md` 말미의 수동 샌드박스 검증 3항목을 사용자가 수행하기 전에는 **실제 결제 트래픽을 붙이지 마라.** 특히 "활성화 시 실제로 오는 이벤트가 `subscription.active`인가"는 코드로 검증 불가능하며, 여기가 어긋나면 결제해도 Premium이 열리지 않는다.

**조건 2 (실제 돈이 흐르기 전).** M-1(파싱 실패 무음 폐기)의 수정 또는 최소한의 관측 수단 확보. 현재는 이 실패 모드가 발생해도 **응답 200 · 로그 0건 · Polar 재시도 없음**이라 사후 추적이 불가능하다. M-2(순서 역전)는 마이그레이션이 필요해 이 phase에서 고칠 수 없으므로, ADR에 알려진 제약으로 명시하고 후속 phase 백로그에 올릴 것을 권고한다.

MINOR 4건은 머지 후 정리로 충분하다.
