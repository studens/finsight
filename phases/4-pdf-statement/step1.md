# Step 1: fuzzy y 행 그룹핑 + 거래행 후보 필터 + right-edge 컬럼 클러스터 발견

## 작업

step 0의 `PdfExtractedDocument`를 **행(line) 구조 + 동적으로 발견된 금액 컬럼 클러스터**로 바꾼다.
**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.** LLM은 이 step에서 호출하지 않는다.

> 이 step의 알고리즘은 리더가 실제 NH농협 PDF로 **거래 34건 / 합계 882,646원(오차 0)** 을 확인한 절차다.
> `_workspace/00_input/pdf-extraction-algorithm-verified.md`를 그대로 이식하라. **새로 발명하지 마라.**

### 1-1. 타입 추가 — `src/types/pdf.ts`

```typescript
export type PdfLineRole =
  | "transaction"    // 거래행 후보: 첫 아이템이 MM/DD 로 시작
  | "subtotal"       // 소계 — 이중계상 원인 + 실명 포함 → 반드시 배제
  | "total"          // 합계 — 이중계상 원인 → 반드시 배제
  | "tableHeader"    // 컬럼명 행 (LLM이 클러스터를 라벨링할 근거)
  | "sectionHeader"  // [해외이용] 등
  | "period"         // 이용기간 헤더 (연도 추론 근거)
  | "other"

export type PdfSectionKind = "domestic" | "foreign"

export type PdfLine = {
  pageNumber: number
  /** 클러스터 평균 y */
  y: number
  /** x 오름차순으로 정렬된 아이템 */
  items: PdfTextItem[]
  /** items를 순서대로 "" 로 이어붙인 문자열. 소계/합계 키워드 검사 전용 — 컬럼 분리에 쓰지 말 것 */
  text: string
  role: PdfLineRole
  sectionId: string | null
}

/** 동적으로 발견한 금액 컬럼. rightEdge 값은 카드사마다 다르므로 하드코딩 금지 */
export type PdfRightEdgeCluster = {
  /** 클러스터에 속한 아이템들의 (x + width) 평균 */
  rightEdge: number
  /** 이 컬럼에 값이 있는 거래행 후보의 수 */
  rowCount: number
  /** 최대 5개 샘플 값 (숫자 문자열만 — PII 아님) */
  sampleValues: string[]
}

export type PdfStatementLayout = {
  lines: PdfLine[]
  /** role === "transaction" 인 라인만 */
  transactionLines: PdfLine[]
  /** 그 외 전부 (소계/합계/헤더/page1 PII 라인) — 진단·테스트용 */
  excludedLines: PdfLine[]
  sections: { sectionId: string; kind: PdfSectionKind; headerText: string }[]
  /** 이용기간. ISO YYYY-MM-DD */
  statementPeriod: { start: string; end: string } | null
  /** 거래행 후보에서만 발견한 숫자 컬럼. rightEdge 오름차순 */
  numericColumns: PdfRightEdgeCluster[]
  /** tableHeader 라인의 아이템들 (text + rightEdge). LLM이 클러스터를 라벨링하는 근거 */
  headerLabels: { text: string; rightEdge: number }[]
}
```

### 1-2. 구현 — `src/services/pdf-parser/layout.ts` (신규)

```typescript
export const Y_CLUSTER_TOLERANCE = 0.5
export const RIGHT_EDGE_TOLERANCE = 1.5

/** 한 페이지의 아이템을 fuzzy y 클러스터링으로 행으로 묶는다 */
export function clusterItemsIntoLines(
  items: PdfTextItem[],
  pageNumber: number,
  yTolerance?: number,   // 기본 Y_CLUSTER_TOLERANCE. 회귀 테스트가 0을 주입한다
): PdfLine[]

export function buildStatementLayout(
  doc: PdfExtractedDocument,
  options?: { yTolerance?: number },
): PdfStatementLayout
```

#### (a) fuzzy y 클러스터링 — **이 step의 가장 중요한 부분**

검증된 절차를 그대로 옮긴다:
```
y 내림차순으로 아이템을 순회하며,
|cluster.y - item.y| < yTolerance 인 기존 클러스터를 찾으면 거기에 넣고
cluster.y 를 이동평균으로 갱신한다: y = (y * (n-1) + item.y) / n
없으면 새 클러스터를 만든다.
```
- 기본 허용오차는 **0.5pt**. `Math.round(y * 10) / 10` 같은 **정확 반올림 그룹핑은 금지**다.
- 이유(실측): 한 시각적 행이 두 y로 갈라진다(소계 행 `350.33`/`350.26`, 합계 행 `312.07`/`312.00`). 정확 반올림으로 시도했을 때 **34건 중 24건만 잡히고 합계가 882,646 대신 702,397** 이 됐다. 에러 없이 금액만 틀리게 나오므로 테스트가 없으면 발견되지 않는다.
- 클러스터 확정 후 각 행의 `items`를 **x 오름차순**으로 정렬하고, `text`는 `items.map(i => i.text).join("")`로 만든다.
- 행은 페이지 순 → y 내림차순으로 정렬해 `lines`에 담는다.

