# Step 6: POST /api/analyze — PDF 분기 (password + pdfColumnSchema 재수신, LLM 재판정 없음)

## 작업

`POST /api/analyze`가 PDF도 처리하게 확장한다. **핵심은 "LLM 컬럼 의미 판정을 절대 다시 하지 않는다"이다.** **TDD 필수 — `src/app/api/analyze/route.test.ts`에 실패하는 테스트를 먼저 추가하고, 통과하는 구현을 쓴다.**

건드릴 파일:
- `src/app/api/analyze/route.ts` (수정)
- `src/app/api/analyze/route.test.ts` (기존 테스트 유지 + PDF 케이스 추가)
- `isPdfBuffer`는 **`src/services/pdf-parser`에서 import**한다(core-services step 0 산출 — `src/lib/`에 중복 구현 금지). `claimsPdf`는 `src/lib/file-type.ts`, 에러 매핑 `toPdfErrorPayload`는 `src/lib/pdf-error.ts`에서 **step 5가 만든 것을 그대로 import해서 재사용**한다. 판별 로직·에러 매핑을 이 라우트에 복제하지 않는다(두 라우트의 판별 기준이 어긋나면 upload에서 PDF로 처리된 파일이 analyze에서 CSV로 처리되는 최악의 정합성 사고가 난다). step 5가 이 모듈들을 만들지 않았다면 **여기서 만들고 upload 라우트도 그것을 쓰도록 함께 정리**한다.

### 0. 왜 analyze가 파일을 다시 파싱하는가 (기존 확정 계약 인용)

`_workspace/03_api-routes_contract.md` 54행:

> 설계 주의: 서버가 원본 파일을 다시 받아 `parseCsv → maskPii`를 재실행한다. `MaskedRow` 브랜드는 `maskPii`만 부여할 수 있으므로(core-services 타입 불변식), 클라이언트가 보낸 "마스킹된 데이터"를 신뢰하지 않는다. 그래서 요청 필드가 "마스킹 데이터"가 아니라 `file`이다.

PDF도 동일하다 — 파일을 다시 받아 **다시 파싱**한다. 그래서 암호화된 PDF라면 `password`가 다시 필요하다.

### 1. INV-2 — 이 step의 가장 중요한 불변식

scope 문서 INV-2 그대로:

> `/api/analyze`는 `MaskedRow` 브랜드 불변식 때문에 파일을 재파싱한다. **여기서 LLM 판정을 두 번 하면 두 결과가 달라져 사용자가 본 숫자와 저장된 숫자가 어긋날 수 있다.**
> → `/api/upload`가 판정 결과 `PdfColumnSchema`를 응답에 담아 반환하고, 클라이언트가 기존 `mapping`과 똑같은 방식으로 `/api/analyze`에 되돌려보낸다. `/api/analyze`는 이 스키마를 **그대로 적용만 하고 LLM을 재호출하지 않는다.**

따라서 analyze의 PDF 경로는 **"스키마 적용 전용" 함수**(core-services step 4 산출)만 호출한다. LLM 컬럼 의미 판정 함수(core-services step 3 산출)는 **호출 대상이 아니다.**

**왜 이게 이 phase에서 가장 위험한 정합성 이슈인가 (리더 실측으로 근거 강화됨):**
리더가 실제 NH농협 PDF를 `pdfjs-dist@4.10.38`로 검증한 결과(`_workspace/00_input/pdf-extraction-algorithm-verified.md`), 이 명세서는 **좌표 클러스터링만으로 결정적 파싱이 가능**하고 LLM이 하는 일은 "동적으로 발견된 right-edge 컬럼 클러스터가 각각 어떤 의미인지"만 판정하는 것이다. 즉 `PdfColumnSchema`는 **클러스터 → 컬럼 의미 매핑**이라는 순수 구조 메타데이터이며 PII를 담지 않아 클라이언트 왕복이 안전하다.

문제는 실측에서 드러난 컬럼 구조다 — 한 거래행에 right-edge가 다른 금액 컬럼이 여러 개 있다:

