# Polar ↔ Supabase 매핑 규약 (phase 6-polar-billing)

> 작성: db-schema planner / 2026-08-07
> 이 문서는 core-services(step 1), api-routes(step 2·3), frontend(step 4) planner가 참조하는 **확정 계약**이다.
> 기존 스키마 계약은 `_workspace/02_db-schema_schema.md`를 그대로 유지한다(이번 phase에서 변경 없음).

## ⚠️ 후속 플래너가 가장 먼저 알아야 할 것

**이 문서는 Codex에게 자동 주입되지 않는다.** `scripts/execute.py`의 프리앰블은 `AGENTS.md`와 `docs/*.md`만 붙이고 `_workspace/`는 붙이지 않는다.
따라서 아래 규약 중 각 step에 해당하는 내용은 **해당 `step{N}.md` 본문에 그대로 복사해 넣어야 한다.** "매핑 규약 문서를 참고하라"는 참조만으로는 Codex가 볼 수 없다.

---

## 1. 결론: 스키마 변경 없음 (선택지 A 채택)

**Polar 고객 ↔ Supabase 사용자 매핑은 체크아웃 생성 시 실어 보낸 `externalCustomerId`(+ `metadata.user_id`)를 웹훅에서 역참조하는 방식으로 처리한다. `subscriptions` 테이블에 컬럼을 추가하지 않는다. 이번 phase에 마이그레이션은 없다.**

### 판단 근거 (선택지 B = `polar_customer_id` / `polar_subscription_id` 컬럼 추가와의 비교)

| 판단 기준 | A (external_id 역참조) | B (매핑 컬럼 추가) | 판정 |
|---|---|---|---|
| **멱등성** (Polar 최대 10회 지수 백오프 재시도) | 쓰기가 `user_id` 유니크 키에 대한 upsert이고 `status`가 **이벤트 타입의 순수 함수**라, 같은 이벤트를 N번 처리해도 결과 행이 동일하다. 구조적으로 멱등. | 컬럼이 늘어나도 멱등성은 그대로 upsert가 제공한다. **B가 기여하는 바가 없다.** 진짜 dedup을 원하면 `polar_webhook_events(event_id unique)` 테이블이 필요한데, 쓰기가 이미 멱등이므로 MVP에 불필요. | **무승부 → 최소주의로 A** |
| **이벤트 순서 뒤바뀜 내성** | 없음(아래 §7 한계 참조). | **B도 없다.** 순서 내성을 주는 건 `customer_id`/`subscription_id`가 아니라 *단조 증가 버전 컬럼*(이벤트 타임스탬프)이다. 제안된 두 컬럼은 순서 문제를 전혀 해결하지 못한다. | **무승부 → A** |
| **감사 추적** | Polar→Supabase 방향은 Polar 대시보드의 customer `external_id`로 이미 추적 가능. Supabase→Polar 방향은 Polar API를 `external_customer_id`로 조회해 얻는다. | 조회 한 번을 아낀다. 실질 이득은 있으나 **MVP 샌드박스 단일 상품에서는 미미**하고, 값을 채우는 경로(웹훅)가 곧 유일한 조회 경로라 자기참조적. | 소폭 B, 그러나 결정적이지 않음 |
| **현 스키마 정합성** | `user_id` unique(사용자당 1행) + `status` 2값 구조에 그대로 맞는다. 추가 상태 없음. | `polar_subscription_id`에 unique를 걸면 **해지 후 재구독 시 새 subscription id가 같은 user 행에 와야 하는데 과거 id와의 충돌·잔존 문제**가 생기고, unique를 안 걸면 컬럼의 존재 의미가 약해진다. 사용자당 1행 모델과 구독 N개 모델이 어긋나는 지점이 새 실패 모드로 들어온다. | **A** |
| **MVP 최소주의** | 마이그레이션 0건, 타입 재생성 0건, 배포된 테이블 `alter` 0건. | 마이그레이션 + `src/types/database.ts` 갱신 + 쓰기 코드에서 채워야 할 nullable 컬럼 2개. 지금 아무도 읽지 않는 컬럼. | **A** |

**ADR-006과의 관계:** ADR-006 트레이드오프 절에 "`polar-billing` phase에서 `subscriptions` 마이그레이션(컬럼 추가), `polar_webhook_events` 테이블 … 이 필요하다"는 *예상*이 적혀 있다. 이는 결정 사항이 아니라 당시의 비용 추정이며, 실제로 설계해 보니 (a) 쓰기가 구조적으로 멱등이라 이벤트 테이블이 불필요하고, (b) 매핑은 `external_id`로 충분하다. **ADR을 위배하지 않으며, ADR-006의 결정 문장("이번 phase는 스키마만, 결제 연동은 후속 phase")은 그대로 지켜진다.**

### 그래서 step 0은?

