# Step 0: `src/services/polar/` — Polar SDK 래퍼 (체크아웃 생성 / 웹훅 서명검증 / 상태 매핑)

## 배경

`src/app/api/webhooks/polar/route.ts`는 지금 6줄짜리 `501 NOT_IMPLEMENTED` 스텁이고, 체크아웃 라우트는 아예 없다. CLAUDE.md의 **"외부 API 호출(Claude, Supabase, Polar)은 `src/services/`를 통해서만 수행한다"** 규칙에 따라, 라우트를 만들기 전에 Polar SDK를 감싸는 서비스 계층부터 만든다.

**이 step은 이 phase의 첫 step이고, `src/services/polar/`와 그 유닛 테스트만 만든다.** 선행 step에 의존하지 않는다(스키마 마이그레이션은 db-schema가 "불필요"로 결론내 이 phase에 없다). 라우트 핸들러(`POST /api/checkout`, `/api/webhooks/polar`)와 `PremiumSection` CTA 연결은 **뒤따르는 step들의 범위**다. `src/app/`·`src/components/` 아래를 건드리지 마라. 기존 501 스텁도 이 step에서는 그대로 둔다.

환경변수 5개(`POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_ID`, `POLAR_SERVER`, `NEXT_PUBLIC_APP_URL`)는 **`.env.local`에 이미 채워져 있고 `.env.example`에도 이미 문서화돼 있다.** 새 환경변수 이름을 발명하지 말고, `.env.example`을 수정하지도 마라.

> **주입된 `AGENTS.md`/`docs/*.md`가 헷갈리게 만들 수 있다.** 그 문서들은 "실제 체크아웃/웹훅 연동은 Polar 계정 준비 후 `polar-billing` phase에서 구현한다", "polar-billing은 아직 미구현" 이라고 적고 있다. **그 후속 phase가 바로 지금 이 phase(`6-polar-billing`)다.** Polar 샌드박스 조직·제품·CLI·키가 전부 준비 완료이고 `.env.local`에 값이 들어 있다. 그러니 "아직 할 때가 아니다"라고 판단해 이 step을 건너뛰거나 blocked 처리하지 마라. 반대로, 그 문서들이 함께 언급하는 **마이그레이션이나 `polar_webhook_events` 테이블은 만들지 마라** — db-schema가 2026-08-07에 "이번 phase 스키마 변경 없음"으로 확정했고, 애초에 이 step은 `src/services/polar/`만 만든다.

**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

### 이미 검증된 SDK 사실 (추측하지 말고 이대로 써라)

`@polar-sh/sdk@0.49.0`의 배포 타입 정의(`dist/esm/**/*.d.ts`)를 직접 열어 확인한 내용이다. 아래와 다르게 쓰면 typecheck가 깨진다.

- 클라이언트: `import { Polar } from "@polar-sh/sdk"` → `new Polar({ accessToken, server })`
- **옵션 이름은 `server`이지 `environment`가 아니다.** 값은 `"sandbox" | "production"`.
  `@polar-sh/sdk` 내부의 `src/lib/config.ts`(우리 레포 파일 아님) 기준 `server`를 생략하면 **기본값이 `"production"`** 이다. 즉 값을 안 넘기면 샌드박스 토큰으로 프로덕션 API를 때린다.
- 체크아웃: `await polar.checkouts.create(request: CheckoutCreate): Promise<Checkout>`
  - `CheckoutCreate`의 필드(확인된 것만): `products: Array<string>` (필수), `successUrl?: string | null`, `externalCustomerId?: string | null`, `customerEmail?: string | null`, `metadata?: { [k: string]: string | number | boolean }`
  - `Checkout`에는 `id: string`과 `url: string`이 있다. 이 `url`이 사용자를 보낼 Hosted Checkout 주소다.
- 웹훅: `import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks.js"`
  - **서브패스 import이며 `.js` 확장자가 붙는다.** `@polar-sh/sdk`(루트)에서는 export되지 않는다. 루트 `index.ts`는 `lib/config.js`, `lib/files.js`, `lib/http.js`, `sdk/sdk.js`만 재export한다.
  - 시그니처: `validateEvent(body: string | Buffer, headers: Record<string, string>, secret: string)` → 파싱된 이벤트 유니온을 **동기로 반환**(Promise 아님).
  - 내부 동작: `Buffer.from(secret, "utf-8").toString("base64")`로 secret을 base64 인코딩한 뒤 `new Webhook(base64Secret).verify(body, headers)`를 호출한다. **이 base64 변환이 직접 HMAC을 구현하면 거의 틀리는 지점이다. 절대 손으로 구현하지 마라.**
  - 실패 동작 2종: ① 서명/헤더 문제 → SDK의 `WebhookVerificationError` throw. ② 서명은 통과했지만 `type`을 SDK가 모르거나 payload 스키마 파싱 실패 → `SDKValidationError` throw. **①과 ②는 결과가 완전히 달라야 한다**(①은 거부, ②는 무시).
  - 헤더 이름: `webhook-id`, `webhook-timestamp`(초 단위 문자열), `webhook-signature`(`v1,<base64>`). Standard Webhooks 사양.
- 구독 이벤트 payload: `subscription.active | canceled | revoked | uncanceled | past_due | created | updated` 7종 모두 `{ type, timestamp: Date, data: Subscription }` 형태다.
  - `Subscription`에 `id`, `customerId`, `productId`, `metadata: {[k:string]: ...}`, `customer: SubscriptionCustomer`가 있다.
  - `SubscriptionCustomer`에 **`externalId?: string | null | undefined`** 가 있다. 체크아웃에서 `externalCustomerId`로 실어 보낸 Supabase `user.id`가 여기로 돌아온다.
- SDK의 transitive dependency로 `standardwebhooks`가 함께 설치된다. 테스트에서 유효한 서명을 만들 때 이걸 쓴다.

**아래 런타임 동작은 `@polar-sh/sdk@0.49.0`을 실제로 실행해 확인했다.** 계획대로 짜면 그대로 재현된다:

