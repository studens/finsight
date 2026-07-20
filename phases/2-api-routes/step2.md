# Step 2: service-role 클라이언트 + supabase-admin 쓰기 서비스 (소유권 직접 검증)

## 작업
API 라우트가 사용할 **쓰기 경계**를 TDD로 구현한다. 두 파일을 만든다:
1. `src/lib/supabase/service.ts` — service-role 원시 클라이언트(`SUPABASE_SERVICE_ROLE_KEY`, RLS 우회). 서버 전용.
2. `src/services/supabase-admin/` — 위 클라이언트를 감싸 DB 쓰기를 수행하며, **쓰기 전에 코드로 `user_id` 소유권을 직접 검증**하는 서비스.

**테스트를 먼저 작성**한다.

### `src/lib/supabase/service.ts`
```typescript
export function createServiceClient(): SupabaseClient; // service-role 키 사용, RLS 우회
```
- `SUPABASE_SERVICE_ROLE_KEY`와 `NEXT_PUBLIC_SUPABASE_URL`을 사용한다. 키가 없으면 즉시 throw.
- 이 파일은 서버 전용이다. 클라이언트 컴포넌트/미들웨어에서 import 되지 않으며, 키에 `NEXT_PUBLIC_` 접두어를 붙이지 않는다.

### `src/services/supabase-admin/`
```typescript
// analyses INSERT — 마스킹된 요약 데이터만 저장 (원본 CSV/PII 저장 금지)
export async function insertAnalysis(input: {
  userId: string;
  maskedTransactions: MaskedRow[];
  freeSummary: FreeSummary;
}): Promise<{ id: string }>;

// premium_reports 캐시 upsert — 쓰기 전 소유권 검증 필수
export async function upsertPremiumReport(input: {
  userId: string;
  analysisId: string;
  reportType: ReportType;
  report: PremiumReport;
}): Promise<void>;
```

계약 인용 (db-schema `_workspace/02_db-schema_schema.md`):
- `analyses` INSERT 컬럼: `user_id`(input.userId), `masked_transactions`(jsonb), `free_summary`(jsonb). `id`/`created_at`은 DB default.
- 두 테이블 모두 **쓰기 RLS 정책 없음** → 쓰기는 service-role 경유가 유일한 경로이고, 그래서 코드가 소유권을 직접 지켜야 한다.
- `premium_reports`는 `reportType`별 키를 가진 jsonb. 부분 캐시 허용(미생성 키는 없음). upsert는 기존 jsonb에 `{ [reportType]: report }`를 **병합**한다(다른 키를 덮어쓰지 않는다).

계약 인용 (core-services `_workspace/02_core-services_interface.md`):
- `ReportType = 'mom_comparison' | 'anomaly_detection' | 'savings_suggestions' | 'budget_recommendation'` — `premium_reports` jsonb 키와 정확히 일치.
- `MaskedRow`는 브랜디드 타입(오직 `maskPii`만 부여). `insertAnalysis`는 이미 브랜드된 `MaskedRow[]`만 받는다.

### 소유권 검증 규칙 (CRITICAL — 이 step의 핵심)
`upsertPremiumReport`는 UPDATE(service-role) **직전에** 대상 `analysisId`의 `user_id`가 `input.userId`와 일치하는지 코드로 확인한다. 불일치하거나 레코드가 없으면 쓰기를 수행하지 않고 에러를 던진다(호출자인 라우트가 이를 404로 변환). service-role은 RLS를 우회하므로, 이 검증을 빠뜨리면 다른 사용자의 레코드를 덮어쓸 수 있다.

`insertAnalysis`는 새 레코드를 `input.userId` 소유로 생성하므로, `user_id`를 반드시 `input.userId`로 세팅한다(클라이언트가 보낸 임의 값이 아니라 인증된 세션에서 온 값).

## Acceptance Criteria
- [ ] (소유권 직접 검증 CRITICAL) `upsertPremiumReport`가 service-role UPDATE 실행 전에 `analysisId`의 소유 `user_id === input.userId`를 확인하고, **불일치 시 UPDATE를 호출하지 않고** 에러를 던지는 테스트가 통과한다(service-role 쓰기 mock이 호출되지 않음을 assert).
- [ ] `insertAnalysis`가 `user_id`를 `input.userId`로 세팅해 INSERT 하고, `masked_transactions`/`free_summary`만 저장하며 원본/비마스킹 필드를 저장하지 않는 테스트가 통과한다. 반환값에 새 `id`가 담긴다.
- [ ] `upsertPremiumReport`가 기존 `premium_reports` jsonb의 다른 키를 보존한 채 `{ [reportType]: report }`만 병합 갱신하는 테스트가 통과한다.
- [ ] (타입 경계) `insertAnalysis`의 `maskedTransactions` 파라미터 타입이 `MaskedRow[]`이며, 비브랜드 `RawRow[]`를 그대로 넘기면 컴파일 에러가 남을 확인한다.
- [ ] (service-role 격리 CRITICAL) service-role 키는 `src/lib/supabase/service.ts`에서만 참조되고, `NEXT_PUBLIC_` 접두어가 없으며, 이 서비스가 클라이언트 컴포넌트에서 import 되지 않음을 grep으로 확인한다.
