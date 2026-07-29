# core-services 확정 인터페이스 — `src/services/pdf-parser` (phase 4-pdf-statement)

> api-routes(step5·6) / frontend(step7·8) planner와 qa가 참조하는 **서비스 함수 시그니처 계약**이다.
> 계획 파일: `phases/4-pdf-statement/step0.md` ~ `step4.md`.
> 기존 CSV 계약: `_workspace/02_core-services_interface.md` (변경 없음 — INV-5).
> 근거 문서: `_workspace/00_input/scope_4-pdf-statement.md`, `pdf-extraction-algorithm-verified.md`, `pdf-fixture-generation-verified.md`.

## 파일 배치

| 파일 | step | 내용 |
|---|---|---|
| `src/types/pdf.ts` | 0·1·3 | 공유 타입 전부 |
| `src/services/pdf-parser/errors.ts` | 0 | 에러 클래스 2개 |
| `src/services/pdf-parser/extract-text.ts` | 0 | pdfjs 저수준 추출 |
| `src/services/pdf-parser/layout.ts` | 1 | fuzzy y 행 그룹핑 + right-edge 클러스터 발견 |
| `src/services/pii-masking/redaction-gate.ts` | 2 | 차단형 레댁션 게이트 (INV-3) |
| `src/services/llm/pdf-column-schema.ts` | 3 | Claude 호출 (기존 `./provider` 재사용) |
| `src/services/pdf-parser/column-schema.ts` | 3 | 게이트 → LLM → 검증 |
| `src/services/pdf-parser/to-parsed-csv.ts` | 4 | 스키마 적용 → `ParsedCsv` |
| `src/services/pdf-parser/index.ts` | 0·3·4 | 배럴 + 오케스트레이터 |

## api-routes가 쓰는 공개 API (배럴 `src/services/pdf-parser`)

```typescript
// ── 파일 판별 (CSV/PDF 분기)
export function isPdfBuffer(input: Buffer | Uint8Array): boolean

// ── POST /api/upload 경로: LLM 컬럼 의미 판정을 여기서 딱 한 번 한다
export function parsePdfStatement(input: {
  data: Buffer | Uint8Array
  password?: string
}): Promise<{ parsed: ParsedCsv; pdfColumnSchema: PdfColumnSchema }>

// ── POST /api/analyze 경로: upload가 준 스키마를 적용만 한다. LLM을 호출하지 않는다 (INV-2)
export function parsePdfStatementWithSchema(input: {
  data: Buffer | Uint8Array
  password?: string
  schema: PdfColumnSchema
}): Promise<ParsedCsv>

// ── 클라이언트가 되돌려보낸 pdfColumnSchema JSON 검증 (신뢰하지 않는 입력)
//    위반 시 TypeError → api-routes가 400 BAD_REQUEST 로 매핑한다
export function parsePdfColumnSchema(value: unknown): PdfColumnSchema

// ── /api/upload 응답의 mapping 에 그대로 쓸 값 (하드코딩하지 말고 이걸 import)
export const PDF_HEADERS: readonly ["이용일", "가맹점", "청구금액", "구분"]
export const PDF_COLUMN_MAPPING: ColumnMapping  // { date:"이용일", merchant:"가맹점", amount:"청구금액", category:"구분", confidence:1 }

// ── 에러
export class PdfPasswordRequiredError extends Error {
  readonly code: "PDF_PASSWORD_REQUIRED"
  readonly passwordCase: "missing" | "incorrect"
}
export class UnsupportedPdfFormatError extends Error {
  readonly code: "UNSUPPORTED_PDF_FORMAT"
  readonly reason: string
}
export type PdfPasswordCase = "missing" | "incorrect"
```

내부 함수(qa가 코드 검증 시 확인할 것 — api-routes는 직접 쓰지 않는다):

```typescript
export function extractPdfTextItems(input: { data: Buffer | Uint8Array; password?: string }): Promise<PdfExtractedDocument>
export function buildStatementLayout(doc: PdfExtractedDocument, options?: { yTolerance?: number }): PdfStatementLayout
export function buildColumnSchemaExcerpt(layout: PdfStatementLayout): PdfColumnSchemaRequest
export function determinePdfColumnSchema(layout: PdfStatementLayout): Promise<PdfColumnSchema>
export function applyPdfColumnSchema(input: { layout: PdfStatementLayout; schema: PdfColumnSchema }): ParsedCsv
export const MIN_SCHEMA_CONFIDENCE = 0.5

// src/services/pii-masking/redaction-gate.ts
export function findPiiPatterns(value: string): RedactionFindingKind[]
export function assertRedacted(values: string[]): void   // 위반 시 RedactionGateError throw
```

