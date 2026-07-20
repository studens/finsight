# Step 1: Supabase 읽기 클라이언트 + RLS 읽기 쿼리 헬퍼

## 작업
API 라우트가 사용할 **읽기 경계**를 `src/lib/supabase/server.ts`에 TDD로 구현한다. 모든 읽기는 사용자 세션 기반 RLS 적용 클라이언트로 수행해, RLS SELECT 정책이 실제 방어선이 되게 한다(db-schema 계약: 두 테이블 모두 `auth.uid() = user_id` SELECT 전용 RLS). **테스트를 먼저 작성**한다.

`@supabase/ssr`의 `createServerClient`(쿠키 기반)로 RLS 클라이언트를 만들고, 아래 함수들을 export 한다.

```typescript
// src/lib/supabase/server.ts
export async function createClient(): Promise<SupabaseClient>;           // 세션 쿠키 기반, RLS 적용
export async function getSessionUser(): Promise<User | null>;           // auth.getUser() 결과 (없으면 null)

// analyses 단건 조회 — 소유권 판정과 캐시 조회 모두에 쓰이므로 원본 컬럼을 그대로 반환
export async function getAnalysisById(analysisId: string): Promise<{
  id: string;
  user_id: string;
  created_at: string;
  masked_transactions: unknown;
  free_summary: FreeSummary;
  premium_reports: Record<string, unknown> | null;
} | null>;

// 구독 상태 — 본인 행이 없으면 'inactive'로 취급
export async function getSubscriptionStatus(userId: string): Promise<'active' | 'inactive'>;

// 전월 대비용 직전 레코드 (created_at < beforeCreatedAt, created_at desc, limit 1)
export async function getPreviousAnalysis(userId: string, beforeCreatedAt: string): Promise<AnalysisRecord | null>;

// 대시보드 이력 목록 — 본인 소유 analyses 목록 (created_at desc). masked_transactions/premium_reports는 목록에 불필요하므로 제외.
export async function listUserAnalyses(): Promise<{ id: string; createdAt: string; freeSummary: FreeSummary }[]>;
```

계약 인용 (db-schema `_workspace/02_db-schema_schema.md`):
- `analyses`: `id uuid`, `user_id uuid not null`, `created_at timestamptz`, `masked_transactions jsonb not null`, `free_summary jsonb not null`, `premium_reports jsonb nullable default null`. 인덱스 `(user_id, created_at desc)` — `getPreviousAnalysis`가 이 인덱스를 탄다.
- `subscriptions`: `user_id` unique, `status text` in (`'active'`,`'inactive'`) default `'inactive'`. **Premium 게이팅 판정 = 본인 행이 `status='active'`인지 여부.**

계약 인용 (core-services `_workspace/02_core-services_interface.md`):
- `FreeSummary = { totalSpent, transactionCount, categoryTotals, topMerchants }`.
- `AnalysisRecord = { id: string; createdAt: string; maskedTransactions: MaskedRow[]; freeSummary: FreeSummary }`. `getPreviousAnalysis`는 DB의 `snake_case` 컬럼을 이 `camelCase` shape으로 매핑해 반환한다.

`src/types/database.ts`(db-schema step2 산출)와 `src/types/pipeline.ts`(core-services step0 산출)의 타입을 재사용한다. 새 타입을 중복 정의하지 않는다.

## Acceptance Criteria
- [ ] `getAnalysisById`가 존재하지 않는 id 또는 다른 사용자의 레코드(RLS로 안 보임)에 대해 `null`을 반환하는 테스트가 통과한다.
- [ ] `getSubscriptionStatus`가 본인 행이 없을 때 `'inactive'`를, `status='active'` 행이 있을 때 `'active'`를 반환하는 테스트가 통과한다.
- [ ] `getPreviousAnalysis`가 `created_at < beforeCreatedAt` 조건으로 `created_at desc`의 첫 레코드를 반환하고, 없으면 `null`을 반환하며, 반환 shape이 `AnalysisRecord`(`camelCase`, `maskedTransactions`/`freeSummary` 포함)임을 확인하는 테스트가 통과한다.
- [ ] `listUserAnalyses`가 본인 소유 레코드만 `created_at desc`로 반환하고(RLS로 남의 행 미노출), 각 항목이 `{ id, createdAt, freeSummary }` shape이며 `masked_transactions`/`premium_reports`를 포함하지 않는 테스트가 통과한다. (프론트 대시보드 이력 목록이 Server Component에서 직접 호출)
- [ ] (읽기 경계 CRITICAL) `src/lib/supabase/server.ts`가 `SUPABASE_SERVICE_ROLE_KEY`를 참조하지 않고 anon 키 + 세션 쿠키만 사용함을 grep으로 확인한다. 이 파일에는 INSERT/UPDATE 호출이 없다(읽기 전용).
- [ ] 기존 db-schema/core-services 타입(`src/types/database.ts`, `src/types/pipeline.ts`)을 import해서 쓰고, `FreeSummary`/`AnalysisRecord`를 중복 선언하지 않는다.