**step 0(스키마 마이그레이션)은 불필요하다.** 리더에게 다음 중 하나를 권고한다:
- (권장) 기존 step 1~4를 **step 0~3으로 재번호 매김**. `phase-planning` 스킬이 "step 번호는 0부터 연속"을 요구하고, `execute.py`의 진행률 표시(`Step {n}/{total-1}`)가 0-base를 가정한다.
- 재번호가 번거로우면 index.json의 `steps`를 1~4로 두어도 실행 자체는 동작한다(`_invoke_codex`가 `step{index.json의 step 값}.md`를 찾으므로 파일명만 맞으면 됨). 다만 진행률 표시가 어긋난다.

---

## 2. 체크아웃 생성 시 전송 규약 (step: `POST /api/checkout` + `src/services/polar/`)

`src/services/polar/`의 체크아웃 생성 함수는 Polar SDK 호출 시 **반드시 아래 4개를 실어 보낸다.**

| 필드 | 값 | 이유 |
|---|---|---|
| `products` | `[process.env.POLAR_PRODUCT_ID]` | 리더 확정 env 이름. 새 이름 금지. |
| `successUrl` | `` `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=success` `` | 리더 확정. cancel URL은 만들지 않는다. |
| `externalCustomerId` | 로그인 사용자의 Supabase `user.id` (uuid 문자열) | **매핑의 1차 키.** Polar 고객 객체의 `external_id`로 저장되고 웹훅 payload에 실려 돌아온다. |
| `metadata` | `{ user_id: <Supabase user.id> }` | **2차 폴백.** 비용이 사실상 0이고, `customer.external_id`가 payload에 없거나 SDK 버전에 따라 형태가 다를 때를 대비한 이중화. Polar metadata 값은 문자열/숫자/불리언만 허용되므로 uuid 문자열 그대로 넣는다. |

- `user.id`는 **서버에서 세션으로 얻은 값**만 쓴다. 요청 본문(body)이나 쿼리로 받은 user_id를 그대로 신뢰해 실어 보내면 타인 명의 구독을 만들 수 있다. 클라이언트가 보낸 user_id는 받지도 말 것.
- `POLAR_ACCESS_TOKEN` / `POLAR_SERVER`는 SDK 클라이언트 생성 시에만 사용하고 응답에 포함하지 않는다. 라우트가 클라이언트에 돌려주는 것은 **체크아웃 URL 하나**뿐이다.

## 3. 웹훅 → Supabase user_id 해석 규약 (step: `/api/webhooks/polar`)

`validateEvent()`로 **서명 검증을 통과한 이벤트에 대해서만** 아래를 수행한다. 검증 실패는 즉시 거부(4xx)하고 DB에 손대지 않는다.

`src/services/polar/`에 순수 함수로 둔다(라우트에 인라인 금지):

```
resolveUserId(event): string | null
```

해석 우선순위 — 앞에서 값이 나오면 즉시 사용:

1. `event.data.customer.externalId` (SDK가 camelCase로 역직렬화) — **없으면** `event.data.customer.external_id` (raw JSON snake_case 폴백)
2. `event.data.metadata.user_id` (§2에서 심어 보낸 값)
3. 위 둘 다 없으면 `null`

그 다음 **반드시 uuid v4 형식 검증**을 통과해야 한다. 형식이 아니면 `null`로 취급한다. (임의 문자열이 그대로 DB 쿼리에 들어가지 않게 하는 방어선. 최종 방어선은 `user_id` FK → `auth.users(id)`다.)

- `@polar-sh/sdk`가 아직 설치돼 있지 않으므로(현재 `package.json`에 없음) **필드 케이싱은 설치 후 실제 타입/`polar listen` 수신 payload로 확인한다.** 위 1·2 폴백 체인은 어느 쪽이든 동작하도록 짠 것이니 체인 자체를 지우지 마라.
- **원본 payload 전체를 로그로 찍지 마라.** 고객 이메일·이름이 payload에 들어 있다. 로그가 필요하면 이벤트 타입 문자열만 남긴다. 시크릿(`POLAR_WEBHOOK_SECRET`, `POLAR_ACCESS_TOKEN`)은 어떤 경로로도 로그·응답에 넣지 않는다.

### 해석 실패 / 미지의 사용자 처리