| right-edge | 컬럼 의미 | 등장 |
|---|---|---|
| 275.5 | 이용금액(원 거래액) | 32행 |
| **407.0** | **청구금액 ← D2에 따라 이것만 계상** | 34행 |
| 445.5 | 포인트 | 34행 |
| 558.5 | 할부잔여 | 4행 |

analyze가 LLM으로 재판정해서 판정이 한 칸 밀리면, 할부 건이 **23,375(청구액) 대신 140,252(원 이용금액)** 로 계상되는 식으로 **에러 없이 합계만 조용히 틀려진다.** 사용자가 upload 화면에서 확인한 숫자와 DB에 저장된 숫자가 어긋나고, 어디서도 예외가 나지 않아 발견되지 않는다. 그래서 재판정 금지는 "성능 최적화"가 아니라 **정확성 요구**다.

**PDF인데 `pdfColumnSchema`가 없으면 `400 { "code": "BAD_REQUEST" }`다. LLM 재판정으로 대체하지 않는다.** 스키마 없이 진행할 수 있는 우회로를 만들지 마라.

### 2. 먼저 step 0~4의 실제 산출물을 읽어라

`src/services/pdf-parser/`의 **실제 export를 직접 읽고 그대로 사용**한다. 이 계획서가 쓰는 이름은 가정이므로 실제 코드와 다르면 실제 코드를 신뢰한다. `PdfColumnSchema`의 내부 필드 구조는 **core-services가 확정한 타입을 그대로 사용**하고, 라우트가 필드를 발명하거나 필드 단위로 의미 검증을 하지 않는다.

`PdfColumnSchema`는 **클러스터 → 컬럼 의미 매핑**이라는 구조 메타데이터다(PII 아님). 라우트는 이 값을 **불투명한(opaque) 객체로 취급**해 파싱 가능 여부만 확인하고 그대로 pdf-parser에 넘긴다.

core-services step 0이 이미 확정한 것(라우트가 그대로 import):

```typescript
// src/services/pdf-parser (배럴)
export function isPdfBuffer(input: Buffer | Uint8Array): boolean
export type PdfPasswordCase = "missing" | "incorrect"
export class PdfPasswordRequiredError extends Error {
  readonly code = "PDF_PASSWORD_REQUIRED" as const
  readonly passwordCase: PdfPasswordCase
}
export class UnsupportedPdfFormatError extends Error {
  readonly code = "UNSUPPORTED_PDF_FORMAT" as const
  readonly reason: string   // 내부 진단 라벨 — 응답 body에 절대 넣지 않는다
}
```

라우트가 pdf-parser에게 추가로 요구하는 동작 계약(step 4 산출):
- 버퍼 + (선택)비밀번호 + **이미 확정된 `PdfColumnSchema`**를 받아 `ParsedCsv`를 반환하는 **적용 전용** 함수. 내부에서 LLM을 호출하지 않는다.
- 실패 시 step 5와 **동일한** 두 에러 클래스 중 하나를 던진다. 스캔 이미지 PDF(= **문서 전체에서 거래행 후보 0건**. "텍스트 아이템 0개"가 아니다)는 `UnsupportedPdfFormatError`로 온다.
- 라우트는 스캔 여부·거래행 후보 수를 **자체 판정하지 않는다.** 던져진 에러 클래스만 신뢰한다.
- ⚠️ `UnsupportedPdfFormatError.reason`은 우리 409 body의 `reason`과 이름이 겹친다. **422 body는 `{ code: "UNSUPPORTED_PDF_FORMAT" }` 리터럴로 새로 만들고** 에러 객체를 스프레드하거나 `reason: error.reason`으로 옮기지 않는다.

**라우트 테스트에서 pdf-parser 모킹 시 주의:** `vi.mock`으로 모듈을 통째로 대체하면 에러 클래스도 대체돼 `instanceof` 판별이 깨진다. `importOriginal`/`vi.importActual`로 **에러 클래스와 `isPdfBuffer`는 실제 구현을 유지**하고, 파싱/적용 함수와 LLM 판정 함수만 `vi.fn()`으로 교체한다.

