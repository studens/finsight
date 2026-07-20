# Step 6: llm Premium 리포트 — 절약제안 + 예산추천 + 리포트 디스패처

## 작업
`src/services/llm/reports/`에 나머지 두 리포트를 **각각 독립 함수**로 TDD 구현하고, api-routes가 `reportType` 하나로 호출할 수 있는 **디스패처**를 구현한다. **테스트를 먼저 작성**하고 통과하는 구현을 작성한다.

공개 함수(정확한 시그니처):
```typescript
// src/services/llm/reports/savings-suggestions.ts
export function generateSavingsSuggestions(input: {
  current: AnalysisRecord;
}): Promise<SavingsReport>;

// src/services/llm/reports/budget-recommendation.ts
export function generateBudgetRecommendation(input: {
  current: AnalysisRecord;
}): Promise<BudgetReport>;

// src/services/llm/reports/index.ts — 디스패처
export function generateReport(input: {
  reportType: ReportType;
  current: AnalysisRecord;
  previous: AnalysisRecord | null;
}): Promise<PremiumReport>;
```

디스패처 규칙:
- `reportType`(step 0의 `ReportType`: `'mom_comparison' | 'anomaly_detection' | 'savings_suggestions' | 'budget_recommendation'`)에 따라 해당 리포트 함수 **하나만** 호출한다. 지연 생성이 리포트 타입 단위이므로 요청된 타입만 생성한다.
- `mom_comparison`만 `previous`를 사용하고, 나머지 세 타입은 `current`만 사용한다(`previous`는 무시).
- 이 `reportType` 문자열은 `analyses.premium_reports` jsonb 캐시의 **키와 정확히 일치**한다(db-schema 확정 계약). api-routes가 이 키로 캐시 upsert/조회한다.
- **구독 체크·DB 조회는 여기서 하지 않는다**(step 5와 동일 경계) — 게이팅과 캐시 저장/이전 레코드 조회는 api-routes 책임.

## Acceptance Criteria
- [ ] `generateSavingsSuggestions`, `generateBudgetRecommendation`이 각각 `current` `AnalysisRecord`만으로 리포트를 반환하는 Vitest 테스트가 통과한다(AI SDK 모킹).
- [ ] `generateReport` 디스패처가 각 `reportType`에 대해 대응하는 함수 **하나만** 호출함을 테스트로 확인한다(예: `reportType='savings_suggestions'`이면 다른 세 함수는 호출되지 않음 — 스파이로 확인).
- [ ] `reportType='mom_comparison'`일 때만 `previous`가 전달되고, 나머지 타입에서는 `previous` 없이도 동작하는 테스트가 통과한다.
- [ ] (키 일치 CRITICAL) `ReportType` 리터럴 4개가 `mom_comparison`/`anomaly_detection`/`savings_suggestions`/`budget_recommendation`와 정확히 일치함을 확인한다(오타 시 캐시 키 불일치로 지연 생성이 깨진다).
- [ ] (구독 체크·DB 조회 부재) 세 파일(두 리포트 + 디스패처) 코드에 구독 상태 조회/`subscriptions` 접근/403 로직과 Supabase/DB 조회가 **없음**을 확인한다.
- [ ] (원본 미전달 CRITICAL — 타입) 모든 리포트 입력이 `AnalysisRecord`(마스킹된 데이터)이며 원본 값 도달 경로가 타입상 없음을 확인한다.
- [ ] 유닛 테스트가 실제 Claude API를 호출하지 않는다(AI SDK 모킹).
