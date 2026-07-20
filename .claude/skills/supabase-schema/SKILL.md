---
name: supabase-schema
description: "finsight의 Supabase 테이블 설계, RLS 정책 작성, 마이그레이션 적용 워크플로우. analyses/subscriptions 테이블 컬럼 설계, SELECT-only RLS 정책, service-role 쓰기 경로 검증이 필요할 때 사용. 새 테이블 추가, 컬럼 변경, RLS 정책 작성/점검 요청 시 반드시 이 스킬을 먼저 로드한다."
---

# Supabase 스키마 설계 가이드

> **사용 방식:** db-schema 에이전트가 이 내용을 직접 구현하지 않는다. 아래 원칙을 `phase-planning` 스킬 형식에 맞춰 Codex가 실행할 step의 작업 지시문·Acceptance Criteria로 옮겨 적는 데 사용한다.

finsight는 카드 명세서 데이터를 다루므로, 스키마 설계 자체가 "원본 미저장"과 "페이월 이중 강제"라는 두 CRITICAL 규칙의 실제 방어선이다. 컬럼 하나를 잘못 추가하면 그 규칙이 코드가 아니라 스키마 단에서 깨질 수 있다.

## 테이블 설계 원칙

### analyses 테이블
마스킹된 거래 데이터와 구조화된 집계값만 저장한다. 다음 컬럼을 포함한다:
- `id`, `user_id` (FK, 소유권 컬럼), `created_at`
- `masked_transactions` (jsonb) — 마스킹 완료된 거래 배열. 원본 카드/계좌번호나 이름 컬럼이 이 안에 들어가면 안 된다.
- `free_summary` (jsonb) — 카테고리별 합계, 총 지출/거래 건수, 가맹점 Top 5
- `premium_reports` (jsonb, nullable) — 지연 생성 캐시. 미생성 상태에서는 `null`이 정상이다. reportType별로 키를 나눠 저장(예: `{ "mom_comparison": {...}, "anomaly_detection": {...} }`)해 부분 캐시를 허용한다.

컬럼을 추가하기 전에 스스로 물어볼 것: "이 컬럼에 원본 PII가 들어갈 수 있는가?" 그렇다면 설계를 다시 한다.

### subscriptions 테이블 (이번 phase는 스키마만)
- `id`, `user_id` (FK), `status` (예: `active`/`inactive`), `created_at`, `updated_at`
- Polar 전용 컬럼(`customer_id`, `current_period_end` 등)은 아직 값을 채울 수 없으므로 이번 phase에서 추가하지 않는다. `polar-billing` phase에서 마이그레이션으로 추가한다.
- 개발 중 Premium 흐름을 테스트하려면 이 테이블에 수동으로 레코드를 넣어 구독 상태를 시뮬레이션한다.

## RLS 정책 패턴

모든 사용자 스코프 테이블에 다음 정책만 적용한다 (쓰기 정책은 만들지 않는다):

```sql
alter table analyses enable row level security;

create policy "select_own_analyses" on analyses
  for select
  to authenticated
  using (auth.uid() = user_id);
```

INSERT/UPDATE 정책을 별도로 만들지 않는 이유: 모든 쓰기는 `src/services/supabase-admin/`이 `lib/supabase/service.ts`(service-role 키)로 수행하고, service-role은 RLS를 우회하므로 애초에 정책이 필요 없다. 오히려 `authenticated` 롤에 쓰기 정책을 열어두면 브라우저에서 Supabase 클라이언트로 직접 테이블에 쓸 수 있게 되어 "마스킹된 데이터만 저장된다"는 불변식을 우회할 수 있다 — 이것이 ADR-004가 쓰기 정책 자체를 금지하는 이유다.

## 마이그레이션 워크플로우

1. `list_tables`로 현재 스키마 확인
2. `apply_migration`으로 DDL 적용 (테이블 생성 + RLS 정책을 같은 마이그레이션에 포함 — RLS 없는 테이블이 잠깐이라도 존재하지 않도록)
3. `get_advisors`로 보안 어드바이저 점검 — RLS 미적용 테이블 경고가 남아있으면 안 된다
4. 스키마가 확정되면 `generate_typescript_types`로 `src/types/`에 쓸 타입 생성

## "전월 대비" 계산을 위한 조회 패턴

Premium의 "전월 대비" 리포트는 같은 `user_id`의 직전 `analyses` 레코드가 필요하다. `created_at desc` 정렬 + `limit 2`(현재 + 직전)로 조회 가능하도록 인덱스(`user_id, created_at`)를 고려한다.
