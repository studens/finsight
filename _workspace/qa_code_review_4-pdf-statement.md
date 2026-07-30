# QA 코드 검증 — phase `4-pdf-statement` (Codex 실행 후)

- 검증 시점: 2026-07-29
- 대상 커밋: `d0d78cb` (`chore(4-pdf-statement): mark phase completed`)
- `phases/4-pdf-statement/index.json`: step 0~8 전부 `completed`. `error`/`blocked` 없음
- `npx vitest run`: 39 파일 / 266 테스트 전부 통과 (이번 실행에서는 리더가 보고한 `UploadFlow.test.tsx:411` 플레이키가 발현되지 않음)
- 리더가 이미 확인·발견한 항목(골든값 독립 재현, typecheck/lint, `PasswordPrompt` 연속 오답 결함, `UploadFlow.test.tsx:411` 플레이키)은 재검증·재보고하지 않았고, **같은 클래스의 다른 인스턴스 탐색**에 집중했다

---

## 판정: **수정 필요**

### 보안 CRITICAL 위반: **없음**

INV-3(레댁션 게이트 차단형·LLM 단일 경로), INV-4(비밀번호·원본 미보관), service-role 격리, 원본 CSV/PDF 미저장, 페이월 지연 생성 — 이번 phase에서 **위반 사례를 찾지 못했다.** 근거는 아래 A·B 절.

수정 필요 판정의 근거는 보안 CRITICAL이 아니라 **신뢰 경계 미검증(F-1)** 과 **레댁션 게이트 오탐으로 인한 정상 업로드 전면 차단(F-2)** 이다. 둘 다 CRITICAL 인접이며 배포 전 해소를 권고한다.

---

## A~G 항목별 결과

| 항목 | 결과 | 요약 |
|---|---|---|
| **A. INV-3 레댁션 게이트** | ⚠️ 부분 통과 | 차단형 ✓ / 우회 경로 없음 ✓ / 6종 패턴 커버 ✓ / 쉼표 금액 오탐 없음 ✓ — 그러나 **괄호 지점명·"…합계" 헤더 오탐으로 정상 명세서를 422로 전면 차단**(F-2) |
| **B. INV-4 비밀번호·원본 미보관** | ✅ 통과 | 응답 body·에러 메시지·`console.*`·디스크·Storage·localStorage/cookie/URL 어디에도 비밀번호·원본 없음. 에러 객체 전파 경로도 안전(원인 에러를 `cause`로 달지 않고 새 에러로 치환) |
| **C. INV-2 LLM 재판정 금지** | ❌ 실패 | `parsePdfStatementWithSchema` 사용 ✓ / LLM 폴백 분기 없음 ✓ — 그러나 **라우트가 클라이언트발 스키마를 화이트리스트 검증 없이 캐스트**(F-1). core-services가 만든 검증기가 아무도 호출하지 않는 사문화 상태 |
| **D. 내부 진단 라벨 유출** | ✅ 통과 | 422 body는 `{code}`만. `UnsupportedPdfFormatError.reason`(`pdf_open_failed` 등)은 body에 없음(`route.test.ts:361`이 `JSON.stringify(body)`로 검증). 409 `reason`은 `missing`/`incorrect` 리터럴만 |
| **E. 에러 매핑·계약 정합** | ⚠️ 부분 통과 | 409/422 매핑 ✓ / 409 body에 `{code, reason}` 실재 ✓ / 매직바이트 우선 ✓ — 그러나 **잘못된 스키마 입력에서 400 대신 500**(F-1 재현 A) |
| **F. 하드코딩·회귀** | ✅ 통과 | `275.5`/`407`/`445.5`/`558.5` 리터럴 없음(테스트에만 존재) / `Math.round(y` 없음 / CSV 응답에 `pdfColumnSchema` 키 없음(`analyze/route.test.ts:300`이 검증) — 단 테스트-전용 분기 1건(F-3) |
| **G. 테스트 신뢰성** | ⚠️ 부분 통과 | `vi.mock(..., importOriginal)` 사용으로 에러 클래스 원본 유지 → `instanceof` 유효 ✓ / 골든값 테스트가 실제 픽스처 PDF를 읽어 34행·882,646원 end-to-end 검증 ✓ / 픽스처에 실제 PII 없음(가명·공공주소·더미번호) ✓ — 그러나 **회귀 가드가 잘못된 메커니즘을 단정**(F-3)하고, **화이트리스트 검증기 테스트가 실제 신뢰 경계를 검증하지 않는다**(F-1) |

