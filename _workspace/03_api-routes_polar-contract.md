# api-routes 확정 계약 — Polar (phase 6-polar-billing, step 1·2)

> 작성: api-routes planner / 2026-08-07
> frontend planner(step 3)와 qa가 참조하는 **엔드포인트 요청/응답 shape 계약**이다.
> 계획 파일: `phases/6-polar-billing/step1.md`(체크아웃), `phases/6-polar-billing/step2.md`(웹훅).
> 의존 계약: `_workspace/02_core-services_polar-interface.md`(step 0 서비스 시그니처), `_workspace/02_db-schema_polar-mapping.md`(매핑 규약).
> 기존 계약: `_workspace/03_api-routes_contract.md` — **그 문서의 "POST /api/webhooks/polar (범위 밖 — 스텁)" 절은 이 문서로 대체된다.** 나머지(업로드/분석/리포트)는 그대로 유효하다.
>
> ⚠️ `_workspace/`는 `scripts/execute.py`의 Codex 프리앰블에 자동 주입되지 않는다(`AGENTS.md` + `docs/*.md`만 붙는다). 이 문서의 내용 중 Codex가 알아야 할 것은 이미 각 `step{N}.md` 본문에 복사해 넣었다.

---

## 1. 이 phase에서 확정한 결정 3가지

### ① `CHECKOUT_FAILED` 신설 — **채택**

core-services의 권고를 채택한다. 기존 에러 코드 표에 결제용 코드가 없었다.

**`GENERATION_FAILED`를 재사용하지 않는다.** 그 코드는 LLM 리포트 생성 실패 전용이고 frontend가 "인사이트를 만들지 못했습니다" 계열 문구로 분기한다. 결제 실패에 그 문구가 뜨면 오진이다.

부수적으로 `INTERNAL_ERROR`, `ALREADY_SUBSCRIBED`, `FORBIDDEN`, `INVALID_SIGNATURE`도 이 phase에서 처음 등장하는 코드다. 아래 §2 통합 표 참조.

### ② 이미 구독 중인 사용자의 체크아웃 호출 — **409로 차단**

`POST /api/checkout`은 `getSubscriptionStatus(user.id)`가 `"active"`이면 `createCheckoutSession`을 **호출하지 않고** `409 { "code": "ALREADY_SUBSCRIBED" }`를 반환한다.

근거:
- MVP는 단일 상품·단일 티어다(scope "범위 밖": 다중 티어·트라이얼·쿠폰 없음). 구독자가 살 수 있는 다른 것이 없으므로 두 번째 체크아웃은 **같은 상품의 중복 구독 = 이중 청구**다.
- `subscriptions.user_id`가 unique(사용자당 1행)이고 `status`가 2값뿐이라 **활성 구독 2개는 스키마상 표현 불가**다. 두 구독의 웹훅이 같은 행을 두고 싸운다 — 구독 A의 `subscription.revoked`가 아직 유효한 구독 B를 `'inactive'`로 만든다.
- 이 phase에 청구서·구독 취소·환불 UI가 없다(scope "범위 밖"). 사용자가 이중 결제를 스스로 되돌릴 방법이 없다.
- 실패 방향이 안전하다: 차단의 최악은 "구독자가 결제 버튼을 눌렀는데 안 눌린다", 허용의 최악은 "돈 낸 고객에게 또 청구한다".

**알려진 한계(의도적 수용):** `subscription.canceled`(해지 예약)·`past_due`(결제 재시도 중)인 사용자도 우리 DB에서는 `'active'`이므로 재구독이 막힌다. 그들은 아직 Premium 접근권이 있어 손해가 없고, 실제 접근 종료(`subscription.revoked` → `'inactive'`) 후 다시 결제할 수 있다. ADR-006과 정합한 동작이다.

**frontend(step 3)에 대한 함의:** `PremiumSection`의 업그레이드 CTA는 구독자에게는 애초에 렌더되지 않으므로 409는 정상 흐름에서 나오지 않는다. 방어적 케이스(다른 탭에서 결제 완료 후 stale한 화면에서 클릭 등)이며, 이때는 에러 모달 대신 **페이지 새로고침**으로 처리하는 것이 자연스럽다.

### ③ 체크아웃 성공 응답은 `{ url }` 한 필드

