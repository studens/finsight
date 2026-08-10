# core-services 확정 인터페이스 — Polar (phase 6-polar-billing, step 0)

> step 1(`POST /api/checkout`) / step 2(`/api/webhooks/polar`)의 api-routes planner와 qa가 참조하는
> **서비스 함수 시그니처 계약**이다. 계획 파일: `phases/6-polar-billing/step0.md`.
> 상위 계약: `_workspace/02_core-services_interface.md`(기존 서비스), `_workspace/03_api-routes_contract.md`(에러 코드 표),
> **`_workspace/02_db-schema_polar-mapping.md`(db-schema 확정 매핑 규약 — 이 문서는 그 규약을 준수한다).**
>
> ⚠️ `_workspace/`는 Codex 프리앰블에 자동 주입되지 않는다. 라우트 planner는 이 문서의 해당 내용을
> 자기 `step{N}.md` 본문에 **복사해 넣어야** 한다. "이 문서를 참고하라"는 참조만으로는 Codex가 보지 못한다.

SDK는 `@polar-sh/sdk@^0.49.0`. 아래 시그니처는 SDK 0.49.0의 배포 타입 정의(`dist/esm/**/*.d.ts`)를 직접 열어 확인한 것이다.

## 모듈 경계

```
import { ... } from "../../services/polar"     // 배럴. 라우트는 여기만 import한다.
```

- **라우트가 `@polar-sh/sdk`를 직접 import하는 것은 금지**(CLAUDE.md: 외부 API 호출은 `src/services/`를 통해서만). step 0의 AC에 grep 검증이 걸려 있다.
- `createPolarClient()`(raw SDK 인스턴스 팩토리)는 배럴에서 **재export되지 않는다.** 라우트에서 쓸 수 없고, 쓸 필요도 없다.
- 라우트는 Polar 타입을 하나도 몰라도 된다. 필요한 Supabase user id는 `resolveUserId`가 평범한 문자열로 돌려준다.

## 1. 체크아웃 세션 생성 (step 1 = 체크아웃 라우트가 사용)

```typescript
export type CreateCheckoutSessionInput = {
  userId: string          // Supabase auth user.id → Polar externalCustomerId
  email?: string | null   // Supabase user.email. 없으면 Polar가 체크아웃에서 직접 수집
}

export type CheckoutSession = {
  checkoutId: string
  url: string             // Hosted Checkout URL. 이 값을 클라이언트에 반환해 리다이렉트시킨다.
}

export function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSession>
```

서비스가 대신 처리해주는 것 (라우트가 다시 하지 마라):
- `POLAR_PRODUCT_ID`, `POLAR_SERVER`, `POLAR_ACCESS_TOKEN`, `NEXT_PUBLIC_APP_URL` 읽기와 유효성 검사
- `successUrl = ${NEXT_PUBLIC_APP_URL}/dashboard?checkout=success` 생성(끝 슬래시 정규화 포함)
- `externalCustomerId: userId` + `metadata: { user_id: userId }` 동시 기입 (db-schema 매핑 규약 §2)
- 응답에서 `clientSecret` 등 민감 필드 제거 — 반환값은 위 2개 필드뿐이라 그대로 클라이언트에 내려도 안전하다

라우트(step 1)의 책임으로 남는 것:
- **세션 확인**. 비로그인 → 401 `UNAUTHORIZED`. 이 서비스는 인증을 검사하지 않는다.
- **`userId`는 반드시 서버 세션에서 얻은 값**을 넘긴다. 요청 본문/쿼리의 `user_id`를 받지도 말고 넘기지도 마라 — 타인 명의 구독을 만들 수 있다. 이 서비스는 출처를 검사할 방법이 없다.
- **이미 구독 중인 사용자 처리**. 이 서비스는 구독 상태를 조회하지 않는다. `getSubscriptionStatus`로 확인해 이미 `active`면 체크아웃을 만들지 않는 편이 낫다(정책은 api-routes가 결정).
- `POST`만 export. 브라우저 프리페치로 체크아웃이 생성되면 안 된다.

