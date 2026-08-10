# Step 1: `POST /api/checkout` — Polar Hosted Checkout 세션 발급 라우트

## 배경

step 0에서 `src/services/polar/`가 만들어졌다. 이 step은 그 서비스를 소비하는 **첫 라우트**를 만든다. 지금 저장소에 `src/app/api/checkout/`은 존재하지 않는다(신규 디렉토리).

이 라우트가 하는 일은 하나다: **로그인한 사용자를 위해 Polar Hosted Checkout URL을 만들어 돌려준다.** 실제 구독 상태 갱신은 이 라우트가 하지 않는다 — 결제가 끝나면 Polar이 `/api/webhooks/polar`로 이벤트를 보내고, 그 라우트(step 2)가 `subscriptions`를 갱신한다. **이 라우트는 DB에 아무것도 쓰지 않는다.**

`src/components/PremiumSection.tsx`의 업그레이드 CTA를 이 엔드포인트에 연결하는 것은 **step 3(frontend)의 범위**다. 이 step에서 `src/components/` 아래를 건드리지 마라.

**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

### step 0이 이미 제공하는 것 (이 계약을 그대로 쓴다 — 추측하지 마라)

`src/services/polar/index.ts` 배럴이 export하는 것 중 이 step이 쓰는 것:

```typescript
export type CreateCheckoutSessionInput = {
  userId: string          // Supabase auth user.id → Polar externalCustomerId
  email?: string | null   // 없으면 Polar가 체크아웃 화면에서 직접 수집
}

export type CheckoutSession = {
  checkoutId: string
  url: string             // Hosted Checkout URL
}

export function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSession>

export class PolarApiError extends Error { readonly code = "POLAR_API_ERROR" }
export class PolarConfigError extends Error { readonly code = "POLAR_CONFIG_ERROR" }
```

서비스가 **이미 대신 처리하므로 라우트가 다시 하지 마라:**

- `POLAR_PRODUCT_ID`, `POLAR_SERVER`, `POLAR_ACCESS_TOKEN`, `NEXT_PUBLIC_APP_URL` 읽기와 유효성 검사
- `successUrl = ${NEXT_PUBLIC_APP_URL}/dashboard?checkout=success` 생성(끝 슬래시 정규화 포함). **cancel URL은 만들지 않는다** — 취소/이탈 복귀는 Polar 기본 동작에 맡긴다.
- `externalCustomerId: userId` + `metadata: { user_id: userId }` 동시 기입
- SDK 응답에서 `clientSecret` 등 민감 필드 제거

**라우트는 Polar 타입을 하나도 몰라도 된다.** 라우트가 `@polar-sh/sdk`를 직접 import하는 것은 금지다(CLAUDE.md CRITICAL: "외부 API 호출(Claude, Supabase, Polar)은 `src/services/`를 통해서만 수행한다"). `createPolarClient()`는 배럴에서 재export되지 않으므로 애초에 접근할 수도 없다.

### 기존 라우트에서 세션을 얻는 방식 (그대로 따른다)

`src/lib/supabase/server.ts`가 export하는 세션 기반(RLS 적용) 읽기 함수를 쓴다. 새 방법을 발명하지 마라.

```typescript
export async function getSessionUser(): Promise<User | null>
export async function getSubscriptionStatus(userId: string): Promise<"active" | "inactive">
```

`src/app/api/reports/[analysisId]/[reportType]/route.ts`가 이미 이 두 함수를 쓰고 있다. `getSessionUser()`가 돌려주는 `User`에는 `id: string`과 `email?: string`이 있다.

이 프로젝트에는 `@/` 경로 alias가 없다. **상대 경로 import만 쓴다.** `src/app/api/checkout/route.ts` 기준으로:

```typescript
import { getSessionUser, getSubscriptionStatus } from "../../../lib/supabase/server"
import { createCheckoutSession, PolarApiError } from "../../../services/polar"
```

## 작업

