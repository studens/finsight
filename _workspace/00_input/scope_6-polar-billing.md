# Scope: 6-polar-billing

작성일: 2026-08-07
Phase 디렉토리: `phases/6-polar-billing/`
브랜치(execute.py 자동 생성): `feat-6-polar-billing`

## 배경

ADR-006에서 "Polar 실제 결제 연동은 후속 phase로 분리, 이번엔 엔타이틀먼트 스키마만"으로 결정했고,
`0-db-schema`~`5-logout`이 모두 완료된 지금 그 후속 phase에 해당한다.

현재 상태:
- `subscriptions` 테이블: `user_id`(unique) + `status ('active'|'inactive')` 만 존재. SELECT-only RLS.
- `src/lib/supabase/server.ts`의 `getSubscriptionStatus`로 게이팅 읽기는 이미 동작 중.
- `src/app/api/webhooks/polar/route.ts` — 6줄짜리 `501 NOT_IMPLEMENTED` 스텁.
- `PremiumSection` — 정적 잠금 카드만 렌더. 업그레이드 CTA가 어디에도 연결돼 있지 않음.
- `src/services/polar/` 없음. 체크아웃 라우트 없음.

## 사용자가 이미 준비한 것 (blocked 사유 아님)

Polar 샌드박스 조직·제품·CLI가 모두 준비 완료다. **Codex는 Polar 대시보드 조작이나 키 발급을 요구하지 마라.**

- Polar CLI `v1.3.9` 설치됨 (`/usr/local/bin/polar`)
- `.env.local`에 아래 5개가 **이미 채워져 있다**:
  - `POLAR_ACCESS_TOKEN` (샌드박스 organization access token)
  - `POLAR_WEBHOOK_SECRET` (`polar listen`이 출력한 값)
  - `POLAR_PRODUCT_ID=bf1600f8-7e5c-45cb-843c-728ec579cce4`
  - `POLAR_SERVER=sandbox`
  - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- `.env.example`에도 위 5개 키가 주석과 함께 문서화됨
- 로컬 웹훅 수신은 `polar listen http://localhost:3000/api/webhooks/polar`로 터널링한다.
  대시보드 엔드포인트 등록은 **Vercel 배포 후**의 일이므로 이 phase 범위 밖.

## 이번 phase 범위

**확정된 최종 step 배치** (계획 수립 후 재번호됨):

| step | 담당 플래너 | 내용 |
|---|---|---|
| 0 | core-services | `src/services/polar/` — SDK 래퍼(체크아웃 세션 생성, 웹훅 서명 검증/파싱, 상태 매핑) + 유닛 테스트 |
| 1 | api-routes | `POST /api/checkout` — 로그인 사용자용 체크아웃 세션 발급 |
| 2 | api-routes | `/api/webhooks/polar` 501 스텁 → 서명 검증 + `subscriptions` upsert |
| 3 | frontend | `PremiumSection` 잠금 카드 → 체크아웃 CTA 연결, 결제 복귀 배너 |

> **DB 스키마 step은 없다.** db-schema 플래너가 검토 결과 마이그레이션 불필요로 결론냈다(A안).
> 체크아웃 시 `externalCustomerId`에 Supabase `user.id`를 실어 보내고 웹훅에서 역참조하면,
> 쓰기가 `user_id` 유니크 키 upsert 1회라 구조적으로 멱등해 Polar의 최대 10회 재시도에도 안전하다.
> `polar_subscription_id`에 unique를 걸면 해지 후 재구독 시 충돌하는 새 실패 모드가 생긴다.
> 근거 전문: `_workspace/02_db-schema_polar-mapping.md`.
> ADR-006이 "컬럼 추가·`polar_webhook_events` 테이블 필요"라 예상했으나 그건 결정이 아니라 당시 비용 추정이다.

## 범위 밖 (명시적 제외)

- 프로덕션 Polar 조직 생성·심사·payout 계정 — 사용자 몫, 배포 시점
- Vercel 대시보드 웹훅 엔드포인트 등록
- 요금제 다중 티어, 트라이얼, 쿠폰/할인 (PRD "MVP 제외 사항")
- 청구서/영수증 화면, 구독 취소 UI (Polar 고객 포털로 대체 가능하나 이번엔 미포함)
- Playwright E2E — 별도 phase

## 리더가 정한 기본 결정 (플래너는 이 전제를 따른다)

1. **환경변수 이름은 위 5개를 그대로 쓴다.** 새 이름을 발명하지 마라.
2. **체크아웃 성공 복귀**: `${NEXT_PUBLIC_APP_URL}/dashboard?checkout=success`.
   취소/이탈 복귀는 Polar 기본 동작에 맡기고 별도 cancel URL을 만들지 않는다.
3. **Polar 고객 ↔ Supabase 사용자 매핑**은 체크아웃 생성 시 `externalCustomerId`(또는 metadata)에
   Supabase `user.id`를 실어 보내고, 웹훅에서 그 값으로 역참조하는 방식을 1순위로 검토한다.
   추가 컬럼이 정말 필요한지는 step 0에서 db-schema가 판단한다.
4. **웹훅 → status 매핑** (현 스키마가 2값뿐이므로):
   - `subscription.active`, `subscription.uncanceled` → `'active'`
   - `subscription.revoked` → `'inactive'`
   - `subscription.canceled`, `subscription.past_due` → **무시(상태 변경 없음)**, 200 응답
   - 그 외 이벤트도 200으로 무시(에러 아님)

   > **정정 이력 (2026-08-07, 리더).** 초안은 `canceled`/`past_due`도 `'inactive'`로 뒤집었으나
   > **ADR-006 위배**다. ADR-006 결정문: *"취소 시에도 이미 결제된 기간이 끝날 때까지 Premium을 유지하는
   > 방식으로 구현한다."* Polar에서 `canceled`는 **해지 예약**(기간 말 종료 예정) 시점이고 실제 접근 종료는
   > `revoked`가 온다. 초안대로면 사용자가 이미 지불한 기간을 즉시 잃는다. `past_due`도 결제 재시도(dunning)
   > 중일 뿐이라 유예가 맞고, Polar이 포기하면 `revoked`를 보낸다.
   > db-schema·core-services 플래너가 독립적으로 같은 지적을 했고 리더가 ADR 원문을 확인해 수용했다.
5. **SDK**: `@polar-sh/sdk`를 쓴다. 서명 검증은 직접 HMAC 구현하지 말고 SDK의
   `validateEvent()`를 쓴다 — Polar은 Standard Webhooks 사양이고 secret을 base64로 취급하는
   함정이 있어 수동 구현 시 틀리기 쉽다.

## 반드시 지켜야 할 CRITICAL 규칙 (CLAUDE.md)

- 외부 API 호출(Polar SDK)은 `src/services/polar/`를 통해서만. 라우트 핸들러가 SDK를 직접 import 금지.
- `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET`에 `NEXT_PUBLIC_` 접두어 금지. 클라이언트 컴포넌트 전달 금지.
- 웹훅은 **서명 검증을 통과한 뒤에만** 구독 상태를 갱신한다. 검증 실패 시 요청 거부.
- DB 쓰기는 `services/supabase-admin`의 service-role 클라이언트로만. 코드에서 소유권 직접 검증.
- Premium 리포트 lazy-generate·403 게이팅 동작을 깨뜨리지 않는다.
- TDD: 테스트 먼저, 통과하는 구현 나중.