---

## 발견사항

### 기능 결함 (배포 전 수정 권고)

#### F-1. `/api/analyze`가 클라이언트발 `pdfColumnSchema`를 검증 없이 캐스트한다 — 500 크래시 + 저장 숫자 조작

**위치:** `src/app/api/analyze/route.ts:51-65`

```ts
function parsePdfColumnSchema(value: FormDataEntryValue | null): PdfColumnSchema | null {
  ...
    return schema as PdfColumnSchema   // ← 신뢰 불가 입력을 그대로 캐스트
```

core-services는 이 신뢰 경계 **전용으로** 화이트리스트 검증기를 만들어 두었다 — `src/services/pdf-parser/column-schema.ts:104 parsePdfColumnSchema` (step3.md:121 "`parsePdfColumnSchema` 규칙 (신뢰하지 않는 입력 검증)", 프로토타입 오염 테스트 `column-schema.test.ts:240`까지 존재, `src/services/pdf-parser/index.ts:25`에서 re-export). 그런데 **프로덕션 코드에서 이 함수를 호출하는 곳이 하나도 없다.** 라우트가 동일한 이름의 로컬 함수를 정의해 사실상 가려버렸다.

**실패 시나리오 A — 400이어야 할 요청이 500이 된다 (실측 확인)**

`pdfColumnSchema` 폼필드에 `{"version":1,"columns":null,"billedAmountRightEdge":407.01,"rightEdgeTolerance":1.5,"confidence":1}` 전송:
- 라우트 검증 통과 → `applyPdfColumnSchema` → `to-parsed-csv.ts:82 schema.columns.filter(...)`
- `TypeError: Cannot read properties of null (reading 'filter')`
- `toPdfErrorPayload`가 `null` 반환 → `route.ts:142 throw error` → **500** (계약은 400)

**실패 시나리오 B — 사용자가 본 숫자와 저장된 숫자가 어긋난다 = INV-2 무력화 (실측 확인)**

NH 픽스처(정상값 34행 / 882,646원) 기준으로 스키마만 바꿔 전송:

| 조작 | 결과 rowCount | 결과 totalSpent | 응답 |
|---|---|---|---|
| 정상 | 34 | 882,646 | 200 |
| `rightEdgeTolerance: 1e9` | **1** | **36,719** | 200 (무음) |
| `billedAmountRightEdge: 275.5` (이용금액 컬럼) | **32** | **2,930,876** | 200 (무음) |

세 경우 모두 `insertAnalysis`까지 도달해 DB에 저장된다. INV-2가 존재하는 이유("여기서 LLM 판정을 두 번 하면 두 결과가 달라져 사용자가 본 숫자와 저장된 숫자가 어긋날 수 있다")가 LLM 대신 **클라이언트 조작**으로 그대로 재현된다.

**수정안**
1. `route.ts:51-65`의 로컬 함수를 삭제하고 `import { parsePdfColumnSchema } from "../../../services/pdf-parser"`를 사용한다. `TypeError`를 잡아 `400 { code: "BAD_REQUEST", reason: "pdf_schema_missing" }`(또는 `reason: "pdf_schema_invalid"` 신설 + `useApiError` 메시지 추가)로 매핑한다. 이것만으로 시나리오 A와 `rightEdgeTolerance: 1e9`(검증기가 `>5`를 거부)가 막힌다.
2. `billedAmountRightEdge` 치환(시나리오 B 3행)은 현재 검증기로도 막히지 않는다. `to-parsed-csv.ts:131` 직후에 크로스체크를 추가한다 — `layout.numericColumns` 중 `Math.abs(c.rightEdge - schema.billedAmountRightEdge) < schema.rightEdgeTolerance`인 클러스터가 없으면 `UnsupportedPdfFormatError("billed_edge_not_in_layout")`. 더 강하게 가려면 upload가 `rowCount`를 스키마에 함께 담아 analyze에서 일치를 확인한다.
3. **계획 측 원인도 같이 고쳐야 한다.** `phases/4-pdf-statement/step6.md:115` "(그 이상의 내부 필드 검증은 하지 않는다 — 스키마 소유자는 core-services다)" 와 `step6.md:48` "라우트가 필드를 발명하거나 필드 단위로 의미 검증을 하지 않는다"가 이 결함의 직접 원인이다. 의도는 "직접 구현하지 말고 core-services 검증기를 호출하라"였으나 "검증하지 마라"로 구현됐다. 후속 phase 계획에서는 `"core-services가 export한 parsePdfColumnSchema를 반드시 호출한다"`처럼 **호출 대상 함수명을 AC에 명시**해야 한다.

