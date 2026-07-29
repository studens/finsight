# Step 5: POST /api/upload — PDF 분기 (판별·password·409/422·pdfColumnSchema 반환·CSV 무회귀)

## 작업

`POST /api/upload`이 CSV 외에 **PDF 카드 명세서**도 받게 확장한다. **TDD 필수 — `src/app/api/upload/route.test.ts`에 실패하는 테스트를 먼저 추가하고, 통과하는 구현을 쓴다.**

건드릴 파일:
- `src/lib/file-type.ts` (신규) + `src/lib/file-type.test.ts` (신규) — `claimsPdf(file)` 보조 판별 헬퍼. **매직바이트 판별 `isPdfBuffer`는 새로 만들지 않는다** — core-services step 0이 `src/services/pdf-parser`에서 이미 export한다(아래 0항). step 6이 이 모듈을 **그대로 재사용**하므로 라우트 안에 인라인하지 않는다.
- `src/lib/pdf-error.ts` (신규) + `src/lib/pdf-error.test.ts` (신규) — pdf-parser 에러 → HTTP 응답 매핑 헬퍼. **step 6이 그대로 재사용**한다(두 라우트의 에러 매핑·`reason` 분기가 어긋나면 upload에서 409를 본 사용자가 analyze에서 다른 문구를 보게 된다).
- `src/app/api/upload/route.ts` (수정)
- `src/app/api/upload/route.test.ts` (기존 테스트 유지 + PDF 케이스 추가)

### 0. core-services가 이미 확정한 것 (step 0 계획 기준) — 중복 구현 금지

`src/services/pdf-parser`가 아래를 export한다(core-services step 0 배럴). **라우트는 이것들을 그대로 import해서 쓴다.**

```typescript
// src/services/pdf-parser (배럴)
/** %PDF- 매직 바이트로 PDF 여부 판별 — api-routes가 CSV/PDF 분기에 사용 */
export function isPdfBuffer(input: Buffer | Uint8Array): boolean

export type PdfPasswordCase = "missing" | "incorrect"

export class PdfPasswordRequiredError extends Error {
  readonly code = "PDF_PASSWORD_REQUIRED" as const
  readonly passwordCase: PdfPasswordCase   // pdfjs PasswordException code 1 → "missing", 2 → "incorrect"
}

export class UnsupportedPdfFormatError extends Error {
  readonly code = "UNSUPPORTED_PDF_FORMAT" as const
  readonly reason: string   // 내부 진단용 짧은 라벨(예: "pdf_open_failed") — 응답 body에 절대 넣지 않는다
}
```

- **`isPdfBuffer`를 `src/lib/`에 다시 구현하지 마라.** 위 함수를 import한다. `src/lib/file-type.ts`에는 `claimsPdf`만 둔다.
- 두 에러 클래스는 `name`이 클래스명이고 `code` 필드도 있어 **`instanceof`와 `code` 둘 다로 판별 가능**하다. 이 둘로 판별하고 **`message` 문자열 매칭은 쓰지 않는다.**
- `passwordCase`가 곧 응답 `reason`이다(값 집합이 `"missing" | "incorrect"`로 동일).
- ⚠️ **`UnsupportedPdfFormatError.reason`은 응답 body에 절대 넣지 않는다.** 필드 이름이 우리 409 body의 `reason`과 겹쳐 `{ code: e.code, reason: e.reason }`처럼 무심코 흘리기 쉽다. 422 body는 **`{ code: "UNSUPPORTED_PDF_FORMAT" }`뿐**이다.

이 step은 core-services step 0~4가 완료된 뒤에 실행된다. **실행 시점의 실제 코드를 먼저 읽고, 위 표기와 다르면 실제 코드를 신뢰한다.** `PdfColumnSchema`의 내부 필드 구조는 **core-services가 확정한 타입을 그대로 사용**하고, 라우트에서 필드를 새로 발명하거나 필드 단위로 검증하지 않는다(`_workspace/02_core-services_pdf-interface.md`가 있으면 그것이 최종 기준이다).

