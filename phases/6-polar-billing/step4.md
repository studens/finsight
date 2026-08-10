# Step 4: 지원 이벤트의 파싱 실패를 200으로 삼키지 않도록 웹훅 검증 분류 수정

## 배경

step 0~3은 이미 실행 완료됐다. 이 step은 그중 `src/services/polar/webhook.ts`에서 발견된 **결제 누락 버그 하나**만 고친다. 기능 추가가 아니다.

### 지금 무슨 일이 일어나는가

`verifyPolarWebhook`의 현재 `catch`는 이렇게 되어 있다:

```typescript
} catch (error) {
  if (error instanceof WebhookVerificationError) {
    throw new PolarWebhookVerificationError()
  }
  return { kind: "unsupported" }     // ← 나머지를 전부 여기로 흡수한다
}
```

이 코드는 "`WebhookVerificationError`가 아닌 에러 = 서명은 진짜인데 우리가 모르는 이벤트 타입"이라는 전제로 짜였다. **그 전제가 틀렸다.** SDK는 두 가지 완전히 다른 상황을 **똑같은 `SDKValidationError`로** 던진다. `@polar-sh/sdk@0.49.0`으로 실제 재현한 결과다:

| 유효 서명 + 이 body | SDK가 던지는 것 |
|---|---|
| `{"type":"subscription.active","data":{"id":"sub_1"}}` (**우리가 처리하는 타입**, `data`가 불완전) | `SDKValidationError` |
| `{"type":"unknown.event","data":{}}` (모르는 타입) | `SDKValidationError` |

둘의 클래스가 같으므로 현재 코드는 구별하지 못하고 **둘 다 `{ kind: "unsupported" }`** 를 반환한다. 라우트는 그걸 받아 `200 { received: true, ignored: "unhandled_event" }`를 돌려준다.

그 결과 첫 번째 줄에서 이런 일이 벌어진다:

1. 사용자가 결제한다 → Polar가 `subscription.active` 웹훅을 보낸다
2. 어떤 이유로든 payload가 우리 SDK 버전의 스키마와 안 맞는다(Polar의 필드 추가/변경, 전송 중 잘림 등)
3. 우리는 **200으로 "잘 처리했다"고 응답**한다
4. Polar는 성공으로 간주하고 **재시도하지 않는다**
5. `subscriptions.status`는 `'inactive'`로 남는다 → **돈은 냈는데 Premium이 안 열린다**
6. `console.` 0건 규칙 때문에 **로그에도 아무 흔적이 없다**

### 왜 5xx인가

이 프로젝트는 `src/services/polar/` 전체에 `console.` 0건을 강제한다(토큰·raw body 유출 방지). 그래서 "로그를 남긴다"는 선택지가 없다. **응답 코드가 유일한 관측 채널이다.**

- **5xx를 반환하면** Polar가 지수 백오프로 재시도한다. 일시적 원인(전송 중 잘림 등)이면 자동 복구된다.
- 재시도가 다 실패해도 **Polar 대시보드의 전달 로그(delivery log)에 실패로 남는다.** `console.` 없이도 사람이 발견할 수 있는 지점이 생긴다.
- 반대로 200은 그 이벤트를 **영구히, 조용히 폐기**한다. 되찾을 방법이 없다.

### 왜 "모르는 이벤트"는 여전히 200이어야 하는가

Polar는 앞으로도 새 이벤트 타입을 계속 추가한다. 우리가 모르는 타입마다 5xx를 뱉으면 Polar가 그 이벤트를 10여 회 재시도하다 엔드포인트를 실패 상태로 표시한다. **모르는 이벤트는 무시가 정답이다.** 그래서 이 step의 핵심은 "전부 5xx"가 아니라 **둘을 구별하는 것**이다.

### 구별 방법과 그 안전성

`validateEvent`는 **서명을 먼저 검증하고, 통과한 뒤에야 payload를 파싱한다.** 이것도 실측으로 확인했다:

| 입력 | 결과 |
|---|---|
| 깨진 JSON + **틀린** 서명 | `WebhookVerificationError` (파싱까지 못 감) |
| 깨진 JSON + **올바른** 서명 | `SyntaxError` (서명은 통과한 뒤 파싱에서 실패) |

즉 `catch` 블록에서 `error`가 `WebhookVerificationError`가 **아니라는 것 자체가 "서명 검증을 이미 통과했다"는 증거**다. 따라서 그 지점에서 raw body를 `JSON.parse`해 `type`을 읽어도 안전하다.