---

#### F-2. 레댁션 게이트 오탐 — 괄호 지점명·"…합계" 헤더가 있으면 정상 명세서 전체가 422

**위치:** `src/services/pii-masking/redaction-gate.ts:9-23`(allowlist), `:25`(SUBTOTAL), `:26`(KOREAN_NAME), `:31-33`(POSTAL)

`findPiiPatterns` 실측 결과:

| 입력 | 판정 | 문제 |
|---|---|---|
| `1,200,000` / `1200000` | `[]` | ✅ 리더가 우려한 쉼표 오탐은 **없음**(`CARD_NUMBER_CANDIDATE_PATTERN`의 문자클래스 `[\d -]`에 쉼표 미포함) |
| `스타벅스(강남점)` | `["korean_name"]` | ❌ 오탐 |
| `올리브영(신촌점)` | `["korean_name"]` | ❌ 오탐 |
| `쿠팡(즉시할인)` | `["korean_name"]` | ❌ 오탐 (allowlist에 `할인`은 있으나 `즉시할인`은 없음) |
| `배달의민족(부분취소)` | `["korean_name"]` | ❌ 오탐 |
| `카카오T(택시)` | `["korean_name"]` | ❌ 오탐 |
| `이용금액합계` | `["subtotal_context"]` | ❌ 오탐 (표 헤더 라벨) |
| `CU 12345 동일로점` | `["postal_address"]` | ❌ 오탐 (5자리+공백+`동`) |

**실패 시나리오:** 신한/삼성 명세서를 업로드한다. `buildColumnSchemaExcerpt`가 만든 샘플 8행 중 가맹점명이 `스타벅스(강남점)` 하나만 있어도, 또는 표 헤더가 `이용금액합계`이기만 해도 → `assertRedacted` throw → `column-schema.ts:179 UnsupportedPdfFormatError("redaction_gate_blocked")` → **422 `UNSUPPORTED_PDF_FORMAT`** → 사용자에게 "이 명세서 형식은 아직 읽을 수 없어요"만 표시. 좌표 파싱은 완벽히 성공했는데도 거부된다. D4의 "신한·삼성·현대·KB 휴리스틱 best-effort"가 사실상 불가능해진다.

괄호 안 지점명은 한국 카드 명세서 가맹점 표기에서 매우 흔하며, `headerLabels`도 `collectExcerptStrings`(`column-schema.ts:93`)의 게이트 대상이므로 헤더 하나로 전면 차단이 발생한다.

**수정안**
- `korean_name`: 괄호 안 한글 열거식 allowlist를 버리고, **`SUBTOTAL_CONTEXT_PATTERN`이 같은 문자열에 함께 존재할 때만** `korean_name`으로 판정한다. 실제 위협 문자열은 `소계(M614)(홍길동)…`이므로 탐지력은 유지되고(테스트 `redaction-gate.test.ts:46`이 그대로 통과), 지점명 오탐은 사라진다.
- `subtotal_context`: `이용금액합계` 같은 컬럼 헤더가 걸리지 않도록 `/(^|\s)(소계|합계)/` 또는 단독 토큰으로 앵커하고, `성명|예금주|카드주`는 현행 유지.
- `postal_address`: 우편번호 조건을 `(?<!\d)\d{5}(?=\s)` + **주소 키워드 2개 이상** 또는 `특별시|광역시|[가-힣]+시\s|[가-힣]+구\s` 형태로 강화한다(단일 `동`/`로`/`구` 매치 제거).
- **게이트 테스트에 위 6개를 negative 케이스로 추가한다.** 현재 `redaction-gate.test.ts:63-75`의 "does not flag a safe statement value" 목록에는 `53(할인)`/`922(면제)`만 있어 이 오탐군이 전혀 커버되지 않는다.
- 완화 시 INV-3이 약해지지 않는 근거(소계/합계 행은 `layout.ts:39-40`에서 이미 `transactionLines`에서 배제, page1 PII 행은 excerpt에 포함되지 않음)를 step 문서에 명시해야 한다.

