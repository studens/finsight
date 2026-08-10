# Step 2: `/api/webhooks/polar` 501 스텁 → 서명 검증 + `subscriptions` 갱신

## 배경

`src/app/api/webhooks/polar/route.ts`는 지금 이게 전부다:

```typescript
// polar-billing phase: 서명 검증 후 subscriptions 갱신
import { NextResponse } from "next/server"

export async function POST(_request: Request): Promise<NextResponse> {
  return NextResponse.json({ code: "NOT_IMPLEMENTED" }, { status: 501 })
}
```

`src/app/api/webhooks/polar/route.test.ts`도 그 501을 단정하는 테스트 하나뿐이다. **이 step에서 두 파일을 모두 실제 구현/실제 테스트로 교체한다.** 기존 501 테스트는 그대로 두면 실패하므로 삭제하고 새 테스트로 대체한다(스텁이 사라지는 것이 이 step의 목적이므로, 이건 "기존 테스트를 깨뜨린 것"이 아니라 의도된 교체다).

이 라우트는 이 프로젝트에서 **구독 상태를 `'active'`로 올릴 수 있는 유일한 경로**다. `src/lib/supabase/server.ts`의 `getSubscriptionStatus`가 이 값을 읽어 Premium 게이팅(403 `PAYWALL_REQUIRED`)을 판정한다. 여기서 서명 검증을 빼먹으면 **아무나 POST 한 번으로 자기 계정을 Premium으로 만들 수 있다.**

step 1(`POST /api/checkout`)과 step 0(`src/services/polar/`)이 이미 끝나 있다. 이 step은 `src/app/` 아래 라우트 하나와 `src/services/supabase-admin/`의 쓰기 헬퍼 하나를 만든다.

**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

### step 0이 이미 제공하는 것 (이 계약을 그대로 쓴다 — 추측하지 마라)

`src/services/polar/index.ts` 배럴이 export하는 것 중 이 step이 쓰는 것:

```typescript
export type PolarWebhookEvent = ReturnType<typeof validateEvent>  // SDK 이벤트 유니온

export type VerifiedWebhook =
  | { kind: "event"; event: PolarWebhookEvent }
  | { kind: "unsupported" }

// 동기 함수다. Promise가 아니다.
export function verifyPolarWebhook(input: {
  body: string                              // request.text() 결과 그대로
  headers: Headers | Record<string, string> // request.headers 그대로 넘겨도 된다
}): VerifiedWebhook

export function resolveUserId(event: PolarWebhookEvent): string | null

export type SubscriptionStatusUpdate = "active" | "inactive"
export function mapEventToSubscriptionStatus(
  eventType: string,
): SubscriptionStatusUpdate | null

export const SUBSCRIPTION_STATUS_BY_EVENT_TYPE: Readonly<
  Record<string, SubscriptionStatusUpdate>
>

export class PolarWebhookVerificationError extends Error {
  readonly code = "POLAR_WEBHOOK_INVALID_SIGNATURE"
}
export class PolarConfigError extends Error {
  readonly code = "POLAR_CONFIG_ERROR"
}
```

서비스가 이미 대신 처리하므로 라우트가 다시 하지 마라:

- `POLAR_WEBHOOK_SECRET` 읽기와 유효성 검사
- 헤더 키 소문자 정규화 (`Headers` 인스턴스를 그대로 넘겨도 된다)
- Standard Webhooks 서명 검증 전체 (SDK의 `validateEvent`가 수행)
- `customer.externalId` → `customer.external_id` → `metadata.user_id` 3단 폴백과 UUID 형식 검증

**라우트는 `@polar-sh/sdk`를 직접 import하지 않는다**(CLAUDE.md CRITICAL: "외부 API 호출(Claude, Supabase, Polar)은 `src/services/`를 통해서만 수행한다"). 라우트는 Polar 타입을 하나도 몰라도 된다 — `resolveUserId`가 Supabase user id를 평범한 문자열로 돌려준다.

### ⚠️ raw body 함정 — 이걸 틀리면 서명이 100% 깨진다

**반드시 `const body = await request.text()`로 raw 문자열을 읽어 그대로 `verifyPolarWebhook`에 넘긴다.**

`await request.json()`으로 파싱하면 안 된다. 서명은 Polar이 보낸 **바이트열 그대로**에 대해 계산되어 있는데, `JSON.parse` 후 다시 `JSON.stringify`하면 키 순서·공백·숫자 표기·유니코드 이스케이프가 달라져 바이트가 바뀐다. 그러면 **모든 웹훅이 서명 실패로 403이 되어 아무도 구독이 활성화되지 않는다.**

- `request.json()`을 부르지 마라.
- body를 먼저 파싱한 뒤 검증용으로 다시 `JSON.stringify`하지 마라.
- `request.text()`는 **한 번만** 부를 수 있다(스트림은 한 번 소비되면 끝). 결과를 변수에 담아 재사용한다.
- 이벤트 내용이 필요하면 `verifyPolarWebhook`이 돌려준 `result.event`를 쓴다. 라우트가 직접 파싱할 이유가 없다.

### 상대 경로 import

이 프로젝트에는 `@/` 경로 alias가 없다. `src/app/api/webhooks/polar/route.ts` 기준:

```typescript
import {
  mapEventToSubscriptionStatus,
  PolarWebhookVerificationError,
  resolveUserId,
  verifyPolarWebhook,
} from "../../../../services/polar"
import type { VerifiedWebhook } from "../../../../services/polar"
import {
  isUnknownUserError,
  upsertSubscriptionStatus,
} from "../../../../services/supabase-admin"
```