## 2. 웹훅 서명 검증 + 파싱 (step 2 = 웹훅 라우트가 사용)

```typescript
export type PolarWebhookEvent = ReturnType<typeof validateEvent>   // SDK 이벤트 유니온

export type VerifiedWebhook =
  | { kind: "event"; event: PolarWebhookEvent }
  | { kind: "unsupported" }

export function verifyPolarWebhook(input: {
  body: string                              // request.text() 결과 그대로. JSON.parse 하지 말 것
  headers: Headers | Record<string, string> // request.headers 그대로 넘겨도 됨
}): VerifiedWebhook                          // 동기 함수. Promise 아님
```

- **동기 함수다.** `await`하지 않아도 되고, 해도 무해하다.
- `headers`는 `Headers` 인스턴스를 그대로 넘겨도 된다. 서비스 내부에서 소문자 키의 평범한 객체로 정규화한다.
- **`body`는 반드시 raw 문자열이어야 한다.** `await request.text()`를 쓰고, `request.json()`을 쓰지 마라 — 재직렬화하면 바이트가 달라져 서명이 100% 깨진다. 라우트에서 body를 먼저 파싱한 뒤 다시 stringify하는 것도 금지.

### 3가지 결과와 HTTP 매핑

| 결과 | 의미 | step 2(웹훅 라우트)의 응답 |
|---|---|---|
| `{ kind: "event", event }` 반환 | 서명 유효 + 파싱 성공 | 아래 3·4절대로 처리 후 200 |
| `{ kind: "unsupported" }` 반환 | **서명은 유효**하나 SDK가 모르는 이벤트 타입 | DB 쓰기 없이 **200** `{ received: true, ignored: "unhandled_event" }`. 에러 아님 |
| `PolarWebhookVerificationError` throw | 서명 불일치 / 변조 / 필수 헤더 누락 | **403**(본문에 상세 사유 금지). DB를 절대 건드리지 않는다 |
| `PolarConfigError` throw | `POLAR_WEBHOOK_SECRET` 미설정 (서버 설정 오류) | **500**. 403이 아니다 |

서명 검증 통과 이후의 응답 코드는 db-schema 매핑 규약 §3의 표를 따른다:
`resolveUserId → null`이면 200 `{ received: true, ignored: "unresolved_customer" }`,
`mapEventToSubscriptionStatus → null`이면 200 `{ received: true, ignored: "unhandled_event" }`,
FK 위반(23503)이면 200 `{ received: true, ignored: "unknown_user" }`,
그 외 일시적 DB 오류만 5xx(Polar 재시도에 맡긴다).

`{ kind: "unsupported" }`가 200인 이유: 서명 검증은 이미 통과했으므로 진짜 Polar가 보낸 요청이고, 우리는 `subscription.active`/`uncanceled`/`revoked` 3종에만 반응하면 되기 때문이다. 여기서 5xx를 내면 Polar가 무한 재시도한다.

### 에러 클래스

```typescript
export class PolarWebhookVerificationError extends Error {
  readonly code = "POLAR_WEBHOOK_INVALID_SIGNATURE"
}
export class PolarConfigError extends Error {
  readonly code = "POLAR_CONFIG_ERROR"
}
export class PolarApiError extends Error {
  readonly code = "POLAR_API_ERROR"
}
```

- 세 클래스 모두 배럴에서 export되므로 라우트에서 `instanceof`로 분기한다.
- **`error.message`를 응답 본문에 담지 마라.** 라우트는 `_workspace/03_api-routes_contract.md`의 공통 형식대로 `{ code }`만 반환한다.
- 체크아웃 라우트(step 1)에서 `PolarApiError` → **502 `GENERATION_FAILED`**... 는 LLM 전용 코드이므로 어울리지 않는다. **`{ code: "CHECKOUT_FAILED" }` + 502**를 신규 코드로 쓰는 것을 권장한다(기존 표에 결제용 코드가 없다 — api-routes planner가 확정하고 계약 문서에 추가하라).
- `PolarConfigError`는 어느 라우트에서든 **500** + `{ code: "INTERNAL_ERROR" }`. 변수 이름조차 응답에 노출할 필요 없다.