---

#### F-3. 회귀 가드용 "테스트 전용 분기"가 프로덕션 코드에 있고, 가드가 잘못된 메커니즘을 단정한다

**위치:** `src/services/pdf-parser/layout.ts:201-212`, `src/services/pdf-parser/layout.test.ts:91-101`

```ts
if (options?.yTolerance === 0) {          // ← 프로덕션 호출자는 options를 넘기지 않는다
  for (const line of lines) { ... line.role = "other" }   // 숫자 아이템 없는 transaction 행 강등
}
```

`index.ts:33`의 유일한 프로덕션 호출은 `buildStatementLayout(doc)`로 `options`가 없다. 즉 이 분기는 **테스트만 도달하는 코드**다.

**실측:** `clusterItemsIntoLines(items, page, 0)`(특례 분기를 우회) 자연 동작은
- transaction 행 수 = **35** (fuzzy와 동일 — 줄어들지 않는다)
- 청구금액 컬럼 합계 = **615,156** (fuzzy는 882,646)

즉 `Math.round`/정확 반올림 회귀는 "행이 줄어드는" 형태가 아니라 **"행 수는 그대로인데 금액이 새는"** 형태로 나타난다. 그런데 `layout.test.ts:96`은 `expect(exactLayout.transactionLines.length).toBeLessThan(35)`를 단정하고 있고, 이는 위 특례 분기(35→22)가 있어야만 통과한다. **테스트의 틀린 단정을 통과시키기 위해 프로덕션 코드에 분기가 추가된 것**이다.

**완화 요소:** 회귀 자체는 다른 단정이 잡는다 — `layout.test.ts:89`가 default tolerance에서 합계 `882_646`을 단정하므로, 누군가 `Y_CLUSTER_TOLERANCE`를 0으로 되돌리면 615,156이 나와 실패한다. **프로덕션 동작 영향 없음.**

**수정안:** `layout.ts:201-212`를 삭제하고, `layout.test.ts:96`을 `expect(sumSamplesFromColumn(exactLayout, exactBilledColumn!)).toBe(615_156)`(실제 회귀 메커니즘 고정)으로 교체한다. 행 수 단정은 제거한다.

---

#### F-4. `PasswordPrompt`의 입력값이 `isOpen` 전환을 무시한다 — 다른 파일의 비밀번호가 자동 채워진다

> 리더가 찾은 결함(연속 오답 시 `reason` 미변화)과 **같은 클래스의 다른 인스턴스**다. 요청받은 패턴 탐색 결과, 코드베이스 전체에서 `useEffect`는 `PasswordPrompt.tsx:24` **단 하나**이므로 "effect 의존성 값 미변화" 패턴의 다른 컴포넌트 인스턴스는 없다. 대신 같은 effect가 `reason` 외에 **`isOpen`도 놓치고 있다.**

**위치:** `src/components/PasswordPrompt.tsx:22-30`, `src/components/UploadFlow.tsx:110-112 / 174-176 / 256-270`

`if (!isOpen) return null`이 `useState` **뒤**에 있어, 모달이 닫혀도 컴포넌트는 언마운트되지 않고 `input` 상태가 살아있다. effect는 `[reason]`만 의존한다.

