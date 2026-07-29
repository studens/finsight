# Step 4: 스키마 적용 → `ParsedCsv` 어댑터 (할부=청구액 / 연도추론 / 해외 자동탈락) + 합계 일치 통합테스트

## 작업

step 1의 layout과 step 3의 `PdfColumnSchema`를 합쳐 **기존 파이프라인이 그대로 먹을 수 있는 `ParsedCsv`**를 만든다.
**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

### 4-1. 고정 출력 형태 (INV-1 — 변경 금지)

```typescript
// src/services/pdf-parser/to-parsed-csv.ts
export const PDF_HEADERS = ["이용일", "가맹점", "청구금액", "구분"] as const

/** api-routes가 /api/upload 응답에 그대로 쓰는 매핑 (사용자 확인 UI 불필요 — 파서가 헤더를 부여했으므로 confidence 1) */
export const PDF_COLUMN_MAPPING: ColumnMapping = {
  date: "이용일",
  merchant: "가맹점",
  amount: "청구금액",
  category: "구분",
  confidence: 1,
}

export type PdfTransactionKind = "일시불" | "할부" | "연회비" | "해외" | "기타"
```
- `청구금액` = **이번 달 청구액**(D2). 쉼표를 제거한 정수 문자열로 담는다(예: `"23375"`, `"-300"`). 기존 `generateFreeSummary`의 `parseAmount`가 그대로 처리한다.
- `이용일` = `YYYY-MM-DD`.
- 이 헤더에는 이름·주소·계좌·카드번호 컬럼이 **존재하지 않는다.** `maskPii`가 제외/마스킹할 컬럼을 찾지 못하는 것이 정상이다.

### 4-2. 순수 변환 함수 — `src/services/pdf-parser/to-parsed-csv.ts` (신규)

```typescript
export function applyPdfColumnSchema(input: {
  layout: PdfStatementLayout
  schema: PdfColumnSchema
}): ParsedCsv
```
`layout.transactionLines`를 등장 순서(페이지 순 → y 내림차순)대로 순회하며 각 행을 처리한다.

#### (a) 청구금액 추출 — **해외 중복계상 방지가 여기서 해결된다**
- 행의 숫자 아이템(`/^-?[\d,]+$/`) 중 `Math.abs((x + width) - schema.billedAmountRightEdge) < schema.rightEdgeTolerance` 인 것을 모은다.
- **정확히 1개가 아니면 그 행을 제외한다.** 별도의 중복 제거 로직을 만들지 마라 — 해외이용 섹션 상세 행은 청구금액 컬럼에 값이 없어 이 규칙으로 **자동 탈락**하며, 그래서 `07/03 WWW.ALIEXPRESS.COM 36,719`이 본 표에서 한 번만 계상된다(리더 실측 확인).
- `청구금액` = 그 아이템 text에서 쉼표를 제거한 값.

#### (b) 연도 추론 — 거래 날짜에 연도가 없다(MM/DD만)
- `layout.statementPeriod`가 `null`이면 `UnsupportedPdfFormatError`(reason `"statement_period_missing"`).
- 규칙(정확히 이대로): `MM*100 + DD`가 **이용기간 종료일의 `MM*100 + DD`보다 크면 종료연도 - 1, 아니면 종료연도**.
  - 이용기간 `2026.06.11 ~ 2026.07.10`(종료 710): `03/20`(320 ≤ 710) → `2026-03-20`. **이용기간 시작보다 과거인 할부 원거래도 유효한 거래로 유지한다.**
  - 이용기간 `2025.12.11 ~ 2026.01.10`(종료 110): `12/15`(1215 > 110) → `2025-12-15` / `01/05`(105 ≤ 110) → `2026-01-05` / `11/20`(1120 > 110) → `2025-11-20`
- 월 1~12, 일 1~31 범위를 벗어나면 그 행을 제외한다.

#### (c) 가맹점
- 첫 아이템(날짜) 이후의 **숫자가 아닌** 아이템들을 `""`로 이어붙여 `trim()`. 빈 문자열이면 `"알 수 없음"`.

#### (d) `구분` 판정 (순서대로 평가)
1. 행의 `sectionId`가 `kind === "foreign"` 섹션이면 → `해외`
2. `schema.columns`에서 `role === "remainingBalance"`인 컬럼에 이 행의 값이 있거나, 첫 아이템을 **제외한** 아이템 중 `/^\d{1,2}\/\d{1,2}$/`(할부회차) 형태가 있으면 → `할부`
3. 가맹점에 `연회비`가 포함되면 → `연회비`
4. 가맹점이 `"알 수 없음"`이면 → `기타`
5. 그 외 → `일시불`

> 1번보다 2번을 먼저 평가하면 해외 할부가 잘못 분류된다. **회차 판정에서 첫 아이템(날짜 `06/13`)을 제외하지 않으면 모든 행이 할부로 잡힌다** — 반드시 제외한다.