(`VerifiedWebhook`은 아래 ② 스니펫의 `let verified: VerifiedWebhook`에 쓰인다. 타입 전용 import이므로 런타임에 지워지고 목킹에 영향을 주지 않는다.)

## 작업

### 2-1. `src/services/supabase-admin/index.ts`에 쓰기 헬퍼 2개 추가

기존 파일에 **추가**한다. 기존 `insertAnalysis`/`upsertPremiumReport`의 동작을 바꾸지 않는다. 스타일(같은 파일, `createServiceClient()` 호출, `if (error) throw error`)을 그대로 따른다.

```typescript
export async function upsertSubscriptionStatus(input: {
  userId: string
  status: "active" | "inactive"
}): Promise<void>

export function isUnknownUserError(error: unknown): boolean
```

**`upsertSubscriptionStatus` 구현 규칙:**

1. `createServiceClient()`(= `src/lib/supabase/service.ts`, service-role 클라이언트)로 `subscriptions` 테이블에 쓴다.
2. **반드시 `upsert`이고 `onConflict: "user_id"`다. `update`로 짜지 마라.**

   ```typescript
   await supabase
     .from("subscriptions")
     .upsert(
       {
         user_id: input.userId,
         status: input.status,
         updated_at: new Date().toISOString(),
       },
       { onConflict: "user_id" },
     )
   ```

   **왜 upsert여야 하는가:** 지금 이 저장소에서 `subscriptions` 테이블에 **INSERT하는 코드가 하나도 없다.** 즉 사용자가 처음 결제할 때 그 사용자의 행은 **존재하지 않는 것이 정상**이다. `update`로 짜면 0행 갱신이 되고 PostgREST는 이걸 **에러로 취급하지 않으므로**, 첫 결제가 조용히 실패한다. 라우트는 200을 반환하고 Polar은 성공으로 알고 재전송하지 않으며, 사용자는 돈을 냈는데 Premium이 안 열린다. `subscriptions.user_id`에 unique 제약이 이미 있으므로 `onConflict: "user_id"`가 성립한다.
3. **`updated_at`을 쓰기 코드가 직접 설정한다.** 이 테이블에는 `updated_at` 자동 갱신 트리거가 **없다**(`supabase/migrations/20260720164534_create_subscriptions.sql` 확인). `default now()`는 INSERT 때만 적용되므로, 명시하지 않으면 UPDATE 경로에서 값이 영원히 첫 생성 시각으로 굳는다.
4. `created_at`과 `id`는 넣지 않는다(DB default에 맡긴다).
5. `error`가 있으면 그대로 `throw error`한다. 라우트가 분류한다.
6. `console.*`을 쓰지 않는다.

**`isUnknownUserError` 구현 규칙:**

```typescript
export function isUnknownUserError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23503"
  )
}
```

- `23503`은 Postgres의 **foreign key violation** SQLSTATE다. `subscriptions.user_id`가 `auth.users(id)`를 FK로 참조하므로, 이미 탈퇴한 사용자에 대한 지연 웹훅이 오면 이 코드로 실패한다.
- **왜 라우트에 인라인하지 않고 여기 두는가:** 라우트 핸들러가 Postgres SQLSTATE를 알면 DB 세부사항이 `src/app/` 층으로 새어 나온다. 이 프로젝트는 DB 접근을 `services/supabase-admin` 뒤에 캡슐화하고 있으므로(라우트는 `lib/supabase/service`나 `@supabase/supabase-js`를 직접 import하지 않는다), 에러 분류도 같은 층에 둔다. `src/lib/supabase/server.ts`가 `PGRST303`을 자기 파일 안에서 판별하는 것과 같은 패턴이다.
- 이 함수는 `Promise`가 아니다. I/O를 하지 않는 순수 함수다.

**절대 하지 말 것 (CRITICAL):**

- **`supabase/migrations/`에 새 마이그레이션 파일을 만들지 마라.** db-schema가 "이번 phase는 스키마 변경 없음"으로 확정했다. `subscriptions`의 최종 스키마는 지금과 동일하다: `id`, `user_id`(unique, FK → `auth.users`), `status`(check in `'active'`,`'inactive'`), `created_at`, `updated_at`. Polar 식별자(`customer_id`, `subscription_id`, `current_period_end`)는 **어디에도 저장하지 않는다.**

  > **⚠️ 위에 자동으로 붙은 `docs/ADR.md`가 반대로 읽힐 수 있다 — 속지 마라.** ADR-006의 *트레이드오프* 절에는 "`polar-billing` phase에서 `subscriptions` 마이그레이션(컬럼 추가), `polar_webhook_events` 테이블, 체크아웃/웹훅 코드와 관련 테스트가 추가로 필요하다"고 적혀 있다. **이것은 결정이 아니라 ADR 작성 당시의 비용 추정이다.** 실제로 설계해 보니 (a) 쓰기가 `user_id` 유니크 키에 대한 upsert 1회라 **구조적으로 멱등**이어서 이벤트 중복 제거 테이블이 불필요하고, (b) Polar 고객 ↔ Supabase 사용자 매핑은 체크아웃에서 심어 보낸 `externalCustomerId` 역참조로 충분하다. db-schema 플래너가 2026-08-07에 "이번 phase 스키마 변경 없음"으로 확정했다.
  >
  > ADR-006의 **결정문**("이번 phase는 스키마만 준비하고 결제 연동은 후속 `polar-billing` phase에서" + "취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지")은 그대로 지켜진다. **그리고 그 후속 `polar-billing` phase가 바로 지금 이 phase다** — `AGENTS.md`와 `docs/*.md`가 "polar-billing은 아직 미구현"이라고 말하는 것은 그 문서들이 이 phase 시작 전에 쓰였기 때문이다. 체크아웃·웹훅 코드를 만드는 것은 맞고, **마이그레이션과 `polar_webhook_events` 테이블을 만드는 것은 아니다.**
