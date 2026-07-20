# Step 4: llm Free 요약 생성

## 작업
`src/services/llm/free-summary.ts`에 Free 요약 생성 함수를 TDD로 구현한다. **테스트를 먼저 작성**하고 통과하는 구현을 작성한다.

공개 함수(정확한 시그니처):
```typescript
export function generateFreeSummary(input: {
  rows: MaskedRow[];
  mapping: ConfirmedMapping;
}): Promise<FreeSummary>;
```
- 입력 `rows`는 **반드시 `MaskedRow[]`**(마스킹된 전체 거래). 원본 `RawRow[]`는 타입상 불가.
- 반환 `FreeSummary`는 `analyses.free_summary` jsonb에 그대로 저장되는 shape(step 0 / db-schema 계약): `{ totalSpent, transactionCount, categoryTotals, topMerchants }`.

계산 범위 구분:
- **순수 계산(코드)로 처리**: 총 지출(`totalSpent`), 거래 건수(`transactionCount`), 카테고리별 합계(`categoryTotals`), 가맹점 Top 5(`topMerchants`) — 집계 연산은 Claude를 호출하지 않고 코드로 계산한다.
- **Claude가 필요한 부분만 LLM 사용**: 매핑에 category 컬럼이 없어 카테고리 분류 자체가 필요하거나, 자유 텍스트 가맹점명 정규화가 필요한 경우에만 Claude를 호출한다. 단순 합산·정렬을 LLM에 맡기지 않는다.

## Acceptance Criteria
- [ ] (순수 집계) 마스킹된 거래 배열과 확정 매핑을 넣으면 `totalSpent`(금액 합), `transactionCount`(행 수), `categoryTotals`(카테고리별 합), `topMerchants`(상위 5개 가맹점+합계)가 정확히 계산되는 Vitest 테스트가 통과한다. 이 집계 계산 경로는 Claude 호출 없이 동작한다(모킹으로 호출 0회 확인).
- [ ] 가맹점이 5개 미만인 경우 있는 만큼만 `topMerchants`에 담기고, 금액 내림차순 정렬됨을 테스트로 확인한다.
- [ ] 금액 셀에 통화기호/쉼표(예: `"₩12,300"`, `"12,300"`)가 있어도 숫자로 파싱해 합산하는 테스트가 통과한다.
- [ ] (원본 미전달 CRITICAL — 타입) `rows` 파라미터가 `MaskedRow[]`이며 `RawRow[]`를 넘기면 컴파일 에러가 남을 `// @ts-expect-error` 테스트로 확인한다.
- [ ] category 컬럼이 매핑에 없을 때 Claude 분류를 사용하는 경로가 있고, 그 경로도 AI SDK 모킹 하에서 테스트가 통과한다(실제 API 미호출).
- [ ] 반환 객체가 `FreeSummary` 타입과 정확히 일치해 `analyses.free_summary`에 그대로 저장 가능하다(추가/누락 필드 없음).
