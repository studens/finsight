# Step 0: analyses 테이블 + RLS 정책 마이그레이션

## 작업

Supabase(Postgres)에 `analyses` 테이블을 생성하는 마이그레이션을 작성·적용한다. 이 테이블은 마스킹된 거래 데이터와 구조화된 집계값만 저장하며, 원본 CSV/PII는 절대 저장하지 않는다.

절차:
1. Supabase MCP `list_tables`로 현재 스키마를 먼저 확인한다 (이미 `analyses`가 있으면 컬럼/제약을 아래 정의와 대조해 부족분만 반영).
2. 아래 DDL을 담은 마이그레이션 파일을 `supabase/migrations/<timestamp>_create_analyses.sql`에 저장한다(리포지토리에 버전 관리되도록). 같은 SQL을 Supabase MCP `apply_migration`(name: `create_analyses`)으로 원격에 적용한다.
3. **테이블 생성 DDL과 RLS 활성화·정책을 반드시 하나의 마이그레이션에 함께 포함**한다 — RLS가 적용되지 않은 테이블이 단 한 순간도 존재하지 않아야 한다.

### 컬럼 정의 (`analyses`)
- `id` — `uuid primary key default gen_random_uuid()`
- `user_id` — `uuid not null references auth.users(id) on delete cascade` (소유권 컬럼)
- `created_at` — `timestamptz not null default now()`
- `masked_transactions` — `jsonb not null` — 마스킹 완료된 거래 배열
- `free_summary` — `jsonb not null` — 카테고리별 합계, 총 지출/거래 건수, 가맹점 Top 5
- `premium_reports` — `jsonb`(nullable, default null) — Premium 리포트 지연 생성 캐시. reportType별 키로 부분 캐시(예: `{ "mom_comparison": {...}, "anomaly_detection": {...}, "savings_suggestions": {...}, "budget_recommendation": {...} }`). 미생성 상태에서는 `null`이 정상.

### 인덱스
- `(user_id, created_at desc)` 복합 인덱스. "전월 대비" 리포트가 같은 `user_id`의 직전 레코드를 `created_at desc limit 2`로 조회하는 것을 뒷받침한다.

### RLS 정책 (SELECT 전용, 쓰기 정책 없음)
```sql
alter table analyses enable row level security;

create policy "select_own_analyses" on analyses
  for select
  to authenticated
  using (auth.uid() = user_id);
```

## Acceptance Criteria
- [ ] `supabase/migrations/` 아래에 `analyses` 테이블 DDL과 RLS 정책을 함께 담은 마이그레이션 파일이 존재하고, 같은 내용이 `apply_migration`으로 원격에 적용되어 `list_tables` 결과에 `analyses`가 나타난다.
- [ ] `analyses`의 컬럼이 정확히 다음과 같다: `id`, `user_id`, `created_at`, `masked_transactions`(jsonb, not null), `free_summary`(jsonb, not null), `premium_reports`(jsonb, nullable). 그 외 컬럼은 없다.
- [ ] 원본 PII를 담을 수 있는 컬럼(예: 마스킹되지 않은 카드번호/계좌번호/이름/전화번호 전용 컬럼, 원본 CSV 텍스트를 담는 컬럼)이 **하나도 없다**. DB에는 마스킹된 요약/구조화 데이터만 저장한다는 CRITICAL 규칙을 컬럼 구성이 위반하지 않는다.
- [ ] `user_id`가 `auth.users(id)`를 참조하는 FK이며 `on delete cascade`가 걸려 있다.
- [ ] `(user_id, created_at desc)` 복합 인덱스가 생성되어 있다.
- [ ] `analyses`에 row level security가 활성화되어 있고, `authenticated` 롤에 대한 `for select ... using (auth.uid() = user_id)` 정책이 **정확히 하나만** 존재한다.
- [ ] `analyses`에 INSERT/UPDATE/DELETE 정책이 **하나도 없다**. 모든 쓰기는 API Route의 service-role 클라이언트(RLS 우회)로만 수행되므로 `authenticated` 롤에 쓰기 정책을 열어두면 브라우저에서 직접 조작된 데이터를 삽입할 수 있어 "마스킹된 데이터만 저장된다" 불변식이 깨진다 — 따라서 쓰기 정책을 만들지 않는다.