라우트가 pdf-parser에게 추가로 요구하는 **동작 계약**(step 3~4 산출, 이름은 실제 코드 기준으로 바인딩):
1. 버퍼 + (선택)비밀번호를 받아 `{ ParsedCsv, PdfColumnSchema }` 상당의 결과를 돌려주는 진입 함수. 내부에서 LLM 컬럼 의미 판정을 1회 수행한다(INV-2의 "한 번").
2. 실패 시 위 두 에러 클래스 중 하나를 던진다. **스캔 이미지 PDF는 `UnsupportedPdfFormatError`로 온다.**

**주의:** 스캔 이미지 PDF 판정 기준은 "텍스트 아이템 0개"가 **아니다.** 리더 실측에서 정상 PDF의 마지막 페이지도 푸터 때문에 텍스트 아이템이 6개 있었다. 기준은 **문서 전체에서 거래행 후보(첫 아이템이 `/^\d{2}\/\d{2}/`인 행)가 0건**인 경우다. 이 판정은 **core-services step 4의 책임**이며, 라우트는 자체 판정을 하지 않고 던져진 에러 타입만 신뢰한다.

### 0-1. 라우트 테스트에서 pdf-parser를 모킹하는 방법 (중요)

`vi.mock("../../../services/pdf-parser")`로 모듈을 통째로 대체하면 **에러 클래스도 대체돼 `instanceof` 판별이 깨진다.** 반드시 `importOriginal`/`vi.importActual`로 **에러 클래스와 `isPdfBuffer`는 실제 구현을 유지**하고, 파싱 함수만 `vi.fn()`으로 바꾼다.

```typescript
vi.mock("../../../services/pdf-parser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/pdf-parser")>()),
  // 파싱 진입 함수(및 LLM 판정 함수)만 vi.fn()으로 교체
}))
```

라우트는 `pdfjs-dist`를 **직접 import 하지 않는다.** 외부 라이브러리 접근은 `src/services/pdf-parser` 경유만이다(CLAUDE.md: "외부 API 호출은 `src/services/`를 통해서만 수행한다. 컴포넌트나 라우트 핸들러에서 직접 호출하지 않는다").

### 1. `src/lib/file-type.ts` — 확장자 신호만 담는 보조 헬퍼

```typescript
/** 파일명이 .pdf로 끝나거나 MIME이 application/pdf — 보조 신호일 뿐 단독 판단 근거가 아니다 */
export function claimsPdf(file: File): boolean;
```

- 대소문자 무시(`statement.PDF`도 `true`).
- **매직바이트 판별은 `src/services/pdf-parser`의 `isPdfBuffer`를 쓴다**(0항). 여기에 다시 만들지 않는다.
- 확장자만 믿으면 `.csv`로 저장된 실제 PDF가 CSV 경로로 흘러 파싱 에러가 나고, `.pdf`로 저장된 PDF 아닌 파일이 PDF 경로로 흘러 무의미한 에러를 낸다. 그래서 **매직바이트(주 신호) + 확장자/MIME(보조 신호)를 조합**한다.

### 2. 라우트 분기 규칙 (step 6과 동일하게 적용 — 두 라우트가 어긋나면 안 된다)

파일 버퍼를 읽은 직후, 아래 순서로 **결정적으로** 분기한다:

| # | 조건 | 처리 |
|---|---|---|
| 1 | `isPdfBuffer(buffer) === true` | **PDF 경로** (확장자/MIME이 무엇이든 PDF로 처리) |
| 2 | `isPdfBuffer === false` && `claimsPdf(file) === true` | `422 { "code": "UNSUPPORTED_PDF_FORMAT" }` — PDF라고 주장하지만 PDF 헤더가 없음(손상/비PDF). 절대 `parseCsv`에 넘기지 않는다 |
| 3 | 그 외 | **CSV 경로** — 기존 동작 그대로, 변경 없음 |

### 3. PDF 경로 처리 순서