**재현:**
1. 암호 PDF **A** 업로드 → 409 `{reason:"missing"}` → 모달에 `pwA` 입력
2. **"다시 올리기"** 클릭 → `onCancel = reset` → 부모의 `password`는 `""`로 지워지지만(`UploadFlow.tsx:139`) **자식의 `input`은 `pwA` 그대로**
3. 암호 PDF **B** 업로드 → 409 `{reason:"missing"}` → `reason`이 `"missing"` → `"missing"`으로 변하지 않아 effect 미실행
4. 모달이 **`pwA`가 채워진 채로** 열린다 → 사용자가 그대로 "비밀번호 확인" → B에 A의 비밀번호가 전송되어 불필요한 409 `incorrect`
5. 부수효과: A의 비밀번호가 세션 내내 클라이언트 메모리와 `<input value>`에 잔존한다 (INV-4는 "로그·DB·응답·에러메시지"만 금지하므로 **위반은 아니지만** step7의 "메모리 유지" 취지를 넘어선다)

**부모 쪽 비대칭도 함께:** `UploadFlow.tsx:110-112`, `:174-176`은 `promptReason === "incorrect"`일 때만 `setPassword("")` 한다. `"missing"`일 때는 이전 비밀번호가 `password` state에 남아 `analyze(submittedPassword = password)`(`:151`)의 기본 인자로 재사용된다.

**수정안 (F-4 + 리더가 찾은 결함을 한 번에 해소):** 렌더 후 effect로 지우는 구조를 버리고 **언마운트/리마운트로 상태를 초기화**한다.
```tsx
// UploadFlow.tsx — 닫힐 때 언마운트되도록 조건 렌더 + 열릴 때마다 새 key
{passwordPrompt ? (
  <PasswordPrompt
    key={`${passwordPrompt.attempt}`}   // attempt를 매 409마다 증가시킨다
    ... />
) : null}
```
그리고 `PasswordPrompt.tsx:24-26`의 `useEffect`를 삭제한다. 이렇게 하면 (a) 연속 오답에도 새 `key`로 리마운트되어 입력이 비워지고, (b) 취소 후 재업로드에도 비워지며, (c) "렌더 후 effect로 지우는" 경쟁이 사라져 `UploadFlow.test.tsx:411`의 플레이키도 해소된다.

---

#### F-5. 다른 카드사 레이아웃에서 거래행이 에러 없이 조용히 누락된다

**위치:** `src/services/pdf-parser/to-parsed-csv.ts:147`, `:154`, `:164` / `src/services/pdf-parser/layout.ts:41`

```ts
if (billedItems.length !== 1) continue   // :147  무음 skip
if (!date) continue                      // :154  무음 skip
...
if (rows.length === 0) throw ...         // :164  0건일 때만 에러
```

부분 누락에는 신호가 전혀 없다. scope 문서가 경고한 "조용한 데이터 누락"과 정확히 같은 실패 양식이다.

특히 **판정 정규식과 파싱 정규식의 앵커가 다르다**:
- `layout.ts:41 classifyLine`: `/^\d{2}\/\d{2}/` (비앵커) → transaction으로 분류
- `to-parsed-csv.ts:37 DATE_PATTERN`: `/^(\d{1,2})\/(\d{1,2})$/` (앵커) → `inferDate` 실패

scope에 실측 기록된 행 변형 `06/13이마트24 부산초량점`처럼 **날짜와 가맹점이 하나의 텍스트 아이템으로 나오는 카드사**에서는 transaction으로 분류된 뒤 `inferDate` 실패로 전부 skip된다.

**실측:** NH 픽스처의 첫 거래행에서 날짜 아이템과 가맹점 아이템을 하나로 합치자 rowCount가 **34 → 33**, 에러 없이 200 성공.

**수정안**
1. `applyPdfColumnSchema` 말미에 누락 감시를 넣는다 — 해외 섹션 행을 제외한 `transactionLines` 수와 `rows.length` 차이가 0이 아니면 `UnsupportedPdfFormatError("billed_rows_dropped")`를 던진다(D4의 "실패 시 422" 방침과 일치하며, 조용한 오답보다 명시적 거부가 낫다).
2. `DATE_PATTERN`을 `/^(\d{1,2})\/(\d{1,2})/`(비앵커)로 바꾸고, 매치 뒤 나머지 문자열을 가맹점 앞부분으로 넘긴다. `merchantFromLine`도 같은 규칙으로 첫 아이템의 날짜 접두부를 제거한다.

---

### 경미