frontend가 가정하던 `{ url: string }`을 그대로 확정한다. `checkoutId`는 응답에 **포함하지 않는다** — db-schema 매핑 규약 §2가 "라우트가 클라이언트에 돌려주는 것은 체크아웃 URL 하나뿐"으로 확정했다.

---

## 2. 에러 코드 표 (기존 표 + 이번 phase 신설)

| 상황 | HTTP | body | 신설 여부 |
|---|---|---|---|
| 세션 없음(비로그인) | 401 | `{ "code": "UNAUTHORIZED" }` | 기존 |
| 잘못된 요청 | 400 | `{ "code": "BAD_REQUEST" }` | 기존 |
| 리소스 없음 / 소유권 불일치 | 404 | `{ "code": "NOT_FOUND" }` | 기존 |
| 미구독 사용자의 Premium 요청 | 403 | `{ "code": "PAYWALL_REQUIRED" }` | 기존 |
| llm 생성 실패 | 502 | `{ "code": "GENERATION_FAILED" }` | 기존 — **결제에 재사용 금지** |
| 교차 출처 POST 거부 | 403 | `{ "code": "FORBIDDEN" }` | **신설** |
| 이미 구독 중인 사용자의 체크아웃 요청 | 409 | `{ "code": "ALREADY_SUBSCRIBED" }` | **신설** |
| Polar 체크아웃 생성 실패(`PolarApiError`) | 502 | `{ "code": "CHECKOUT_FAILED" }` | **신설** |
| 웹훅 서명 검증 실패 | 403 | `{ "code": "INVALID_SIGNATURE" }` | **신설** |
| 서버 오설정(`PolarConfigError`) / 예상치 못한 오류 | 500 | `{ "code": "INTERNAL_ERROR" }` | **신설** |

모든 에러 본문은 **`code` 한 필드뿐**이다. `error.message`를 담지 않는다 — Polar SDK 에러 메시지에는 요청 헤더·응답 본문이 담길 수 있어 `POLAR_ACCESS_TOKEN` 유출 경로가 된다.

---

## 3. `POST /api/checkout`

로그인 사용자를 위한 Polar Hosted Checkout 세션 발급. **DB 쓰기 없음.**

파일: `src/app/api/checkout/route.ts` (신규, step 1)

### 요청

```
POST /api/checkout
```

- **본문 없음.** 라우트는 요청 본문을 읽지 않는다(`request.json()`/`text()`/`formData()`/`searchParams` 미사용).
- `userId`는 **전적으로 서버 세션**(`getSessionUser()`)에서 온다. 본문에 `user_id`를 넣어도 무시된다.
  > **왜 CRITICAL인가:** 본문의 `user_id`를 `externalCustomerId`로 실어 보내면 공격자가 임의 uuid로 **타인 명의의 구독을 만들 수 있다.** 웹훅은 그 값을 믿고 해당 사용자의 `status`를 `'active'`로 올린다.
- `Content-Type` 불필요. `fetch("/api/checkout", { method: "POST" })`로 충분하다.
- 브라우저에서 호출하면 `Origin` 헤더가 자동으로 붙고 동일 출처이므로 통과한다.

### 응답

성공(200):
```json
{ "url": "https://sandbox.polar.sh/checkout/polar_c_XXXXXXXX" }
```
- **정확히 이 한 필드.** `checkoutId`는 없다.
- frontend는 이 값으로 `window.location.href = url` 리다이렉트한다.

에러:
```json
403 { "code": "FORBIDDEN" }            // Origin 헤더가 요청 오리진과 다름 (교차 출처 POST)
401 { "code": "UNAUTHORIZED" }         // 세션 없음
409 { "code": "ALREADY_SUBSCRIBED" }   // 이미 구독 중 — 체크아웃 생성 시도 없이 즉시
502 { "code": "CHECKOUT_FAILED" }      // Polar API 호출 실패 (PolarApiError)
500 { "code": "INTERNAL_ERROR" }       // 서버 오설정(PolarConfigError) 또는 예상치 못한 오류
```

`POST`만 export한다. 그 외 메서드는 Next.js가 405를 자동 반환한다.

### 검사 순서 (불변식 — qa 검증 포인트)

```
1. 동일 출처 확인      → 실패 시 403, getSessionUser 호출 없음
2. 세션 확인            → 없으면 401, getSubscriptionStatus·createCheckoutSession 호출 없음
3. 구독 상태 확인       → "active"면 409, createCheckoutSession 호출 없음
4. createCheckoutSession({ userId: <세션 user.id>, email: user.email ?? null })
5. 200 { url }
```

