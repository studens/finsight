# db-schema 확정 스키마 (phase 0-db-schema)

> 이 문서는 core-services / api-routes / frontend planner가 참조하는 **확정 테이블/컬럼 계약**이다.
> 계획 파일: `phases/0-db-schema/`. TypeScript 타입: `src/types/database.ts` (step2에서 생성).

## analyses

마스킹된 거래 데이터 + 구조화된 집계값만 저장. 원본 CSV/PII 저장 금지.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `user_id` | uuid | not null, FK → `auth.users(id)` on delete cascade | 소유권 컬럼 |
| `created_at` | timestamptz | not null, default `now()` | |
| `masked_transactions` | jsonb | not null | 마스킹 완료된 거래 배열 (뒤 4자리만 남긴 카드/계좌, 이름·전화 컬럼 제외) |
| `free_summary` | jsonb | not null | 카테고리별 합계, 총 지출/거래 건수, 가맹점 Top 5 |
| `premium_reports` | jsonb | nullable, default null | Premium 지연 생성 캐시. reportType별 키 |

- 인덱스: `(user_id, created_at desc)` — "전월 대비" 조회(`created_at desc limit 2`)용.
- `premium_reports` 키 예시: `mom_comparison`, `anomaly_detection`, `savings_suggestions`, `budget_recommendation`. 부분 캐시 허용(미생성 키는 없거나 null).
- RLS: `select_own_analyses` (SELECT 전용, `authenticated`, `auth.uid() = user_id`). **쓰기 정책 없음.**

## subscriptions

구독 엔타이틀먼트 스키마만. Polar 전용 컬럼은 `polar-billing` phase에서 추가(ADR-006).

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `user_id` | uuid | not null, **unique**, FK → `auth.users(id)` on delete cascade | 사용자당 1행 |
| `status` | text | not null, default `'inactive'`, check in (`'active'`,`'inactive'`) | 구독 상태 |
| `created_at` | timestamptz | not null, default `now()` | |
| `updated_at` | timestamptz | not null, default `now()` | 쓰기 코드가 갱신 |

- RLS: `select_own_subscription` (SELECT 전용, `authenticated`, `auth.uid() = user_id`). **쓰기 정책 없음.**
- Premium 게이팅 판정: `status = 'active'` 인 본인 행 존재 여부. 개발 중 Premium 흐름 테스트는 이 테이블에 수동으로 `active` 행을 넣어 시뮬레이션.

## 읽기/쓰기 경계 (planner 공통 계약)

- **읽기**: `lib/supabase/server.ts`(사용자 세션 기반, RLS 적용) 또는 `lib/supabase/client.ts`(브라우저, RLS 적용). RLS SELECT 정책이 실제 방어선.
- **쓰기(INSERT/UPDATE)**: `services/supabase-admin`이 `lib/supabase/service.ts`(service-role, RLS 우회)로만 수행하고, 코드에서 `user_id` 소유권을 직접 검증. 두 테이블 모두 쓰기 RLS 정책이 없으므로 브라우저 직접 쓰기는 불가능.
- `premium_reports` 캐시 갱신도 service-role UPDATE(upsert)로 수행 — UPDATE 정책 없음.