| 상황 | 응답 | 이유 |
|---|---|---|
| 서명 검증 실패 | **403** (본문에 상세 사유 금지) | CLAUDE.md CRITICAL: 검증 실패 시 요청 거부. |
| 서명 OK, `resolveUserId` → `null` | **200** `{ received: true, ignored: "unresolved_customer" }` | 재전송해도 영원히 해결되지 않는다. 4xx/5xx를 주면 Polar이 10회 재시도만 반복한다. **DB는 건드리지 않는다.** |
| 서명 OK, user_id는 얻었으나 FK 위반(23503, `auth.users`에 없는 사용자) | **200** `{ received: true, ignored: "unknown_user" }` | 위와 동일. 탈퇴 사용자의 지연 이벤트가 정상 케이스. |
| 서명 OK, 매핑 대상 밖 이벤트 타입 | **200** `{ received: true, ignored: "unhandled_event" }` | 리더 결정 4번: "그 외 이벤트는 200으로 무시(에러 아님)". |
| 서명 OK, DB 쓰기가 일시적 오류(네트워크/타임아웃 등) | **5xx** | 재시도로 회복 가능한 유일한 케이스. Polar 재시도에 맡긴다. |

## 4. 이벤트 → `status` 매핑 (2026-08-07 리더 정정 후 — 이것이 정본)

| Polar 이벤트 | `subscriptions.status` |
|---|---|
| `subscription.active` | `'active'` |
| `subscription.uncanceled` | `'active'` |
| `subscription.revoked` | `'inactive'` |
| `subscription.canceled` | **무시**(200, DB 미변경) |
| `subscription.past_due` | **무시**(200, DB 미변경) |
| 그 외 전부 | 무시(200, DB 미변경) |

> **되돌리지 마라 — ADR-006 회귀 방지선.**
> 이 문서 §8-2가 올린 "리더 확인 요청"은 **수용됐다.** 리더가 ADR-006 원문을 확인한 결과 결정문에
> *"취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지하는 방식으로 구현한다"* 가 명시돼 있었고,
> 초안의 `canceled → 'inactive'` 매핑이 ADR 위배였다. Polar에서 `canceled`는 **해지 예약**(기간 말 종료 예정)
> 시점이고 실제 접근 종료는 `revoked`가 온다. `past_due`도 결제 재시도(dunning) 중일 뿐이며 Polar이 포기하면
> `revoked`를 보낸다. **구독 해제는 오직 `subscription.revoked` 하나로만 일어난다.**
> 정본 출처: `_workspace/00_input/scope_6-polar-billing.md` 결정 4번(정정 이력 포함),
> `_workspace/02_core-services_polar-interface.md` §3.

- 매핑 테이블은 **`src/services/polar/`의 상수 객체 하나**로 두고 라우트는 그것만 참조한다. 라우트에 `switch`를 흩뿌리지 마라 — step 3의 테스트가 이 상수를 직접 검증할 수 있어야 한다.
- **step 1/3 실행 시 `polar listen`으로 실제 샌드박스 결제를 한 번 태워, 활성화 시 어떤 이벤트가 오는지 확인할 것.** `subscription.created`만 오고 `subscription.active`가 오지 않는다면 활성화가 영영 안 된다. 그 경우에 한해 `subscription.created`를 `data.status === 'active'`일 때만 `'active'`로 매핑하는 항목을 추가한다(그 외에는 추가하지 마라).

## 5. 멱등 처리 방식

**별도 이벤트 테이블도, 이벤트 ID 저장도 하지 않는다.** 멱등성은 쓰기 자체의 형태로 확보한다:

- 쓰기는 항상 `user_id`를 충돌 키로 하는 **upsert 1회**다. (`subscriptions.user_id`에 unique 제약이 이미 있어 PostgREST `onConflict: "user_id"`가 성립한다.)
- 쓰는 값은 `status` 하나이고, 그 값은 **이벤트 타입의 순수 함수**다. 따라서 같은 이벤트를 1회 처리하든 10회 처리하든 결과 행은 동일하다(`updated_at`만 갱신됨).
- `subscriptions`에 해당 사용자 행이 아직 **없는 것이 정상**이다(현재 어떤 코드도 이 테이블에 INSERT하지 않는다). 그러므로 `update`가 아니라 **반드시 upsert**여야 한다. `update`로 짜면 첫 결제가 0행 갱신으로 조용히 실패한다.
- `updated_at` 자동 갱신 트리거가 **없다.** 쓰기 코드가 `updated_at: new Date().toISOString()`을 명시적으로 넣어야 한다.

테스트로 고정할 불변식(step 3): *같은 이벤트를 두 번 처리하면 admin 쓰기 함수가 동일한 인자로 호출되고, 두 번째 호출 후에도 최종 `status`가 바뀌지 않는다.*

## 6. DB 쓰기 경로 (CRITICAL — 변경 금지 사항 포함)

새 헬퍼를 `src/services/supabase-admin/index.ts`에 추가한다(웹훅 step에서 구현):

```
upsertSubscriptionStatus(input: { userId: string; status: "active" | "inactive" }): Promise<void>
```