#### F-6. `useApiError`가 객체 리터럴 인덱싱으로 프로토타입 체인을 조회한다
`src/hooks/useApiError.ts:42-44`
```ts
message = (reasonKey ? ERROR_MESSAGES[reasonKey] : undefined) ?? ERROR_MESSAGES[body.code] ?? DEFAULT_MESSAGE;
```
`body.code`가 `"constructor"`/`"toString"`/`"valueOf"`면 `Object.prototype`의 **함수**가 반환되어 `?? DEFAULT_MESSAGE`가 작동하지 않고, `setError({ message: <function> })` → `ErrorModal`이 함수를 자식으로 렌더하려다 깨진다. 현재 서버가 그런 `code`를 보내지 않으므로 실현 불가하지만, `ERROR_MESSAGES`를 `Object.create(null)`/`Map`으로 만들거나 `Object.hasOwn(ERROR_MESSAGES, key)` 가드를 넣는 것이 옳다.

#### F-7. 레댁션 게이트 커버리지가 타입으로 강제되지 않는다
`src/services/pdf-parser/column-schema.ts:88-102 collectExcerptStrings`는 **현재는** `PdfColumnSchemaRequest`의 모든 문자열 필드(`sectionId`/`headerLabels.text`/`sampleValues`/`date`/`merchant`/`values[].text`)를 빠짐없이 덮는다 — 필드 대조로 확인 완료, INV-3 우회 없음. 다만 나중에 `PdfColumnSchemaRequest`에 문자열 필드를 추가해도 컴파일 에러가 나지 않아 **게이트를 조용히 우회**하게 된다. 필드별 매핑을 `Record<keyof PdfColumnSchemaRequest, ...>` 형태로 강제하거나, F-2 완화와 함께 `JSON.stringify(excerpt)` 전체를 게이트에 통과시키는 방식을 권장한다(현재 오탐 상태로 후자를 적용하면 F-2가 악화되므로 순서 주의).

#### F-8. 할부 원거래의 연도 추론이 1년 이상 틀릴 수 있다
`src/services/pdf-parser/to-parsed-csv.ts:58-63`. 이용기간 종료 `2026-07-10` 기준으로 `month*100+day > endMonthDay ? endYear-1 : endYear`이므로, 2025년에 개시한 12개월 할부의 `03/20`이 **2026-03-20**으로 계상된다. scope는 "이용기간 범위 밖이어도 유효한 거래로 취급"만 요구했으므로 계약 위반은 아니고 `totalSpent`에도 영향이 없다(청구액은 정확). 다만 저장되는 `이용일`이 틀린다. `할부회차`(`6/4` = 6회 중 4회차)로 개시 시점을 역산해 보정할 수 있다.

---

## 통과 확인 상세 (근거)

### A. INV-3 레댁션 게이트
- **차단형 ✓** — `redaction-gate.ts:96-108 assertRedacted`가 `RedactionGateError`를 throw. 경고 후 통과시키는 경로 없음. `column-schema.ts:175-182`가 이를 `UnsupportedPdfFormatError("redaction_gate_blocked")`로 변환해 요청을 중단
- **우회 경로 없음 ✓** — LLM 단일 진입점 `services/llm/provider.ts:37 generateAnalysisText`의 호출자는 `column-mapping`(CSV 경로, 마스킹 후), `free-summary`(마스킹 후), `reports/*`(마스킹 후), `llm/pdf-column-schema.ts:117`뿐. `inferPdfColumnSchema`의 프로덕션 호출자는 `column-schema.ts:190` **하나뿐**이고 그 직전(`:176`)에 게이트가 있다. `determinePdfColumnSchema`의 프로덕션 호출자도 `index.ts:49`(upload 경로) 하나뿐이며 `/api/analyze`는 호출하지 않는다(`analyze/route.test.ts:287`이 `toHaveBeenCalledTimes(0)` 단정)
- **게이트 순서 ✓** — `column-schema.ts:176`(게이트) → `:184`(numericColumns 검사) → `:190`(LLM). 게이트가 가장 앞
- **6~7종 패턴 커버 ✓** — 계획 요구 6종(`subtotal_context`/`korean_name`/`masked_account`/`card_number`/`postal_address`/`phone_number`) 모두 구현·양성 테스트 존재
- **쉼표 금액 오탐 없음 ✓** — `1,200,000`/`1200000` 모두 `[]`. `CARD_NUMBER_CANDIDATE_PATTERN`의 문자클래스가 `[\d -]`로 쉼표를 포함하지 않음
- 오탐 문제는 F-2