### 결제 복귀 URL (frontend step 3가 처리)

`successUrl`은 `src/services/polar/`가 만든다. 라우트도 프론트도 만들지 않는다.

```
${NEXT_PUBLIC_APP_URL}/dashboard?checkout=success
```

- 결제 완료 후 사용자는 **`/dashboard?checkout=success`로 돌아온다.**
- **cancel URL은 없다.** 취소·이탈 복귀는 Polar 기본 동작에 맡긴다(scope 리더 결정 2번).
- ⚠️ **`checkout=success`가 곧 "구독 활성화됨"은 아니다.** 구독 상태는 웹훅이 갱신하며, 리다이렉트와 웹훅 도착 사이에 수초의 시차가 있을 수 있다. 복귀 화면에서 `getSubscriptionStatus`가 아직 `'inactive'`일 수 있으므로, **성공 파라미터만 믿고 Premium UI를 확정 렌더하지 마라.**
- **폴링하지 않는다.** `docs/ARCHITECTURE.md`의 "폴링 없음" 전제를 지킨다(step 3 결정). 서버가 읽은 실제 구독 상태에 따라 안내 배너를 **1회** 보여주는 것으로 처리한다 — 아직 `'inactive'`면 "결제를 확인하는 중입니다. 잠시 후 새로고침해 주세요" 계열, 이미 `'active'`면 "Premium이 활성화됐습니다" 계열. 구체 문구·구현은 step 3(`phases/6-polar-billing/step3.md`)이 소유한다.

---

## 4. `POST /api/webhooks/polar`

Polar 웹훅 수신 → 서명 검증 → `subscriptions.status` 갱신. **이 프로젝트에서 구독을 `'active'`로 올릴 수 있는 유일한 경로.**

파일: `src/app/api/webhooks/polar/route.ts` (기존 501 스텁 교체, step 2)

**frontend는 이 엔드포인트를 호출하지 않는다.** Polar 서버만 호출한다. 아래는 qa 검증용 계약이다.

### 요청

- Polar이 Standard Webhooks 사양으로 POST한다. 헤더: `webhook-id`, `webhook-timestamp`, `webhook-signature`.
- 라우트는 `await request.text()`로 **raw 문자열**을 읽어 그대로 검증에 넘긴다. `request.json()` 금지 — 재직렬화하면 바이트가 달라져 서명이 100% 깨진다.

### 응답

| 상황 | HTTP | body |
|---|---|---|
| 정상 갱신 | 200 | `{ "received": true }` |
| SDK가 모르는 이벤트(`kind: "unsupported"`) | 200 | `{ "received": true, "ignored": "unhandled_event" }` |
| 매핑 대상 밖 이벤트(`mapEventToSubscriptionStatus → null`) | 200 | `{ "received": true, "ignored": "unhandled_event" }` |
| user_id 해석 불가(`resolveUserId → null`) | 200 | `{ "received": true, "ignored": "unresolved_customer" }` |
| 미지 사용자(FK 위반 `23503`) | 200 | `{ "received": true, "ignored": "unknown_user" }` |
| **서명 검증 실패** | **403** | `{ "code": "INVALID_SIGNATURE" }` — 상세 사유 노출 금지, DB 미변경 |
| **설정 누락(`PolarConfigError`)** | **500** | `{ "code": "INTERNAL_ERROR" }` — 403으로 뭉개지 않는다 |
| 일시적 DB 오류 | **5xx** | `{ "code": "INTERNAL_ERROR" }` |

**왜 이렇게 나뉘는가:** Polar은 실패 시 최대 10회 지수 백오프로 재시도한다. 재시도로 해결될 수 없는 상황(모르는 이벤트, 해석 불가, 탈퇴 사용자)에 5xx를 주면 무한 재시도가 된다. 반대로 재시도하면 성공할 상황(일시적 DB 오류)에 200을 주면 이벤트가 영구 유실되어 **사용자가 돈을 냈는데 Premium이 안 열린다.**

### 이벤트 → status 매핑 (ADR-006 — 되돌리지 마라)

| Polar 이벤트 | `subscriptions.status` |
|---|---|
| `subscription.active` | `'active'` |
| `subscription.uncanceled` | `'active'` |
| `subscription.revoked` | `'inactive'` |
| `subscription.canceled` | **무시(상태 변경 없음)**, 200 |
| `subscription.past_due` | **무시(상태 변경 없음)**, 200 |
| 그 외 전부 | 무시, 200 |