#### (e) 결과
`{ headers: [...PDF_HEADERS], rows, rowCount: rows.length }`. 제외된 행은 `rows`에 넣지 않는다.
계상된 행이 0건이면 `UnsupportedPdfFormatError`(reason `"no_billed_rows"`).

### 4-3. 오케스트레이터 — `src/services/pdf-parser/index.ts`

```typescript
/** /api/upload 경로: LLM 판정을 여기서 딱 한 번 한다 */
export async function parsePdfStatement(input: {
  data: Buffer | Uint8Array
  password?: string
}): Promise<{ parsed: ParsedCsv; pdfColumnSchema: PdfColumnSchema }>

/** /api/analyze 경로: upload가 준 스키마를 적용만 한다. LLM을 호출하지 않는다 (INV-2) */
export async function parsePdfStatementWithSchema(input: {
  data: Buffer | Uint8Array
  password?: string
  schema: PdfColumnSchema
}): Promise<ParsedCsv>
```
두 함수 공통 순서:
1. `extractPdfTextItems({ data, password })` — 비밀번호 예외는 step 0이 `PdfPasswordRequiredError`로 변환
2. `buildStatementLayout(doc)`
3. **`layout.transactionLines.length === 0`이면 `UnsupportedPdfFormatError`(reason `"no_transaction_rows"`)** — 스캔/이미지 PDF 거부는 텍스트 아이템 개수가 아니라 **이 기준**이다(실측: 마지막 페이지는 푸터만 있어 아이템이 6개다)
4. `parsePdfStatement`만 `determinePdfColumnSchema(layout)` 호출 / `parsePdfStatementWithSchema`는 인자로 받은 `schema` 사용
5. `applyPdfColumnSchema({ layout, schema })`

- `parsePdfStatementWithSchema`는 `determinePdfColumnSchema`·`inferPdfColumnSchema`를 **import조차 하지 않는 경로**로 동작해야 한다(INV-2).
- 원본 PDF 바이트·비밀번호를 디스크·로그·리턴값에 남기지 않는다(INV-4). 반환값은 `ParsedCsv`와 `PdfColumnSchema`뿐이다.

## Acceptance Criteria

- [ ] (TDD) `src/services/pdf-parser/to-parsed-csv.test.ts`(순수 함수)와 `src/services/pdf-parser/index.test.ts`(통합)가 먼저 작성되고 통과한다. LLM은 기존 방식대로 `vi.mock("../llm/provider", () => ({ generateAnalysisText }))`로 모킹한다.
- [ ] (**골든값 — 합계 오차 0**) `nh-statement-sample.pdf`(비밀번호 `000000`)를 `parsePdfStatement`로 처리하면 `parsed.rowCount === 34`이고 `rows`의 `청구금액`을 모두 정수로 더한 값이 **정확히 882,646**이다. 같은 테스트에서 `layout.excludedLines`의 `합계` 행에서 읽은 청구 값도 **882,646**이며 두 값이 같음을 단정한다(명세서 합계와 오차 0).
- [ ] (**D2 할부 — 숫자로 못 박기**) `이용일 === "2026-03-20"` 행이 정확히 1개이고 `가맹점`에 `테스트페이_강의`가 포함되며 `청구금액 === "23375"`, `구분 === "할부"`이다. 그리고 `rows` 전체에서 `청구금액`이 `"140252"`인 행이 **하나도 없다**(원 이용금액 140,252은 계상하지 않는다).
- [ ] (**해외 중복계상 방지 — 숫자로 못 박기**) `rows` 중 `청구금액 === "36719"`인 행이 **정확히 1개**이고 그 `이용일`이 `"2026-07-03"`이다. 해외 섹션 상세 행(`M614 WWW.ALIEXPRES 룩셈부르크`)은 `rows`에 없다(`가맹점`에 `룩셈부르크`를 포함하는 행이 0개). 코드에 (이용일, 금액) 짝을 비교하는 별도 중복 제거 로직이 없음을 확인한다.
- [ ] (행 변형 7가지 개별 AC) 각각 별도 단정으로 통과한다:
      (1) 일반+할인 — `이용일 "2026-06-13"` / `청구금액 "4447"`(4,500이 아니다) / `구분 "일시불"`
      (2) 할인 없음 — `이용일 "2026-06-24"` / `가맹점 "아파트관리비"` / `청구금액 "246090"`
      (3) 연회비 — `가맹점`에 `기본연회비` 포함 / `청구금액 "6000"` / `구분 "연회비"`
      (4) 할부 — 위 D2 AC
      (5) 마이너스(이용금액 칸 없음) — `가맹점 "포인트결제"` / `청구금액 "-300"`, `가맹점 "카드론상환"` / `청구금액 "-1000"` 두 행이 모두 존재하고 `구분 "일시불"`
      (6) 소계/합계 배제 — `가맹점`에 `소계` 또는 `합계`를 포함하는 행이 0개이고, `청구금액`이 `"866646"` / `"882646"` / `"16000"`인 행이 **하나도 없다**(합계 행이 거래로 새면 이중계상이다)
      (7) 해외 섹션 — 위 해외 AC
