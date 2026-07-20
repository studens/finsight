# Step 0: 공유 파이프라인 타입 정의 (브랜디드 MaskedRow 경계)

## 작업
`src/types/pipeline.ts`를 새로 만들고, csv-parser → pii-masking → llm 세 서비스가 공유하는 타입을 정의한다. 이 타입들이 파이프라인 순서를 **컴파일 타임에 강제**하는 1차 방어선이다. 아직 어떤 서비스 구현도 하지 않는다 — 타입 정의와 타입 레벨 테스트만 한다.

정의할 타입:

- `RawRow = Record<string, string>` — csv-parser가 반환하는 **마스킹 전** 원본 행. 이름부터 "원본"임이 드러나야 한다.
- `ParsedCsv = { headers: string[]; rows: RawRow[]; rowCount: number }` — csv-parser 결과.
- `MaskedRow` — **브랜디드 타입**으로 정의한다. 예: `type MaskedRow = Record<string, string> & { readonly __masked: unique symbol }`. 일반 `Record<string,string>`나 `RawRow`를 `MaskedRow`로 대입하면 컴파일 에러가 나야 한다. 이 브랜드는 오직 pii-masking 서비스만 부여할 수 있다(step 2에서 단언).
- `MaskedDataset = { headers: string[]; rows: MaskedRow[]; excludedColumns: string[]; maskedColumns: string[] }` — pii-masking 결과. `excludedColumns`는 신원 식별 컬럼(이름/전화)이라 통째로 제거된 원본 컬럼명, `maskedColumns`는 뒤 4자리만 남기고 마스킹된 컬럼명.
- `ColumnMapping = { date: string | null; merchant: string | null; amount: string | null; category: string | null; confidence: number }` — llm 컬럼 매핑 추론 결과. `confidence`는 0~1.
- `ConfirmedMapping = { date: string; merchant: string; amount: string; category: string | null }` — 사용자가 확인/수정을 마친 확정 매핑(Free 요약 입력).
- `FreeSummary = { totalSpent: number; transactionCount: number; categoryTotals: Record<string, number>; topMerchants: { merchant: string; amount: number }[] }` — `analyses.free_summary` jsonb에 그대로 저장되는 shape(db-schema 확정 계약, `_workspace/02_db-schema_schema.md`).
- `ReportType = 'mom_comparison' | 'anomaly_detection' | 'savings_suggestions' | 'budget_recommendation'` — **이 문자열 리터럴이 `analyses.premium_reports` jsonb의 키와 정확히 일치해야 한다**(db-schema 확정 계약). 오타/다른 이름 금지.
- `AnalysisRecord = { id: string; createdAt: string; maskedTransactions: MaskedRow[]; freeSummary: FreeSummary }` — 저장된 `analyses` 한 행 중 Premium 리포트 생성에 필요한 부분. Premium 함수들의 입력이 된다(DB 조회는 llm 서비스가 아니라 api-routes 책임 — llm은 이 객체를 인자로 받기만 한다).
- `MonthOverMonthReport`, `AnomalyReport`, `SavingsReport`, `BudgetReport` 각 리포트 결과 타입과 `PremiumReport = MonthOverMonthReport | AnomalyReport | SavingsReport | BudgetReport` 유니온의 **최소 자리표시(placeholder) 선언**만 이 파일에 둔다. 구체 필드는 각 리포트 step(5,6)에서 확정한다 — 지금은 컴파일만 되게 최소 필드로 둔다.

이 파일은 순수 타입 선언만 담는다(런타임 코드 금지).

## Acceptance Criteria
- [ ] `src/types/pipeline.ts`가 위 타입들을 `export`하고 `npx tsc --noEmit`(strict mode)로 통과한다.
- [ ] `MaskedRow`가 브랜디드 타입이어서, `RawRow`(또는 일반 `Record<string,string>`) 값을 `MaskedRow`가 필요한 자리에 넣으면 컴파일 에러가 난다. 이를 검증하는 타입 레벨 테스트를 `src/types/pipeline.test-d.ts`(또는 `pipeline.test.ts` 안 `// @ts-expect-error`)로 작성한다: `const raw: RawRow = {}; const m: MaskedRow = raw;` 줄에 `// @ts-expect-error`가 붙어야 컴파일이 통과하도록 한다(즉 브랜드 없이는 대입 불가임을 증명).
- [ ] `RawRow`와 `MaskedRow`가 서로 다른 타입임이 이름과 정의에서 명확하다 — "원본 데이터"와 "마스킹된 데이터"를 같은 타입으로 다루지 않는다(CLAUDE.md: 원본 값을 LLM에 절대 전달하지 않는다는 규칙의 타입 레벨 근거).
- [ ] 이 step은 타입만 정의한다 — `src/services/` 아래 어떤 구현 파일도 만들지 않는다.
