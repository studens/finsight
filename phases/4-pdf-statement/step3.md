# Step 3: LLM 컬럼 의미 판정 → `PdfColumnSchema` (레댁션 게이트 통과 후, 실패 시 UNSUPPORTED)

## 작업

step 1이 **동적으로 발견한 right-edge 클러스터**가 각각 어떤 컬럼인지 Claude에게 판정받아 `PdfColumnSchema`로 만든다.
**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

D1 하이브리드의 정확한 경계: **좌표 발견은 코드가, "이 클러스터가 청구금액인가"의 판정만 LLM이 한다.** 좌표값(275.5 / 407.0 / 445.5 / 558.5)은 NH농협 고유값이므로 코드에 하드코딩하지 않는다.

### 3-1. 타입 추가 — `src/types/pdf.ts`

`PdfColumnSchema`는 `/api/upload` → 클라이언트 → `/api/analyze`로 **JSON 왕복**한다(INV-2). 따라서:
- **직렬화 가능한 순수 데이터만** 담는다(함수·클래스 인스턴스·Date 금지).
- **PII를 담지 않는다** — 컬럼 좌표와 의미 라벨, 표 헤더 문자열(`이용금액` 등)만 담는다. 가맹점명·금액 값·이름·계좌는 넣지 않는다.

```typescript
export type PdfColumnRole =
  | "usageAmount"          // 이용금액(원 거래액) — 계상하지 않는다
  | "discount"             // 할인/면제
  | "billedAmount"         // 이번 달 청구액 ← D2에 따라 이것만 계상한다
  | "points"               // 포인트/적립
  | "remainingBalance"     // 할부잔여
  | "foreignBilledAmount"  // 해외 섹션의 원화청구금액 (본 표에 이미 계상되므로 쓰지 않는다)
  | "unknown"

export type PdfColumnAssignment = {
  /** step 1이 발견한 클러스터의 right-edge */
  rightEdge: number
  role: PdfColumnRole
  /** 판정 근거가 된 표 헤더 라벨. 없으면 null. PII 아님 */
  headerLabel: string | null
}

export type PdfColumnSchema = {
  version: 1
  /** 추정 카드사 라벨. 확신 없으면 null */
  issuer: string | null
  columns: PdfColumnAssignment[]
  /** role === "billedAmount" 인 컬럼의 rightEdge. 적용 시 이 컬럼만 계상한다 */
  billedAmountRightEdge: number
  /** 적용 시 right-edge 허용오차 */
  rightEdgeTolerance: number
  /** 0~1 */
  confidence: number
}
```

### 3-2. LLM 호출 — `src/services/llm/pdf-column-schema.ts` (신규)

```typescript
export type PdfColumnSchemaRequest = {
  sections: { sectionId: string; kind: PdfSectionKind }[]
  headerLabels: { text: string; rightEdge: number }[]
  numericColumns: PdfRightEdgeCluster[]
  sampleRows: {
    sectionId: string | null
    date: string
    merchant: string
    values: { rightEdge: number; text: string }[]
  }[]
}

export async function inferPdfColumnSchema(
  request: PdfColumnSchemaRequest,
): Promise<PdfColumnSchema>
```
- LLM 호출은 **기존 `./provider`의 `generateAnalysisText`만** 사용한다(ADR-002: Claude 단일 기본값, 프로바이더 추상화는 이미 있는 것을 쓴다). 새 프로바이더·모델 선택 로직을 만들지 않는다.
- 프롬프트에 반드시 포함할 문장:
  - 각 `numericColumns` 항목의 `rightEdge`에 대해 `PdfColumnRole` 중 하나를 배정하라
  - `headerLabels`의 `rightEdge`가 컬럼의 `rightEdge`와 가까우면 그 라벨이 그 컬럼의 이름이다
  - **`billedAmount`(이번 달 청구액)는 정확히 하나만 배정하라. 이용금액(원 거래액)과 혼동하지 마라 — 할부 거래에서 두 값이 다르다**
  - 확신이 없으면 `unknown`을 쓰고 `confidence`를 낮게 반환하라. 억지로 배정하지 마라
  - 설명·마크다운 없이 JSON 객체만 반환하라
- 반환 JSON 파싱은 기존 `column-mapping.ts`의 방식(`JSON.parse` + 필드별 런타임 검증 후 TypeError)을 따른다. 검증 실패 시 `TypeError`를 던진다(HTTP 매핑은 호출자 책임).
- `version`과 `rightEdgeTolerance`는 LLM 응답에서 받지 않고 **코드가 채운다**(`version: 1`, `rightEdgeTolerance: RIGHT_EDGE_TOLERANCE`).

### 3-3. 게이트 + 오케스트레이션 — `src/services/pdf-parser/column-schema.ts` (신규)