> **ADR-006 결정문:** *"취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지하는 방식으로 구현한다."*
>
> Polar에서 `subscription.canceled`는 **해지 예약**(기간 말 종료 예정)이고 실제 접근 종료는 `subscription.revoked`가 따로 온다. `past_due`는 결제 재시도(dunning) 중일 뿐이며 Polar이 포기하면 `revoked`를 보낸다.
> **구독 해제는 오직 `subscription.revoked` 하나로만 일어난다.**
>
> 이력: `_workspace/00_input/scope_6-polar-billing.md` 초안은 `canceled`/`past_due`를 `'inactive'`로 적었으나 ADR-006 위배로 2026-08-07 리더가 정정했다(결정 4번 정정 이력 블록). db-schema·core-services 플래너가 독립적으로 같은 지적을 했다. 관련 규약 문서(`02_db-schema_polar-mapping.md`, `02_core-services_polar-interface.md`)는 모두 정정 후 값으로 일치한다 — qa가 2026-08-07 전수 대조로 확인했다.

### DB 쓰기 경계 (불변식 — qa 검증 포인트)

- 쓰기는 `src/services/supabase-admin/index.ts`에 **이 step에서 새로 추가되는** `upsertSubscriptionStatus({ userId, status }): Promise<void>` 경유로만. 라우트가 `lib/supabase/service`나 `@supabase/supabase-js`를 직접 import하지 않는다.
- **`update`가 아니라 `upsert(onConflict: "user_id")`.** 현재 이 테이블에 INSERT하는 코드가 없어 첫 결제 시 행이 존재하지 않는다. `update`로 짜면 0행 갱신으로 조용히 실패한다.
- `updated_at` 자동 갱신 트리거가 없으므로 쓰기 코드가 `new Date().toISOString()`을 직접 넣는다.
- 함께 추가되는 `isUnknownUserError(error): boolean`이 Postgres FK 위반(SQLSTATE `23503`)을 판별한다. Postgres 에러 코드가 `src/app/` 층으로 새지 않게 하기 위한 것.
- **마이그레이션 0건, `src/types/database.ts` 변경 0건.** `subscriptions` 스키마는 현재와 동일하다.
- **`subscriptions`에 INSERT/UPDATE/DELETE RLS 정책을 추가하지 않는다.** 정책은 `select_own_subscription`(SELECT 전용) 하나뿐이다. 쓰기 정책을 열면 브라우저에서 사용자가 자기 `status`를 `'active'`로 바꿔 페이월을 우회한다.
- **읽기 경로(`src/lib/supabase/server.ts`의 `getSubscriptionStatus`)를 수정하지 않는다.** 웹훅이 쓰고, 그 함수가 읽는다. 기존 Premium 게이팅(403 `PAYWALL_REQUIRED`)·lazy-generate 동작이 그대로 유지된다.
- **멱등성은 upsert가 제공한다.** `polar_webhook_events` 같은 중복 제거 테이블을 만들지 않는다. `status`가 이벤트 타입의 순수 함수이므로 같은 이벤트를 N번 처리해도 결과 행이 동일하다.

---

## 5. 라우트 공통 경계 (이번 phase에서 지켜지는 것)

- **`@polar-sh/sdk`를 import하는 파일은 `src/services/polar/` 안에만 존재한다.** `grep -rn "@polar-sh/sdk" src/app/` → 0건. (CLAUDE.md CRITICAL: 외부 API 호출은 `src/services/`를 통해서만.)
- **`process.env` 접근이 두 라우트 모두 0건이다.** `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET`/`POLAR_PRODUCT_ID`/`POLAR_SERVER`/`NEXT_PUBLIC_APP_URL`은 전부 `src/services/polar/`가 읽는다.
- **`NEXT_PUBLIC_POLAR_*` 형태의 변수를 만들지 않는다.** `NEXT_PUBLIC_APP_URL`만 공개 변수이고 나머지 4개는 서버 전용이다.
- **`console.` 호출이 두 라우트 모두 0건이다.** 원본 웹훅 payload에는 고객 이메일·이름이, Polar SDK 에러에는 토큰이 담길 수 있다.
- **`src/middleware.ts`를 수정하지 않는다.** matcher가 이미 `/api/*`를 제외한다.