| 입력 | `validateEvent`의 동작 |
|---|---|
| 유효 서명 + 알려진 이벤트 | 파싱된 이벤트 반환. `data.customer.external_id` → **`data.customer.externalId`로 camelCase 변환됨** |
| 유효 서명 + `{"type":"unknown.event","data":{}}` | `SDKValidationError` throw — **`WebhookVerificationError`가 아니다**(`instanceof` false). 0-5의 `{ kind: "unsupported" }` 분기가 여기 걸린다 |
| 헤더 객체가 `{}` (전부 누락) | `WebhookVerificationError` throw |
| `webhook-signature`만 누락 | `WebhookVerificationError` throw |
| body 변조(끝에 공백 1개 추가) | `WebhookVerificationError` throw |
| 다른 secret으로 서명 | `WebhookVerificationError` throw |

- 참고: `standardwebhooks`는 헤더 키 대소문자를 **자체적으로** 처리한다(`Webhook-Id`로 줘도 검증 통과). 그럼에도 0-5에서 소문자 정규화를 요구하는 이유는 **`Headers` 인스턴스**를 지원하기 위해서다 — `standardwebhooks`는 평범한 객체 속성 접근을 하므로 `Headers` 인스턴스를 그대로 넘기면 모든 헤더를 못 찾아 검증이 실패한다. 정규화의 load-bearing 부분은 대소문자가 아니라 `Headers` → 평범한 객체 변환이다.

## 작업

### 0-0. 의존성 추가

```bash
npm install @polar-sh/sdk@^0.49.0
npm install --save-dev standardwebhooks@^1.0.0
```

- `@polar-sh/sdk`는 `dependencies`, `standardwebhooks`는 `devDependencies`에 들어간다. `standardwebhooks`는 **테스트에서 유효한 서명을 생성할 때만** 쓴다. 프로덕션 코드(`src/services/polar/*.ts` 중 `*.test.ts`가 아닌 파일)에서 `standardwebhooks`를 import하지 마라 — 서명 검증은 SDK의 `validateEvent`가 전담한다.
- `@polar-sh/sdk`는 `zod`를 필요로 하므로 npm이 함께 설치한다. 정상이다.
- `package.json` / `package-lock.json` 외의 설정 파일(`.env.example`, `tsconfig.json`, `vitest.config.ts`, `next.config.ts`)은 수정하지 않는다.

### 0-1. `src/services/polar/errors.ts` (신규)

`src/services/pdf-parser/errors.ts`의 스타일(짧은 고정 메시지 + `readonly code` 리터럴)을 그대로 따른다.

```typescript
export class PolarConfigError extends Error {
  readonly code = "POLAR_CONFIG_ERROR" as const
  constructor(variableName: string)   // message: `${variableName} is required`
}

export class PolarWebhookVerificationError extends Error {
  readonly code = "POLAR_WEBHOOK_INVALID_SIGNATURE" as const
  constructor()   // message: "Polar webhook signature verification failed"
}

export class PolarApiError extends Error {
  readonly code = "POLAR_API_ERROR" as const
  constructor(message: string)
}
```

- 세 클래스 모두 생성자에서 `this.name`을 클래스 이름으로 설정한다.
- **`PolarConfigError`의 메시지에는 환경변수 "이름"만 담고 "값"은 절대 담지 않는다.** `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET`의 값이 에러 메시지를 타고 응답이나 스택트레이스로 새면 안 된다.
- `PolarApiError`에 SDK 원본 에러를 `cause`로 붙이거나 원본 메시지를 이어붙이지 마라. Polar SDK 에러는 요청 헤더/응답 본문을 문자열에 담을 수 있어 토큰 유출 경로가 된다. 고정 문구만 쓴다.

### 0-2. `src/services/polar/client.ts` (신규)

```typescript
export function createPolarClient(): Polar
```

- 파일 첫 줄에 `import "server-only"` (기존 `src/lib/supabase/service.ts`와 동일한 방어). 이러면 클라이언트 컴포넌트가 실수로 import할 때 빌드가 깨진다.
- `process.env.POLAR_ACCESS_TOKEN`이 없거나 빈 문자열이면 `throw new PolarConfigError("POLAR_ACCESS_TOKEN")`.
- `process.env.POLAR_SERVER`가 `"sandbox"`도 `"production"`도 아니면(미설정 포함) `throw new PolarConfigError("POLAR_SERVER")`.
  - **기본값으로 넘어가게 두지 마라.** 위 "검증된 SDK 사실"대로 SDK 기본값은 `production`이라, 오타 하나로 샌드박스 개발 중에 프로덕션 결제 API를 호출하게 된다. 명시적으로 요구하고 아니면 던진다.
- `return new Polar({ accessToken, server })`.
- **환경변수는 반드시 함수 본문 안에서 읽는다.** 모듈 최상단에서 `const TOKEN = process.env...`로 캐싱하지 마라 — 테스트가 env를 바꿔가며 검증할 수 없고, Next 빌드 시점에 값이 굳는다.
- 이 함수는 `index.ts`에서 **재export하지 않는다.** 서비스 밖에서 raw SDK 인스턴스를 만들 수 있으면 "라우트가 SDK 직접 호출 금지" 경계가 무너진다.

### 0-3. `src/services/polar/checkout.ts` (신규)

```typescript
export type CreateCheckoutSessionInput = {
  userId: string          // Supabase auth user.id
  email?: string | null   // Supabase user.email (없으면 Polar가 체크아웃에서 직접 수집)
}

export type CheckoutSession = {
  checkoutId: string
  url: string
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSession>
```

동작 규칙:

1. `process.env.POLAR_PRODUCT_ID`가 비어 있으면 `throw new PolarConfigError("POLAR_PRODUCT_ID")`.
   `process.env.NEXT_PUBLIC_APP_URL`이 비어 있으면 `throw new PolarConfigError("NEXT_PUBLIC_APP_URL")`.
   (`NEXT_PUBLIC_APP_URL`은 비밀이 아닌 공개 URL이므로 `NEXT_PUBLIC_` 접두어가 붙는 게 정상이다. 이름을 바꾸지 마라.)