### 1-1. `src/app/api/checkout/route.ts` (신규)

```typescript
export async function POST(request: Request): Promise<NextResponse>
```

**`POST`만 export한다.** `GET`/`PUT`/`DELETE`를 export하지 않는다 — 링크 프리페치나 주소창 접근만으로 Polar 체크아웃 세션이 생성되면 안 된다. Next.js가 정의되지 않은 메서드에 405를 자동 반환한다.

동작 순서. **이 순서를 바꾸지 마라.** 각 단계에서 거부되면 다음 단계의 함수는 호출되지 않아야 한다.

**① 동일 출처 확인**

`Origin` 헤더가 존재하고 그 값이 `new URL(request.url).origin`과 다르면, `getSessionUser`를 **호출하지 않고** 즉시 `403 { code: "FORBIDDEN" }`을 반환한다. `Origin` 헤더가 아예 없으면 통과시킨다(비브라우저 클라이언트).

`src/app/api/auth/signout/route.ts`가 쓰는 것과 같은 방어다:

```typescript
const requestOrigin = new URL(request.url).origin
const origin = request.headers.get("origin")
if (origin !== null && origin !== requestOrigin) { /* 403 */ }
```

**왜 필요한가:** 상태를 바꾸는 POST이고, 외부 사이트가 로그인된 사용자의 브라우저로 이 엔드포인트를 치게 만들면 사용자 명의의 Polar 체크아웃 세션이 만들어진다. Supabase 세션 쿠키가 기본 `SameSite=Lax`라 교차 사이트 POST에는 애초에 쿠키가 실리지 않지만, signout 라우트의 선례대로 방어를 코드에 명시적으로 남긴다.

signout은 `new NextResponse(null, { status: 403 })`으로 빈 본문을 돌려주지만, **이 라우트는 `{ code: "FORBIDDEN" }` JSON을 돌려준다.** 이 엔드포인트는 프론트가 `fetch`로 호출하고 `code`로 분기하는 JSON API이므로, 다른 에러들과 형식을 통일한다.

**② 세션 확인**

`const user = await getSessionUser()`. `null`이면 `401 { code: "UNAUTHORIZED" }`. 이때 `getSubscriptionStatus`와 `createCheckoutSession`은 호출되지 않는다.

**③ 이미 구독 중인 사용자 차단 (중복 결제 방지)**

`const status = await getSubscriptionStatus(user.id)`. `"active"`이면 `createCheckoutSession`을 **호출하지 않고** `409 { code: "ALREADY_SUBSCRIBED" }`를 반환한다.

**왜 허용이 아니라 차단인가 (이 결정을 뒤집지 마라):**

- MVP는 **단일 상품·단일 티어**다(scope 문서 "범위 밖": 다중 티어·트라이얼·쿠폰 없음). 이미 구독 중인 사용자가 살 수 있는 다른 것이 없으므로, 두 번째 체크아웃은 **같은 상품의 중복 구독 = 이중 청구**밖에 되지 않는다.
- 우리 스키마는 `subscriptions.user_id`가 **unique(사용자당 1행)** 이고 `status`가 `'active' | 'inactive'` 2값뿐이다. 한 사용자에게 활성 구독이 2개 생기면 두 구독의 웹훅이 같은 행 하나를 두고 싸운다 — 구독 A의 `subscription.revoked`가 아직 유효한 구독 B를 `'inactive'`로 만든다. **표현할 수 없는 상태를 애초에 만들지 않는다.**
- 이 phase에는 청구서·구독 취소·환불 UI가 없다(scope "범위 밖"). 사용자가 이중 결제를 스스로 되돌릴 방법이 없다.
- 실패 방향이 안전하다: 차단해서 생기는 최악은 "구독자가 결제 버튼을 눌렀는데 안 눌린다"이고, 허용해서 생기는 최악은 "돈 낸 고객에게 또 청구한다"이다.