```
1. 세션 확인 (없으면 401 { code: "UNAUTHORIZED" }) — formData()를 읽기 전에 먼저
2. formData() 파싱 → file 유효성(File 인스턴스 && size > 0) 확인 (실패 시 400 { code: "BAD_REQUEST" })
3. buffer 생성 → 위 분기 규칙 적용
4. PDF: password 폼필드를 읽는다. 문자열이면 그 값, 없거나 문자열이 아니면 undefined
   (빈 문자열 ""은 "미제공"과 동일하게 undefined로 취급)
5. pdf-parser 진입 함수 호출 → { ParsedCsv, PdfColumnSchema }
   - 비밀번호 에러 타입 → 409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" | "incorrect" }
   - 지원 불가/레이아웃 실패/거래행 후보 0건(스캔 이미지) 에러 타입 → 422 { "code": "UNSUPPORTED_PDF_FORMAT" }
   - 그 외 예외 → 재던지기(기존 CSV 경로와 동일한 처리 유지, 임의로 500 body를 만들지 않는다)
6. maskPii(parsed) → 앞 5행 샘플 (기존 MAX_SAMPLE_ROWS = 5 재사용)
7. mapping은 LLM 없이 결정적으로 구성 (아래 4항)
8. 응답 반환
```

### 4. PDF의 mapping은 LLM으로 추론하지 않는다

INV-1이 PDF 파서의 `headers`를 다음으로 **고정**했다:

```
["이용일", "가맹점", "청구금액", "구분"]
```

따라서 PDF 경로에서 `inferColumnMapping`(LLM 호출)을 부르는 것은 낭비이자 비결정성의 원인이다. 아래 고정 매핑을 그대로 반환한다:

```json
{ "date": "이용일", "merchant": "가맹점", "amount": "청구금액", "category": "구분", "confidence": 1 }
```

`src/services/pdf-parser`가 이 헤더/매핑 상수를 export하면 **그것을 import해서 쓴다**(INV-1의 단일 출처). export하지 않으면 라우트 모듈 최상단에 상수로 정의한다.

### 5. 응답 shape

PDF 성공(200) — 기존 응답에 `pdfColumnSchema`가 **추가**된다:

```json
{
  "mapping": { "date": "이용일", "merchant": "가맹점", "amount": "청구금액", "category": "구분", "confidence": 1 },
  "sample": {
    "headers": ["이용일", "가맹점", "청구금액", "구분"],
    "rows": [{ "이용일": "2026-06-13", "가맹점": "이마트24 부산초량점", "청구금액": "4447", "구분": "일시불" }],
    "excludedColumns": [],
    "maskedColumns": []
  },
  "pdfColumnSchema": { "…": "core-services가 확정한 PdfColumnSchema를 그대로 직렬화" }
}
```

- `excludedColumns`/`maskedColumns`가 빈 배열인 것은 **정상**이다 — INV-1: "이 헤더에는 이름·주소·계좌·카드번호 컬럼이 존재하지 않는다. 따라서 `maskPii`는 제외/마스킹할 컬럼을 찾지 못하는 것이 정상이다."
- `pdfColumnSchema`는 **객체 그대로** 반환한다(문자열로 감싸지 않는다). 클라이언트가 `/api/analyze`에 보낼 때 `JSON.stringify`한다.
- CSV 성공(200)은 **기존과 완전히 동일** — `pdfColumnSchema` 키가 **없어야 한다**.

신규 에러 (기존 401/400/403/404/502/501과 충돌 없음 — 409·422는 이 프로젝트에서 처음 쓰는 상태코드다):

| 상황 | HTTP | body |
|---|---|---|
| 암호화된 PDF인데 비밀번호 **미제공** | 409 | `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }` |
| 암호화된 PDF인데 비밀번호 **불일치** | 409 | `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }` |
| 레이아웃 해석 실패 / 거래행 후보 0건(스캔 이미지 PDF) / PDF 주장하지만 `%PDF-` 헤더 없음 | 422 | `{ "code": "UNSUPPORTED_PDF_FORMAT" }` |

### 6. `src/lib/pdf-error.ts` — 에러 매핑 + 409의 `reason`

프론트가 "비밀번호를 입력해 주세요"(missing)와 "비밀번호가 맞지 않아요"(incorrect)를 구분해 보여줄 수 있어야 한다는 요구가 있다. 이를 **비밀번호 값이 아니라 분류 리터럴 하나**로만 전달한다.