## 3. 이벤트 → 구독 상태 매핑 (step 2가 사용)

```typescript
export type SubscriptionStatusUpdate = "active" | "inactive"

export function mapEventToSubscriptionStatus(
  eventType: string,
): SubscriptionStatusUpdate | null
```

| eventType | 반환값 |
|---|---|
| `subscription.active`, `subscription.uncanceled` | `"active"` |
| `subscription.revoked` | `"inactive"` |
| `subscription.canceled`, `subscription.past_due` | **`null`** (무시 — 상태 변경 없음) |
| 그 외 전부 (`subscription.created`, `subscription.updated`, `order.paid`, …) | `null` |

`SUBSCRIPTION_STATUS_BY_EVENT_TYPE`의 키는 **정확히 3개**(`subscription.active`, `subscription.uncanceled`, `subscription.revoked`)뿐이다.

- **`null` = "DB를 건드리지 않는다"**, 에러가 아니다. 라우트는 `null`이면 upsert를 건너뛰고 200 `{ received: true, ignored: "unhandled_event" }`를 반환한다.
- 반환 타입이 현 `subscriptions.status` 체크 제약(`'active' | 'inactive'`)과 정확히 일치하므로, 라우트는 값을 변환 없이 그대로 쓴다.
- 호출 방법: `mapEventToSubscriptionStatus(result.event.type)`.

> ### ⚠️ `canceled`/`past_due`가 `inactive`가 아닌 이유 (되돌리지 마라)
>
> **ADR-006 결정문:** *"취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지하는 방식으로 구현한다."*
>
> Polar에서 `subscription.canceled`는 **해지 "예약"** 시점이고, 실제 접근 종료는 `subscription.revoked`가 따로 온다. `canceled`에서 즉시 내리면 사용자가 이미 지불한 잔여 기간을 빼앗는다. `subscription.past_due`는 결제 재시도(dunning) 중일 뿐이며, Polar가 재시도를 포기하면 `revoked`를 보낸다.
>
> **구독 해제는 오직 `subscription.revoked` 하나로만 일어난다.**
>
> (이력: scope 초안은 이 둘을 `inactive`로 적었으나 ADR-006 위배로 2026-08-07 리더가 정정했다. db-schema·core-services 플래너가 독립적으로 같은 지적을 했고 리더가 ADR 원문을 확인해 수용했다. `_workspace/00_input/scope_6-polar-billing.md` 결정 4번의 정정 이력 블록 참조.)
>
> 웹훅 라우트 step의 planner에게: **이 서술을 네 `step{N}.md` 본문에 복사해 넣어라.** `_workspace/`는 Codex에 자동 주입되지 않으므로, 이 근거가 step 파일에 없으면 Codex가 "취소인데 active라니 버그"로 판단해 되돌릴 수 있다.

## 4. Supabase user id 역참조 (step 2가 사용)

```typescript
export function resolveUserId(event: PolarWebhookEvent): string | null
```

db-schema가 **"스키마 변경 없음"**(매핑 규약 §1)으로 결론냈으므로, Polar 고객 ↔ Supabase 사용자 매핑은 **전적으로 이 함수 하나**에 달려 있다. `subscriptions`에 `polar_customer_id` 같은 컬럼은 추가되지 않는다.

해석 우선순위(매핑 규약 §3과 동일):
1. `event.data.customer.externalId` — 체크아웃에서 `externalCustomerId`로 심어 보낸 값
2. `event.data.customer.external_id` — raw snake_case 폴백
3. `event.data.metadata.user_id` — 문자열일 때만
4. 없으면 `null`

- **UUID 형식이 아니면 `null`을 반환한다.** 임의 문자열이 DB 쿼리로 흘러가지 않게 하는 방어선.
  매핑 규약은 "uuid v4"라 적었으나 구현은 버전 니블을 강제하지 않는 **일반 UUID 형식 검증**을 쓴다 — 방어 목적은 동일하되 유효한 사용자를 잘못 버릴 위험이 없다. 의도된 완화다.