```typescript
vi.mock("../../../services/pdf-parser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/pdf-parser")>()),
  // 스키마 적용 함수 / LLM 컬럼 의미 판정 함수만 vi.fn()으로 교체
}))
```

라우트는 `pdfjs-dist`를 직접 import하지 않는다(CLAUDE.md: "외부 API 호출은 `src/services/`를 통해서만 수행한다. 컴포넌트나 라우트 핸들러에서 직접 호출하지 않는다").

### 3. 요청 계약

`multipart/form-data`:
- `file`: CSV **또는** PDF (upload에 올린 것과 동일 파일)
- `mapping`: JSON 문자열 — `ConfirmedMapping = { date, merchant, amount, category }` (`category`는 `null` 허용) — **기존과 동일, 변경 없음**
- `password`: (선택) PDF 비밀번호 — 재파싱용. PDF가 아니면 무시
- `pdfColumnSchema`: (PDF일 때 **필수**) JSON 문자열. upload가 반환한 객체를 클라이언트가 `JSON.stringify`한 값

PDF일 때 `mapping`은 upload가 반환한 고정 매핑(INV-1 헤더 기준)이 그대로 돌아온다:
```json
{ "date": "이용일", "merchant": "가맹점", "amount": "청구금액", "category": "구분" }
```
라우트는 이 값을 특별 취급하지 않고 **기존 `projectMappedColumns` 경로에 그대로 흘린다** — PDF/CSV 공통 하위 파이프라인은 바꾸지 않는다(scope 목표: "하위 파이프라인은 변경하지 않는다").

### 4. 처리 순서 (검증을 모두 끝낸 뒤에 파싱)

```
1. 세션 확인 (없으면 401 { code: "UNAUTHORIZED" }) — formData()를 읽기 전에 먼저
2. formData() 파싱 실패 → 400 { code: "BAD_REQUEST" }
3. file 유효성(File && size > 0) + mapping 유효성(기존 parseMapping) 확인 → 실패 시 400
4. buffer 생성 → step 5와 동일한 분기 규칙 적용:
   a. isPdfBuffer(buffer) === true                       → PDF 경로
   b. isPdfBuffer === false && claimsPdf(file) === true   → 422 { code: "UNSUPPORTED_PDF_FORMAT" }
   c. 그 외                                              → CSV 경로 (기존 동작 그대로)
5. PDF 경로:
   5-1. pdfColumnSchema 폼필드 검증 → 실패 시 400 { code: "BAD_REQUEST", reason: "pdf_schema_missing" }
        (파싱/LLM 호출 없이 즉시)
        - 문자열이 아니거나 빈 문자열 → 400
        - JSON.parse 실패 → 400
        - 결과가 null / 배열 / 객체 아님 → 400
        - (그 이상의 내부 필드 검증은 하지 않는다 — 스키마 소유자는 core-services다)
   5-2. password 폼필드 읽기 (문자열이면 그 값, 없거나 빈 문자열이면 undefined)
   5-3. pdf-parser의 "스키마 적용 전용" 함수 호출 → ParsedCsv
        - 비밀번호 에러 타입   → 409 { code: "PDF_PASSWORD_REQUIRED", reason: "missing" | "incorrect" }
        - 지원불가/레이아웃 실패/거래행 후보 0건 에러 타입 → 422 { code: "UNSUPPORTED_PDF_FORMAT" }
        - 그 외 예외 → 재던지기 (임의로 500 body를 만들지 않는다)
   5-4. parseCsv는 호출하지 않는다
6. 공통(PDF/CSV 동일): maskPii(parsed) → projectMappedColumns(masked.rows, mapping)
   → generateFreeSummary → insertAnalysis → 200
```

**검증 순서 주의:** `pdfColumnSchema` 누락 400은 pdf-parser 호출 **전에** 반환되어야 한다. 파싱을 먼저 시도하고 나중에 스키마를 확인하면, 비밀번호 검증이 먼저 터져 400 대신 409가 나가는 순서 역전이 생긴다.