#### (b) 라인 role 판정 (순서대로 평가)

1. `text`에 `소계`가 포함 → `"subtotal"`
2. `text`에 `합계`가 포함 → `"total"`
3. 첫 아이템의 `text.trim()`이 `/^\d{2}\/\d{2}/` 에 매칭 → `"transaction"`
4. `text`에 `이용기간` 또는 `/\d{4}\.\d{2}\.\d{2}\s*~\s*\d{4}\.\d{2}\.\d{2}/` 가 있으면 → `"period"`
5. `text`가 `/^\[[^\]]+\]/` 로 시작 → `"sectionHeader"`
6. 첫 아이템이 `이용일`이고 `가맹점` 아이템이 있으면 → `"tableHeader"`
7. 그 외 → `"other"`

**1·2가 3보다 먼저 평가되어야 한다.** 소계/합계 행을 거래로 계상하면 이중계상이다.

#### (c) 섹션 판정

- `sectionHeader` 또는 `period` 라인에서 `[...]` 안의 텍스트를 읽어 새 섹션을 시작한다.
- `sectionId`: `해외`를 포함하면 `"foreign"`, 그 외는 `"domestic"`. 같은 kind가 두 번 나오면 `"domestic-2"` 처럼 뒤에 순번을 붙인다.
- `kind`: 브래킷 텍스트에 `해외`가 있으면 `"foreign"`, 아니면 `"domestic"`.
- 섹션 헤더 이후의 라인들은 다음 섹션 헤더가 나오기 전까지 그 `sectionId`를 갖는다. 섹션 헤더 이전 라인(page1 등)은 `sectionId: null`.

#### (d) 이용기간 파싱

- `period` 라인의 `text`에서 `/(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/` 를 찾아 `{ start: "YYYY-MM-DD", end: "YYYY-MM-DD" }`로 만든다.
- 여러 개 있으면 **첫 번째**를 쓴다. 없으면 `null`.

#### (e) right-edge 컬럼 클러스터 동적 발견

- **`transactionLines`의 아이템만** 대상으로 한다(소계/합계/page1이 클러스터를 오염시키면 안 된다).
- 숫자 아이템 판정: `/^-?[\d,]+$/.test(text.trim())` — `53(할인)`, `6/4`, `USD`, `23.39`, `1,554.60`은 숫자가 아니므로 제외된다(리더 실측 히스토그램이 컬럼 4개로 나온 이유다).
- 각 숫자 아이템의 right-edge = `x + width`.
- right-edge를 `RIGHT_EDGE_TOLERANCE`(1.5) 이내로 묶어 클러스터를 만들고, `rightEdge`는 평균, `rowCount`는 **그 컬럼에 값이 있는 서로 다른 거래행의 수**, `sampleValues`는 최대 5개.
- `numericColumns`를 `rightEdge` 오름차순으로 정렬한다.
- **좌표 상수(275.5 / 407.0 / 445.5 / 558.5)를 코드에 하드코딩하지 않는다.** 이건 NH농협 고유값이고 다른 카드사는 다르다. 어떤 클러스터가 어떤 컬럼인지는 step 3에서 LLM이 판정한다.

#### (f) headerLabels

`tableHeader` role 라인들의 각 아이템을 `{ text, rightEdge: x + width }`로 모은다. 여러 tableHeader가 있으면 전부 모은다. step 3이 이걸 LLM에 줘서 클러스터를 라벨링한다.

### 1-3. 이 step에서 하지 않는 것

- 이미지/스캔 PDF 거부(`transactionLines.length === 0`) → **step 4**
- 레댁션 게이트 → **step 2**
- LLM 호출·`PdfColumnSchema` → **step 3**
- 연도 추론·`ParsedCsv` 변환 → **step 4**

## Acceptance Criteria