두 라우트가 동일한 매핑을 쓰도록 매핑을 순수 함수로 분리한다:

```typescript
// src/lib/pdf-error.ts
export type PdfErrorPayload =
  | { status: 409; body: { code: "PDF_PASSWORD_REQUIRED"; reason: "missing" | "incorrect" } }
  | { status: 422; body: { code: "UNSUPPORTED_PDF_FORMAT" } }

// 인식 가능한 pdf-parser 에러면 payload를, 아니면 null(→ 라우트는 재던지기)
export function toPdfErrorPayload(error: unknown, hadPassword: boolean): PdfErrorPayload | null
```

에러 계열 판별은 `instanceof PdfPasswordRequiredError` / `instanceof UnsupportedPdfFormatError`로 하고, 보조로 `code` 필드를 확인한다.

`reason` 결정 규칙 (이 순서대로):
1. `PdfPasswordRequiredError.passwordCase`가 `"missing"`/`"incorrect"`면 **그 값을 그대로** 쓴다(값 집합이 응답 `reason`과 동일하다).
2. `passwordCase`가 없거나 두 리터럴 외의 값이면 **라우트가 받은 요청 상태로 추론**한다: `hadPassword === false` → `"missing"`, `true` → `"incorrect"`.

422 body는 `{ code: "UNSUPPORTED_PDF_FORMAT" }` **리터럴로 새로 만든다.** `UnsupportedPdfFormatError`를 스프레드(`...error`)하거나 `reason: error.reason`으로 옮기지 않는다 — 이 클래스에도 `reason` 필드(`"pdf_open_failed"` 같은 내부 진단 라벨)가 있어 이름이 겹친다. **내부 진단 라벨은 응답에 나가지 않는다.**

**절대 금지:** 에러 객체의 `message`/`stack`을 문자열 검사해 에러 계열이나 `reason`을 판정하는 것, `reason` 자리에 에러 메시지·비밀번호·파일명을 넣는 것. `reason`은 **`"missing"` 또는 `"incorrect"` 두 리터럴만** 취할 수 있는 allowlist 값이다. `toPdfErrorPayload`는 `error`를 body에 **어떤 형태로도 담지 않는다** — 반환 body는 위 타입의 리터럴 필드만으로 구성된다.

**`PDF_PASSWORD_REQUIRED`는 비밀번호 사유에만 쓴다.** 다른 실패(레이아웃/포맷/기타)에 이 코드를 재사용하지 않는다. 프론트가 이 코드를 보고 **에러 모달이 아니라 비밀번호 입력 모달**을 여는 정상 흐름 신호로 쓰기 때문에, 다른 사유에 재사용하면 사용자가 입력할 수 없는 비밀번호 모달에 갇힌다.

### 6-1. 409 응답에는 반드시 JSON body가 있어야 한다 (프론트 블로킹 요구)

프론트(`_workspace/03_frontend_pdf-notes.md` 리스크 4)는 409를 감지할 때 `await response.clone().json()`으로 body의 `code`를 읽는다. 서버가 **빈 body로 409**를 주면 `.json()`이 던지고 일반 `ErrorModal`로 폴백되어 **사용자가 비밀번호를 입력할 방법 자체가 사라진다.**

- 409는 반드시 `NextResponse.json({ code: "PDF_PASSWORD_REQUIRED", reason }, { status: 409 })`로 만든다.
- `new NextResponse(null, { status: 409 })`, `new Response(undefined, ...)`, `NextResponse.json(undefined, ...)` 같은 빈 body 형태를 쓰지 않는다.
- 응답 `Content-Type`이 `application/json`이어야 한다(`NextResponse.json`이 자동 설정).

### 7. 비밀번호·원본 미보관 (CRITICAL)