### 5. 응답 shape — 변경 없음

성공(200)은 PDF/CSV 모두 기존과 **완전히 동일**하다. 여기에 `pdfColumnSchema`를 되돌려주지 않는다.

```json
{
  "analysisId": "b3f1c2a4-...-uuid",
  "freeSummary": {
    "totalSpent": 882646,
    "transactionCount": 42,
    "categoryTotals": { "일시불": 600000, "할부": 23375 },
    "topMerchants": [{ "merchant": "아파트관리비", "amount": 246090 }]
  }
}
```

에러 코드 표(기존 + 신규, 충돌 없음):

| 상황 | HTTP | body |
|---|---|---|
| 세션 없음 | 401 | `{ "code": "UNAUTHORIZED" }` |
| file/mapping 누락·형식오류 (기존) | 400 | `{ "code": "BAD_REQUEST" }` |
| **PDF인데 `pdfColumnSchema` 누락·형식오류 (신규)** | 400 | `{ "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }` |
| 암호화된 PDF인데 비밀번호 **미제공** | 409 | `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }` |
| 암호화된 PDF인데 비밀번호 **불일치** | 409 | `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }` |
| 레이아웃 해석 실패 / 거래행 후보 0건(스캔 이미지 PDF) / PDF 주장하지만 `%PDF-` 헤더 없음 | 422 | `{ "code": "UNSUPPORTED_PDF_FORMAT" }` |

**`reason` 결정 규칙 — step 5와 완전히 동일하게 구현한다(두 라우트의 문구 분기가 어긋나면 안 된다):**
1. core-services 에러 타입이 `PasswordException.code` 상당의 판별 값을 노출하면 `1 → "missing"`, `2 → "incorrect"`.
2. 판별 값이 없거나 알 수 없으면 요청 상태로 추론: `password` 폼필드 미제공 → `"missing"`, 제공 → `"incorrect"`.

`reason`은 **`"missing"`/`"incorrect"` 두 리터럴만** 취하는 allowlist 값이다. 에러 `message`/`stack` 문자열 검사로 만들지 않고, `reason` 자리에 에러 메시지·비밀번호·파일명을 절대 넣지 않는다. 이 규칙은 step 5가 만든 `src/lib/pdf-error.ts`의 `toPdfErrorPayload(error, hadPassword)`에 이미 구현돼 있으므로 **그 함수를 호출만 한다.**

**`PDF_PASSWORD_REQUIRED`는 비밀번호 사유에만 쓴다.** 프론트가 이 코드를 "에러 모달이 아니라 비밀번호 입력 모달을 여는" 정상 흐름 신호로 쓰므로, 다른 사유에 재사용하면 사용자가 입력해도 풀 수 없는 모달에 갇힌다.

### 5-1. 409 응답에는 반드시 JSON body가 있어야 한다 (프론트 블로킹 요구)

프론트(`_workspace/03_frontend_pdf-notes.md` 리스크 4)는 409를 `await response.clone().json()`으로 엿봐 `code`를 읽는다. **빈 body로 409를 주면** `.json()`이 던지고 일반 `ErrorModal`로 폴백되어 사용자가 비밀번호를 다시 넣을 수 없다. analyze의 409는 특히 치명적이다 — 사용자가 이미 매핑 확인까지 진행한 상태이므로 여기서 막히면 처음부터 다시 해야 한다.

- 409는 반드시 `NextResponse.json({ code: "PDF_PASSWORD_REQUIRED", reason }, { status: 409 })`로 만든다.
- `new NextResponse(null, { status: 409 })` 같은 빈 body 형태를 쓰지 않는다.

### 5-2. PDF인데 `pdfColumnSchema` 누락 — 400 유지 + 진단용 `reason` 추가 (결정)

scope가 "PDF인데 `pdfColumnSchema`가 없으면 `400 BAD_REQUEST`"로 확정했으므로 **HTTP 상태와 `code`는 바꾸지 않는다.** 다만 프론트가 지적한 UX 문제(`03_frontend_pdf-notes.md` 리스크 2)를 해결하기 위해 **이 한 케이스에만 진단용 분류 필드를 추가**한다:

