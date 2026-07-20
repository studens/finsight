# core-services 확정 인터페이스 (phase 1-core-services)

> api-routes / frontend planner가 참조하는 **서비스 함수 시그니처 계약**이다.
> 계획 파일: `phases/1-core-services/`. 공유 타입: `src/types/pipeline.ts`(step 0).
> db-schema 계약: `_workspace/02_db-schema_schema.md`.

## 공유 타입 (`src/types/pipeline.ts`)

```typescript
type RawRow = Record<string, string>;                 // 마스킹 전 원본 행 (csv-parser 출력)
type ParsedCsv = { headers: string[]; rows: RawRow[]; rowCount: number };

type MaskedRow = Record<string, string> & { readonly __masked: unique symbol }; // 브랜디드 — pii-masking만 부여
type MaskedDataset = {
  headers: string[];
  rows: MaskedRow[];
  excludedColumns: string[];   // 이름/전화 등 통째로 제거된 컬럼명
  maskedColumns: string[];     // 뒤 4자리만 남기고 마스킹된 컬럼명
};

type ColumnMapping = { date: string|null; merchant: string|null; amount: string|null; category: string|null; confidence: number };
type ConfirmedMapping = { date: string; merchant: string; amount: string; category: string|null };

type FreeSummary = {
  totalSpent: number;
  transactionCount: number;
  categoryTotals: Record<string, number>;
  topMerchants: { merchant: string; amount: number }[];
}; // analyses.free_summary jsonb 그대로

type ReportType = 'mom_comparison' | 'anomaly_detection' | 'savings_suggestions' | 'budget_recommendation';
// ↑ analyses.premium_reports jsonb 캐시 키와 정확히 일치 (db-schema 계약)

type AnalysisRecord = { id: string; createdAt: string; maskedTransactions: MaskedRow[]; freeSummary: FreeSummary };
type PremiumReport = MonthOverMonthReport | AnomalyReport | SavingsReport | BudgetReport;
// 각 리포트 결과 타입의 구체 필드는 step 5/6에서 확정.
```

**핵심 불변식(타입 레벨):** llm 서비스의 모든 입력은 `MaskedRow`/`AnalysisRecord`만 받는다. `RawRow[]`(원본)를 llm 함수에 넘기면 컴파일 에러 — 원본 값이 Claude로 가는 경로가 타입상 존재하지 않는다.

## csv-parser (`src/services/csv-parser`)

```typescript
export function parseCsv(input: Buffer | Uint8Array): ParsedCsv;
```
- 인코딩 감지(EUC-KR/CP949 → UTF-8) 후 인메모리 파싱. 디스크/로그 기록 없음.
- 출력은 **원본** `RawRow[]` — 마스킹 안 됨.

## pii-masking (`src/services/pii-masking`)

```typescript
export function maskPii(parsed: ParsedCsv): MaskedDataset;
```
- 카드/계좌번호: 뒤 4자리만 남기고 마스킹(구분자 유무 모두). 이름/전화 등: 컬럼 자체 제거.
- `MaskedRow` 브랜드를 부여하는 **유일한** 지점.

## llm (`src/services/llm`)

```typescript
// 컬럼 매핑 추론 (마스킹된 샘플만 입력)
export function inferColumnMapping(input: { headers: string[]; sampleRows: MaskedRow[] }): Promise<ColumnMapping>;

// Free 요약 (업로드 시 생성/저장)
export function generateFreeSummary(input: { rows: MaskedRow[]; mapping: ConfirmedMapping }): Promise<FreeSummary>;

// Premium 리포트 — 리포트 타입별 독립 함수 (지연 생성 단위)
export function generateMomComparison(input: { current: AnalysisRecord; previous: AnalysisRecord | null }): Promise<MonthOverMonthReport>;
export function generateAnomalyDetection(input: { current: AnalysisRecord }): Promise<AnomalyReport>;
export function generateSavingsSuggestions(input: { current: AnalysisRecord }): Promise<SavingsReport>;
export function generateBudgetRecommendation(input: { current: AnalysisRecord }): Promise<BudgetReport>;

// Premium 디스패처 — api-routes가 reportType 하나로 호출
export function generateReport(input: {
  reportType: ReportType;
  current: AnalysisRecord;
  previous: AnalysisRecord | null;   // mom_comparison에서만 사용
}): Promise<PremiumReport>;
```

## api-routes가 반드시 지켜야 할 경계 (이 phase 범위 밖 → api-routes 책임)

- **구독 체크(페이월)**: llm 리포트 함수는 구독 여부를 확인하지 않는다. api-routes가 `subscriptions.status='active'` 확인 후에만 `generateReport`를 호출하고, 미구독이면 호출 없이 403 `PAYWALL_REQUIRED`.
- **DB 조회/쓰기**: `previous` `AnalysisRecord`(직전 레코드) 조회, `premium_reports` 캐시 조회/upsert, `analyses` INSERT는 모두 api-routes/`supabase-admin` 책임. llm 함수는 인자로 받고 결과만 반환한다.
- **캐시 키**: `premium_reports` jsonb의 키 = `ReportType` 리터럴(`mom_comparison` 등)과 정확히 일치.
- **파이프라인 순서**: `parseCsv` → `maskPii` → llm 함수. 타입상 `maskPii`를 거치지 않은 데이터는 llm에 못 들어간다.