D3/INV-4: **"비밀번호는 로그·DB·응답·에러메시지에 절대 미기록"**, **"CSV와 동일하게 PDF 원본은 Storage/디스크/로그 어디에도 쓰지 않고 메모리에서만 다룬다."**
CLAUDE.md CRITICAL: **"원본 CSV 파일은 어떤 형태로도(Storage, 디스크, 로그 등) 영구 저장하지 않는다. 업로드된 파일은 요청 처리 중 메모리에서만 다루고 응답 후 폐기한다."**

구현 규칙:
- 비밀번호는 지역 변수로만 다루고 pdf-parser 인자로만 전달한다. 어떤 객체에도 저장하지 않는다.
- 에러 응답 body의 키는 **`code`(모든 에러) + `reason`(409에만)** 으로 제한한다. 예외의 `message`/`stack`을 body에 넣지 않는다(비밀번호가 서드파티 에러 메시지에 섞여 들어올 가능성 차단 — pdfjs `PasswordException.message`는 실측에서 `'No password given'`이었지만 다른 구현/버전이 입력값을 메시지에 포함할 수 있다).
- 라우트에 `console.log`/`console.error`/`console.warn`/`console.debug`를 **추가하지 않는다.**
- `fs`/`node:fs`, `os.tmpdir`, Supabase Storage 등 어떤 영속 쓰기 API도 import하지 않는다. 이 라우트는 DB 쓰기도 없다(upload은 조회/추론만).

### 8. 런타임

`pdfjs-dist`는 Node API가 필요하므로 이 라우트는 Node 런타임에서 돌아야 한다. `export const runtime = "edge"`를 넣지 않는다. step 0~4가 Node 런타임 명시를 요구한다면 `export const runtime = "nodejs"`를 추가한다.

### 참고: 현재 라우트 코드 (변경 대상)

```typescript
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = parseCsv(buffer)
  const masked = maskPii(parsed)
  const sampleRows = masked.rows.slice(0, MAX_SAMPLE_ROWS)
  const mapping = await inferColumnMapping({ headers: masked.headers, sampleRows })

  return NextResponse.json({ mapping, sample: { headers: masked.headers, rows: sampleRows,
    excludedColumns: masked.excludedColumns, maskedColumns: masked.maskedColumns } })
}
```

## Acceptance Criteria

### 파일 판별
- [ ] `src/lib/file-type.test.ts`가 통과한다: `claimsPdf`가 `statement.pdf` / `statement.PDF`(대문자) / `type: "application/pdf"`에 `true`, `transactions.csv` + `text/csv`에 `false`를 반환한다.
- [ ] **`isPdfBuffer`를 `src/lib/`에 중복 구현하지 않고** `src/services/pdf-parser`에서 import해 쓰는지 grep으로 확인한다(`src/lib/file-type.ts`에 `%PDF-` 문자열이 없다).
- [ ] **확장자가 `.csv`/`text/csv`인데 내용이 PDF 매직바이트인 파일**을 업로드하면 PDF 경로로 처리되어(`parseCsv`가 호출되지 않고 pdf-parser가 호출됨) 200 + `pdfColumnSchema`가 반환되는 테스트가 통과한다.
- [ ] **확장자/MIME은 PDF인데 내용에 `%PDF-`가 없는 파일**은 `parseCsv`가 **호출되지 않고** `422 { "code": "UNSUPPORTED_PDF_FORMAT" }`이 반환되는 테스트가 통과한다.
- [ ] 라우트 안에 확장자/MIME만으로 PDF를 판정하는 코드 경로가 없다 — PDF 경로 진입 조건은 항상 `isPdfBuffer`가 참일 때뿐임을 코드로 확인한다.