```json
400 { "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }
```

- **왜 새 `code`를 만들지 않는가:** 새 코드(`PDF_SCHEMA_REQUIRED` 등)를 도입하면 scope 계약을 어기고, 프론트의 `useApiError` 분기와 이미 완료된 step 7~8 계획까지 함께 바꿔야 한다. `reason`은 **가산적(additive)** 이라 `code`만 보는 기존 프론트 코드는 영향받지 않고, 문구 개선이 필요해질 때 프론트가 선택적으로 참조할 수 있다.
- **왜 필요한가:** 프론트가 `pdfColumnSchema`를 잃었을 때 기존 400 문구("파일을 읽지 못했어요. 형식을 확인해 주세요")는 **파일에 문제가 없는데 파일을 탓해** 사용자가 다른 파일로 재시도하며 반복 실패하게 만든다.
- `reason` 값은 리터럴 `"pdf_schema_missing"` 하나뿐이다. 다른 400(file/mapping 누락·형식오류)에는 `reason`을 **붙이지 않는다** — 기존 400 응답 shape을 바꾸면 INV-5(무회귀)에 걸린다.

**최종 body 키 규약:**

| 케이스 | 키 |
|---|---|
| 기존 400 (file/mapping 누락·형식오류) | `["code"]` — **변경 없음** |
| 신규 400 (PDF인데 `pdfColumnSchema` 누락·형식오류) | `["code", "reason"]` (`reason: "pdf_schema_missing"`) |
| 409 | `["code", "reason"]` (`reason: "missing" \| "incorrect"`) |
| 422 | `["code"]` |

### 6. 비밀번호·원본 미보관 (CRITICAL)

D3/INV-4: **"비밀번호는 로그·DB·응답·에러메시지에 절대 미기록"**, **"CSV와 동일하게 PDF 원본은 Storage/디스크/로그 어디에도 쓰지 않고 메모리에서만 다룬다."**
CLAUDE.md CRITICAL: **"원본 CSV 파일은 어떤 형태로도(Storage, 디스크, 로그 등) 영구 저장하지 않는다. 업로드된 파일은 요청 처리 중 메모리에서만 다루고 응답 후 폐기한다. DB에는 마스킹된 요약 데이터(카테고리별 합계 등 구조화된 값)만 저장한다."**

이 라우트는 **DB 쓰기가 있는 유일한 지점**이므로 특히 주의한다:
- `insertAnalysis`에 넘기는 `maskedTransactions`는 `projectMappedColumns` 결과(= mapping이 지정한 4개 컬럼만)로 유지한다. `password`, `pdfColumnSchema`, 원본 버퍼를 DB에 넣는 코드를 추가하지 않는다.
- 비밀번호는 지역 변수로만 다루고 pdf-parser 인자로만 전달한다.
- 에러 응답 body는 `{ code }` **단일 키**만 갖는다. 예외의 `message`/`stack`을 body에 넣지 않는다.
- `console.log`/`console.error`/`console.warn`/`console.debug`를 추가하지 않는다.
- `fs`/`node:fs`, `os.tmpdir`, Supabase Storage 등 영속 쓰기 API를 import하지 않는다.

`export const runtime = "edge"`를 넣지 않는다(pdfjs는 Node API 필요).

### 참고: 현재 라우트의 핵심 흐름 (변경 대상)

```typescript
const file = formData.get("file")
const mapping = parseMapping(formData.get("mapping"))
if (!(file instanceof File) || file.size === 0 || !mapping) {
  return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 })
}

const buffer = Buffer.from(await file.arrayBuffer())
const parsed = parseCsv(buffer)              // ← 여기가 PDF/CSV 분기 지점이 된다
const masked = maskPii(parsed)
const rows = projectMappedColumns(masked.rows, mapping)
const freeSummary = await generateFreeSummary({ rows, mapping })
const analysis = await insertAnalysis({ userId: user.id, maskedTransactions: rows, freeSummary })
return NextResponse.json({ analysisId: analysis.id, freeSummary })
```