- **`subscriptions`에 INSERT/UPDATE/DELETE RLS 정책을 추가하지 마라.** 이 테이블의 정책은 `select_own_subscription`(SELECT 전용) **하나뿐이어야 한다.** 쓰기 정책을 열면 브라우저의 anon 클라이언트로 사용자가 자기 `status`를 `'active'`로 바꿔 **페이월을 그대로 우회한다.** 쓰기는 RLS를 우회하는 service-role 경로(`createServiceClient()`)로만 한다. 소유권은 RLS가 아니라 **코드가 `user_id`를 명시 지정하는 것**으로 결정된다(CLAUDE.md CRITICAL: "DB 쓰기(INSERT/UPDATE)는 이 service-role 클라이언트를 통해서만 수행하고, 코드에서 소유권(user_id)을 직접 검증한다").
- **`src/lib/supabase/server.ts`의 `getSubscriptionStatus`를 수정하지 마라.** 그건 세션 기반 RLS 읽기 경로이고 게이팅 판정의 유일한 소스이며 이미 동작 중이다. **웹훅이 쓰고, 그 함수가 읽는다.** 읽기 경로에 손대면 기존 Premium 게이팅 테스트가 깨진다.
- **`src/types/database.ts`를 수정하지 마라.** 스키마가 바뀌지 않으므로 타입 재생성이 필요 없다.

기존 `src/services/supabase-admin/index.test.ts`와 `index.test-d.ts`를 **깨지 말고 확장**한다.

### 2-2. `src/app/api/webhooks/polar/route.ts` — 501 스텁을 실제 구현으로 교체

```typescript
export async function POST(request: Request): Promise<NextResponse>
```

**`POST`만 export한다.** `GET`을 export하지 않는다.

`export const runtime`/`export const dynamic` 같은 라우트 세그먼트 설정을 추가하지 마라. 이 저장소의 다른 라우트가 쓰지 않고 기본값(nodejs)이 맞다. **`src/middleware.ts`도 수정하지 마라** — matcher가 이미 `/api/*`를 제외하고 있어 웹훅 요청은 미들웨어를 타지 않는다. (세션 쿠키 없이 오는 요청이므로 미들웨어를 태우면 안 된다.)

동작 순서. **이 순서를 바꾸지 마라.**

**① raw body 읽기**

```typescript
const body = await request.text()
```

위 "raw body 함정" 절 참조. `request.json()` 금지.

**② 서명 검증**

```typescript
let verified: VerifiedWebhook
try {
  verified = verifyPolarWebhook({ body, headers: request.headers })
} catch (error) {
  if (error instanceof PolarWebhookVerificationError) {
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 403 })
  }
  return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
}
```

- `request.headers`(`Headers` 인스턴스)를 **그대로** 넘긴다. 직접 객체로 변환하지 마라 — 서비스가 소문자 정규화까지 해준다.
- **403인 응답 본문에 상세 사유를 담지 마라.** `error.message`, 받은 서명 값, 기대한 서명 값 어느 것도 넣지 않는다. `{ code: "INVALID_SIGNATURE" }` 한 필드뿐이다.
- **`PolarConfigError`(`POLAR_WEBHOOK_SECRET` 미설정)는 500이다. 403으로 뭉개지 마라.** 403으로 만들면 서버 오설정이 "Polar이 이상한 요청을 보낸다"로 오진되어 디버깅이 완전히 잘못된 방향으로 간다. 위 코드의 `else` 분기(500)가 `PolarConfigError`를 받는다. `PolarConfigError`를 명시적으로 `instanceof` 분기해도 되지만, 어느 쪽이든 **결과는 500 `{ code: "INTERNAL_ERROR" }`** 여야 한다.
- **검증 실패 시 DB를 절대 건드리지 않는다.** `upsertSubscriptionStatus`가 호출되지 않아야 한다(CLAUDE.md CRITICAL: "Polar 웹훅은 반드시 서명을 검증한 뒤에만 구독 상태를 갱신한다. 검증 실패 시 요청을 거부한다").

**③ 미지원 이벤트**

```typescript
if (verified.kind === "unsupported") {
  return NextResponse.json({ received: true, ignored: "unhandled_event" })
}
```

서명은 **이미 통과**했으므로 진짜 Polar이 보낸 요청이다. 단지 SDK가 모르는 새 이벤트 타입일 뿐이다. **200으로 조용히 무시한다.**

**④ user_id 해석**

```typescript
const userId = resolveUserId(verified.event)
if (userId === null) {
  return NextResponse.json({ received: true, ignored: "unresolved_customer" })
}
```

우리 체크아웃을 거치지 않고 Polar 대시보드에서 수동 생성된 구독이거나, `subscription.*`이 아닌 이벤트다. **200으로 무시하고 DB를 건드리지 않는다.**

**⑤ 이벤트 → status 매핑**

```typescript
const status = mapEventToSubscriptionStatus(verified.event.type)
if (status === null) {
  return NextResponse.json({ received: true, ignored: "unhandled_event" })
}
```

`null`은 **에러가 아니라 "이 이벤트로는 DB를 건드리지 않는다"** 는 뜻이다.