## `PdfColumnSchema` — 최종 확정 형태

**설계 원칙:** right-edge 좌표값(NH농협 실측 275.5 / 407.0 / 445.5 / 558.5)은 카드사 고유값이라 코드에 하드코딩하지 않는다. 코드가 클러스터를 **동적으로 발견**하고, **각 클러스터가 어떤 컬럼인지만 LLM이 판정**한다 — 그 판정 결과가 이 스키마다.

**PII 없음 / 직렬화 가능:** 컬럼 좌표(number), 의미 라벨(리터럴), 표 헤더 문자열(`이용금액` 등)만 담는다. 가맹점명·금액 값·이름·계좌·비밀번호를 담는 필드가 없다. `JSON.parse(JSON.stringify(schema))` 왕복 후 값이 동일하다(step3 AC로 검증).

```typescript
export type PdfColumnRole =
  | "usageAmount"          // 이용금액(원 거래액) — 계상하지 않는다
  | "discount"             // 할인/면제
  | "billedAmount"         // 이번 달 청구액 ← D2에 따라 이것만 계상한다
  | "points"               // 포인트/적립
  | "remainingBalance"     // 할부잔여 (구분=할부 판정에 사용)
  | "foreignBilledAmount"  // 해외 섹션 원화청구금액 (본 표에 이미 계상되므로 쓰지 않는다)
  | "unknown"

export type PdfColumnAssignment = {
  rightEdge: number           // step1이 발견한 클러스터 right-edge (x + width)
  role: PdfColumnRole
  headerLabel: string | null  // 판정 근거가 된 표 헤더 라벨. PII 아님
}

export type PdfColumnSchema = {
  version: 1
  issuer: string | null            // 추정 카드사 라벨. 확신 없으면 null. 길이 40 이하
  columns: PdfColumnAssignment[]
  billedAmountRightEdge: number    // role === "billedAmount" 컬럼의 rightEdge
  rightEdgeTolerance: number       // 적용 시 허용오차 (0 < t <= 5, 기본 1.5)
  confidence: number               // 0~1. MIN_SCHEMA_CONFIDENCE(0.5) 미만이면 파서가 422를 던진다
}
```

`parsePdfColumnSchema`의 검증 규칙(api-routes가 400을 던지는 조건):
`version !== 1` / `columns`가 배열 아님 / `role`이 위 리터럴 외 / `rightEdge`·`confidence`·`rightEdgeTolerance`가 유한수 아님 / `billedAmount` 역할 컬럼이 정확히 1개가 아님 / `billedAmountRightEdge`가 그 컬럼과 불일치 / `confidence`가 [0,1] 밖 / `rightEdgeTolerance`가 (0,5] 밖 / `issuer`가 `string|null` 아님. 화이트리스트 필드만 취하므로 `__proto__` 같은 키는 무시된다.

## 에러 → HTTP 매핑 (api-routes가 구현할 계약)

| 파서가 던지는 것 | HTTP | 응답 body |
|---|---|---|
| `PdfPasswordRequiredError` (`passwordCase: "missing"` 또는 `"incorrect"`) | **409** | `{ "code": "PDF_PASSWORD_REQUIRED", "passwordCase": "missing" \| "incorrect" }` |
| `UnsupportedPdfFormatError` (모든 `reason`) | **422** | `{ "code": "UNSUPPORTED_PDF_FORMAT" }` |
| `parsePdfColumnSchema`의 `TypeError` / PDF인데 `pdfColumnSchema` 누락 | **400** | `{ "code": "BAD_REQUEST" }` |
| `generateAnalysisText` 등 LLM 장애 (파서가 감싸지 않고 전파) | 기존 LLM 실패 경로와 동일 (**502**) | 기존과 동일 |

- **`passwordCase`는 core-services의 제안이다.** scope 계약의 body는 `{ code: "PDF_PASSWORD_REQUIRED" }`이며, 리더가 "프론트는 미제공/불일치 안내 문구를 다르게 보여줄 수 있어야 한다"고 요구했으므로 이 필드를 추가하는 것을 권장한다. **필드명·포함 여부의 최종 결정은 api-routes/frontend 몫이다.** 어떤 경우에도 비밀번호 값 자체는 응답에 담지 않는다.
- `UnsupportedPdfFormatError.reason` 라벨(진단용, 응답 body에 담지 말 것):
  `pdf_open_failed` / `no_transaction_rows`(스캔·이미지 PDF) / `no_numeric_columns` / `redaction_gate_blocked` / `column_schema_invalid` / `billed_column_not_identified` / `column_schema_low_confidence` / `statement_period_missing` / `no_billed_rows`

## api-routes/frontend가 지켜야 할 경계 (이 phase의 core-services 범위 밖)