```typescript
export const MIN_SCHEMA_CONFIDENCE = 0.5

/** layout에서 LLM에 보낼 표 조각을 만든다 (순수 함수) */
export function buildColumnSchemaExcerpt(layout: PdfStatementLayout): PdfColumnSchemaRequest

/** 게이트 통과 → LLM 판정 → 검증. 실패는 전부 UnsupportedPdfFormatError */
export function determinePdfColumnSchema(
  layout: PdfStatementLayout,
): Promise<PdfColumnSchema>

/** 클라이언트가 되돌려보낸 JSON을 검증한다(신뢰하지 않는 입력). api-routes가 사용 */
export function parsePdfColumnSchema(value: unknown): PdfColumnSchema
```

#### `buildColumnSchemaExcerpt` 규칙
- 대상 라인은 role이 `period` / `sectionHeader` / `tableHeader` / `transaction` 인 것만. **`other`(page1 PII 라인, page3 푸터)와 `subtotal` / `total` 라인은 절대 포함하지 않는다.**
- `sampleRows`는 `transactionLines`에서 **최대 8행**만. 각 행에서:
  - `date` = 첫 아이템 text
  - `merchant` = 첫 아이템 이후의 **숫자가 아닌** 아이템들을 `""`로 이어붙인 값(trim)
  - `values` = 숫자 아이템들의 `{ rightEdge: x + width, text }`
- 전체 명세서 행을 보내지 않는다(ADR-003과 동일한 원칙: 헤더 + 샘플 행만).

#### `determinePdfColumnSchema` 순서 (이 순서를 바꾸면 INV-3 위반)
1. `buildColumnSchemaExcerpt(layout)`로 excerpt를 만든다.
2. excerpt에 담긴 **모든 문자열**(sectionId, headerLabels.text, numericColumns.sampleValues, sampleRows.date/merchant/values.text)을 모아 `assertRedacted(strings)`를 호출한다 — step 2의 게이트.
3. 게이트를 통과한 **뒤에만** `inferPdfColumnSchema(excerpt)`를 호출한다.
4. 결과를 검증하고 반환한다.

실패 → `UnsupportedPdfFormatError` 변환 표 (reason 라벨은 정확히 이대로):

| 상황 | reason |
|---|---|
| `RedactionGateError` 발생 | `"redaction_gate_blocked"` |
| `numericColumns`가 비어 있음 (LLM 호출 전에 판정) | `"no_numeric_columns"` |
| LLM 응답 JSON 파싱/검증 실패 (`TypeError`) | `"column_schema_invalid"` |
| `billedAmount` 역할 컬럼이 0개거나 2개 이상 | `"billed_column_not_identified"` |
| `confidence < MIN_SCHEMA_CONFIDENCE` | `"column_schema_low_confidence"` |

- **`RedactionGateError`의 `findings` 내용을 `UnsupportedPdfFormatError`의 message에 넣지 않는다.** reason 라벨만 쓴다.
- LLM 호출 자체가 실패(네트워크/프로바이더 에러)한 경우는 `UnsupportedPdfFormatError`로 **감싸지 않고 그대로 전파**한다 — 일시적 장애를 "지원하지 않는 형식"으로 잘못 보고하면 사용자가 같은 파일을 다시 올려도 계속 422를 받는다.

#### `parsePdfColumnSchema` 규칙 (신뢰하지 않는 입력 검증)
- 화이트리스트 필드만 취한다. `__proto__` 등 알 수 없는 키는 **무시**하고 결과 객체에 옮기지 않는다.
- `version === 1`, `columns`가 배열이고 각 원소의 `rightEdge`가 유한수, `role`이 `PdfColumnRole` 리터럴 중 하나, `headerLabel`이 `string | null`.
- `role === "billedAmount"`인 컬럼이 **정확히 1개**이고 `billedAmountRightEdge`가 그 컬럼의 `rightEdge`와 일치한다.
- `rightEdgeTolerance`가 유한수이고 `0 < tolerance <= 5`.
- `confidence`가 유한수이고 `0 <= confidence <= 1`.
- `issuer`가 `string | null`이고 문자열이면 길이 40 이하.
- 위반 시 `TypeError`를 던진다(api-routes가 400 `BAD_REQUEST`로 매핑한다).

### 3-4. 배럴 — `src/services/pdf-parser/index.ts`

`determinePdfColumnSchema`, `parsePdfColumnSchema`, `buildColumnSchemaExcerpt`, `MIN_SCHEMA_CONFIDENCE`를 re-export한다.

## Acceptance Criteria