**라우트에 `switch`나 `if (type === "subscription.active")` 같은 분기를 흩뿌리지 마라.** 매핑은 전적으로 `src/services/polar/`의 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE` 상수 하나가 소유한다. 라우트는 `mapEventToSubscriptionStatus` 결과만 쓴다. 라우트에 이벤트 타입 문자열 리터럴이 등장해서는 안 된다.

**⑥ DB 쓰기**

```typescript
try {
  await upsertSubscriptionStatus({ userId, status })
} catch (error) {
  if (isUnknownUserError(error)) {
    return NextResponse.json({ received: true, ignored: "unknown_user" })
  }
  return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
}

return NextResponse.json({ received: true })
```

**⑦ 로그 금지 (CRITICAL)**

`console.*`을 쓰지 않는다. **원본 payload를 로그로 찍지 마라 — 고객 이메일·이름이 들어 있다.** `webhook-signature` 헤더, `POLAR_WEBHOOK_SECRET`, `POLAR_ACCESS_TOKEN`도 마찬가지다. 응답 본문에 `error.message`를 담지도 않는다.

### 왜 이렇게 상태 코드가 나뉘는가 (이 표를 바꾸지 마라)

**Polar은 웹훅 전달 실패 시 최대 10회 지수 백오프로 재시도한다.** 그래서 "재시도하면 해결되는가"가 상태 코드를 가르는 유일한 기준이다.

| 상황 | 응답 | 이유 |
|---|---|---|
| 서명 검증 실패 | **403** `{ "code": "INVALID_SIGNATURE" }` | 거부. 본문에 사유 노출 금지. 재시도해도 같은 서명이 오므로 어차피 해결 안 되지만, **거부 자체가 CLAUDE.md CRITICAL 요구사항**이다. |
| 설정 누락 (`PolarConfigError`) | **500** `{ "code": "INTERNAL_ERROR" }` | 서버 오설정. 403으로 뭉개면 오진된다. 환경변수를 고치면 재시도가 성공하므로 5xx가 맞다. |
| 미지원 이벤트 (`kind: "unsupported"`) | **200** `{ "received": true, "ignored": "unhandled_event" }` | 서명은 유효. 우리가 반응할 이벤트가 아닐 뿐. 재시도해도 영원히 같다. |
| 매핑 대상 밖 이벤트 (`mapEventToSubscriptionStatus → null`) | **200** `{ "received": true, "ignored": "unhandled_event" }` | 위와 동일. |
| user_id 해석 불가 (`resolveUserId → null`) | **200** `{ "received": true, "ignored": "unresolved_customer" }` | 재전송해도 payload가 같으므로 영원히 해결 안 된다. |
| 미지 사용자 (FK 위반 `23503`) | **200** `{ "received": true, "ignored": "unknown_user" }` | 탈퇴 사용자의 지연 이벤트가 정상 케이스. 재시도해도 사용자가 되살아나지 않는다. |
| 일시적 DB 오류 (그 외 모든 쓰기 실패) | **5xx** `{ "code": "INTERNAL_ERROR" }` | **재시도로 회복 가능한 유일한 케이스.** Polar 재시도에 맡긴다. |
| 정상 갱신 | **200** `{ "received": true }` | |

**재시도로 해결될 수 없는 상황에 5xx를 주면 무한 재시도가 된다** — Polar이 10회 백오프를 다 돌 때까지 우리 서버가 같은 요청을 계속 받고, 그동안 정상 이벤트 처리가 밀린다. 반대로 **재시도하면 성공할 상황에 200을 주면 이벤트가 영구히 유실된다**(사용자가 돈을 냈는데 Premium이 안 열린다). 그래서 "일시적 DB 오류만 5xx"라는 이 경계가 정확해야 한다.

### ⚠️ ADR-006 회귀 방지 — `canceled`/`past_due`를 되돌리지 마라

웹훅 이벤트 → `subscriptions.status` 매핑은 다음과 같다. **`src/services/polar/`의 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`이 이미 이렇게 구현돼 있다.**

| Polar 이벤트 | `subscriptions.status` |
|---|---|
| `subscription.active` | `'active'` |
| `subscription.uncanceled` | `'active'` |
| `subscription.revoked` | `'inactive'` |
| `subscription.canceled` | **무시(상태 변경 없음)**, 200 |
| `subscription.past_due` | **무시(상태 변경 없음)**, 200 |
| 그 외 전부 | 무시(상태 변경 없음), 200 |