> **⚠️ 이 `JSON.parse`는 서명 검증을 대체하지 않는다.** 서명이 검증된 **뒤에** 실패 원인을 분류하기 위한 용도로만 존재한다. 이 파싱 결과로 DB를 쓰거나 사용자를 식별하는 경로를 만들지 마라. 검증 전에 body를 신뢰하는 코드가 생기면 CLAUDE.md의 "웹훅은 서명 검증을 통과한 뒤에만 구독 상태를 갱신한다"를 위반한다.

### 이 설계는 프로토타입으로 검증됐다

아래 4-2의 로직을 `@polar-sh/sdk@0.49.0`에 그대로 얹어 11개 케이스를 돌렸고 **11/11이 의도대로** 나왔다(정상 픽스처가 여전히 `{ kind: "event" }`로 파싱되는 회귀 확인 포함). AC의 기대값은 전부 그 실측 결과다. 구현이 AC를 못 맞추면 SDK가 아니라 구현이 계획과 다른 것이다.

**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

## 작업

### 4-1. `src/services/polar/errors.ts` — 에러 타입 1개 추가

기존 3개 클래스(`PolarConfigError`, `PolarWebhookVerificationError`, `PolarApiError`) **아래에** 추가한다. 기존 3개는 한 글자도 바꾸지 않는다.

```typescript
export class PolarWebhookPayloadError extends Error {
  readonly code = "POLAR_WEBHOOK_PAYLOAD_INVALID" as const

  constructor() {
    super("Polar webhook payload could not be parsed")
    this.name = "PolarWebhookPayloadError"
  }
}
```

- **생성자 인자를 받지 않는다.** 원본 zod 에러 메시지나 body 조각을 담지 마라 — 그 안에 고객 이메일·이름이 들어 있고, 이 메시지는 스택트레이스를 타고 흐른다. 기존 `PolarWebhookVerificationError`와 동일한 "고정 문구" 규약이다.
- `PolarWebhookVerificationError`(403)와 **반드시 다른 클래스**여야 한다. 파싱 실패는 5xx, 서명 실패는 403이다.

### 4-2. `src/services/polar/webhook.ts` — 분류 로직

**import 추가 2개:**

```typescript
import { PolarWebhookPayloadError } from "./errors"          // 기존 import 목록에 추가
import { mapEventToSubscriptionStatus } from "./subscription-status"
```

- `mapEventToSubscriptionStatus`를 **`./subscription-status`에서 직접** import한다. **배럴(`./index` 또는 `.`)에서 가져오지 마라** — `index.ts`가 `webhook.ts`를 재export하므로 순환 참조가 된다. `subscription-status.ts`는 import가 하나도 없는 순수 모듈이라 직접 import는 안전하다.
- "우리가 처리하는 이벤트 집합"을 `webhook.ts`에 **문자열로 다시 나열하지 마라.** 반드시 `mapEventToSubscriptionStatus(type) !== null`로 판정한다. 그래야 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`이 유일한 진실 공급원으로 남고 둘이 어긋날 수 없다.

**헬퍼 추가** (파일 내 다른 헬퍼들과 같은 위치, `export`하지 않는다):

```typescript
type RawEventTypeProbe = { kind: "type"; type: string } | { kind: "unreadable" }

/**
 * 서명 검증을 통과한 뒤에만 호출된다.
 * 이 파싱은 서명 검증을 대체하지 않는다 — 실패한 전달을 "우리가 처리하는 이벤트인지"
 * 분류하기 위한 용도로만 쓴다. 이 결과로 DB를 쓰거나 사용자를 식별하지 않는다.
 */
