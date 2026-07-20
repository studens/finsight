# Step 5: llm Premium 리포트 — 전월대비 + 이상거래

## 작업
`src/services/llm/reports/`에 Premium 리포트 중 두 종을 **각각 독립 함수**로 TDD 구현한다. **테스트를 먼저 작성**하고 통과하는 구현을 작성한다. 각 리포트는 지연 생성(lazy-generate)이 리포트 타입 단위로 이뤄지므로, 반드시 서로 독립적으로 호출 가능한 별도 함수여야 한다.

공개 함수(정확한 시그니처):
```typescript
// src/services/llm/reports/mom-comparison.ts
export function generateMomComparison(input: {
  current: AnalysisRecord;
  previous: AnalysisRecord | null;
}): Promise<MonthOverMonthReport>;

// src/services/llm/reports/anomaly-detection.ts
export function generateAnomalyDetection(input: {
  current: AnalysisRecord;
}): Promise<AnomalyReport>;
```

범위·경계 규칙:
- **입력은 이미 마스킹된 `AnalysisRecord`만** 받는다(`maskedTransactions: MaskedRow[]`). 원본 값은 타입상 도달 불가.
- **DB 조회를 여기서 하지 않는다.** "전월 대비"의 직전 레코드(`previous`)는 인자로 **받기만** 한다 — 직전 `analyses` 레코드 조회는 api-routes/db 계층 책임이다. `previous`가 `null`(비교 대상 없음)이면 "비교할 이전 데이터 없음"을 나타내는 정상 결과를 반환하고 throw하지 않는다.
- **구독 여부를 여기서 체크하지 않는다.** 이 함수들은 "이미 게이팅을 통과했다"는 전제로 순수하게 리포트만 생성한다. 페이월(403 PAYWALL_REQUIRED)은 api-routes 책임 — 구독 체크 코드를 이 서비스에 넣지 않는다.
- 전월 대비 비교 수치(카테고리별 증감 등)는 코드로 계산하고, 그 위의 해석/코멘트만 Claude를 사용한다.

## Acceptance Criteria
- [ ] `generateMomComparison`이 `current`/`previous` 두 `AnalysisRecord`를 받아 카테고리별·총액 증감을 계산해 `MonthOverMonthReport`로 반환하는 Vitest 테스트가 통과한다(AI SDK 모킹).
- [ ] `previous`가 `null`일 때 throw하지 않고 "이전 데이터 없음" 상태의 정상 결과를 반환하는 테스트가 통과한다.
- [ ] `generateAnomalyDetection`이 `current`만으로 이상 거래 리포트를 반환하는 테스트가 통과한다(AI SDK 모킹).
- [ ] (구독 체크 부재) 두 함수 코드에 구독 상태 조회/`subscriptions` 접근/403 반환 로직이 **없음**을 확인한다 — 게이팅은 api-routes 책임이며 이 서비스는 생성만 한다.
- [ ] (DB 조회 부재) 두 함수 코드에 Supabase/DB 조회 호출이 없음을 확인한다. `previous`는 인자로만 들어온다.
- [ ] (원본 미전달 CRITICAL — 타입) 입력이 `AnalysisRecord`(내부 `maskedTransactions: MaskedRow[]`)이며 원본 행을 넣는 경로가 타입상 없음을 확인한다.
- [ ] 유닛 테스트가 실제 Claude API를 호출하지 않는다(AI SDK 모킹).