- **`/api/upload`**: `isPdfBuffer`로 분기 → `parsePdfStatement({ data, password })` → 응답에 `mapping: PDF_COLUMN_MAPPING`, `sample`(= `maskPii(parsed)` 앞 N행), `pdfColumnSchema`를 담는다. CSV일 때는 `pdfColumnSchema`를 **넣지 않는다**.
- **`/api/analyze`**: PDF면 `pdfColumnSchema`가 **필수**. `parsePdfColumnSchema`로 검증 후 `parsePdfStatementWithSchema({ data, password, schema })`를 호출한다. **LLM 재판정으로 대체하지 않는다**(INV-2 — 두 번 판정하면 사용자가 본 숫자와 저장된 숫자가 어긋날 수 있다).
- **비밀번호**: 변수로만 전달한다. 로그·DB·응답 body·에러 메시지에 넣지 않는다(INV-4, D3). 프론트는 메모리에만 유지하고 localStorage/sessionStorage에 저장하지 않는다.
- **원본 미보관**: PDF 바이트를 Storage/디스크/로그에 쓰지 않는다. DB에는 `maskPii` 결과와 `freeSummary`만 저장한다(ADR-005).
- **구독 체크·DB 조회/쓰기**: 이 phase에서도 core-services 범위 밖이다. Premium 지연 생성 규칙(ADR-007)은 변경되지 않는다.

## 하위 파이프라인 호환성 (INV-1 / INV-5)

`parsePdfStatement`의 `parsed`는 기존 CSV 경로와 **동일한 `ParsedCsv`**다. 이후 흐름은 변경되지 않는다:

```
parsePdfStatement → parsed(ParsedCsv) → maskPii → generateFreeSummary → (지연) generateReport
```
- `headers`는 항상 `["이용일", "가맹점", "청구금액", "구분"]`
- `청구금액`은 **이번 달 청구액**(D2). 쉼표 없는 정수 문자열(`"23375"`, `"-300"`)
- `이용일`은 `YYYY-MM-DD`
- `구분` ∈ `일시불 | 할부 | 연회비 | 해외 | 기타` → `mapping.category`가 채워지므로 `generateFreeSummary`가 **카테고리 분류용 LLM 호출을 하지 않는다**
- 이 헤더에 이름·주소·계좌·카드번호 컬럼이 없으므로 `maskPii`의 `excludedColumns`/`maskedColumns`는 **빈 배열**이 정상이다

## 골든값 (qa가 실행 후 코드 검증에 쓸 기준)

커밋된 픽스처 `src/services/pdf-parser/__fixtures__/nh-statement-sample.pdf` (비밀번호 `000000`, `pdfkit` 생성):

| 항목 | 값 |
|---|---|
| 계상 거래 | **34건** |
| 청구금액 합계 | **882,646** (= 명세서 `합계` 행, 오차 0) |
| 할부 행 `03/20 테스트페이_강의` | **23,375만 계상**. 140,252은 계상하지 않는다 |
| 해외 건 `07/03 ... 36,719` | **1번만** 계상 (해외 섹션 상세 행은 청구금액 컬럼이 없어 자동 탈락) |
| 소계 2행 / 합계 1행 | 전부 배제 (866,646 / 16,000 / 882,646이 거래로 새지 않는다) |
| `구분` 분포 | `{ 일시불: 29, 할부: 4, 연회비: 1 }` |
| 발견 클러스터 rowCount | 이용금액 32 / 청구금액 34 / 포인트 34 / 할부잔여 4 |
| y 허용오차 0으로 바꿀 때 | 34건 미달 & 합계 ≠ 882,646 (설계상 22건 / 669,446) — **fuzzy 0.5 클러스터링 회귀 가드** |

`year-boundary-sample.pdf`: 3건 / 80,000 / `이용일 = ["2025-12-15", "2026-01-05", "2025-11-20"]`
`no-transactions-sample.pdf`: `UnsupportedPdfFormatError` reason `no_transaction_rows`

## 픽스처 정책 (CRITICAL — qa가 반드시 확인)

`git grep`으로 알려진 실제 실명 / 주소 / 계좌 / 비밀번호가 **각각 0건**이어야 한다(실제 비밀번호는 사용자의 생년월일이므로 문서에도 기록하지 않는다).
픽스처 비밀번호는 `000000`. 실제 명세서 PDF는 커밋하지 않는다. 픽스처는 `pdfkit`(devDependency) + macOS 시스템 폰트로 **한 번 생성해 커밋**하고, 테스트는 읽기만 한다 — `src/` 어디에도 `pdfkit` import나 시스템 폰트 경로가 없어야 한다.