**알려진 한계(의도적으로 감수 — 고치지 마라):** `subscription.canceled`(해지 예약)와 `subscription.past_due`(결제 재시도 중) 상태의 사용자도 우리 DB에서는 여전히 `'active'`이므로 이 분기에 걸려 재구독이 막힌다. 그들은 아직 Premium 접근권을 갖고 있으므로 손해가 없고, 실제로 접근이 끝나면(`subscription.revoked` → `'inactive'`) 다시 결제할 수 있다. 이건 ADR-006의 "취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지한다"와 정합한 동작이다.

**④ 체크아웃 세션 생성**

```typescript
const session = await createCheckoutSession({
  userId: user.id,
  email: user.email ?? null,
})
```

**`userId`는 반드시 `getSessionUser()`가 돌려준 서버 세션의 `user.id`다.** 요청 본문·쿼리스트링·헤더에서 받은 값을 쓰지 마라. **받지도 마라.**

- 이 라우트는 **요청 본문을 읽지 않는다.** `request.json()`, `request.text()`, `request.formData()`, `new URL(request.url).searchParams`를 호출하지 않는다. 필요한 정보가 세션에 전부 있으므로 읽을 이유가 없고, 읽지 않는 것이 가장 확실한 방어다.
- **왜 CRITICAL인가:** 본문의 `user_id`를 그대로 `externalCustomerId`로 실어 보내면, 공격자가 임의의 uuid를 넣어 **타인 명의의 구독을 만들 수 있다.** 웹훅은 `externalCustomerId`를 그대로 믿고 그 사용자의 `subscriptions.status`를 `'active'`로 올린다(step 2). 즉 아무나 남의 계정에 구독을 붙이거나, 자기가 결제한 구독을 남의 계정으로 흘려보낼 수 있다. `src/services/polar/`는 넘겨받은 `userId`의 출처를 검사할 방법이 없으므로, **이 방어선은 오직 이 라우트에만 있다.**
- `user.email`이 `undefined`면 `null`을 넘긴다. 서비스가 알아서 `customerEmail` 키를 payload에서 뺀다.

**⑤ 응답**

성공 시 **`200 { url: session.url }`**. 정확히 이 한 필드만 반환한다.

- `checkoutId`를 응답에 포함하지 마라. db-schema 매핑 규약이 "라우트가 클라이언트에 돌려주는 것은 체크아웃 URL 하나뿐이다"로 확정했고, frontend(step 3)는 `{ url: string }`을 가정하고 작성 중이다.
- `session` 객체를 통째로 `NextResponse.json(session)`으로 돌려주지 마라. 필드를 명시적으로 골라 담는다.

**⑥ 에러 매핑**

`createCheckoutSession` 호출을 `try/catch`로 감싼다:

| 던져진 에러 | HTTP | body |
|---|---|---|
| `PolarApiError` (Polar API 호출 실패) | **502** | `{ "code": "CHECKOUT_FAILED" }` |
| `PolarConfigError` (환경변수 미설정 = 서버 오설정) | **500** | `{ "code": "INTERNAL_ERROR" }` |
| 그 외 예상치 못한 에러 | **500** | `{ "code": "INTERNAL_ERROR" }` |

- **`GENERATION_FAILED`를 재사용하지 마라.** 그 코드는 LLM 리포트 생성 실패 전용이고, 프론트가 "인사이트를 만들지 못했습니다" 계열 문구로 분기한다. 결제 실패에 그 문구가 뜨면 오진이다. **`CHECKOUT_FAILED`를 신설해 쓴다**(에러 코드 표에 결제용 코드가 없었다 — 이 step에서 확정된 신규 코드다).
- `PolarConfigError`가 500인 이유: 서버가 잘못 설정된 것이지 Polar이나 사용자 잘못이 아니다. 502로 뭉개면 "Polar이 장애"로 오진된다.
- **`error.message`를 응답 본문에 담지 마라.** 반환하는 것은 `{ code }` 하나뿐이다. Polar SDK 에러 메시지에는 요청 헤더·응답 본문이 담길 수 있어 `POLAR_ACCESS_TOKEN` 유출 경로가 된다.
- 분기는 `instanceof PolarApiError`로 한다(배럴이 클래스를 export한다). `error.code === "POLAR_API_ERROR"` 문자열 비교도 동작하지만 `instanceof`를 쓴다.

