# Step 1: subscriptions 테이블 + RLS 정책 마이그레이션

## 작업

Supabase(Postgres)에 구독 엔타이틀먼트를 저장하는 `subscriptions` 테이블을 생성하는 마이그레이션을 작성·적용한다. **이번 phase는 엔타이틀먼트 스키마만 만든다.** Polar 실제 결제 연동(체크아웃/웹훅)은 후속 `polar-billing` phase에서 구현하므로, 지금 값을 채울 수 없는 Polar 전용 컬럼(`customer_id`, `current_period_end` 등)은 만들지 않는다 (ADR-006).

**대상 Supabase 프로젝트**: `project_id: peewjgbhqpkysitzqjum` (이름: finsight, 리전: ap-northeast-2). 모든 Supabase MCP 도구 호출에 이 project_id를 사용한다.

절차:
1. Supabase MCP `list_tables`(project_id: `peewjgbhqpkysitzqjum`)로 현재 스키마를 확인한다.
2. 아래 DDL을 담은 마이그레이션 파일을 `supabase/migrations/<timestamp>_create_subscriptions.sql`에 저장하고, 같은 SQL을 Supabase MCP `apply_migration`(project_id: `peewjgbhqpkysitzqjum`, name: `create_subscriptions`)으로 원격에 적용한다.
3. **테이블 생성 DDL과 RLS 활성화·정책을 하나의 마이그레이션에 함께 포함**한다.

### 컬럼 정의 (`subscriptions`)
- `id` — `uuid primary key default gen_random_uuid()`
- `user_id` — `uuid not null unique references auth.users(id) on delete cascade` (소유권 컬럼, 사용자당 1행)
- `status` — `text not null default 'inactive' check (status in ('active','inactive'))`
- `created_at` — `timestamptz not null default now()`
- `updated_at` — `timestamptz not null default now()`

`user_id`에 `unique` 제약을 두는 이유: 구독 상태 조회는 "이 사용자가 active인가"라는 단일 행 판정이므로 사용자당 1행이 자연스럽고, 중복 행으로 인한 게이팅 모호성을 막는다.

### RLS 정책 (SELECT 전용, 쓰기 정책 없음)
```sql
alter table subscriptions enable row level security;

create policy "select_own_subscription" on subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);
```

## Acceptance Criteria
- [ ] `supabase/migrations/` 아래에 `subscriptions` 테이블 DDL과 RLS 정책을 함께 담은 마이그레이션 파일이 존재하고, 같은 내용이 `apply_migration`으로 원격에 적용되어 `list_tables` 결과에 `subscriptions`가 나타난다.
- [ ] `subscriptions`의 컬럼이 정확히 다음과 같다: `id`, `user_id`, `status`, `created_at`, `updated_at`. 그 외 컬럼은 없다.
- [ ] Polar 전용 컬럼(`customer_id`, `current_period_end`, `polar_subscription_id` 등)이 **하나도 없다** — 이번 phase는 엔타이틀먼트 스키마만 만든다는 ADR-006 결정을 위반하지 않는다.
- [ ] `status`는 `check (status in ('active','inactive'))` 제약을 가지며 기본값이 `'inactive'`다.
- [ ] `user_id`가 `auth.users(id)`를 참조하는 FK이고 `unique` 제약과 `on delete cascade`가 걸려 있다.
- [ ] `subscriptions`에 row level security가 활성화되어 있고, `authenticated` 롤에 대한 `for select ... using (auth.uid() = user_id)` 정책이 **정확히 하나만** 존재한다.
- [ ] `subscriptions`에 INSERT/UPDATE/DELETE 정책이 **하나도 없다**. 구독 상태 갱신은 (후속 phase에서) service-role 클라이언트로만 수행되며, `authenticated` 롤에 쓰기 정책을 열면 사용자가 스스로를 `active`로 바꿔 페이월을 우회할 수 있으므로 쓰기 정책을 만들지 않는다.