`parseMapping`, `projectMappedColumns`는 **그대로 둔다.** 분기는 `parseCsv` 호출 지점만 대체한다.

## Acceptance Criteria

### INV-2 — LLM 재판정 없음 (이 step의 최우선 AC)
- [ ] `src/services/pdf-parser` 모듈을 `vi.mock`으로 모킹하고, PDF analyze 성공 시나리오에서 **LLM 컬럼 의미 판정 함수(core-services step 3 산출)의 export가 `toHaveBeenCalledTimes(0)`임을 단정하는 테스트**가 통과한다. 이 단정이 없으면 이 step은 미완료다.
- [ ] 같은 테스트에서 **"스키마 적용 전용" 함수만 호출**되고, 그 호출 인자의 스키마가 요청 `pdfColumnSchema` 폼필드 문자열을 `JSON.parse`한 결과와 **deep-equal**임을 단정한다(upload가 판정한 스키마가 변형 없이 그대로 적용됨).
- [ ] `src/services/llm/provider`를 모킹해 PDF analyze 성공 시나리오에서 `generateAnalysisText`가 **한 번도 호출되지 않음**을 단정하는 테스트가 통과한다(`generateFreeSummary`도 모킹되어 있으므로 LLM 직접 호출이 남아 있으면 이 단정이 깨진다 — 라우트가 pdf-parser를 우회해 LLM을 부르는 경로를 잡는 안전망).
- [ ] PDF인데 `pdfColumnSchema` 폼필드가 **없을 때** `400 { "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }`가 반환되고, pdf-parser의 **어떤 함수도(적용 함수·LLM 판정 함수 모두)** 호출되지 않으며 `parseCsv`·`maskPii`·`generateFreeSummary`·`insertAnalysis`도 호출되지 않는 테스트가 통과한다.
- [ ] `pdfColumnSchema`가 (a) 빈 문자열, (b) 잘못된 JSON(`"{"`), (c) 배열 `"[]"`, (d) `"null"`, (e) 문자열이 아닌 값(File)인 5개 케이스 각각 `400 { "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }`가 반환되는 테스트가 통과한다.
- [ ] **기존 400 응답 shape이 변하지 않는다:** file/mapping 누락·형식오류로 인한 400 body는 여전히 `{ "code": "BAD_REQUEST" }`이고 `reason` 키가 **없음**을 검증하는 테스트가 통과한다(기존 8개 `BAD_REQUEST` 케이스의 `resolves.toEqual({ code: "BAD_REQUEST" })` 단정이 그대로 통과해야 한다 — INV-5).
- [ ] 라우트 코드에 "스키마가 없으면 LLM으로 판정한다"는 폴백 분기가 **존재하지 않음**을 코드로 확인한다.

### PDF 성공 경로
- [ ] PDF analyze 성공 시 응답이 정확히 `{ analysisId, freeSummary }`이고 `pdfColumnSchema`를 되돌려주지 않는 테스트가 통과한다.
- [ ] PDF 경로에서 `parseCsv`가 호출되지 않고, `maskPii`가 **스키마 적용 함수가 반환한 `ParsedCsv`**로 호출되는 테스트가 통과한다.
- [ ] PDF 경로에서 `insertAnalysis`가 `projectMappedColumns` 결과(mapping이 지정한 컬럼만 남은 행)로 호출되고, 그 행에 `password`/`pdfColumnSchema` 키가 없음을 단정하는 테스트가 통과한다.
- [ ] `password` 폼필드가 제공되면 그 값이 스키마 적용 함수의 인자로 전달되고, 미제공/빈 문자열이면 `undefined`로 호출되는 테스트가 각각 통과한다. (**analyze도 반드시 `password`를 받아야 한다** — upload에서만 받으면 사용자가 매핑 확인 후 재파싱 단계에서 영구히 막힌다. 프론트는 upload 성공 후에도 비밀번호를 상태에 유지해 analyze로 다시 보낸다.)
- [ ] 프론트가 실제로 보내는 FormData 키 조합 3가지가 모두 동작하는 테스트가 통과한다: CSV `["file","mapping"]`, 평문 PDF `["file","mapping","pdfColumnSchema"]`, 암호화 PDF `["file","mapping","password","pdfColumnSchema"]`.
- [ ] `generateFreeSummary` 호출이 `insertAnalysis` 호출보다 먼저임을 `invocationCallOrder`로 확인하는 기존 단정이 PDF 경로에서도 성립한다.