**⑦ 로그 금지**

`console.*`을 쓰지 않는다. 액세스 토큰, 사용자 이메일, 체크아웃 URL 어느 것도 로그로 남기지 않는다.

`export const runtime`/`export const dynamic` 같은 라우트 세그먼트 설정을 추가하지 마라. 이 저장소의 다른 라우트가 쓰지 않고, 기본값(nodejs)이 맞다.

### 1-2. 테스트 — `src/app/api/checkout/route.test.ts` (신규)

**파일 확장자는 반드시 `.ts`다.** `vitest.config.ts`의 node 프로젝트가 `src/**/*.test.ts`만 잡는다. `.tsx`로 만들면 어느 프로젝트에도 걸리지 않아 **테스트가 조용히 실행되지 않는다.**

목킹은 `src/app/api/reports/[analysisId]/[reportType]/route.test.ts`의 `vi.hoisted` + `vi.mock` 스타일을 그대로 따른다. **실제 Supabase·Polar에 접속하지 않는다.**

```typescript
const {
  createCheckoutSession,
  getSessionUser,
  getSubscriptionStatus,
  PolarApiError,
  PolarConfigError,
} = vi.hoisted(() => {
  class PolarApiError extends Error {}
  class PolarConfigError extends Error {}
  return {
    createCheckoutSession: vi.fn(),
    getSessionUser: vi.fn(),
    getSubscriptionStatus: vi.fn(),
    PolarApiError,
    PolarConfigError,
  }
})

vi.mock("../../../lib/supabase/server", () => ({ getSessionUser, getSubscriptionStatus }))
vi.mock("../../../services/polar", () => ({
  createCheckoutSession,
  PolarApiError,
  PolarConfigError,
}))
```

- **⚠️ 에러 클래스를 `vi.hoisted` 콜백 *안에서* 선언해야 한다. 모듈 최상위에 `class PolarApiError extends Error {}`를 두고 `vi.mock` 팩토리에서 참조하면 반드시 죽는다.** `vi.mock` 호출은 파일 최상단으로 호이스팅되어 `class` 선언보다 **먼저** 실행되므로 `ReferenceError: Cannot access 'PolarApiError' before initialization`이 나고, 그러면 **테스트 0개로 파일 전체가 로드 실패**한다(`Test Files 1 failed | Tests no tests`). 파일만 존재하고 조용히 실행되지 않는 상태가 되어 아래 AC를 하나도 판정할 수 없다. `vi.hoisted`의 반환값은 `vi.mock` 팩토리보다 먼저 평가되므로 위 패턴은 안전하다.
- 위 구조 덕분에 **테스트 본문에서도 같은 클래스를 그대로 쓸 수 있다.** 라우트가 목킹된 모듈에서 import하는 클래스와 테스트가 던지는 인스턴스가 **동일한 클래스 객체**이므로 `instanceof` 분기가 정상 검증된다: `createCheckoutSession.mockRejectedValue(new PolarApiError("boom"))`.
- `vi.importActual`로 실제 `src/services/polar`를 부분 로드하지 마라 — `server-only`가 이 저장소에 npm 패키지로 설치돼 있지 않아(Next가 빌드 시 alias로 처리) vitest에서 해석 자체가 실패한다.
- `vi.mock`의 경로 문자열은 **`route.ts`가 실제로 쓰는 import 경로와 정확히 같아야** 목킹이 걸린다(`../../../lib/supabase/server`, `../../../services/polar`).
- `beforeEach`에서 `getSessionUser → { id: "user-1", email: "a@b.com" }`, `getSubscriptionStatus → "inactive"`, `createCheckoutSession → { checkoutId: "co_1", url: "https://sandbox.polar.sh/checkout/co_1" }`로 기본값을 세팅한다.
- 요청 헬퍼:
  ```typescript
  function request(init?: { origin?: string; body?: string }) {
    return new Request("https://finsight.test/api/checkout", {
      method: "POST",
      headers: init?.origin === undefined ? undefined : { Origin: init.origin },
      body: init?.body,
    })
  }
  ```