2. `createPolarClient()`로 클라이언트를 만든다.
3. `polar.checkouts.create()`에 넘길 payload:
   ```typescript
   {
     products: [productId],
     successUrl: `${appUrl.replace(/\/$/, "")}/dashboard?checkout=success`,
     externalCustomerId: input.userId,
     metadata: { user_id: input.userId },
     // email이 비어있지 않을 때만 customerEmail 키를 추가한다
   }
   ```
   - `successUrl`은 스코프에서 확정된 값이다. **cancel URL은 만들지 않는다**(취소는 Polar 기본 동작에 맡긴다).
   - `appUrl`의 끝 슬래시를 제거해 `//dashboard`가 되는 것을 막는다.
   - `externalCustomerId`가 웹훅에서 `data.customer.externalId`로 되돌아오는 **1순위 매핑 키**다. `metadata.user_id`는 같은 값을 담은 2차 폴백이다. 둘 다 보낸다.
   - **metadata 키 이름은 정확히 `user_id`다.** db-schema가 확정한 매핑 규약(`_workspace/02_db-schema_polar-mapping.md` §2)이며, 뒤따르는 웹훅 라우트 step이 이 키를 읽는다. `supabase_user_id` 같은 다른 이름으로 바꾸지 마라.
   - `input.userId`는 **호출자(라우트)가 서버 세션에서 얻은 값**이라는 전제다. 이 서비스는 그 출처를 검사할 수 없으므로, "요청 본문의 user_id를 넘기지 않는다"는 책임은 체크아웃 라우트 step에 있다.
   - `input.email`이 `undefined`/`null`/`""`이면 `customerEmail` **키 자체를 payload에서 뺀다**(`null`로 보내지 않는다).
4. 성공 시 `{ checkoutId: checkout.id, url: checkout.url }`만 반환한다. **`clientSecret`을 포함한 SDK 응답 객체를 그대로 반환하지 마라** — 이 반환값은 체크아웃 라우트를 통해 클라이언트로 나간다.
5. `polar.checkouts.create`가 reject하면 `throw new PolarApiError("Failed to create Polar checkout session")`로 **감싸서** 던진다. 원본 에러를 그대로 흘려보내지 않는다(0-1의 토큰 유출 사유). api-routes가 이 `code`로 502를 매핑한다.
6. **`console.*`을 쓰지 않는다.** 액세스 토큰, 이메일, 체크아웃 URL 어느 것도 로그로 남기지 않는다.

### 0-4. `src/services/polar/subscription-status.ts` (신규)

```typescript
export type SubscriptionStatusUpdate = "active" | "inactive"

export function mapEventToSubscriptionStatus(
  eventType: string,
): SubscriptionStatusUpdate | null
```

추가로 매핑 테이블 상수 자체도 export한다:

```typescript
export const SUBSCRIPTION_STATUS_BY_EVENT_TYPE: Readonly<
  Record<string, SubscriptionStatusUpdate>
>
```

db-schema 매핑 규약(§4)이 "매핑 테이블은 `src/services/polar/`의 상수 객체 하나로 두고 라우트는 그것만 참조한다 — 웹훅 step의 테스트가 이 상수를 직접 검증할 수 있어야 한다"고 요구한다. 라우트에 `switch`를 흩뿌리지 않기 위한 것이다.

`mapEventToSubscriptionStatus`는 순수 함수. I/O·env 접근 없음. 매핑 표를 **그대로** 구현한다:

| eventType | 반환값 |
|---|---|
| `subscription.active` | `"active"` |
| `subscription.uncanceled` | `"active"` |
| `subscription.revoked` | `"inactive"` |
| `subscription.canceled` | **`null`** (무시 — 상태 변경 없음) |
| `subscription.past_due` | **`null`** (무시 — 상태 변경 없음) |
| 그 외 전부 (`subscription.created`, `subscription.updated`, `order.paid`, `checkout.created`, 빈 문자열, 알 수 없는 값 …) | `null` |

- 즉 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`의 키는 **정확히 3개**(`subscription.active`, `subscription.uncanceled`, `subscription.revoked`)뿐이다.
- `null`은 "에러"가 아니라 **"이 이벤트로는 DB를 건드리지 않는다"** 를 뜻한다. 웹훅 라우트는 `null`일 때 아무것도 쓰지 않고 200을 반환한다.
- 현 `subscriptions` 스키마의 `status`가 `'active' | 'inactive'` 2값뿐이라 이 표로 축약한 것이다. 반환 타입에 세 번째 값을 추가하지 마라.
- 구현은 `if/else` 체인이 아니라 위 상수 객체 조회로 하고, 조회 실패 시 `null`을 반환한다(기본 분기가 `null`임이 코드에서 자명해야 한다).

> #### ⚠️ `canceled`와 `past_due`가 왜 `inactive`가 아닌가 (되돌리지 마라)
>
> 언뜻 "취소됐는데 왜 active로 두느냐"로 보여 버그로 오인하기 쉽다. 아니다. **ADR-006의 결정문이다:**
>
> > *"취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지하는 방식으로 구현한다."*
>
> Polar에서 `subscription.canceled`는 **사용자가 해지를 "예약"한 시점**에 발생하고, 실제 접근 종료 시점에는 별도로 `subscription.revoked`가 온다. `canceled`에서 즉시 `inactive`로 내리면 **사용자가 이미 지불한 잔여 기간을 빼앗는다.**
>
> `subscription.past_due`는 결제 재시도(dunning) 중이라는 뜻일 뿐이다. Polar가 재시도를 포기하면 그때 `revoked`를 보낸다. 카드가 잠깐 막힌 유료 사용자를 즉시 차단하지 않고 유예하는 것이 ADR-006의 취지에 맞다.
>
> **결론: 구독 해제는 오직 `subscription.revoked` 하나로만 일어난다.** 아래 AC의 `canceled`/`past_due` → `null` 테스트가 이 결정을 코드에 고정하는 회귀 방지선이다. 이 두 케이스를 지우거나 `"inactive"`로 바꾸지 마라.
>
> (이력: scope 초안은 이 둘을 `inactive`로 적었으나 ADR-006 위배로 2026-08-07 리더가 정정했다. `_workspace/00_input/scope_6-polar-billing.md` 결정 4번의 정정 이력 블록 참조.)

### 0-5. `src/services/polar/webhook.ts` (신규)

```typescript
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks.js"