- `subscription.*` 7종이 아닌 이벤트에는 항상 `null`.
- **`null`이면 라우트는 DB를 건드리지 말고 200 `{ received: true, ignored: "unresolved_customer" }`를 반환한다.** 우리 체크아웃을 거치지 않고 Polar 대시보드에서 수동 생성된 구독일 수 있다. 4xx/5xx로 응답하면 Polar가 재시도만 10회 반복한다.
- 반환값은 `auth.users.id`(UUID 문자열)다. 라우트는 이 값으로 `subscriptions.user_id`를 충돌 키 삼아 **upsert**한다(`update`가 아니다 — 첫 결제 시 행이 아직 없다. 매핑 규약 §5).
- **소유권 검증:** 이 값의 출처는 서명 검증을 통과한 Polar payload이며 우리가 직접 심은 값이다. 그럼에도 DB 쓰기는 `services/supabase-admin`의 service-role 클라이언트로만 하고 `user_id`를 이 값으로 명시 지정한다(RLS가 아니라 코드가 소유권을 결정한다 — CLAUDE.md).
- **Polar 식별자는 노출하지 않는다.** db-schema가 `customer_id`/`subscription_id`를 저장하지 않기로 했으므로 이 서비스도 반환하지 않는다. 나중에 필요해지면 Polar API를 `external_customer_id`로 조회한다.
- **제품 필터링 없음:** 이벤트의 `productId`가 `POLAR_PRODUCT_ID`와 일치하는지 검사하지 않는다. 현재 제품이 하나뿐이라 문제없다. 제품이 늘면 필터를 추가해야 한다.

## 5. 환경변수

| 이름 | 서버 전용 | 없을 때 |
|---|---|---|
| `POLAR_ACCESS_TOKEN` | 예 | `PolarConfigError` |
| `POLAR_WEBHOOK_SECRET` | 예 | `PolarConfigError` |
| `POLAR_PRODUCT_ID` | 예 | `PolarConfigError` |
| `POLAR_SERVER` (`sandbox`\|`production`) | 예 | `PolarConfigError` — **기본값으로 넘어가지 않는다** |
| `NEXT_PUBLIC_APP_URL` | 아니오(공개 URL) | `PolarConfigError` |

- 5개 모두 `.env.local`에 이미 채워져 있고 `.env.example`에도 문서화돼 있다. **새 이름을 만들지 마라.**
- `POLAR_SERVER`를 필수로 둔 이유: SDK의 `server` 옵션 기본값이 `"production"`이라, 미설정이면 샌드박스 토큰으로 프로덕션 결제 API를 호출하게 된다.
- 앞 4개는 절대 클라이언트 컴포넌트로 전달하지 않는다. `NEXT_PUBLIC_POLAR_*` 형태의 변수는 만들지 않는다.

## 6. db-schema 매핑 규약과의 정합성

`_workspace/02_db-schema_polar-mapping.md`(2026-08-07 확정)와 대조해 다음을 맞췄다:

| 규약 | 이 인터페이스의 반영 |
|---|---|
| §1 스키마 변경 없음 | Polar 식별자를 반환하지 않는다. `resolveUserId` 하나로 충분하다 |
| §2 `metadata: { user_id }` | 체크아웃 payload의 metadata 키가 정확히 `user_id` |
| §3 `resolveUserId(event): string \| null` | **함수 이름·시그니처를 그대로 채택**. 폴백 체인 3단 + UUID 검증 |
| §4 매핑 테이블을 상수 객체로 | `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`을 배럴에서 export |
| §5 멱등성은 upsert가 제공 | 서비스는 상태를 저장하지 않는 순수 함수. 멱등성은 step 2 라우트 책임 |
| §6 `upsertSubscriptionStatus` | **step 2의 범위.** step 0은 `supabase-admin`을 건드리지 않는다 |