### PDF 성공 경로
- [ ] PDF 업로드 성공 시 응답이 `{ mapping, sample, pdfColumnSchema }` 세 키를 갖고, `pdfColumnSchema`가 pdf-parser가 반환한 스키마 객체와 deep-equal임을 확인하는 테스트가 통과한다(pdf-parser는 모킹).
- [ ] PDF 경로에서 `mapping`이 정확히 `{ date: "이용일", merchant: "가맹점", amount: "청구금액", category: "구분", confidence: 1 }`이고, **`inferColumnMapping`(LLM)이 호출되지 않음**을 모킹으로 검증하는 테스트가 통과한다.
- [ ] PDF 경로에서 `parseCsv`가 호출되지 않고, `maskPii`가 pdf-parser가 반환한 `ParsedCsv`로 호출되며, `sample.rows`가 마스킹 결과의 앞 5행임을 확인하는 테스트가 통과한다.
- [ ] `password` 폼필드가 제공되면 그 값이 pdf-parser 호출 인자로 전달되고, 미제공/빈 문자열이면 비밀번호 없이(`undefined`) 호출되는 테스트가 각각 통과한다. (**upload와 analyze 양쪽 모두** `password`를 받아야 한다 — 한쪽만 받으면 사용자가 매핑 확인까지 진행한 뒤 analyze에서 막힌다. analyze 쪽은 step 6이 담당한다.)

### 에러 매핑 (개별 AC로 분리 — 하나의 테스트에 뭉치지 말 것)
- [ ] `src/lib/pdf-error.test.ts`가 통과한다: `toPdfErrorPayload`가 (a) `PdfPasswordRequiredError` + `passwordCase: "missing"` → `{ status: 409, body: { code: "PDF_PASSWORD_REQUIRED", reason: "missing" } }`, (b) `passwordCase: "incorrect"` → `reason: "incorrect"`, (c) `UnsupportedPdfFormatError`(`reason: "pdf_open_failed"`) → `{ status: 422, body: { code: "UNSUPPORTED_PDF_FORMAT" } }`이고 **body에 `"pdf_open_failed"`가 없음**, (d) 무관한 `new Error("boom")` → `null`을 반환한다.
- [ ] 라우트 테스트에서 pdf-parser를 모킹할 때 `importOriginal`/`vi.importActual`로 **에러 클래스와 `isPdfBuffer`의 실제 구현을 유지**하고 파싱 함수만 `vi.fn()`으로 교체함을 확인한다(클래스를 모킹하면 `instanceof` 판별이 깨져 테스트가 거짓 통과/거짓 실패한다).
- [ ] `src/app/api/upload/route.ts`가 에러 매핑을 자체 구현하지 않고 `src/lib/pdf-error.ts`의 `toPdfErrorPayload`를 사용하며, `null`이 반환되면 예외를 **재던지기**함을 코드로 확인한다(임의 500 body 생성 금지).
- [ ] pdf-parser가 `PdfPasswordRequiredError`(`passwordCase: "missing"`)를 던졌을 때 정확히 `409` + body `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }`가 반환되는 테스트가 통과한다.
- [ ] pdf-parser가 `PdfPasswordRequiredError`(`passwordCase: "incorrect"`)를 던졌을 때 정확히 `409` + body `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }`가 반환되는 테스트가 통과한다.
- [ ] `passwordCase`가 **없거나 알 수 없는 값**일 때, `password` 폼필드 미제공이면 `reason: "missing"`, 제공이면 `reason: "incorrect"`로 폴백하는 테스트가 두 케이스 모두 통과한다.
- [ ] `reason` 값이 `"missing"`/`"incorrect"` 두 리터럴 외의 값을 취할 수 있는 코드 경로가 없다 — 에러 `message`/`stack`이나 pdf-parser가 준 임의 문자열이 `reason`에 흘러들지 않음을 코드로 확인한다.
- [ ] pdf-parser가 `UnsupportedPdfFormatError`를 던졌을 때 정확히 `422` + body `{ "code": "UNSUPPORTED_PDF_FORMAT" }`가 반환되는 테스트가 통과한다.
- [ ] `UnsupportedPdfFormatError`의 `reason`(내부 진단 라벨, 예 `"pdf_open_failed"`)이 **응답 body에 포함되지 않음**을 검증하는 테스트가 통과한다(`JSON.stringify(body)`에 `"pdf_open_failed"` 미포함). 이 클래스의 `reason` 필드명이 우리 409 body의 `reason`과 겹치므로 실수로 흘리기 쉽다.
- [ ] pdf-parser가 **거래행 후보 0건(스캔 이미지 PDF) 사유의 `UnsupportedPdfFormatError`**를 던졌을 때도 `422 { "code": "UNSUPPORTED_PDF_FORMAT" }`가 반환되는 테스트가 통과한다(D4). 라우트가 "텍스트 아이템 0개" 같은 자체 스캔 판정 로직을 갖지 않음을 코드로 확인한다.
- [ ] 에러 계열을 **`instanceof` + `code` 필드로 구분**하며, 에러 메시지 문자열 매칭(`message.includes(...)`)으로 구분하지 않는다.
- [ ] 409 응답 body의 키가 정확히 `["code", "reason"]`, 422 응답 body의 키가 정확히 `["code"]`임을 `Object.keys(body).sort()`로 검증하는 테스트가 통과한다(예외 message/stack 미노출).
- [ ] **409 응답에 JSON body가 실재함**을 상태코드와 **별도로** 검증하는 테스트가 통과한다: `response.headers.get("content-type")`이 `application/json`을 포함하고, **`await response.clone().json()`이 성공**하며 그 결과의 `code`가 `"PDF_PASSWORD_REQUIRED"`다. (프론트가 `clone().json()`으로 409를 엿보므로 상태코드만 맞고 body가 비면 비밀번호 입력 흐름 전체가 막힌다 — 상태코드만 확인하는 테스트로는 부족하다.)
- [ ] `PDF_PASSWORD_REQUIRED`가 **비밀번호 사유 외의 어떤 실패에도 사용되지 않음**을 코드로 확인한다(이 문자열은 라우트/`pdf-error.ts`에서 비밀번호 분기에서만 등장한다).