export type PolarWebhookEvent = ReturnType<typeof validateEvent>

export type VerifiedWebhook =
  | { kind: "event"; event: PolarWebhookEvent }
  | { kind: "unsupported" }

export function verifyPolarWebhook(input: {
  body: string
  headers: Headers | Record<string, string>
}): VerifiedWebhook

export function resolveUserId(event: PolarWebhookEvent): string | null
```

`verifyPolarWebhook` 동작 규칙:

1. 파일 첫 줄에 `import "server-only"`.
2. `process.env.POLAR_WEBHOOK_SECRET`이 비어 있으면 `throw new PolarConfigError("POLAR_WEBHOOK_SECRET")`.
   **이건 서명 실패가 아니라 서버 설정 오류다.** 403이 아니라 500으로 매핑되어야 하므로 `PolarWebhookVerificationError`와 반드시 다른 타입이어야 한다.
3. `input.headers`를 `Record<string, string>`으로 정규화한다. **`Headers` 인스턴스면 `forEach`/`entries`로 순회해 평범한 객체로 바꾸고**, 키를 전부 소문자로 낮춘다. 이 정규화를 여기서 해줘야 웹훅 라우트가 헤더 변환 실수를 할 여지가 없다.
   - 이 변환은 필수다. `standardwebhooks`는 `headers["webhook-id"]` 같은 **평범한 객체 속성 접근**을 하므로, `Headers` 인스턴스를 그대로 넘기면 모든 헤더가 `undefined`가 되어 정상 요청도 검증 실패한다. (대소문자 처리는 `standardwebhooks`가 자체적으로도 하지만, 우리도 낮춰서 계약을 단순하게 유지한다.)
4. `validateEvent(input.body, normalizedHeaders, secret)`를 호출한다.
   - **직접 HMAC을 계산하지 마라. `crypto`를 import하지 마라. secret을 손으로 base64 인코딩하지도 마라** — `validateEvent`가 내부에서 이미 한다. 한 번 더 하면 서명이 전부 실패한다.
5. 성공하면 `{ kind: "event", event }`를 반환한다.
6. `catch (error)`에서:
   - `error instanceof WebhookVerificationError`(SDK가 export하는 그 클래스)이면 → `throw new PolarWebhookVerificationError()`.
     서명 불일치와 **필수 헤더 누락** 둘 다 이 경로로 온다(`standardwebhooks`가 헤더 누락에도 `WebhookVerificationError`를 던진다). 둘 다 거부 대상이므로 같이 처리하는 게 맞다.
   - 그 외 에러이면 → **던지지 말고 `{ kind: "unsupported" }`를 반환한다.**
     이유: `validateEvent`는 **서명을 먼저 검증하고 그다음에 payload를 파싱**한다. 따라서 `WebhookVerificationError`가 아닌 에러가 나왔다는 건 "서명은 진짜인데 SDK가 모르는 이벤트 타입"이라는 뜻이다. Polar가 새 이벤트 타입을 추가할 때마다 우리가 500을 뱉으면 Polar가 무한 재시도를 하게 된다. 우리는 `subscription.active`/`uncanceled`/`revoked` 3종에만 반응하므로 나머지는 조용히 무시하는 게 옳다.
     - `SDKValidationError`를 import해서 `instanceof`로 좁히려 하지 마라. 불필요하게 SDK 내부 경로에 결합된다. "`WebhookVerificationError`가 아니면 전부 unsupported"로 충분하다.
7. `console.*`을 쓰지 않는다. **raw body, 시그니처 헤더, secret 중 어느 것도 로그·에러 메시지에 담지 않는다.**

`resolveUserId` 동작 규칙 (`_workspace/02_db-schema_polar-mapping.md` §3의 계약 — **함수 이름을 바꾸지 마라**):

- db-schema가 "스키마 변경 없음"으로 결론냈다. Polar 고객 ↔ Supabase 사용자 매핑은 **오로지 이 함수의 역참조**로만 이뤄진다. 그래서 이 함수가 이 phase 전체에서 가장 중요한 순수 함수다.
- `event.type`이 `subscription.`으로 시작하는 7종(`active`, `canceled`, `created`, `past_due`, `revoked`, `uncanceled`, `updated`)일 때만 해석을 시도한다. 그 외 이벤트는 `null`.
- 해석 우선순위 — 앞에서 값이 나오면 즉시 사용:
  1. `event.data.customer.externalId` (SDK가 zod로 파싱하며 camelCase로 변환한다 — 확인된 필드)
  2. `event.data.customer.external_id` (raw snake_case 폴백. 현 SDK 버전에서는 도달하지 않지만 **이 폴백 체인을 지우지 마라** — db-schema 규약이 명시적으로 요구한다. `Record<string, unknown>` 캐스팅 헬퍼로 안전하게 읽는다)
  3. `event.data.metadata.user_id` (0-3에서 심어 보낸 2차 폴백. `metadata` 값 타입이 `string | number | boolean`이므로 `typeof === "string"` 체크가 필요하다)
- 얻은 값이 **UUID 형식이 아니면 `null`을 반환한다.** 임의 문자열이 그대로 DB 쿼리에 들어가지 않게 하는 방어선이다. 정규식: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
  - db-schema 문서는 "uuid v4"라고 적었지만 **버전 니블(`4`)과 variant 니블을 강제하지 않는 위 일반 UUID 검증을 쓴다.** 방어 목적(임의 문자열 차단)은 동일하게 달성하면서, Supabase가 v4가 아닌 UUID를 발급하는 경우에 유효한 사용자를 잘못 버리는 위험이 없다. 이 완화는 의도적이다.
  - 빈 문자열, `"null"`, `"'; drop table"` 같은 값이 전부 `null`로 떨어져야 한다.
- **이 함수가 있는 이유:** 웹훅 라우트가 `@polar-sh/sdk` 타입을 하나도 import하지 않고도 Supabase user id를 얻게 하기 위해서다.
- 이 함수는 구독 상태를 판단하지 않는다. 상태는 `mapEventToSubscriptionStatus`가 한다.
- **원본 payload를 로그로 찍지 마라.** 고객 이메일·이름이 들어 있다.

### 0-6. `src/services/polar/index.ts` (신규) — 배럴

아래만 재export한다.

```typescript
export { createCheckoutSession } from "./checkout"
export type { CheckoutSession, CreateCheckoutSessionInput } from "./checkout"
export { resolveUserId, verifyPolarWebhook } from "./webhook"
export type { PolarWebhookEvent, VerifiedWebhook } from "./webhook"
export {
  mapEventToSubscriptionStatus,
  SUBSCRIPTION_STATUS_BY_EVENT_TYPE,
} from "./subscription-status"
export type { SubscriptionStatusUpdate } from "./subscription-status"
export { PolarApiError, PolarConfigError, PolarWebhookVerificationError } from "./errors"
```

- **`createPolarClient`는 재export하지 않는다**(0-2 참조).
- 이 프로젝트에는 `@/` 경로 alias가 없다. 상대 경로 import만 쓴다(`src/services/supabase-admin/index.ts` 참조).
- 코드 스타일은 기존 `src/services/` 파일들과 맞춘다: 세미콜론 없음, 큰따옴표, named export.

### 0-7. 테스트

**모든 테스트 파일의 확장자는 반드시 `.ts`다.** `vitest.config.ts`의 node 프로젝트가 `src/**/*.test.ts`만 잡는다. `.tsx`로 만들면 어느 프로젝트에도 걸리지 않아 **테스트가 조용히 실행되지 않는다.** 4개 파일을 만든다:

- `src/services/polar/client.test.ts`
- `src/services/polar/checkout.test.ts`
- `src/services/polar/subscription-status.test.ts`
- `src/services/polar/webhook.test.ts`

목킹 규칙 — **무엇을 목킹하고 무엇을 목킹하지 않는지가 이 step의 핵심이다:**

- **⚠️ 4개 테스트 파일 "전부"의 첫머리에 `vi.mock("server-only", () => ({}))`를 넣는다. 예외 없다.**
  `server-only`는 이 저장소에 npm 패키지로 **설치돼 있지 않다**(Next.js가 빌드 시 자체 alias로 처리하므로 `next build`/`tsc`는 통과하지만, `require.resolve("server-only")`는 실패한다). vitest는 그 alias를 모르므로 목이 없으면 파일이 **로드조차 되지 않는다**:
  ```
  Error: Failed to load url server-only (resolved id: server-only). Does the file exist?
   Test Files  1 failed (1) | Tests  no tests
  ```
  0-2의 `client.ts`와 0-5의 `webhook.ts`가 `import "server-only"`를 갖고, `checkout.ts`는 `client.ts`를, 배럴 `index.ts`는 둘 다를 끌어온다. 즉 **4개 테스트 파일 모두 직접이든 전이적이든 `server-only`에 닿는다.** 기존 `src/lib/supabase/service.test.ts`가 같은 이유로 같은 목을 쓴다.
  뒤에 나오는 "`webhook.test.ts`에서는 목킹하지 마라"는 지시는 **`@polar-sh/sdk/webhooks.js`에만 해당한다. `server-only`는 `webhook.test.ts`에서도 반드시 목킹한다.**
- **네트워크를 타는 것만 목킹한다.** `client.test.ts`와 `checkout.test.ts`는 `@polar-sh/sdk`를 목킹한다. 어떤 테스트도 실제 Polar API에 붙지 않는다.
  ```typescript
  const { checkoutsCreate, PolarCtor } = vi.hoisted(() => {
    const checkoutsCreate = vi.fn()
    return {
      checkoutsCreate,
      PolarCtor: vi.fn(() => ({ checkouts: { create: checkoutsCreate } })),
    }
  })
  vi.mock("server-only", () => ({}))
  vi.mock("@polar-sh/sdk", () => ({ Polar: PolarCtor }))
  ```
- **`webhook.test.ts`의 목은 `server-only` 하나뿐이다.** 파일 첫머리는 이렇게 시작한다:
  ```typescript
  import { Webhook } from "standardwebhooks"
  import { beforeEach, describe, expect, it, vi } from "vitest"

  vi.mock("server-only", () => ({}))

  import { PolarConfigError, PolarWebhookVerificationError } from "./errors"
  import { resolveUserId, verifyPolarWebhook } from "./webhook"
  ```
- **`webhook.test.ts`에서 `@polar-sh/sdk/webhooks.js`를 목킹하지 마라.** `validateEvent`는 네트워크를 타지 않는 로컬 암호 연산이다. 이걸 목킹하면 "서명 검증이 실제로 동작하는가"라는, 이 step에서 가장 중요한 질문을 테스트가 아무것도 검증하지 못하게 된다. 진짜 서명을 만들어 진짜 `validateEvent`에 통과시켜라.
- `webhook.test.ts`에서 유효한 서명을 만드는 방법(SDK 자체 테스트와 동일한 방식):
  ```typescript
  import { Webhook } from "standardwebhooks"

  const SECRET = "TestSecret"
  function signedHeaders(body: string, id = "msg_1", timestamp = new Date()) {
    const base64Secret = Buffer.from(SECRET, "utf-8").toString("base64")
    return {
      "webhook-id": id,
      "webhook-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
      "webhook-signature": new Webhook(base64Secret).sign(id, timestamp, body),
    }
  }
  ```
  **테스트에서만** secret을 base64로 인코딩한다는 점에 주의하라 — 프로덕션 코드는 `validateEvent`에 **원본(base64 아님) secret**을 넘긴다.
- env는 `beforeEach`에서 `process.env.X = "..."`로 세팅하고, 미설정 케이스는 `delete process.env.X`로 만든다(`src/lib/supabase/service.test.ts` 패턴).
- **웹훅 payload 픽스처는 아래를 그대로 복사해 써라. 추측으로 조립하지 마라.**
  `validateEvent`를 진짜로 통과시키려면 `Subscription` zod 스키마의 필수 필드가 **전부** 있어야 하고, 그 목록은 `.d.ts`의 `?` 표기와 일치하지 않는다(예: TS 타입상 `Date | null`인 `current_meter_period_start`·`trial_start`·`paused_at`·`resumes_at`가 실제 inbound 스키마에서는 **문자열 필수**다. `null`을 넣으면 파싱이 깨진다). 아래 픽스처는 `@polar-sh/sdk@0.49.0`에 실제로 통과시켜 **파싱 성공을 확인한 것**이다:

  ```typescript
  const NOW = "2026-08-07T00:00:00Z"
  const USER_ID = "11111111-2222-4333-8444-555555555555"

  const subscriptionActiveFixture = {
    type: "subscription.active",
    timestamp: NOW,
    data: {
      id: "sub_1", created_at: NOW, modified_at: null,
      amount: 1000, currency: "usd",
      recurring_interval: "month", recurring_interval_count: 1,
      status: "active",
      current_period_start: NOW, current_period_end: NOW,
      current_meter_period_start: NOW, current_meter_period_end: NOW,
      trial_start: NOW, trial_end: NOW,
      pause_at_period_end: false, paused_at: NOW, resumes_at: NOW,
      past_due_at: null,
      cancel_at_period_end: false, canceled_at: null,
      started_at: NOW, ends_at: null, ended_at: null,
      customer_id: "cus_1", product_id: "prod_1", discount_id: null,
      checkout_id: null,
      customer_cancellation_reason: null, customer_cancellation_comment: null,
      metadata: { user_id: USER_ID },
      customer: {
        id: "cus_1", created_at: NOW, modified_at: null,
        metadata: {}, external_id: USER_ID,
        type: "individual", billing_name: "Test User",
        email: "a@b.com", email_verified: true,
        name: null, billing_address: null, tax_id: null,
        organization_id: "org_1", deleted_at: null,
        avatar_url: "https://example.test/a.png",
      },
      product: {
        id: "prod_1", created_at: NOW, modified_at: null,
        name: "finsight Premium", description: null,
        recurring_interval: "month", recurring_interval_count: 1,
        trial_interval: "month", trial_interval_count: 0,
        meter_interval: "month", meter_interval_count: 1,
        metadata: {}, attached_custom_fields: [],
        is_recurring: true, is_archived: false, visibility: "public",
        organization_id: "org_1", prices: [], benefits: [], medias: [],
      },
      discount: null, prices: [], meters: [], pending_update: null,
    },
  }
  ```

  - 키는 **snake_case**로 쓴다. SDK가 zod로 파싱하며 camelCase로 변환해 돌려주므로, 단정은 `event.data.customer.externalId`처럼 camelCase로 한다.
  - 다른 케이스(폴백·`null` 케이스)는 이 객체를 **구조 분해로 얕게 복사해 필요한 필드만 덮어써서** 만든다. 예: `{ ...fx, data: { ...fx.data, customer: { ...fx.data.customer, external_id: null } } }`.
  - 만에 하나 파싱이 실패하면 이는 구현 버그가 아니라 픽스처 문제다. **`SDKValidationError.message`를 출력해 읽어라** — zod가 누락/불일치 필드의 `path`를 정확히 알려주므로 추측으로 반복하지 말고 그 경로만 채운다. SDK 버전이 0.49.0에서 올라간 경우에만 이런 일이 생긴다.
  - 픽스처 파일을 `src/services/polar/__fixtures__/`에 만들지 말고 **`webhook.test.ts` 안에 상수로 둔다.** `.ts` 픽스처 파일을 만들면 `src/**/*.test.ts` 패턴에 안 걸려 무해하지만, 파일 하나로 끝나는 걸 굳이 나눌 이유가 없다.
- **테스트 파일에도 실제 토큰/시크릿 값을 넣지 마라.** `.env.local`을 읽지 말고 더미 문자열(`"test-token"`, `"TestSecret"`)을 쓴다.

## Acceptance Criteria

- [ ] `package.json`의 `dependencies`에 `@polar-sh/sdk`가, `devDependencies`에 `standardwebhooks`가 추가되어 있고 `package-lock.json`이 함께 갱신됐다. 그 외 의존성은 추가·삭제·버전변경되지 않았다.
- [ ] `src/services/polar/`에 `errors.ts`, `client.ts`, `checkout.ts`, `subscription-status.ts`, `webhook.ts`, `index.ts` 6개 소스 파일과 `client.test.ts`, `checkout.test.ts`, `subscription-status.test.ts`, `webhook.test.ts` 4개 테스트 파일이 있다. **테스트 파일 확장자가 전부 `.ts`이고**, `npm run test` 출력의 테스트 파일 목록에 4개 경로가 **실제로 모두 나타난다**(파일만 만들고 실행 안 되는 상태 금지).
- [ ] (클라이언트 설정) `createPolarClient()`가 `new Polar({ accessToken: "<POLAR_ACCESS_TOKEN 값>", server: "sandbox" })`로 호출됨을 `expect(PolarCtor).toHaveBeenCalledWith(...)`로 단정하는 테스트가 통과한다. **옵션 키가 `server`이며 `environment`가 아님**을 이 단정이 보장한다.
- [ ] (프로덕션 오발사 방지 CRITICAL) `POLAR_SERVER`가 미설정일 때, 그리고 `"staging"` 같은 잘못된 값일 때 각각 `createPolarClient()`가 `PolarConfigError`를 던지고 `Polar` 생성자가 **호출되지 않음**(`expect(PolarCtor).not.toHaveBeenCalled()`)을 단정하는 테스트가 통과한다. SDK 기본값(`production`)으로 조용히 넘어가지 않는다.
- [ ] `POLAR_ACCESS_TOKEN` 미설정 시 `createPolarClient()`가 `PolarConfigError`를 던지고, 그 `error.message`에 **토큰 값이 포함되지 않고 변수 이름만** 들어 있음을 단정하는 테스트가 통과한다.
- [ ] (체크아웃 payload) `createCheckoutSession({ userId: "user-1", email: "a@b.com" })` 호출 시 `polar.checkouts.create`가 정확히 다음을 포함해 호출됨을 단정하는 테스트가 통과한다 — `products: ["<POLAR_PRODUCT_ID>"]`, `successUrl: "<NEXT_PUBLIC_APP_URL>/dashboard?checkout=success"`, `externalCustomerId: "user-1"`, `metadata: { user_id: "user-1" }`, `customerEmail: "a@b.com"`. **metadata 키가 `user_id`임**(`supabase_user_id`가 아님)을 이 단정이 고정한다 — db-schema 매핑 규약 §2.
- [ ] `NEXT_PUBLIC_APP_URL`이 `"http://localhost:3000/"`처럼 끝 슬래시를 가질 때도 `successUrl`이 `"http://localhost:3000/dashboard?checkout=success"`(슬래시 2개 아님)임을 단정하는 테스트가 통과한다.
- [ ] `email`이 `undefined`일 때와 `null`일 때 모두, `checkouts.create`에 넘어간 객체에 `customerEmail` **키가 존재하지 않음**(`expect(payload).not.toHaveProperty("customerEmail")`)을 단정하는 테스트가 통과한다.
- [ ] `createCheckoutSession`이 `{ checkoutId, url }` **두 필드만** 반환하고, SDK가 돌려준 `clientSecret`이나 그 외 필드가 반환값에 포함되지 않음을 `toEqual`로 단정하는 테스트가 통과한다.
- [ ] `polar.checkouts.create`가 reject할 때 `createCheckoutSession`이 `PolarApiError`를 던지고, 던져진 에러의 `message`에 SDK 원본 에러 메시지와 액세스 토큰 문자열이 **포함되지 않음**을 단정하는 테스트가 통과한다.
- [ ] `POLAR_PRODUCT_ID` 미설정, `NEXT_PUBLIC_APP_URL` 미설정 각각에 대해 `PolarConfigError`가 던져지고 `checkouts.create`가 **호출되지 않음**을 단정하는 테스트가 통과한다.
- [ ] (상태 매핑 — 두텁게) `mapEventToSubscriptionStatus`에 대해 `it.each`로 다음 **전부**를 단정하는 테스트가 통과한다: `subscription.active`→`"active"`, `subscription.uncanceled`→`"active"`, `subscription.revoked`→`"inactive"`, 그리고 `subscription.created`/`subscription.updated`/`order.paid`/`checkout.created`/`customer.created`/`""`/`"subscription.ACTIVE"`(대문자)/`"unknown.event"` → 전부 `null`.
- [ ] (ADR-006 회귀 방지선 CRITICAL) **`mapEventToSubscriptionStatus("subscription.canceled")`와 `mapEventToSubscriptionStatus("subscription.past_due")`가 각각 `null`을 반환**함을 단정하는 **독립된 테스트 케이스**가 있고, 그 테스트에 "ADR-006: 취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지한다 — 구독 해제는 `subscription.revoked`로만 일어난다"는 취지의 주석 또는 `it(...)` 설명 문구가 붙어 있다. **`"inactive"`를 기대하는 단정이 있으면 안 된다.** (이 두 케이스를 `it.each`의 "그 외 → null" 목록에 섞어 넣지 말고, 왜 무시하는지가 드러나도록 별도로 둔다.)
- [ ] `SUBSCRIPTION_STATUS_BY_EVENT_TYPE` 상수가 배럴에서 export되고, 키가 **정확히 3개**(`subscription.active`, `subscription.revoked`, `subscription.uncanceled`)임을 `expect(Object.keys(...).sort()).toEqual(["subscription.active","subscription.revoked","subscription.uncanceled"])`로 단정하는 테스트가 통과한다. `subscription.canceled`/`subscription.past_due`가 이 상수의 키로 **존재하지 않음**이 이 단정으로 고정된다(웹훅 step의 테스트가 이 상수를 직접 검증할 수 있어야 한다 — db-schema 매핑 규약 §4).
- [ ] (서명 검증 — 유효) 실제 `standardwebhooks`로 서명한 `subscription.active` body를 `verifyPolarWebhook`에 넘겼을 때 `{ kind: "event" }`가 반환되고 `result.event.type === "subscription.active"`임을 단정하는 테스트가 통과한다. **이 테스트에서 `@polar-sh/sdk/webhooks.js`가 목킹되지 않았다**(파일 내에 그 경로에 대한 `vi.mock`이 없음을 확인).
- [ ] (서명 검증 — 변조) 서명 생성 후 body를 한 글자라도 바꾼 요청, 그리고 다른 secret으로 서명한 요청 각각에 대해 `verifyPolarWebhook`이 **`PolarWebhookVerificationError`를 던짐**을 단정하는 테스트가 통과한다.
- [ ] (서명 검증 — 헤더 누락) `webhook-signature` 헤더가 없는 요청, 헤더 객체가 완전히 비어 있는(`{}`) 요청 각각에 대해 `PolarWebhookVerificationError`가 던져짐을 단정하는 테스트가 통과한다.
- [ ] (헤더 형태 내성) ① 헤더 키를 `"Webhook-Id"`/`"Webhook-Timestamp"`/`"Webhook-Signature"`(대문자 섞임)로 준 경우, ② **`new Headers({...})` 인스턴스로 준 경우** 모두 정상적으로 `{ kind: "event" }`가 나오는 테스트가 통과한다. ②가 이 AC의 핵심이다 — `Headers`를 평범한 객체로 변환하지 않으면 정상 요청도 서명 검증에 실패한다.
- [ ] (설정 오류 ≠ 서명 실패 CRITICAL) `POLAR_WEBHOOK_SECRET` 미설정 시 `verifyPolarWebhook`이 던지는 에러가 `PolarConfigError`이고 **`PolarWebhookVerificationError`가 아님**을 단정하는 테스트가 통과한다(`expect(err).not.toBeInstanceOf(PolarWebhookVerificationError)`). 두 에러 클래스가 서로 `instanceof`로 구분 가능하다.
- [ ] (알 수 없는 이벤트) 유효하게 서명됐지만 `{"type":"unknown.event","data":{}}`인 body에 대해 `verifyPolarWebhook`이 **던지지 않고** `{ kind: "unsupported" }`를 반환함을 단정하는 테스트가 통과한다.
- [ ] (user_id 역참조 — 이 phase의 매핑이 전적으로 여기 달려 있다) 서명 검증을 통과한 `subscription.active` 이벤트에 대해 `resolveUserId`가 다음을 만족하는 테스트가 모두 통과한다:
  - ① `data.customer.external_id`가 UUID일 때 그 값을 반환한다.
  - ② `data.customer.external_id`가 `null`이고 `data.metadata.user_id`가 UUID 문자열일 때 그 값으로 폴백한다.
  - ③ 둘 다 없을 때 `null`을 반환한다.
  - ④ `data.metadata.user_id`가 숫자(`12345`)일 때 `null`을 반환한다(문자열 아님).
  - ⑤ `external_id`가 `"not-a-uuid"`, `""`, `"'; drop table subscriptions; --"`일 때 각각 `null`을 반환한다(UUID 형식 검증).
  - ⑥ `checkout.created` 등 `subscription.*`이 아닌 이벤트에 대해 `null`을 반환한다.
- [ ] (수동 HMAC 금지 CRITICAL) `src/services/polar/` 아래 **테스트가 아닌** 파일에 `require("crypto")`/`from "crypto"`/`from "node:crypto"`, `createHmac`, `standardwebhooks` 문자열이 **0건**임을 grep으로 확인한다. 서명 검증은 전적으로 SDK의 `validateEvent`가 수행한다.
- [ ] (secret 이중 인코딩 금지) `src/services/polar/webhook.ts`에 `toString("base64")` 또는 `Buffer.from(secret` 패턴이 **0건**이다. `validateEvent`에 넘기는 secret은 `process.env.POLAR_WEBHOOK_SECRET` 원본 문자열 그대로다.
- [ ] (로그 유출 방지 CRITICAL) `src/services/polar/` 아래 **모든** 파일(테스트 포함)에 `console.` 호출이 **0건**임을 grep으로 확인한다. 픽스처를 디버깅하느라 잠시 넣었더라도 최종 커밋에는 남기지 않는다. raw body·서명 헤더·`POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET` 값이 로그나 throw되는 에러 메시지에 담기지 않는다.
- [ ] (서버 전용 CRITICAL) `grep -rn "NEXT_PUBLIC_POLAR" src/`가 **0건**이고, `grep -rln "POLAR_ACCESS_TOKEN\|POLAR_WEBHOOK_SECRET\|POLAR_PRODUCT_ID" src/`의 결과가 **`src/services/polar/` 아래 파일뿐**임을 확인한다. `src/components/` 아래 어떤 파일도 `services/polar`를 import하지 않는다.
  - **검색 범위를 `src/`로 한정하는 것이 이 AC의 일부다.** 저장소 전체로 넓히면 `.env.example`·`_workspace/*`·`phases/*`(이 step 파일 자신 포함)가 잡힌다. 환경변수 **이름**이 설정 예시와 계획 문서에 적혀 있는 것은 정상이며 **값**이 아니다. 이 히트를 "고치려고" `.env.example`을 건드리지 마라 — 아래 `.env.example` 무수정 AC와 정면으로 충돌한다.
- [ ] (`server-only` 방어) `src/services/polar/client.ts`와 `src/services/polar/webhook.ts` 첫 줄에 `import "server-only"`가 있다.
- [ ] (테스트 로드 보장) `grep -c 'vi.mock("server-only"' src/services/polar/*.test.ts`가 **4개 파일 모두 1 이상**이다. `npm run test` 출력에 `Failed to load url server-only`가 **0건**이고, 4개 테스트 파일 중 `Tests  no tests`로 끝나는 파일이 하나도 없다.
- [ ] (경계 CRITICAL) `@polar-sh/sdk`를 import하는 파일이 `src/services/polar/` 안에만 존재함을 `grep -rn "@polar-sh/sdk" src/`로 확인한다. `src/app/`·`src/components/`·`src/lib/`에는 0건이다.
- [ ] (배럴) `src/services/polar/index.ts`가 `createPolarClient`를 재export하지 **않는다**. `grep -n "createPolarClient" src/services/polar/index.ts` 결과가 0건이다.
- [ ] (범위 유지) `src/app/` 아래 파일이 **하나도 수정되지 않았다**(`git diff --name-only`로 확인). `src/app/api/webhooks/polar/route.ts`는 여전히 501 스텁 그대로다. `src/lib/`, `src/components/`, `src/services/supabase-admin/`, `supabase/migrations/`도 이 step에서 수정되지 않는다(구독 upsert 헬퍼는 웹훅 라우트 step의 범위다).
- [ ] `.env.example`에 **새 키를 추가하지 않았다.** Polar 5개 키(`POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_ID`, `POLAR_SERVER`, `NEXT_PUBLIC_APP_URL`)가 이미 문서화돼 있다. `vitest.config.ts`, `tsconfig.json`, `next.config.ts`도 수정되지 않았다.
- [ ] (env는 런타임에 읽는다) `src/services/polar/` 소스 파일들에서 `process.env` 접근이 모두 함수 본문 안에 있고 모듈 최상단 상수로 캐싱되지 않았음을 확인한다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 **기존 테스트가 하나도 깨지지 않는다.**