의도적으로 완화한 것 하나: §3의 "uuid **v4** 검증"을 버전 니블 비강제인 일반 UUID 검증으로 구현한다(4절 참조).

## 7. step 배치 (2026-08-07 리더 확정)

db-schema가 "마이그레이션 불필요"로 결론내 마이그레이션 step이 사라졌고, 전체가 0-base로 재번호됐다.

| step | 담당 | 내용 |
|---|---|---|
| **0** | core-services | `src/services/polar/` 서비스 계층 — **이 문서가 계약하는 범위** (`phases/6-polar-billing/step0.md`) |
| 1 | api-routes | `POST /api/checkout` |
| 2 | api-routes | `/api/webhooks/polar` 501 스텁 교체 |
| 3 | frontend | `PremiumSection` CTA 연결, 결제 복귀 처리 |

step 0은 이 phase의 첫 step이며 선행 step에 의존하지 않는다.

## 8. SDK 런타임 동작 — 실측 검증 완료 (2026-08-07)

QA 계획 검증이 "설치 전이라 확인 불가"로 이월했던 3건을 `@polar-sh/sdk@0.49.0`을 실제 실행해 확인했다. **셋 다 계획이 가정한 대로다.**

| 확인 항목 | 결과 |
|---|---|
| 알 수 없는 `type` → `WebhookVerificationError`가 **아닌** 에러인가 | 예. `SDKValidationError`이며 `instanceof WebhookVerificationError`는 `false`. → `{ kind: "unsupported" }` 분기가 성립한다 |
| 헤더 누락에도 `WebhookVerificationError`인가 | 예. 헤더 `{}` 전부 누락, `webhook-signature`만 누락 둘 다 `WebhookVerificationError` |
| `customer.external_id` → camelCase 변환되는가 | 예. `event.data.customer.externalId`로 읽힌다 |
| (추가) body 변조 / 다른 secret | 둘 다 `WebhookVerificationError` |

추가 발견 하나 — **`standardwebhooks`는 헤더 키 대소문자를 자체 처리한다.** 그래서 `verifyPolarWebhook`의 소문자 정규화에서 실제로 load-bearing한 부분은 대소문자가 아니라 **`Headers` 인스턴스 → 평범한 객체 변환**이다. `standardwebhooks`가 `headers["webhook-id"]` 식 속성 접근을 하므로, 라우트가 `request.headers`(`Headers` 인스턴스)를 그대로 넘겨도 되도록 이 변환이 반드시 있어야 한다. 웹훅 라우트 planner는 **`request.headers`를 그대로 넘겨도 안전하다**고 전제해도 된다.

또한 `Subscription` zod 스키마의 필수 필드가 `.d.ts`의 `?` 표기와 어긋나는 지점이 있다(`current_meter_period_start`·`trial_start`·`paused_at`·`resumes_at`가 TS상 `Date | null`인데 inbound 스키마는 **문자열 필수**). step 0에 파싱 검증을 마친 픽스처를 통째로 박아 넣었으므로, 웹훅 라우트 step은 그 픽스처를 재사용하면 된다(라우트 테스트는 `verifyPolarWebhook`을 목킹하므로 애초에 픽스처가 필요 없을 수도 있다).

## 9. 남은 미해결 항목

1. **활성화 이벤트 실측.** db-schema 매핑 규약 §4가 `polar listen`으로 실제 샌드박스 결제를 태워 `subscription.active`가 실제로 오는지 확인하라고 요구한다. **step 0의 유닛 테스트로는 검증 불가**(네트워크 금지)하며 step 2 실행 후 수동 검증 항목이다. `subscription.created`만 오고 `active`가 오지 않는 것으로 판명되면 그때만 매핑 표에 `subscription.created`(단, `data.status === "active"`일 때만)를 추가한다.
2. **`CHECKOUT_FAILED` 에러 코드 신설.** 기존 에러 코드 표에 결제용 코드가 없다. 리더가 api-routes planner에게 전달하기로 했다. 확정되면 `_workspace/03_api-routes_contract.md`에 추가한다.