즉 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`의 키는 **정확히 3개**(`subscription.active`, `subscription.uncanceled`, `subscription.revoked`)다.

언뜻 "취소됐는데 왜 active로 두느냐 — 버그 아니냐"로 보인다. **아니다. ADR-006의 결정문이다:**

> *"취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지하는 방식으로 구현한다."*

Polar에서 `subscription.canceled`는 **해지 "예약"** 이다 — 사용자가 "다음 갱신 때 끊겠다"를 누른 시점에 발생하고, 실제 접근 종료 시점에는 **별도로 `subscription.revoked`가 온다.** `canceled`에서 즉시 `'inactive'`로 내리면 **사용자가 이미 지불한 잔여 기간을 빼앗는다.**

`subscription.past_due`는 결제 재시도(dunning) 중이라는 뜻일 뿐이다. 카드가 잠깐 막힌 것이며, Polar이 재시도를 포기하면 그때 `revoked`를 보낸다. 유료 사용자를 즉시 차단하지 않고 유예하는 것이 ADR-006의 취지에 맞다.

**결론: 구독 해제는 오직 `subscription.revoked` 하나로만 일어난다.**

아래 AC의 `canceled`/`past_due` → 상태 변경 없음 테스트가 이 결정을 코드에 고정하는 회귀 방지선이다. 이 두 케이스를 지우거나 `'inactive'`로 바꾸지 마라. `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`에 이 두 키를 추가하지도 마라.

*(이력: `_workspace/00_input/scope_6-polar-billing.md` 초안은 이 둘을 `'inactive'`로 적었으나 ADR-006 위배로 2026-08-07 리더가 정정했다. db-schema·core-services 플래너가 독립적으로 같은 지적을 했고 리더가 ADR 원문을 확인해 수용했다.)*

### 멱등성 (별도 이벤트 테이블을 만들지 마라)

Polar 재시도로 **같은 이벤트가 여러 번 도착하는 것이 정상**이다. 멱등성은 쓰기 자체의 형태로 확보한다:

- 쓰기는 항상 `user_id`를 충돌 키로 하는 **upsert 1회**다.
- 쓰는 값은 `status` 하나이고, 그 값은 **이벤트 타입의 순수 함수**다(`mapEventToSubscriptionStatus`).
- 따라서 같은 이벤트를 1번 처리하든 10번 처리하든 결과 행이 동일하다(`updated_at`만 갱신).

**`polar_webhook_events` 같은 이벤트 중복 제거 테이블을 만들지 마라.** 쓰기가 이미 구조적으로 멱등이므로 불필요하다. 이벤트 ID를 저장하지도 않는다.

**알려진 한계(의도적 — 고치지 마라):** `subscription.active` 전달이 실패해 백오프 재시도 중인 사이에 `subscription.revoked`가 먼저 성공하면, 뒤늦게 도착한 `active` 재시도가 `'inactive'`를 다시 `'active'`로 되돌린다. 결과는 "해지된 사용자가 Premium을 잠시 유지"(매출 누수)이고 다음 실제 이벤트에서 자가 교정된다. PII 노출이나 소유권 침해가 아니다. 이걸 고치려면 단조 증가 버전 컬럼(이벤트 타임스탬프)이 필요한데, 그건 마이그레이션이 정당화되는 시점에 할 일이고 **이번 phase 범위 밖**이다.

### 2-3. 테스트

**모든 테스트 파일의 확장자는 반드시 `.ts`다.** `vitest.config.ts`의 node 프로젝트가 `src/**/*.test.ts`만 잡는다. `.tsx`로 만들면 어느 프로젝트에도 걸리지 않아 **테스트가 조용히 실행되지 않는다.**

**(a) `src/services/supabase-admin/index.test.ts` — 기존 파일 확장**

기존 테스트(`insertAnalysis`, `upsertPremiumReport`)를 **삭제하거나 수정하지 말고** `describe`/`it`을 추가한다. 기존 파일의 목킹 패턴을 그대로 쓴다:

```typescript
const { createServiceClient } = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock("../../lib/supabase/service", () => ({ createServiceClient }))
```

`subscriptions` upsert 쿼리 목:

```typescript
function subscriptionQuery(result: { error: unknown } = { error: null }) {
  const upsert = vi.fn(async () => result)
  return { upsert }
}
```

실제 Supabase에 접속하지 않는다.

**(b) `src/app/api/webhooks/polar/route.test.ts` — 기존 501 테스트를 전면 교체**

`vi.hoisted` + `vi.mock`으로 **`services/polar`와 `services/supabase-admin`을 둘 다 목킹**한다:

```typescript
const {
  isUnknownUserError,
  mapEventToSubscriptionStatus,
  resolveUserId,
  upsertSubscriptionStatus,
  verifyPolarWebhook,
  PolarWebhookVerificationError,
  PolarConfigError,
} = vi.hoisted(() => {
  class PolarWebhookVerificationError extends Error {}
  class PolarConfigError extends Error {}
  return {
    isUnknownUserError: vi.fn(),
    mapEventToSubscriptionStatus: vi.fn(),
    resolveUserId: vi.fn(),
    upsertSubscriptionStatus: vi.fn(),
    verifyPolarWebhook: vi.fn(),
    PolarWebhookVerificationError,
    PolarConfigError,
  }
})