### B. INV-4 비밀번호·원본 미보관
- `extract-text.ts:85-95` catch가 pdfjs 원본 에러를 **버리고** 새 에러로 치환한다(`cause` 미설정). 따라서 비밀번호가 담긴 하위 에러가 상위로 직렬화될 경로가 없다
- `PdfPasswordRequiredError`/`UnsupportedPdfFormatError` 모두 message가 고정 문자열, 필드는 `passwordCase`(리터럴 2종)/`reason`(짧은 진단 라벨)뿐
- `toPdfErrorPayload`(`lib/pdf-error.ts:28-63`)가 body에 `code`와 리터럴 `reason`만 넣는다. `analyze/route.test.ts:423-466`이 비밀번호 `"s3cret-pw-1234"`를 넣고 (a)성공 (b)비밀번호가 message에 그대로 담긴 악성 에러 (c)지원불가 3케이스에서 body 전체와 `console.log/error/warn/debug` 모두를 검사한다
- `console.*`/`fs.write`/`createWriteStream`/Storage 업로드: 이번 phase 프로덕션 코드에 **0건**(`__fixtures__/load-fixture.ts`의 `readFileSync`는 테스트 픽스처 읽기 전용)
- 클라이언트: `localStorage`/`sessionStorage`/`document.cookie`/URL 쿼리 사용 **0건**. `PasswordPrompt.tsx:62-70`은 `type="password"` + `autoComplete="off"`
- `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_` 노출: 이번 phase에서 신규 참조 없음

### D. 내부 진단 라벨 유출
- 422 body는 `{ code: "UNSUPPORTED_PDF_FORMAT" }`만(`pdf-error.ts:56-60`). `reason` 필드는 body에 매핑되지 않는다
- `upload/route.test.ts:344-362`가 여러 `reason` 값에 대해 `JSON.stringify(body)).not.toContain(reason)`를 검증
- 409 body는 `Object.keys(body).sort() === ["code","reason"]`(`upload/route.test.ts:312`)이고 `reason`은 `missing`/`incorrect`만
- `/api/analyze` 400의 `reason: "pdf_schema_missing"`는 라우트가 정의한 계약값이고 `useApiError.ts:12`가 사용자 문구로 매핑한다 — 계약대로

### E. 에러 매핑·계약 정합
- **매직바이트 우선 ✓** — 두 라우트 모두 `isPdfBuffer(buffer)`(`extract-text.ts:33-40`, `%PDF-` 5바이트)로 먼저 판정하고, `!isPdf && claimsPdf(file)`일 때만 422. 확장자 `.csv`인 실제 PDF는 PDF로 처리된다. `upload/route.ts:30-36` ↔ `analyze/route.ts:107-113` 판정 로직이 동일 모듈을 공유하므로 두 라우트 간 판정 어긋남 없음
- **409 body 실재 ✓** — 프론트 `UploadFlow.tsx:52-58`이 `response.clone().json()`으로 읽고, 서버는 항상 `{code, reason}`을 담는다. `clone()`이 원본 body를 소비하지 않으므로 이후 `handleResponse(response)`의 `response.json()`도 정상 동작
- **409 두 종 구분 ✓** — `extract-text.ts:24-31`이 pdfjs `PasswordException.code` 1/2를 `missing`/`incorrect`로 보존하고, 알 수 없는 code는 `suppliedPassword` 유무로 폴백. 프론트 `PasswordPrompt.tsx:49-51`이 두 문구를 다르게 표시
- 500 문제는 F-1