### 파일 판별 (step 5와 동일 기준)
- [ ] `src/app/api/analyze/route.ts`가 `isPdfBuffer`를 `src/services/pdf-parser`에서, `claimsPdf`를 `src/lib/file-type.ts`에서 import해 쓰고, 매직바이트 판별 로직을 자체 구현하지 않음을 코드로 확인한다.
- [ ] 확장자가 `.csv`인데 내용이 PDF 매직바이트인 파일을 보내면 PDF 경로로 처리되어(`parseCsv` 미호출, 스키마 적용 함수 호출) 200이 반환되는 테스트가 통과한다.
- [ ] 확장자/MIME은 PDF인데 `%PDF-`가 없는 파일은 `parseCsv`가 호출되지 않고 `422 { "code": "UNSUPPORTED_PDF_FORMAT" }`가 반환되는 테스트가 통과한다.

### 에러 매핑 (개별 AC로 분리)
- [ ] `src/app/api/analyze/route.ts`가 에러 매핑을 자체 구현하지 않고 `src/lib/pdf-error.ts`의 `toPdfErrorPayload(error, hadPassword)`를 사용하며, `null`이 반환되면 예외를 **재던지기**함을 코드로 확인한다(임의 500 body 생성 금지). upload(step 5)와 **동일한 에러 계열 → 동일한 HTTP 코드/`reason`** 매핑이 보장된다.
- [ ] 스키마 적용 함수가 `PdfPasswordRequiredError`(`passwordCase: "missing"`)를 던졌을 때 정확히 `409` + `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }`가 반환되고 `insertAnalysis`가 호출되지 않는 테스트가 통과한다.
- [ ] 스키마 적용 함수가 `PdfPasswordRequiredError`(`passwordCase: "incorrect"`)를 던졌을 때 정확히 `409` + `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }`가 반환되고 `insertAnalysis`가 호출되지 않는 테스트가 통과한다.
- [ ] 스키마 적용 함수가 `UnsupportedPdfFormatError`를 던졌을 때 정확히 `422` + `{ "code": "UNSUPPORTED_PDF_FORMAT" }`가 반환되고 `insertAnalysis`가 호출되지 않는 테스트가 통과한다.
- [ ] `UnsupportedPdfFormatError.reason`(내부 진단 라벨, 예 `"pdf_open_failed"`)이 **응답 body에 포함되지 않음**을 `JSON.stringify(body)` 검사로 검증하는 테스트가 통과한다.
- [ ] 스키마 적용 함수가 **거래행 후보 0건(스캔 이미지 PDF) 사유의 `UnsupportedPdfFormatError`**를 던졌을 때도 `422 { "code": "UNSUPPORTED_PDF_FORMAT" }`가 반환되는 테스트가 통과하고, 라우트에 "텍스트 아이템 0개" 같은 자체 스캔 판정 로직이 없음을 코드로 확인한다.
- [ ] 에러 계열을 `instanceof` + `code` 필드로 구분하며 메시지 문자열 매칭(`message.includes(...)`)으로 구분하지 않는다.
- [ ] 라우트 테스트에서 pdf-parser 모킹 시 `importOriginal`/`vi.importActual`로 **에러 클래스와 `isPdfBuffer`의 실제 구현을 유지**하고 파싱/적용·LLM 판정 함수만 `vi.fn()`으로 교체함을 확인한다(클래스를 모킹하면 `instanceof` 판별이 깨진다).
- [ ] `pdfColumnSchema`가 누락된 **동시에** PDF가 암호화된 경우, `409`가 아니라 `400 { "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }`가 반환되는(= 스키마 검증이 파싱보다 먼저) 테스트가 통과한다.
- [ ] 응답 body 키를 `Object.keys(body).sort()`로 검증하는 테스트가 통과한다: 기존 400 → `["code"]`, 스키마 누락 400 → `["code", "reason"]`, 409 → `["code", "reason"]`, 422 → `["code"]`.
- [ ] **409 응답에 JSON body가 실재함**을 상태코드와 **별도로** 검증하는 테스트가 통과한다: `response.headers.get("content-type")`이 `application/json`을 포함하고, **`await response.clone().json()`이 성공**하며 그 결과의 `code`가 `"PDF_PASSWORD_REQUIRED"`다. (프론트가 `clone().json()`으로 409를 엿보므로 body가 비면 비밀번호 재입력 흐름이 막히고, 매핑 확인까지 진행한 사용자가 처음부터 다시 해야 한다.)
- [ ] `PDF_PASSWORD_REQUIRED`가 비밀번호 사유 외의 어떤 실패에도 사용되지 않음을 코드로 확인한다.