vi.mock("../../../../services/polar", () => ({
  mapEventToSubscriptionStatus,
  resolveUserId,
  verifyPolarWebhook,
  PolarWebhookVerificationError,
  PolarConfigError,
}))
vi.mock("../../../../services/supabase-admin", () => ({
  isUnknownUserError,
  upsertSubscriptionStatus,
}))
```

- **⚠️ 에러 클래스를 `vi.hoisted` 콜백 *안에서* 선언해야 한다. 모듈 최상위에 `class PolarWebhookVerificationError extends Error {}`를 두고 `vi.mock` 팩토리에서 참조하면 반드시 죽는다.** `vi.mock` 호출은 파일 최상단으로 호이스팅되어 `class` 선언보다 **먼저** 실행되므로 `ReferenceError: Cannot access 'PolarWebhookVerificationError' before initialization`이 나고, 그러면 **테스트 0개로 파일 전체가 로드 실패**한다(`Test Files 1 failed | Tests no tests`). 파일만 존재하고 조용히 실행되지 않는 상태가 되어 아래 웹훅 AC 20여 개를 하나도 판정할 수 없다. `vi.hoisted`의 반환값은 `vi.mock` 팩토리보다 먼저 평가되므로 위 패턴은 안전하다.
- 위 구조 덕분에 **테스트 본문에서도 같은 클래스를 그대로 쓸 수 있다.** 라우트가 목킹된 모듈에서 import하는 클래스와 테스트가 던지는 인스턴스가 **동일한 클래스 객체**이므로 `instanceof` 분기가 정상 검증된다: `verifyPolarWebhook.mockImplementation(() => { throw new PolarWebhookVerificationError("expected v1,abc got v1,xyz") })`.
  - `verifyPolarWebhook`은 **동기 함수**다. `mockRejectedValue`가 아니라 `mockImplementation(() => { throw ... })`로 던지고, 정상 케이스는 `mockReturnValue({ kind: "event", event: { type: "subscription.active" } })`로 준다.
- `vi.importActual`로 실제 `src/services/polar`를 부분 로드하지 마라 — `server-only`가 이 저장소에 npm 패키지로 설치돼 있지 않아(Next가 빌드 시 alias로 처리) vitest에서 해석 자체가 실패한다.
- `vi.mock`의 경로 문자열은 **`route.ts`가 실제로 쓰는 import 경로와 정확히 같아야** 목킹이 걸린다.
- **서명 검증 자체의 정확성은 여기서 테스트하지 않는다.** 진짜 서명으로 진짜 `validateEvent`를 통과시키는 테스트는 step 0의 `src/services/polar/webhook.test.ts`가 이미 갖고 있다. 이 파일이 검증하는 것은 **라우트의 분기·순서·응답 코드**다.
- 요청 헬퍼:
  ```typescript
  function request(body: string) {
    return new Request("https://finsight.test/api/webhooks/polar", {
      method: "POST",
      headers: { "webhook-id": "msg_1", "webhook-signature": "v1,sig" },
      body,
    })
  }
  ```

## Acceptance Criteria

### 쓰기 헬퍼 (`src/services/supabase-admin/index.ts`)

- [ ] `upsertSubscriptionStatus({ userId, status })`가 `createServiceClient()`로 얻은 클라이언트의 `.from("subscriptions")`에 대해 **`.upsert(...)`를 호출**하고, 첫 인자가 `{ user_id: "user-1", status: "active", updated_at: <ISO 문자열> }`, 둘째 인자가 **`{ onConflict: "user_id" }`** 임을 단정하는 테스트가 통과한다.
- [ ] (update 금지 CRITICAL) `src/services/supabase-admin/index.ts`의 `upsertSubscriptionStatus` 구현에 `.update(` 호출이 없고, `subscriptions` 테이블에 대한 쓰기가 `.upsert(`뿐임을 코드로 확인한다. 테스트에서 `from`이 돌려주는 목 객체에 `update` 메서드를 아예 넣지 않아, 구현이 `update`를 쓰면 **TypeError로 실패**하도록 만든다. (첫 결제 시 해당 사용자 행이 존재하지 않으므로 `update`는 0행 갱신으로 조용히 실패한다.)
- [ ] (`updated_at` 명시 CRITICAL) upsert에 넘어간 객체에 `updated_at` 키가 **존재하고** 그 값이 유효한 ISO 8601 문자열임을 단정하는 테스트가 통과한다(`expect(new Date(payload.updated_at).toString()).not.toBe("Invalid Date")`). 이 테이블에는 `updated_at` 자동 갱신 트리거가 없다.
- [ ] upsert가 `{ error }`를 돌려줄 때 `upsertSubscriptionStatus`가 그 에러를 **throw**함을 단정하는 테스트가 통과한다.
- [ ] `isUnknownUserError`가 `{ code: "23503" }` → `true`, `{ code: "23505" }` / `new Error("boom")` / `null` / `undefined` / `"23503"`(문자열 자체) → 전부 `false`임을 `it.each`로 단정하는 테스트가 통과한다.
- [ ] 기존 `insertAnalysis`/`upsertPremiumReport` 테스트와 `src/services/supabase-admin/index.test-d.ts`가 **수정 없이 그대로 통과한다.**

### 웹훅 라우트 (`src/app/api/webhooks/polar/route.ts`)

- [ ] `src/app/api/webhooks/polar/route.ts`에 `NOT_IMPLEMENTED` 문자열과 `501` 상태 코드가 **0건**이다. 스텁이 완전히 교체됐다.
- [ ] `route.ts`가 `POST`만 export하고 `GET`/`PUT`/`PATCH`/`DELETE` export가 **0건**임을 grep으로 확인한다.
- [ ] (raw body CRITICAL) `src/app/api/webhooks/polar/route.ts`에 `request.json`, `JSON.parse`, `JSON.stringify` 문자열이 **각각 0건**이고 `request.text()` 호출이 정확히 **1건**임을 grep으로 확인한다.
- [ ] (raw body 전달 CRITICAL) 공백이 비정규적인 body(예: `'{"type":"subscription.active",   "data":{"x":1}}'` — 콤마 뒤 공백 3칸)로 POST했을 때, `verifyPolarWebhook`이 **그 문자열과 바이트 단위로 동일한 값**으로 호출됨을 `expect(verifyPolarWebhook).toHaveBeenCalledWith({ body: RAW, headers: expect.anything() })`로 단정하는 테스트가 통과한다. 파싱 후 재직렬화했다면 공백이 사라져 이 단정이 실패한다.
- [ ] `verifyPolarWebhook`의 `headers` 인자로 `request.headers`(`Headers` 인스턴스)가 그대로 넘어감을 단정하는 테스트가 통과한다(라우트가 헤더를 직접 객체로 변환하지 않는다).
- [ ] (서명 실패 = 거부 CRITICAL) `verifyPolarWebhook`이 `PolarWebhookVerificationError`를 throw할 때 응답이 **403 `{ code: "INVALID_SIGNATURE" }`** 이고, `upsertSubscriptionStatus`·`resolveUserId`·`mapEventToSubscriptionStatus`가 **모두 호출되지 않음**(`not.toHaveBeenCalled()`)을 단정하는 테스트가 통과한다. CLAUDE.md CRITICAL: "웹훅은 반드시 서명을 검증한 뒤에만 구독 상태를 갱신한다."
- [ ] (403 본문에 사유 노출 금지) 위 403 테스트에서 던져진 에러의 message(예: `"expected v1,abc got v1,xyz"`)가 응답 본문 문자열에 **포함되지 않음**을 `await expect(response.text()).resolves.not.toContain(...)`으로 단정한다.
- [ ] (설정 오류 ≠ 서명 실패 CRITICAL) `verifyPolarWebhook`이 `PolarConfigError`를 throw할 때 응답이 **500 `{ code: "INTERNAL_ERROR" }`** 임을 단정하는 테스트가 통과한다. **403이 아니다.** `upsertSubscriptionStatus`는 호출되지 않는다.
- [ ] `verifyPolarWebhook`이 평범한 `new Error("boom")`을 throw할 때도 응답이 **500 `{ code: "INTERNAL_ERROR" }`** 이고 예외가 라우트 밖으로 던져지지 않음을 단정하는 테스트가 통과한다.
- [ ] (미지원 이벤트) `verifyPolarWebhook`이 `{ kind: "unsupported" }`를 반환할 때 응답이 **200 `{ received: true, ignored: "unhandled_event" }`** 이고 `upsertSubscriptionStatus`가 **호출되지 않음**을 단정하는 테스트가 통과한다. 4xx/5xx가 아니다.
- [ ] (해석 불가) `resolveUserId`가 `null`을 반환할 때 응답이 **200 `{ received: true, ignored: "unresolved_customer" }`** 이고 `upsertSubscriptionStatus`가 **호출되지 않음**을 단정하는 테스트가 통과한다.
- [ ] (매핑 대상 밖) `mapEventToSubscriptionStatus`가 `null`을 반환할 때 응답이 **200 `{ received: true, ignored: "unhandled_event" }`** 이고 `upsertSubscriptionStatus`가 **호출되지 않음**을 단정하는 테스트가 통과한다.
- [ ] (정상 갱신) `resolveUserId → "11111111-1111-4111-8111-111111111111"`, `mapEventToSubscriptionStatus → "active"`일 때 `upsertSubscriptionStatus`가 **정확히 `{ userId: "11111111-1111-4111-8111-111111111111", status: "active" }`** 로 호출되고 응답이 **200 `{ received: true }`** 임을 단정하는 테스트가 통과한다.
- [ ] (미지 사용자) `upsertSubscriptionStatus`가 reject하고 `isUnknownUserError`가 `true`를 반환할 때 응답이 **200 `{ received: true, ignored: "unknown_user" }`** 임을 단정하는 테스트가 통과한다.
- [ ] (일시적 DB 오류 → 재시도 유도) `upsertSubscriptionStatus`가 reject하고 `isUnknownUserError`가 `false`를 반환할 때 응답 status가 **500번대**임을 단정하는 테스트가 통과한다(200이 아니다 — Polar이 재시도해야 한다).
- [ ] (검증이 쓰기보다 먼저) 정상 갱신 테스트에서 `verifyPolarWebhook.mock.invocationCallOrder[0] < upsertSubscriptionStatus.mock.invocationCallOrder[0]`을 단정한다.
- [ ] (멱등성) 같은 body로 `POST`를 **두 번** 호출했을 때 `upsertSubscriptionStatus`가 **두 번 모두 완전히 동일한 인자**로 호출되고(`expect(upsertSubscriptionStatus.mock.calls[0]).toEqual(upsertSubscriptionStatus.mock.calls[1])`) 두 응답 모두 200 `{ received: true }`임을 단정하는 테스트가 통과한다.
- [ ] (매핑 소유권) `src/app/api/webhooks/polar/route.ts`에 `"subscription.` 문자열과 `switch` 키워드가 **각각 0건**임을 grep으로 확인한다. 이벤트 타입 분기는 전적으로 `src/services/polar/`의 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`이 소유한다.

### ADR-006 회귀 방지선 (CRITICAL)

- [ ] `mapEventToSubscriptionStatus`를 목킹하지 않은 **실제 구현**에 대해, step 0의 `src/services/polar/subscription-status.test.ts`가 여전히 `subscription.canceled → null`, `subscription.past_due → null`을 단정하며 통과한다. 이 테스트를 수정·삭제하지 않았다.
- [ ] `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`의 키가 **여전히 정확히 3개**(`subscription.active`, `subscription.revoked`, `subscription.uncanceled`)임을 단정하는 step 0의 테스트가 통과한다. 이 step에서 `subscription.canceled`나 `subscription.past_due`를 이 상수에 **추가하지 않았다.**
- [ ] 웹훅 라우트 테스트에 `subscription.canceled` 이벤트가 도착했을 때(= `mapEventToSubscriptionStatus`가 `null`을 반환할 때) **`upsertSubscriptionStatus`가 호출되지 않고 200**임을 단정하는 **독립된 테스트 케이스**가 있고, 그 `it(...)` 설명 또는 인접 주석에 "ADR-006: 취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지한다 — 구독 해제는 `subscription.revoked`로만 일어난다"는 취지의 문구가 붙어 있다.
- [ ] `git diff`에서 `src/services/polar/subscription-status.ts`가 **수정되지 않았음**을 확인한다.

### DB 경계 (CRITICAL)

- [ ] (마이그레이션 0건) `supabase/migrations/`에 **새 파일이 추가되지 않았고** 기존 두 파일(`20260720164500_create_analyses.sql`, `20260720164534_create_subscriptions.sql`)이 **수정되지 않았다**(`git diff --name-only`로 확인). `src/types/database.ts`도 수정되지 않았다.
- [ ] (RLS 쓰기 정책 0건 CRITICAL) `grep -niE "create policy" supabase/migrations/20260720164534_create_subscriptions.sql`의 결과가 **정확히 1건**이고 그것이 `select_own_subscription`(`for select`)이다. `subscriptions`에 대한 `for insert`/`for update`/`for delete` 정책이 **저장소 전체에 0건**이다. 쓰기 정책을 열면 브라우저에서 사용자가 자기 `status`를 `'active'`로 바꿔 페이월을 우회한다.
- [ ] (읽기 경로 불변 CRITICAL) `src/lib/supabase/server.ts`가 **수정되지 않았다**(`git diff --name-only`로 확인). `getSubscriptionStatus`는 그대로다. 기존 `src/lib/supabase/server.test.ts`와 `src/app/api/reports/[analysisId]/[reportType]/route.test.ts`가 **하나도 깨지지 않는다** — Premium 게이팅(403 `PAYWALL_REQUIRED`)과 lazy-generate 동작이 그대로 살아 있다.
- [ ] (service-role 경계 CRITICAL) `src/app/api/webhooks/polar/route.ts`에 `lib/supabase/service`, `@supabase/supabase-js`, `SUPABASE_SERVICE_ROLE_KEY`, `createServiceClient` 문자열이 **각각 0건**이다. DB 쓰기는 오직 `services/supabase-admin`의 `upsertSubscriptionStatus` 경유다.
- [ ] (이벤트 테이블 금지) `polar_webhook_events` 문자열이 저장소 전체에 **0건**이다. 멱등성은 upsert가 제공하므로 중복 제거 테이블을 만들지 않는다.

### 공통

- [ ] (서비스 경계 CRITICAL) `grep -rn "@polar-sh/sdk" src/app/`의 결과가 **0건**이다. Polar 호출은 전부 `../../../../services/polar` 배럴 경유다.
- [ ] (환경변수 재읽기 금지) `src/app/api/webhooks/polar/route.ts`에 `process.env` 접근이 **0건**이다. `POLAR_WEBHOOK_SECRET`은 `src/services/polar/`만 읽는다.
- [ ] (로그 유출 방지 CRITICAL) `src/app/api/webhooks/polar/route.ts`와 `src/services/supabase-admin/index.ts`에 `console.` 호출이 **0건**임을 grep으로 확인한다. raw payload(고객 이메일·이름 포함), `webhook-signature` 헤더 값, 시크릿이 로그·응답 본문 어디에도 담기지 않는다.
- [ ] (범위 유지) `src/middleware.ts`, `src/lib/supabase/middleware.ts`, `src/components/`, `.env.example`, `package.json`, `vitest.config.ts`, `tsconfig.json`, `next.config.ts`를 **편집하지 않았다**. 기존 `src/middleware.test.ts`가 그대로 통과한다. (`/api/*`는 이미 미들웨어 matcher에서 제외돼 있어 웹훅을 위해 matcher를 바꿀 필요가 없다.)
- [ ] 이 step에서 네가 수정/추가한 파일은 `src/app/api/webhooks/polar/route.ts`, `src/app/api/webhooks/polar/route.test.ts`, `src/services/supabase-admin/index.ts`, `src/services/supabase-admin/index.test.ts` **4개뿐**이다.
  - `git status`에 이 step 이전부터 존재하던 미커밋 변경(예: `.env.example`, `.mcp.json`)이 보일 수 있다. **그건 네가 만든 것이 아니므로 되돌리거나 커밋에 끌어들이지 마라.** 판단 기준은 "네가 이 step에서 편집했는가"다.
- [ ] `npm run test` 출력에서 `src/app/api/webhooks/polar/route.test.ts`와 `src/services/supabase-admin/index.test.ts`가 **실제로 실행되어 각각 1개 이상의 테스트가 통과한다.** 파일 목록에 이름만 뜨고 `Tests no tests`이거나 모듈 로드 단계에서 실패(`ReferenceError`/`Failed to load url`)하는 상태는 **불합격**이다.
- [ ] (목 호이스팅 함정) `src/app/api/webhooks/polar/route.test.ts`에 **모듈 최상위 레벨의 `class ... extends Error` 선언이 0건**이고, `PolarWebhookVerificationError`/`PolarConfigError`가 `vi.hoisted(() => { ... })` 콜백 안에서 선언되어 반환됨을 코드로 확인한다. `vi.mock` 팩토리가 참조하는 모든 식별자가 `vi.hoisted`의 반환값에서 온다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 **501 스텁 테스트를 대체한 것 외에 기존 테스트가 하나도 깨지지 않는다.**

## 실행 후 수동 검증 (커밋 후, 사용자가 수행)

유닛 테스트로는 검증할 수 없는 항목이다. Codex는 이 항목 때문에 step을 blocked 처리하지 말고, 완료 summary에 남겨라.

1. `npm run dev`와 `polar listen http://localhost:3000/api/webhooks/polar`를 띄우고 샌드박스 결제를 한 번 태운다.
2. 활성화 시 **실제로 어떤 이벤트가 오는지** 확인한다. `subscription.created`만 오고 `subscription.active`가 오지 않는다면 구독이 영영 활성화되지 않는다. 그 경우에 **한해서만** `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`에 `subscription.created`(단, `data.status === "active"`일 때만)를 추가하는 후속 작업이 필요하다. 그 외에는 매핑 표에 아무것도 추가하지 않는다.
3. 결제 후 `subscriptions`에 해당 `user_id` 행이 **새로 INSERT되고** `status = 'active'`, `updated_at`이 갱신됐는지 확인한다(첫 결제이므로 행이 없던 상태에서 생겨야 한다 — upsert가 제대로 동작했다는 증거).