- [ ] (`구분` 분포) `rows`의 `구분` 값 개수가 정확히 `{ 일시불: 29, 할부: 4, 연회비: 1 }`이고 합이 34다. `구분` 값이 `PdfTransactionKind` 리터럴 외의 값을 갖는 행이 없다.
- [ ] (**연도 추론 — 12월→1월 경계와 할부 원거래 둘 다**) `year-boundary-sample.pdf`를 처리하면 `rowCount === 3`이고 `이용일`이 정확히 `["2025-12-15", "2026-01-05", "2025-11-20"]`(등장 순서)이며 청구금액 합이 **80,000**이다. `11/20` 행의 `구분`이 `할부`다. 별도로 NH 픽스처에서 이용기간(2026.06.11~07.10) **범위 밖**인 `03/20`·`02/28`·`04/15`·`05/02`·`06/01`·`06/05` 행이 모두 `rows`에 **남아 있다**(범위 밖이어도 유효한 거래).
- [ ] (이용기간 없음) `statementPeriod`가 `null`인 layout으로 `applyPdfColumnSchema`를 호출하면 `UnsupportedPdfFormatError`(`reason === "statement_period_missing"`)가 throw된다.
- [ ] (스캔/이미지 PDF 거부) `no-transactions-sample.pdf`를 `parsePdfStatement`로 처리하면 `UnsupportedPdfFormatError`(`reason === "no_transaction_rows"`)가 throw되고 **`generateAnalysisText`가 호출되지 않는다.** `index.ts`에 "텍스트 아이템 개수/길이가 적으면 throw"하는 판정이 없음을 확인한다.
- [ ] (회차 오분류 방지) 첫 아이템(날짜 `06/13`)을 회차로 오인해 모든 행이 `할부`가 되지 않음을 (a) 위 `구분` 분포 AC와 (b) 날짜만 있고 회차가 없는 행의 `구분`이 `일시불`인 단정으로 확인한다.
- [ ] (**INV-2 — analyze 경로에서 LLM 재호출 없음**) `parsePdfStatementWithSchema`에 `parsePdfStatement`가 반환한 스키마를 그대로 넣으면 (1) 결과 `ParsedCsv`가 `parsePdfStatement`의 결과와 **깊은 값이 동일**하고 (2) `generateAnalysisText`가 **한 번도 호출되지 않는다**는 테스트가 통과한다.
- [ ] (JSON 왕복 후에도 동일) 위 스키마를 `JSON.parse(JSON.stringify(schema))` → `parsePdfColumnSchema` 한 뒤 `parsePdfStatementWithSchema`에 넣어도 결과가 동일함을 단정한다(클라이언트 왕복 시나리오 재현).
- [ ] (**하위 파이프라인 무변경 검증**) 위 `parsed`를 기존 `maskPii`에 넣으면 `excludedColumns`와 `maskedColumns`가 **모두 빈 배열**이고 `headers`가 `["이용일","가맹점","청구금액","구분"]` 그대로다(INV-1). 이어서 `generateFreeSummary({ rows, mapping: { date:"이용일", merchant:"가맹점", amount:"청구금액", category:"구분" } })`의 `totalSpent`가 **882,646**, `transactionCount`가 **34**이고, `mapping.category`가 있으므로 **카테고리 분류용 LLM 호출이 발생하지 않는다**.
- [ ] (비밀번호 경로) `parsePdfStatement`에 비밀번호를 주지 않으면 `PdfPasswordRequiredError`(`passwordCase === "missing"`), 틀린 비밀번호면 `passwordCase === "incorrect"`가 throw되고, 두 경우 모두 `generateAnalysisText`가 호출되지 않는다.
- [ ] (INV-4 원본·비밀번호 미보관 CRITICAL) `parsePdfStatement`/`parsePdfStatementWithSchema`의 반환 타입에 원본 바이트·비밀번호·좌표 원본 텍스트가 포함되지 않는다. `src/services/pdf-parser/`의 프로덕션 코드(테스트·`__fixtures__` 제외)에 `console.`, `fs`, `writeFile` 사용이 **0건**임을 grep으로 확인한다.
- [ ] (좌표 하드코딩 금지) `to-parsed-csv.ts`와 `index.ts`에 `275.5`, `407`, `445.5`, `558.5` 리터럴이 하나도 없음을 grep으로 확인한다. 청구금액 컬럼 식별은 `schema.billedAmountRightEdge`와 `schema.rightEdgeTolerance`만으로 한다.
- [ ] (INV-5 무회귀) `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`가 모두 통과하고 **기존 CSV 업로드 흐름의 테스트가 하나도 깨지지 않는다.** `src/services/csv-parser/`, `src/services/pii-masking/index.ts`, `src/services/llm/free-summary.ts`, `src/types/pipeline.ts`가 이 step에서 수정되지 않았음을 `git diff --stat`으로 확인한다.