- [ ] (TDD) `src/services/llm/pdf-column-schema.test.ts`와 `src/services/pdf-parser/column-schema.test.ts`가 먼저 작성되고 통과한다.
- [ ] (LLM 모킹 방식 통일) 두 테스트가 **기존 테스트와 같은 방식**으로 LLM을 모킹한다: `const generateAnalysisText = vi.fn()` + `vi.mock("./provider", () => ({ generateAnalysisText }))`(llm 테스트) / `vi.mock("../llm/provider", () => ({ generateAnalysisText }))`(pdf-parser 테스트) + `await import(...)`. 실제 Claude API를 호출하는 테스트를 만들지 않는다.
- [ ] (**INV-3 CRITICAL — 게이트 미통과 텍스트가 LLM에 전달되지 않음**) 소계 라인처럼 PII 패턴이 남은 excerpt를 만들어 `determinePdfColumnSchema`를 호출하면 (1) `UnsupportedPdfFormatError`(`reason === "redaction_gate_blocked"`)가 throw되고 (2) **`generateAnalysisText`가 단 한 번도 호출되지 않는다**(`expect(generateAnalysisText).not.toHaveBeenCalled()`)는 테스트가 통과한다.
- [ ] (게이트 호출 순서) `column-schema.ts`에서 `assertRedacted`가 `inferPdfColumnSchema` 호출보다 **앞에** 있음을 코드로 확인한다. 게이트 결과를 `try/catch`로 삼켜 계속 진행하는 경로가 없다.
- [ ] (excerpt에 PII 없음 CRITICAL) `nh-statement-sample.pdf`의 layout으로 `buildColumnSchemaExcerpt`를 호출한 결과를 `JSON.stringify`했을 때 `홍길동`, `123********99`, `세종대로`, `010-1234-5678`, `소계`, `합계` 문자열이 **하나도 포함되지 않는다**는 테스트가 통과한다.
- [ ] (excerpt 크기 제한) `sampleRows.length <= 8`이고, excerpt에 34개 거래행 전체가 들어가지 않는다는 테스트가 통과한다.
- [ ] (excerpt 내용) excerpt의 `numericColumns`에 `rowCount === 34`인 클러스터가 있고, `headerLabels`에 `이번달청구금액`이 있으며, `sampleRows[0]`에 `date`/`merchant`/`values`가 채워져 있다는 테스트가 통과한다.
- [ ] (정상 경로 골든값) `generateAnalysisText`가 청구금액 클러스터를 `billedAmount`로 라벨링한 JSON을 반환하도록 모킹했을 때, `determinePdfColumnSchema`가 `version === 1`, `billedAmountRightEdge`가 `407.0 ± 1.5`, `columns`에 `billedAmount` 1개, `confidence >= 0.5`인 스키마를 반환하는 테스트가 통과한다.
- [ ] (실패 매핑 — reason별 개별 테스트) 다음 각각이 `UnsupportedPdfFormatError`이고 `reason`이 정확히 일치하는 테스트가 통과한다: LLM이 JSON이 아닌 텍스트 반환 → `"column_schema_invalid"` / `billedAmount`가 0개 → `"billed_column_not_identified"` / `billedAmount`가 2개 → `"billed_column_not_identified"` / `confidence: 0.3` → `"column_schema_low_confidence"` / `numericColumns`가 빈 배열인 layout → `"no_numeric_columns"`(이 경우 `generateAnalysisText`가 호출되지 않는다).
- [ ] (LLM 장애는 감싸지 않음) `generateAnalysisText`가 `new Error("network")`로 reject하면 `UnsupportedPdfFormatError`가 **아니라** 그 에러가 그대로 전파되는 테스트가 통과한다.
- [ ] (프롬프트 내용) 프롬프트에 "확신이 없으면"과 "billedAmount" 그리고 "이용금액"과 혼동하지 말라는 지시가 포함되어 있음을 `generateAnalysisText.mock.calls[0][0].prompt`로 단정하는 테스트가 통과한다.
- [ ] (왕복 검증 — INV-2) `determinePdfColumnSchema`가 반환한 스키마를 `JSON.parse(JSON.stringify(schema))` 한 뒤 `parsePdfColumnSchema`에 넣으면 **원본과 깊은 값이 같은 객체**가 나오는 테스트가 통과한다(직렬화 가능한 순수 데이터임을 확인).
- [ ] (신뢰하지 않는 입력 검증) `parsePdfColumnSchema`가 다음 각각에 대해 `TypeError`를 던지는 테스트가 통과한다: `null` / `version: 2` / `columns`가 배열이 아님 / `role`이 알 수 없는 문자열 / `billedAmount` 컬럼 0개 / `billedAmountRightEdge`가 `billedAmount` 컬럼과 불일치 / `confidence: 1.5` / `rightEdgeTolerance: 0`. 또한 `{"__proto__": {"polluted": true}}`가 섞인 입력에서 결과 객체에 `polluted` 키가 없음을 확인한다.
- [ ] (좌표 하드코딩 금지) `column-schema.ts`와 `pdf-column-schema.ts`에 `275.5`, `407`, `445.5`, `558.5` 리터럴이 **하나도 없음**을 grep으로 확인한다.
- [ ] (PII·비밀번호 미기록 CRITICAL) 두 파일에 `console.` 호출이 0건이고, 프롬프트 문자열을 로그로 남기는 코드가 없음을 grep으로 확인한다. `PdfColumnSchema` 타입에 가맹점명·금액 값·비밀번호를 담는 필드가 없음을 타입 정의로 확인한다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 기존 CSV 파이프라인 테스트가 하나도 깨지지 않는다(INV-5).