- [ ] (TDD) `src/services/pdf-parser/layout.test.ts`가 먼저 작성되고, 픽스처 `nh-statement-sample.pdf`(비밀번호 `000000`)를 `extractPdfTextItems`로 읽어 `buildStatementLayout`에 넣는 방식으로 검증한다.
- [ ] (골든값 — 거래행 34건) `layout.transactionLines.length === 34`인 테스트가 통과한다.
- [ ] (골든값 — 소계/합계 배제) `layout.transactionLines` 중 `text`에 `소계` 또는 `합계`가 포함된 라인이 **0개**이고, `layout.excludedLines`에 role `"subtotal"` 2개와 `"total"` 1개가 있는 테스트가 통과한다. 소계 행에 가명 실명 `홍길동`이 들어 있음도 함께 단정해, 이 행이 거래로 새지 않음을 명시한다.
- [ ] (골든값 — page1 PII 라인이 거래 후보가 아님) `성명`/`주소`/`결제계좌`를 포함하는 page1 라인들이 모두 `excludedLines`에 있고 `transactionLines`에 없다는 테스트가 통과한다.
- [ ] (**CRITICAL 회귀 — fuzzy 클러스터링 없으면 조용히 틀림**) 다음 두 단정이 한 테스트에 함께 있어야 한다:
      (1) `yTolerance` 기본값(0.5)에서 `transactionLines.length === 34`이고 청구금액 컬럼(rowCount 34인 클러스터) 값 합이 **882,646**이다.
      (2) `buildStatementLayout(doc, { yTolerance: 0 })`로 바꾸면 거래행 수가 **34보다 작아지고** 청구금액 합이 **882,646이 아니다**. (픽스처 설계상 22건 / 669,446이 예상값이며, 최소한 부등식은 반드시 성립해야 한다.)
      또한 구현 코드에 `Math.round(y` 패턴이 없음을 grep으로 확인한다.
- [ ] (right-edge 컬럼 동적 발견) `layout.numericColumns`에 대해 다음이 통과한다: `rowCount === 34`인 클러스터가 존재하고 그 `rightEdge`가 `407.0 ± 1.5`이다. `rowCount === 32`(이용금액, `275.5 ± 1.5`), `rowCount === 34`(포인트, `445.5 ± 1.5`), `rowCount === 4`(할부잔여, `558.5 ± 1.5`) 클러스터가 각각 존재한다.
- [ ] (좌표 하드코딩 금지) `src/services/pdf-parser/layout.ts`에 `275.5`, `407`, `445.5`, `558.5` 리터럴이 **하나도 없음**을 grep으로 확인한다. 코드에 있는 좌표 상수는 `Y_CLUSTER_TOLERANCE`(0.5)와 `RIGHT_EDGE_TOLERANCE`(1.5)뿐이다.
- [ ] (right-edge 허용오차) 픽스처에서 청구금액 right-edge를 407.4 / 406.6 / 407.3으로 흔들어 둔 3개 행이 **모두 같은 클러스터**로 묶여 rowCount가 34가 되는 것으로 1.5 허용오차가 검증된다.
- [ ] (숫자 판정) `53(할인)`, `922(면제)`, `6/4`, `USD`, `23.39`, `1,554.60`이 `numericColumns` 클러스터에 **포함되지 않음**을 단정하는 테스트가 통과한다(그래서 클러스터가 4개 + 해외 원화청구금액 1개로만 나온다).
- [ ] (해외 상세 행) 해외 섹션 상세 라인은 `role === "transaction"`으로 잡히지만 청구금액 클러스터(`407.0 ± 1.5`)에 값이 **없다**는 테스트가 통과한다. 이 행 때문에 `rowCount === 1`인 별도 클러스터(원화청구금액, `520.0 ± 1.5`)가 발견되는 것도 함께 단정한다.
- [ ] (섹션) `layout.sections`에 `kind === "domestic"` 1개와 `kind === "foreign"` 1개가 있고, 해외 상세 라인의 `sectionId`가 foreign 섹션의 id와 같은 테스트가 통과한다.
- [ ] (이용기간) `layout.statementPeriod`가 `{ start: "2026-06-11", end: "2026-07-10" }`이다. `year-boundary-sample.pdf`에서는 `{ start: "2025-12-11", end: "2026-01-10" }`이고 `transactionLines.length === 3`이다.
- [ ] (headerLabels) `layout.headerLabels`에 `이번달청구금액`이 있고 그 `rightEdge`가 청구금액 클러스터의 `rightEdge`와 `1.5` 이내로 일치하는 테스트가 통과한다(step 3의 LLM 라벨링 근거가 실제로 성립함).
- [ ] (문자열 join을 컬럼 분리에 쓰지 않음) `layout.ts`에서 `text`(join된 문자열)는 소계/합계·이용기간·섹션 헤더 **키워드 판정에만** 쓰이고, 금액 컬럼 분리에는 `x + width`만 쓰인다. `text`를 공백/정규식으로 split해 금액을 뽑는 코드가 없음을 확인한다.
- [ ] (원본 미보관 CRITICAL) `layout.ts`에 `console.*`, `fs` 사용이 없고 원본 행 텍스트를 로그로 남기는 코드가 없음을 grep으로 확인한다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 기존 CSV 파이프라인 테스트가 하나도 깨지지 않는다(INV-5).