## Acceptance Criteria

- [ ] `src/app/api/checkout/route.ts`와 `src/app/api/checkout/route.test.ts`가 존재하고, **테스트 파일 확장자가 `.ts`이며**, `npm run test` 출력에서 `src/app/api/checkout/route.test.ts`가 **실제로 실행되어 1개 이상의 테스트가 통과한다.** 파일 목록에 이름만 뜨고 `Tests no tests`이거나 모듈 로드 단계에서 실패(`ReferenceError`/`Failed to load url`)하는 상태는 **불합격**이다.
- [ ] (목 호이스팅 함정) `src/app/api/checkout/route.test.ts`에 **모듈 최상위 레벨의 `class ... extends Error` 선언이 0건**이고, `PolarApiError`/`PolarConfigError`가 `vi.hoisted(() => { ... })` 콜백 안에서 선언되어 반환됨을 코드로 확인한다. `vi.mock` 팩토리가 참조하는 모든 식별자가 `vi.hoisted`의 반환값에서 온다.
- [ ] `route.ts`가 `POST`만 export하고 `GET`/`PUT`/`PATCH`/`DELETE` export가 **0건**임을 grep으로 확인한다.
- [ ] (정상 경로) 미구독 사용자가 호출하면 응답이 **200**이고 본문이 `{ url: "https://sandbox.polar.sh/checkout/co_1" }`임을 **`toEqual`로** 단정하는 테스트가 통과한다. `toEqual`이므로 `checkoutId`나 그 외 필드가 응답에 섞여 있으면 실패한다.
- [ ] (세션 유래 userId CRITICAL) 세션 사용자가 `{ id: "user-1", email: "a@b.com" }`인 상태에서 요청 본문에 `'{"user_id":"00000000-0000-0000-0000-0000000000ff","userId":"00000000-0000-0000-0000-0000000000ff"}'`를 실어 POST해도, `createCheckoutSession`이 **정확히 `{ userId: "user-1", email: "a@b.com" }`으로** 호출됨을 `toHaveBeenCalledWith`로 단정하는 테스트가 통과한다. 응답은 200이고, 본문의 uuid는 어디에도 사용되지 않는다.
- [ ] (요청 본문을 아예 읽지 않음) `src/app/api/checkout/route.ts`에 `request.json`, `request.text`, `request.formData`, `searchParams`, `req.body` 문자열이 **각각 0건**임을 grep으로 확인한다.
- [ ] `user.email`이 `undefined`일 때 `createCheckoutSession`이 `{ userId: "user-1", email: null }`로 호출됨을 단정하는 테스트가 통과한다(`undefined`가 그대로 넘어가지 않는다).
- [ ] (401) `getSessionUser`가 `null`을 반환할 때 응답이 **401 `{ code: "UNAUTHORIZED" }`** 이고, `getSubscriptionStatus`와 `createCheckoutSession`이 **호출되지 않음**(`not.toHaveBeenCalled()`)을 단정하는 테스트가 통과한다.
- [ ] (중복 결제 방지 CRITICAL) `getSubscriptionStatus`가 `"active"`를 반환할 때 응답이 **409 `{ code: "ALREADY_SUBSCRIBED" }`** 이고, `createCheckoutSession`이 **호출되지 않음**(`expect(createCheckoutSession).not.toHaveBeenCalled()`)을 단정하는 테스트가 통과한다. `getSubscriptionStatus`가 `user.id`(`"user-1"`)로 호출됐음도 함께 단정한다.
- [ ] (검사 순서) 정상 경로 테스트에서 `getSessionUser` → `getSubscriptionStatus` → `createCheckoutSession` 순으로 호출됨을 `mock.invocationCallOrder` 비교로 단정하는 테스트가 통과한다. 구독 확인이 체크아웃 생성보다 **먼저** 일어난다.
- [ ] (동일 출처) `Origin: https://evil.test`로 호출하면 응답이 **403 `{ code: "FORBIDDEN" }`** 이고 `getSessionUser`·`createCheckoutSession`이 **모두 호출되지 않음**을 단정하는 테스트가 통과한다.
- [ ] (동일 출처 통과) `Origin: https://finsight.test`(요청 URL과 같은 오리진)일 때와 `Origin` 헤더가 **아예 없을 때** 모두 200이 반환되는 테스트가 통과한다.
- [ ] (502 CHECKOUT_FAILED) `createCheckoutSession`이 `PolarApiError`로 reject할 때 응답이 **502 `{ code: "CHECKOUT_FAILED" }`** 임을 단정하는 테스트가 통과한다. 응답 본문 문자열에 던져진 에러의 `message`가 **포함되지 않음**을 `await expect(response.text()).resolves.not.toContain(...)`로 함께 단정한다.
- [ ] (GENERATION_FAILED 재사용 금지) `src/app/api/checkout/route.ts`에 `GENERATION_FAILED` 문자열이 **0건**임을 grep으로 확인한다.
- [ ] (500 INTERNAL_ERROR) `createCheckoutSession`이 `PolarConfigError`로 reject할 때, 그리고 평범한 `new Error("boom")`으로 reject할 때 각각 응답이 **500 `{ code: "INTERNAL_ERROR" }`** 이고 예외가 라우트 밖으로 던져지지 않음을 단정하는 테스트가 통과한다. `PolarConfigError`가 403이나 502로 매핑되지 않는다.
- [ ] (서비스 경계 CRITICAL) `src/app/api/checkout/route.ts`에 `@polar-sh/sdk` 문자열이 **0건**이다. Polar 호출은 전부 `../../../services/polar` 배럴 경유다. `grep -rn "@polar-sh/sdk" src/app/`의 결과가 **0건**이다.
- [ ] (service-role 미사용 CRITICAL) `src/app/api/checkout/route.ts`에 `SUPABASE_SERVICE_ROLE_KEY`, `lib/supabase/service`, `services/supabase-admin`, `@supabase/supabase-js` 참조가 **0건**이다. 이 라우트는 DB에 아무것도 쓰지 않는다.
- [ ] (환경변수 재읽기 금지) `src/app/api/checkout/route.ts`에 `process.env` 접근이 **0건**이다. `POLAR_*`와 `NEXT_PUBLIC_APP_URL`은 전부 `src/services/polar/`가 읽는다.
- [ ] (로그 유출 방지 CRITICAL) `src/app/api/checkout/route.ts`에 `console.` 호출이 **0건**임을 grep으로 확인한다.
- [ ] (범위 유지) 이 step에서 **네가 새로 추가한 파일은 `src/app/api/checkout/route.ts`와 `src/app/api/checkout/route.test.ts` 2개뿐**이고, `src/services/`, `src/lib/`, `src/components/`, `src/middleware.ts`, `supabase/migrations/`, `src/types/`, `.env.example`, `package.json` 아래 파일은 **하나도 편집하지 않았다.** `src/app/api/webhooks/polar/route.ts`는 이 step에서도 **여전히 501 스텁 그대로**다(교체는 다음 step).
  - `git status`에 이 step 이전부터 존재하던 미커밋 변경(예: `.env.example`, `.mcp.json`)이 보일 수 있다. **그건 네가 만든 것이 아니므로 되돌리거나 커밋에 끌어들이지 마라.** 판단 기준은 "네가 이 step에서 편집했는가"다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 **기존 테스트가 하나도 깨지지 않는다.**