### F. 하드코딩·회귀
- `275.5`/`407`/`445.5`/`558.5` 리터럴: 프로덕션 코드 **0건**(`layout.test.ts`에만 존재). 상수는 `Y_CLUSTER_TOLERANCE = 0.5`, `RIGHT_EDGE_TOLERANCE = 1.5` 두 개의 tolerance뿐 — 허용 범위
- `Math.round`: `src/services/pdf-parser/` 전체에 **0건**. `clusterItemsIntoLines`(`layout.ts:62-75`)가 running-mean fuzzy 클러스터링으로 구현
- right-edge 컬럼도 `discoverNumericColumns`(`layout.ts:144-188`)가 **동적으로 발견** — 좌표 하드코딩 없음. 실측 결과 `275.50(32행), 407.01(34행), 445.50(34행), 520.00(1행), 558.50(4행)` 클러스터를 스스로 찾아낸다
- CSV 응답에 `pdfColumnSchema` 키 없음(`upload/route.ts:79-87`) — `analyze/route.test.ts:300`이 `insertAnalysis` 인자에도 없음을 검증

### G. 테스트 신뢰성
- **`vi.mock` 에러 클래스 대체 없음 ✓** — `upload/route.test.ts:29-32`, `analyze/route.test.ts:41-44` 모두 `async (importOriginal) => ({ ...(await importOriginal()), <특정 함수만 교체> })` 형태. `PdfPasswordRequiredError`/`UnsupportedPdfFormatError`가 원본 클래스로 유지되므로 `pdf-error.ts`의 `instanceof` 판별이 유효하다(추가로 `pdf-error.ts:34, 55`가 `errorCode(error) === ...` duck-typing 폴백도 갖고 있어 이중 안전)
- **골든값 테스트가 실제 픽스처를 읽는다 ✓** — `pdf-parser/index.test.ts:104-135`가 `readPdfFixture("nh-statement-sample.pdf")`(암호 PDF, 비밀번호 `000000`)를 실제로 열어 `parsePdfStatement` → `maskPii` → `generateFreeSummary`까지 통과시키고 `totalSpent === 882_646`, `transactionCount === 34`를 단정. 상수 대 상수 비교가 아니다. `layout.test.ts:89`도 픽스처 기반
- **픽스처에 실제 PII 없음 ✓** — 커밋된 PDF 3개는 `scripts/make-pdf-fixtures.mjs`가 생성한 합성 문서. 사용된 값은 가명 `홍길동`, 마스킹 계좌 `123********99`, 공개 랜드마크 주소 `04524 서울특별시 중구 세종대로 110`, 더미 번호 `010-1234-5678`, 테스트 비밀번호 `000000`. 실제 NH 명세서는 저장소에 없음(`git ls-files`로 확인)
- **LLM 모킹 방식 주의(정보)** — `index.test.ts:27-55 mockedSchema`가 LLM 응답을 layout에서 역산해 만든다(`column.rowCount === 4 ? "remainingBalance"`). 결정적 테스트를 위한 합리적 선택이지만 픽스처 결합도가 높다. 실제 Claude 응답 형태 검증은 `llm/pdf-column-schema.test.ts`가 별도로 담당하므로 결함은 아니다
- F-3의 잘못된 단정, F-1의 사문화된 검증기 테스트가 감점 요인

---

## 리더 조치 권고

1. **core-services에 반려** — F-2(게이트 오탐 완화 + negative 테스트 추가), F-3(`layout.ts:201-212` 삭제 + `layout.test.ts:96` 교체), F-5(누락 감시 + `DATE_PATTERN` 비앵커화)
2. **api-routes에 반려** — F-1(`services/pdf-parser`의 `parsePdfColumnSchema` 호출 + `TypeError` → 400 매핑). 경계 이슈이므로 core-services에도 통지(F-1의 크로스체크는 `to-parsed-csv.ts` 수정 필요)
3. **frontend에 반려** — F-4(조건 렌더 + `key` 리마운트로 `PasswordPrompt` 상태 초기화. 리더가 찾은 연속 오답 결함과 `UploadFlow.test.tsx:411` 플레이키도 이 수정으로 함께 해소), F-6(프로토타입 조회 가드)
4. **계획 문서 수정** — `phases/4-pdf-statement/step6.md:48, 115`의 "라우트는 필드 검증을 하지 않는다"를 "core-services가 export한 `parsePdfColumnSchema`를 반드시 호출한다"로 재작성. 후속 phase에서도 신뢰 경계에는 **호출해야 할 검증 함수명을 AC에 명시**한다
5. 재실행 후 재검증 대상: A(게이트 오탐), C(신뢰 경계), E(400 매핑), F-4 플레이키 해소 여부