function probeRawEventType(body: string): RawEventTypeProbe
```

동작:
1. `JSON.parse(body)`를 `try/catch`로 감싼다. 던지면 `{ kind: "unreadable" }`.
2. 결과가 객체가 아니거나 `null`이거나 배열이면 `{ kind: "unreadable" }`.
3. `type` 속성이 문자열이 아니면 `{ kind: "unreadable" }`.
4. 그 외에는 `{ kind: "type", type }`.

**`verifyPolarWebhook`의 `catch` 블록만 교체한다.** 함수 시그니처, `VerifiedWebhook` 타입, `normalizeHeaders`, `PolarConfigError` 분기, `try` 블록, `resolveUserId`는 **전부 그대로 둔다.**

```typescript
} catch (error) {
  if (error instanceof WebhookVerificationError) {
    throw new PolarWebhookVerificationError()
  }

  // 여기 도달 = 서명 검증은 이미 통과했다(validateEvent는 검증 후에 파싱한다).
  // 처리 대상 이벤트가 "아님을 확인한" 경우에만 무시한다. 확인할 수 없으면 던진다.
  const probe = probeRawEventType(input.body)
  if (probe.kind === "unreadable") {
    throw new PolarWebhookPayloadError()
  }
  if (mapEventToSubscriptionStatus(probe.type) !== null) {
    throw new PolarWebhookPayloadError()
  }
  return { kind: "unsupported" }
}
```

**판정 규칙을 말로 옮기면:**

| 유효 서명 + 상황 | 결과 | 라우트 응답 |
|---|---|---|
| 정상 파싱 | `{ kind: "event", event }` | 정상 처리 |
| `type`이 `subscription.active`/`uncanceled`/`revoked` 중 하나인데 파싱 실패 | **`PolarWebhookPayloadError` throw** | **5xx** |
| `type`을 읽었고 위 3개 밖 (`subscription.canceled`, `unknown.event` 등) | `{ kind: "unsupported" }` | 200 |
| body가 JSON이 아님 / 객체가 아님 / `type`이 문자열 아님 | **`PolarWebhookPayloadError` throw** | **5xx** |
| 서명 불일치·헤더 누락 | `PolarWebhookVerificationError` throw (**변경 없음**) | 403 |
| `POLAR_WEBHOOK_SECRET` 미설정 | `PolarConfigError` throw (**변경 없음**) | 500 |

핵심 불변식은 **"처리 대상이 아님을 적극적으로 확인했을 때만 200으로 무시한다. 확인할 수 없으면 던진다."** 이다. `type`을 못 읽는 body는 "모르는 이벤트"라는 증거가 없다 — 잘린 `subscription.active`일 수도 있으므로 재시도시키는 쪽이 맞다. (서명이 유효하다는 건 진짜 Polar 트래픽이라는 뜻이므로, 이 경로가 외부 공격자에 의해 유발될 수 없다.)

### 4-3. `src/services/polar/index.ts` — 배럴에 1줄

기존 `errors` 재export 줄에 `PolarWebhookPayloadError`를 추가한다(알파벳 순 유지). 다른 export는 건드리지 않는다.

### 4-4. `src/app/api/webhooks/polar/route.ts` — **수정하지 마라**

확인 결과 **라우트는 변경이 필요 없다.** 현재 catch가 이미 이렇게 되어 있다:

```typescript
} catch (error) {
  if (error instanceof PolarWebhookVerificationError) {
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 403 })
  }
  return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
}
```

`PolarWebhookVerificationError`가 아닌 모든 throw가 이미 **500 `{ code: "INTERNAL_ERROR" }`** 로 떨어진다. 새 `PolarWebhookPayloadError`도 자동으로 여기 걸린다.

- **`route.ts`에 `PolarWebhookPayloadError`를 import해 별도 분기를 추가하지 마라.** 응답이 어차피 같은 500이라 코드만 늘고, 라우트가 서비스 에러 타입을 하나 더 알게 되어 경계가 나빠진다.
- 403 / 200(`unhandled_event`) / 200(`unresolved_customer`) / 200(`unknown_user`) / 5xx(DB 오류) 분기도 전부 그대로 둔다.
- 다만 **이 계약이 유지된다는 것을 테스트로 고정한다**(4-5 참조). 나중에 누가 catch-all을 좁히면 즉시 깨져야 한다.

### 4-5. 테스트

**두 파일만 수정한다. 새 테스트 파일을 만들지 않는다.** 확장자는 둘 다 이미 `.ts`다.

#### (a) `src/services/polar/webhook.test.ts` — 케이스 추가

- 기존 테스트를 **하나도 수정·삭제하지 마라.** 특히 `"ignores a validly signed unknown event"`는 이번 변경의 회귀 방지선이므로 그대로 통과해야 한다.
- 파일 상단의 `subscriptionActiveFixture`, `signedHeaders`, `verifyFixture` 헬퍼를 재사용한다. 새로 만들지 마라.
- `verifyFixture`는 픽스처 객체를 받으므로, **문자열 body를 그대로 서명해 넘기는 경로**가 필요하다. 기존 `signedHeaders(body)`를 써서 아래처럼 직접 호출한다:
  ```typescript
  function verifyRawBody(body: string) {
    return verifyPolarWebhook({ body, headers: signedHeaders(body) })
  }
  ```
- 추가할 케이스:
  1. **(핵심)** `'{"type":"subscription.active","data":{"id":"sub_1"}}'` → `PolarWebhookPayloadError`가 던져진다. QA가 재현에 쓴 payload를 **그대로** 쓴다.
  2. `subscription.uncanceled`, `subscription.revoked`도 같은 불완전 `data`로 각각 `PolarWebhookPayloadError`가 던져진다(`it.each` 권장). 처리 대상 3개 전부 덮는다.
  3. `'{"type":"subscription.canceled","data":{"id":"sub_1"}}'` → **던지지 않고** `{ kind: "unsupported" }`. 처리 대상 밖이면 불완전해도 무시한다는 경계를 고정한다.
  4. `'{"type":"subscription.active"'` (깨진 JSON) → `PolarWebhookPayloadError`.
  5. `'"just a string"'`, `'null'`, `'{"data":{}}'`(type 없음), `'{"type":123,"data":{}}'`(type이 숫자) → 각각 `PolarWebhookPayloadError`.
  6. **던져진 에러가 `PolarWebhookVerificationError`가 아님**을 `expect(err).not.toBeInstanceOf(PolarWebhookVerificationError)`로 단정한다(403으로 잘못 매핑되는 것을 막는 회귀 방지선).
  7. **서명이 틀린 경우는 여전히 `PolarWebhookVerificationError`**이고 `PolarWebhookPayloadError`가 **아님**을 단정한다. 위 1번 payload에 **틀린 secret으로 서명**해서, 이번 변경이 403 경로를 침범하지 않았음을 고정한다.
- `PolarWebhookPayloadError`를 `./errors`에서 import한다.

#### (b) `src/app/api/webhooks/polar/route.test.ts` — 케이스 1개 추가

- 상단 `vi.hoisted` 블록에 `class PolarWebhookPayloadError extends Error {}`를 추가하고, 반환 객체와 `vi.mock("../../../../services/polar", ...)` 팩토리에도 같은 이름으로 넣는다. **기존 클래스·목 함수를 지우거나 이름을 바꾸지 마라.**
  - `vi.mock` 팩토리는 파일 최상단으로 호이스팅되므로 클래스는 **반드시 `vi.hoisted` 안에서** 선언해야 한다. 모듈 본문에 `class`를 두면 `ReferenceError: Cannot access '...' before initialization`으로 suite 전체가 죽는다.
- 추가할 테스트: `verifyPolarWebhook.mockImplementation(() => { throw new PolarWebhookPayloadError() })` 일 때
  - 응답 status가 **500**(`>= 500`)이다
  - `upsertSubscriptionStatus`가 **호출되지 않는다**
  - `resolveUserId`가 **호출되지 않는다**
- 기존 `"contains unexpected verification errors as internal errors"` 테스트와 목적이 다르다(그건 익명 `Error`, 이건 우리가 정의한 실패 타입의 계약). 기존 테스트를 이걸로 대체하지 말고 **둘 다 남긴다.**

## Acceptance Criteria

- [ ] `src/services/polar/errors.ts`가 `PolarWebhookPayloadError`를 export하고, `code`가 `"POLAR_WEBHOOK_PAYLOAD_INVALID"`이며, 생성자가 **인자를 받지 않는다**. 기존 3개 클래스(`PolarConfigError`, `PolarWebhookVerificationError`, `PolarApiError`)의 `code`·메시지·생성자 시그니처가 **변경되지 않았다**.
- [ ] (핵심 버그 수정) 유효 서명 + `'{"type":"subscription.active","data":{"id":"sub_1"}}'` 를 `verifyPolarWebhook`에 넘기면 **`PolarWebhookPayloadError`가 던져진다**(`{ kind: "unsupported" }`를 반환하지 않는다)는 테스트가 `src/services/polar/webhook.test.ts`에서 통과한다.
- [ ] 같은 형태의 불완전 payload를 `subscription.uncanceled`, `subscription.revoked`에 대해서도 각각 `PolarWebhookPayloadError`가 던져지는 테스트가 통과한다. 즉 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE`의 키 **3개 전부**가 덮인다.
- [ ] (모르는 이벤트는 여전히 무시) 유효 서명 + `'{"type":"unknown.event","data":{}}'` 가 **던지지 않고** `{ kind: "unsupported" }`를 반환하는 기존 테스트가 **수정 없이 그대로 통과**한다. 추가로 `'{"type":"subscription.canceled","data":{"id":"sub_1"}}'`(처리 대상 밖 + 불완전)도 `{ kind: "unsupported" }`임을 단정하는 테스트가 통과한다.
- [ ] (읽을 수 없는 body) `'{"type":"subscription.active"'`(깨진 JSON), `'"just a string"'`, `'null'`, `'{"data":{}}'`, `'{"type":123,"data":{}}'` 각각에 대해 `PolarWebhookPayloadError`가 던져지는 테스트가 통과한다.
- [ ] (403 경로 무침범) 던져진 `PolarWebhookPayloadError`가 `PolarWebhookVerificationError`의 인스턴스가 **아님**을 `not.toBeInstanceOf`로 단정하는 테스트가 통과한다. 또한 위 불완전 payload를 **틀린 secret으로 서명**했을 때는 여전히 `PolarWebhookVerificationError`가 던져지고 `PolarWebhookPayloadError`가 **아님**을 단정하는 테스트가 통과한다.
- [ ] (라우트 5xx 매핑) `verifyPolarWebhook`이 `PolarWebhookPayloadError`를 던질 때 `POST /api/webhooks/polar`가 **status >= 500**을 반환하고, `upsertSubscriptionStatus`와 `resolveUserId`가 **호출되지 않음**을 단정하는 테스트가 `route.test.ts`에서 통과한다.
- [ ] (라우트 무수정 CRITICAL) `git diff --name-only`에 `src/app/api/webhooks/polar/route.ts`가 **없다**. `grep -n "PolarWebhookPayloadError" src/app/api/webhooks/polar/route.ts` 결과가 **0건**이다(라우트는 기존 catch-all로 처리하며 새 에러 타입을 알 필요가 없다).
- [ ] (기존 라우트 분기 보존) `route.test.ts`의 기존 테스트가 **하나도 수정·삭제되지 않았고** 전부 통과한다 — 특히 서명 실패 403, `unhandled_event` 200, `unresolved_customer` 200, `unknown_user` 200, DB 오류 5xx, 멱등성 테스트.
- [ ] (단일 진실 공급원) `src/services/polar/webhook.ts`가 `mapEventToSubscriptionStatus`를 **`./subscription-status`에서 직접** import한다. `grep -n '"subscription\.' src/services/polar/webhook.ts`에 **`SUBSCRIPTION_EVENT_TYPES` 상수(기존 7종) 외의 새 이벤트 타입 문자열 목록이 추가되지 않았다** — 처리 대상 판정은 오직 `mapEventToSubscriptionStatus(...) !== null`로만 한다.
- [ ] (순환 참조 없음) `webhook.ts`가 `./index`(배럴)에서 import하지 않는다. `npm run test`·`npm run build`가 순환 참조 경고 없이 통과한다.
- [ ] (서명 검증 우선 CRITICAL) `webhook.ts`의 `JSON.parse` 호출이 **`catch` 블록 안에서만** 일어난다. `try` 블록이나 `validateEvent` 호출 **이전에** body를 파싱하는 코드가 없다. 해당 헬퍼에 "서명 검증을 대체하지 않으며 분류 용도로만 쓴다"는 취지의 주석이 달려 있다. 이 파싱 결과가 `resolveUserId`·DB 쓰기·사용자 식별 어디에도 쓰이지 않는다.
- [ ] (변경 금지 CRITICAL) `src/services/polar/subscription-status.ts`와 `src/services/polar/subscription-status.test.ts`가 `git diff --name-only`에 **없다**. ADR-006 회귀 방지 테스트(`subscription.canceled`/`subscription.past_due` → `null`)와 `SUBSCRIPTION_STATUS_BY_EVENT_TYPE` 키 3개 단정이 그대로 통과한다.
- [ ] (범위 유지) 이 step에서 수정된 파일이 정확히 다음 5개뿐임을 `git diff --name-only`로 확인한다 — `src/services/polar/errors.ts`, `src/services/polar/webhook.ts`, `src/services/polar/index.ts`, `src/services/polar/webhook.test.ts`, `src/app/api/webhooks/polar/route.test.ts`. `src/components/`·`src/lib/`·`src/services/supabase-admin/`·`src/services/llm/`은 건드리지 않는다.
- [ ] (마이그레이션 없음) `supabase/migrations/`에 새 파일이 **0건**이고 기존 파일이 수정되지 않았다. 이 step은 DB 스키마와 무관하다.
- [ ] (로그 유출 방지 CRITICAL) 수정한 5개 파일에 `console.` 호출이 **0건**이다. `PolarWebhookPayloadError`의 메시지에 raw body·zod 에러 원문·고객 이메일·이름이 담기지 않는다(고정 문구만).
- [ ] (회귀 없음) `npm run test`가 **49개 파일 / 398개 테스트 이상**을 실행해 **실패 0건**이다(이 step 시작 시점의 기준선이 49 files / 398 tests이며, 추가된 테스트만큼 늘어나야 한다. 줄어들면 안 된다). `npm run typecheck`, `npm run lint`도 통과한다.