### 비밀번호·원본 미보관 (CRITICAL)
- [ ] 비밀번호 `"s3cret-pw-1234"`를 폼필드로 보내고 스키마 적용 함수가 (a) 성공, (b) 비밀번호 에러(**에러 `message`에 비밀번호가 그대로 포함된 악성 케이스**), (c) 지원불가 에러를 던지는 세 시나리오 각각에서, **응답 body 전체를 `JSON.stringify`한 문자열에 `"s3cret-pw-1234"`가 포함되지 않음**을 검증하는 테스트가 통과한다. (b) 케이스의 body는 여전히 `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }`여야 한다.
- [ ] 같은 세 시나리오에서 `console.log`/`console.error`/`console.warn`/`console.debug`를 `vi.spyOn`으로 감시해 **어느 것도 호출되지 않음**(또는 인자 문자열에 비밀번호가 포함되지 않음)을 검증하는 테스트가 통과한다.
- [ ] 성공 시나리오에서 `insertAnalysis` 호출 인자 전체를 `JSON.stringify`한 문자열에 `"s3cret-pw-1234"`가 포함되지 않음을 단정하는 테스트가 통과한다(비밀번호 DB 미기록).
- [ ] `src/app/api/analyze/route.ts`에 `console.`, `fs`, `node:fs`, `tmpdir`, `writeFile`, `storage` 문자열이 등장하지 않음을 grep으로 확인한다. 원본 버퍼/비밀번호를 모듈 스코프 변수나 캐시에 대입하는 코드가 없다.
- [ ] `src/app/api/analyze/route.ts`가 `pdfjs-dist`를 직접 import하지 않고 `src/services/pdf-parser`만 경유함을 grep으로 확인한다.
- [ ] 라우트가 `lib/supabase/service.ts`를 직접 import하지 않고 `services/supabase-admin`만 경유하는 기존 경계가 유지된다.

### CSV 무회귀 (INV-5)
- [ ] 기존 `src/app/api/analyze/route.test.ts`의 모든 케이스(성공 / 401 / 8개 `BAD_REQUEST` 케이스)를 **단정을 약화시키지 않고** 유지한 채 통과한다. 특히 성공 테스트의 `resolves.toEqual({ analysisId, freeSummary })` 전체 객체 동등 비교와 `projectedRows` 단정들을 그대로 유지한다.
- [ ] CSV 파일과 함께 `password`·`pdfColumnSchema` 폼필드를 보내도 CSV 경로가 그대로 동작하고(두 필드 무시, `parseCsv` 호출, 응답 shape 불변) pdf-parser가 호출되지 않는 테스트가 통과한다.
- [ ] 401 케이스에서 `request.formData()`가 호출되지 않고 pdf-parser·`parseCsv`·`maskPii`·`generateFreeSummary`·`insertAnalysis` 모두 호출되지 않음을 검증하는 기존 단정이 유지된다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 모두 통과한다.
- [ ] `export const runtime = "edge"`가 이 라우트에 없다.