- 내부에서 `createServiceClient()`(= `lib/supabase/service.ts`, service-role)로 `subscriptions`에 `{ user_id, status, updated_at }`를 `onConflict: "user_id"`로 upsert한다. 기존 `insertAnalysis`/`upsertPremiumReport`와 같은 파일·같은 스타일.
- `src/services/supabase-admin/index.test.ts` / `index.test-d.ts`가 이미 있으므로 **기존 테스트를 깨지 말고 확장**한다.
- **라우트 핸들러가 `lib/supabase/service`나 `@supabase/supabase-js`를 직접 import하지 않는다.** 반드시 이 헬퍼를 거친다 (CLAUDE.md: 외부 API 호출은 `src/services/`를 통해서만).
- **`SUPABASE_SERVICE_ROLE_KEY`에 `NEXT_PUBLIC_` 금지, 클라이언트 컴포넌트 전달 금지.**
- **읽기 경로(`src/lib/supabase/server.ts`의 `getSubscriptionStatus`)를 수정하지 마라.** 세션 기반 RLS 읽기로 이미 동작 중이며 게이팅 판정의 유일한 소스다. 웹훅이 쓰고, 이 함수가 읽는다.
- **`subscriptions`에 INSERT/UPDATE RLS 정책을 추가하지 마라.** `select_own_subscription`(SELECT 전용) 하나만 존재해야 한다. 쓰기 정책을 열면 브라우저에서 사용자가 자기 `status`를 `'active'`로 바꿔 페이월을 우회할 수 있다 — 이것이 ADR-004가 쓰기 정책 자체를 금지하는 이유다.

## 7. `subscriptions` 최종 스키마 (이번 phase 종료 시점 = **현재와 동일**)

`supabase/migrations/20260720164534_create_subscriptions.sql` 그대로. **새 마이그레이션 파일 없음. `src/types/database.ts` 변경 없음.**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `user_id` | uuid | not null, **unique**, FK → `auth.users(id)` on delete cascade |
| `status` | text | not null, default `'inactive'`, check in (`'active'`, `'inactive'`) |
| `created_at` | timestamptz | not null, default `now()` |
| `updated_at` | timestamptz | not null, default `now()` (자동 갱신 트리거 없음 — 쓰기 코드가 설정) |

RLS: `select_own_subscription` — `for select to authenticated using (auth.uid() = user_id)`. **쓰기 정책 없음.**

Polar 식별자(`customer_id`, `subscription_id`, `current_period_end`)는 **어디에도 저장하지 않는다.** 필요해지면 Polar API를 `external_customer_id = <supabase user.id>`로 조회한다.

## 8. 알려진 한계 · 리더 확인 요청

이번 설계가 **의도적으로 감수하는** 것들이다. 후속 플래너는 이걸 임의로 "고치지" 말고, 필요하면 리더에게 올린다.

1. **이벤트 순서 뒤바뀜 시 과다 엔타이틀먼트 (수용된 리스크).**
   `subscription.active` 전달이 실패해 백오프 재시도 중인 사이에 `subscription.revoked`가 먼저 성공하면, 뒤늦게 도착한 `active` 재시도가 `'inactive'`를 다시 `'active'`로 되돌린다. 결과는 "해지된 사용자가 Premium을 유지"(매출 누수)이며, 다음 실제 이벤트에서 자가 교정된다. PII 노출이나 소유권 침해는 아니다.
   *해결하려면* 이벤트 타임스탬프를 담을 단조 버전 컬럼(예: `polar_event_at timestamptz`)을 추가하고 `.lt("polar_event_at", eventTs)` 가드로 조건부 갱신해야 한다 — 즉 **순서 내성이 필요하다고 판단되는 순간에만 마이그레이션이 정당화된다.** 지금은 샌드박스·단일 상품·저빈도라 MVP 범위 밖으로 둔다.
2. **[해결됨 — 2026-08-07 리더 수용] `subscription.canceled → 'inactive'` 매핑이 ADR-006의 서술과 어긋난다.**
   → 지적이 맞았다. §4 표를 정정했으며 `canceled`/`past_due`는 무시로 바뀌었다. 아래는 당시 원문 기록이다.
   ADR-006은 "취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지"라고 적혀 있다. Polar에서 `subscription.canceled`는 *사용자가 해지를 예약한 시점*에, `subscription.revoked`는 *실제 접근이 끝나는 시점*에 발생한다. 리더 결정 4번대로 하면 해지 예약 즉시 Premium이 끊긴다(사용자가 이미 낸 돈만큼 못 씀).
   ADR-006대로 가려면 `canceled`를 무시하고 `revoked`/`past_due`만 `'inactive'`로 매핑하면 된다 — **어느 쪽을 택하든 스키마 변경은 필요 없다.** 이 문서는 리더 결정 4번을 정본으로 두되, 리더가 재검토하기를 권고한다.
3. **`polar listen` 터널링 환경에서만 검증된다.** Vercel 배포 후 대시보드 엔드포인트 등록은 이번 phase 범위 밖(scope 문서).