### 비밀번호·원본 미보관 (CRITICAL)
- [ ] 비밀번호 `"s3cret-pw-1234"`를 폼필드로 보내고 pdf-parser가 (a) 성공, (b) 비밀번호 에러(**에러 `message`에 비밀번호 문자열이 그대로 포함된 악성 케이스**), (c) 지원불가 에러를 던지는 세 시나리오 각각에서, **응답 body 전체를 `JSON.stringify`한 문자열에 `"s3cret-pw-1234"`가 포함되지 않음**을 검증하는 테스트가 통과한다. (b) 케이스의 body는 여전히 `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }`여야 한다.
- [ ] 같은 세 시나리오에서 `console.log`/`console.error`/`console.warn`/`console.debug`를 `vi.spyOn`으로 감시해, **어느 것도 호출되지 않음**(또는 호출 인자를 이어붙인 문자열에 비밀번호가 포함되지 않음)을 검증하는 테스트가 통과한다.
- [ ] `src/app/api/upload/route.ts`에 `console.`, `fs`, `node:fs`, `tmpdir`, `writeFile`, `storage` 문자열이 등장하지 않음을 grep으로 확인한다. 원본 PDF/CSV 버퍼를 모듈 스코프 변수나 캐시에 대입하는 코드가 없다.
- [ ] `src/app/api/upload/route.ts`가 `pdfjs-dist`를 직접 import하지 않고 `src/services/pdf-parser`만 경유함을 grep으로 확인한다.

### CSV 무회귀 (INV-5)
- [ ] 기존 `src/app/api/upload/route.test.ts`의 세 케이스(성공 미리보기 / 401 UNAUTHORIZED / 400 BAD_REQUEST for missing·empty file)를 **단정을 약화시키지 않고** 유지한 채 통과한다. 특히 CSV 성공 테스트의 `resolves.toEqual({ mapping, sample })` 전체 객체 동등 비교를 유지해, **CSV 응답에 `pdfColumnSchema` 키가 없음**이 이 단정으로 보장된다.
- [ ] CSV 파일과 함께 `password` 폼필드를 보내도 CSV 응답 shape이 변하지 않고(`pdfColumnSchema` 없음), pdf-parser가 호출되지 않는 테스트가 통과한다.
- [ ] 401 케이스에서 `request.formData()`가 호출되지 않고 pdf-parser·`parseCsv`·`maskPii`·`inferColumnMapping` 모두 호출되지 않음을 검증하는 기존 단정이 유지된다(세션 확인이 항상 최우선).
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 모두 통과한다.
- [ ] `export const runtime = "edge"`가 이 라우트에 없다.
