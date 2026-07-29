# Step 0: pdfjs-dist 도입 + 합성 암호화 PDF 픽스처 + 좌표 텍스트 추출

## 작업

PDF 카드 명세서 파싱의 최하위 계층을 만든다. **TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**
이 step은 PDF 바이트를 **좌표·폭 포함 텍스트 아이템**으로 바꾸는 것까지만 한다. 행 그룹핑·거래행 판정·컬럼 발견·LLM 호출은 이후 step의 범위이며 여기서 하지 않는다.

> 리더가 실측 검증한 두 문서가 정답이다. **알고리즘·라이브러리를 새로 발명하지 마라.**
> - `_workspace/00_input/pdf-extraction-algorithm-verified.md` — 추출 절차 (실제 PDF에서 거래 34건 / 합계 882,646원, 오차 0)
> - `_workspace/00_input/pdf-fixture-generation-verified.md` — `pdfkit`으로 한글 포함 암호화 PDF 생성 + pdfjs 왕복 검증

### 픽스처 전략 결정 (scope 문서의 "2층 픽스처"를 단일 PDF로 단순화 — 근거 기록)

scope 문서는 ①익명화 좌표 JSON ②암호화 PDF 1개의 2층 구조를 제시했으나, 리더의 `pdfkit` 검증으로 **실제 암호화 PDF 하나가 두 목적을 모두 충족**함이 확인됐다. 다음 근거로 **좌표 JSON 덤프를 만들지 않고 커밋된 PDF 픽스처만 사용한다**:

1. 파서가 의존하는 핵심 특성은 금액 컬럼의 **right-edge(x + width) 오른쪽 정렬**이다. JSON 덤프는 사람이 손으로 만든 2차 산물이라 실제 pdfjs 출력과 어긋날 수 있고, 어긋나면 테스트가 통과해도 실제 PDF에서 실패한다.
2. `pdfkit`은 좌표를 직접 지정할 수 있어 오른쪽 정렬을 그대로 재현하므로, 실제 pdfjs → right-edge 경로 전체가 테스트로 덮인다.
3. 비밀번호 `PasswordException` code 1/2가 합성 픽스처에서도 재현되므로 409 분기도 같은 PDF 하나로 덮인다.
4. 픽스처 포맷이 하나면 이후 step(1~4)의 테스트가 모두 같은 입력을 공유해 골든값이 일관된다.

### 0-1. 의존성 도입 (실측 확인된 형태)

- `npm install pdfjs-dist@4.10.38` — **dependency**, 정확히 이 버전으로 핀.
- `npm install -D pdfkit` — **devDependency만.** 픽스처 생성 전용 도구다.
- native 빌드가 필요한 패키지(`canvas`, `@napi-rs/canvas`, `muhammara`, `hummus`)는 추가하지 않는다.
- 리더가 Node에서 worker·canvas 없이 동작을 확인한 형태를 그대로 쓴다:
  ```ts
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const doc = await pdfjs.getDocument({
    data,                    // Uint8Array
    password,                // 있을 때만
    isEvalSupported: false,  // Vercel Node 런타임 대비
    useSystemFonts: false,   // 시스템 폰트 접근 회피
  }).promise
  ```
- `GlobalWorkerOptions.workerSrc`를 파일 경로로 지정하지 않는다. `standardFontDataUrl`/`cMapUrl`도 설정하지 않는다(텍스트만 추출).
- 설치 후 `node_modules/pdfjs-dist/legacy/build/pdf.mjs`가 실제로 존재하는지 `ls`로 확인한 뒤 import 경로를 확정한다.
- 프로젝트에 `next.config.ts`가 **아직 없다.** 새로 만들고 `serverExternalPackages: ["pdfjs-dist"]`를 설정한다.

### 0-2. 공유 타입 — `src/types/pdf.ts` (신규)

```typescript
/**
 * pdfjs가 추출한 텍스트 아이템. 원본 값이므로 그대로 LLM에 보내면 안 된다.
 * width가 필수인 이유: 금액 컬럼은 오른쪽 정렬이라 컬럼 식별에 right-edge(x + width)를 쓴다.
 */
export type PdfTextItem = { text: string; x: number; y: number; width: number }
export type PdfPageText = { pageNumber: number; items: PdfTextItem[] }
export type PdfExtractedDocument = { pages: PdfPageText[] }
```

> **금지 패턴:** 아이템 문자열을 join해서 정규식으로 컬럼을 쪼개는 접근. pdfjs에서 join하면 `"06/13테스트마트 강변점4,50053(할인)4,4470"`처럼 공백이 사라져 분리가 불가능하다. 컬럼 분리는 항상 `x + width` 좌표로 한다(join한 문자열은 소계/합계 **키워드 검사에만** 쓴다).

### 0-3. 에러 타입 — `src/services/pdf-parser/errors.ts` (신규)

```typescript
/** 비밀번호 미제공(PasswordException code 1) / 불일치(code 2)를 구분해 보존한다. 둘 다 HTTP 409. */
export type PdfPasswordCase = "missing" | "incorrect"

export class PdfPasswordRequiredError extends Error {
  readonly code = "PDF_PASSWORD_REQUIRED" as const
  readonly passwordCase: PdfPasswordCase
}

export class UnsupportedPdfFormatError extends Error {
  readonly code = "UNSUPPORTED_PDF_FORMAT" as const
  /** 진단용 짧은 라벨. 원본 텍스트·비밀번호·파일명을 담지 않는다. */
  readonly reason: string
}
```
- 두 클래스 모두 `name`을 클래스명으로 설정하고 `instanceof`와 `code` 둘 다로 판별 가능하게 한다.
- **에러 메시지·`reason`에 비밀번호, 원본 행 텍스트, 파일명을 절대 넣지 않는다.** 고정 문자열 + 짧은 라벨만 쓴다.
- `passwordCase`는 프론트가 "비밀번호를 입력해주세요"(missing) / "비밀번호가 맞지 않아요"(incorrect)를 구분하기 위한 것이다. **비밀번호 값 자체는 어디에도 담지 않는다.**

### 0-4. 저수준 추출 — `src/services/pdf-parser/extract-text.ts` (신규)

```typescript
export async function extractPdfTextItems(input: {
  data: Buffer | Uint8Array
  password?: string
}): Promise<PdfExtractedDocument>

/** %PDF- 매직 바이트로 PDF 여부 판별 (api-routes가 CSV/PDF 분기에 사용) */
export function isPdfBuffer(input: Buffer | Uint8Array): boolean
```
동작 규칙:
- 모든 페이지에 `getTextContent()`를 호출하고, `item.str`이 있고 `trim()`이 비지 않은 아이템만 남긴다.
- 매핑: `{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }`.
- **좌표를 반올림·변환하지 않는다.** y를 반올림하면 step1에서 조용한 데이터 누락이 발생한다(실측: 34건 중 24건만 잡히고 합계가 882,646 대신 702,397).
- 처리 후 `finally`에서 `doc.destroy()`를 호출한다.
- **비밀번호 예외 변환**: `err.name === "PasswordException"`을 `PdfPasswordRequiredError`로 변환한다. `err.code === 1` → `passwordCase: "missing"`, `err.code === 2` → `passwordCase: "incorrect"`. code가 그 외/없으면 `password` 인자가 비었는지로 판정한다.
- 그 밖의 pdfjs 예외(`InvalidPDFException`, 손상 파일)는 `UnsupportedPdfFormatError`(reason `"pdf_open_failed"`)로 변환한다. 원본 예외 메시지를 그대로 노출하지 않는다.
- **텍스트 양·아이템 개수로 이미지 PDF를 판정하지 않는다.** 실측에서 마지막 페이지는 푸터만 있어 아이템이 6개다. 스캔 PDF 거부는 "거래행 후보 0건" 기준이며 **step 4의 책임**이다.
- 파일을 디스크에 쓰지 않고, 파일 내용·비밀번호를 `console.*`로 출력하지 않는다.

### 0-5. 픽스처 (CRITICAL)

사용자가 제공한 실제 NH농협 PDF는 **커밋하지 않는다.** 다음 문자열이 저장소 어디에도 들어가면 안 된다:
실명 `[REDACTED_REAL_NAME]`, 주소 `[REDACTED_REAL_ADDRESS]`, 계좌 `[REDACTED_REAL_ACCOUNT]`, **그리고 실제 비밀번호 `[REDACTED_REAL_PASSWORD]`**(참조 문서에 예시로 적혀 있었으나 사용자의 실제 생년월일이므로 제거했다).

가명·테스트값만 사용한다: `홍길동`, `123********99`, `04524 서울특별시 중구 세종대로 110`, `010-1234-5678`, 비밀번호 **`000000`**, ownerPassword `owner-secret-test`.

#### 생성 스크립트 — `scripts/make-pdf-fixtures.mjs` (devDependency 도구, 커밋)

`_workspace/00_input/pdf-fixture-generation-verified.md`의 검증된 스크립트 패턴을 그대로 확장한다. 3개 픽스처를 생성한다:

| 파일 | 암호화 | 용도 |
|---|---|---|
| `src/services/pdf-parser/__fixtures__/nh-statement-sample.pdf` | userPassword `000000` | 메인. 파싱 로직 + 비밀번호 3케이스 |
| `src/services/pdf-parser/__fixtures__/year-boundary-sample.pdf` | 없음 | 연말 경계 연도 추론 |
| `src/services/pdf-parser/__fixtures__/no-transactions-sample.pdf` | 없음 | 거래행 후보 0건 (스캔 PDF 대체) |

공통 규칙 (검증된 스크립트에서 그대로 가져온다):
- `new PDFDocument({ size: "A4", margin: 0, pdfVersion: "1.6", userPassword, ownerPassword })`
- 한글 폰트: `doc.registerFont("ko", process.env.FIXTURE_FONT ?? "/System/Library/Fonts/Supplemental/AppleGothic.ttf")`, `doc.font("ko").fontSize(7.8)`. 폰트 파일이 없으면 **명확한 에러 메시지로 즉시 종료**한다(무음 실패 금지).
- pdfkit은 y가 top-down, pdfjs는 bottom-up → `top = PAGE_H - y`, `PAGE_H = 841.89`
- **오른쪽 정렬 헬퍼(핵심 특성)**: `doc.text(s, edge - doc.widthOfString(s), top, { lineBreak: false })`
- 행 간격 `12.76`
- 컬럼 right-edge 상수: `이용금액 275.5`, `할인 309.6`, `할부회차`는 좌측 `x = 331.7`, `이번달청구금액 407.0`, `포인트 445.5`, `할부잔여 558.5`. 해외 섹션: `통화 460.0`, `이용금액 480.0`, `환율 500.0`, `원화청구금액 520.0`
- **y 미세 분리 (CRITICAL 회귀 재현)**: 표에서 `ySplit = Y`인 행은 **숫자 아이템만 `top + 0.07`** 에 그린다(날짜·가맹점은 `top`). 실측에서 관측된 `350.33/350.26`, `312.07/312.00` 분리를 재현한 것이다. fuzzy 0.5 클러스터링으로는 한 행, 정확 일치로는 두 조각이 된다.
- **right-edge 미세 흔들림 (1.5 허용오차 검증)**: `이번달청구금액` 컬럼에서 3번 행은 `407.4`, 15번 행은 `406.6`, 32번 행은 `407.3`을 쓴다. 나머지는 `407.0`.

#### (A) `nh-statement-sample.pdf` 데이터 — 이 표를 그대로 transcribe한다 (값 변경 금지)

**page 1** (PII 밀집. 이후 step에서 거래 후보로 잡히지 않아야 하고 LLM에 절대 전달되지 않아야 한다). 라벨 x=40, 값 x=100, y=780부터 12.76 감소:
`카드이용대금 명세서` / `성명`+`홍길동` / `주소`+`04524 서울특별시 중구 세종대로 110` / `연락처`+`010-1234-5678` / `결제계좌`+`123********99` / `결제일`+`2026.07.28` / `청구금액`+`882,646`

**page 2** 라인 순서 (y=771.28부터 12.76씩 감소):
1. (x=202.8) `이용기간 : [일시불/할부] 2026.06.11 ~ 2026.07.10`
2. 표 헤더 — `이용일`(x=36.3) `가맹점`(x=60) `이용금액`(re 275.5) `할인금액`(re 309.6) `할부회차`(x=331.7) `이번달청구금액`(re 407.0) `포인트`(re 445.5) `할부잔여`(re 558.5)
3~36. **거래 34행** — 아래 표 순서대로
37. (x=60)`소계(M614)(홍길동)바른카드` , `866,646`(re 407.0) , `90`(re 445.5) , `277,200`(re 558.5) , ySplit=**Y**
38. (x=60)`소계(L069)(홍길동)뉴후불하이패스` , `16,000`(re 407.0) , `0`(re 445.5) , ySplit=**Y**
39. (x=60)`합계` , `882,646`(re 407.0) , `90`(re 445.5) , `277,200`(re 558.5) , ySplit=**Y**
40. (x=60)`[해외이용]`
41. 해외 표 헤더 — `이용일`(x=36.3) `가맹점`(x=60) `통화`(re 460.0) `이용금액`(re 480.0) `환율`(re 500.0) `원화청구금액`(re 520.0)
42. **해외 상세 1행** — `07/03`(x=36.3) `M614 WWW.ALIEXPRES 룩셈부르크`(x=60) `USD`(re 460.0) `23.39`(re 480.0) `1,554.60`(re 500.0) `36,719`(re 520.0)
    → `이번달청구금액`(re 407.0) 컬럼에 값이 **없다.** "청구금액 컬럼 값을 정확히 1개 갖지 않는 행은 제외" 규칙과 **중복계상 방지**가 이 행으로 검증된다.

**거래 34행** (`-` = 그 컬럼에 아이템 없음):

| # | 이용일 | 가맹점 | 이용금액 | 할인 | 할부회차 | 이번달청구금액 | 포인트 | 할부잔여 | ySplit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 06/12 | 스타벅스 서면점 | 5,600 | - | - | 5,600 | 0 | - | Y |
| 2 | 06/12 | GS25 부산역점 | 3,200 | - | - | 3,200 | 0 | - | Y |
| 3 | 06/13 | 테스트마트 강변점 | 4,500 | 53(할인) | - | 4,447 | 0 | - | N |
| 4 | 06/14 | 배달의민족 | 18,500 | - | - | 18,500 | 0 | - | Y |
| 5 | 06/15 | 쿠팡 | 32,400 | - | - | 32,400 | 0 | - | Y |
| 6 | 06/15 | CU 초량점 | 2,900 | - | - | 2,900 | 0 | - | Y |
| 7 | 06/16 | 넷플릭스 | 17,000 | - | - | 17,000 | 0 | - | Y |
| 8 | 06/17 | 올리브영 | 24,300 | - | - | 24,300 | 0 | - | Y |
| 9 | 06/18 | 다이소 | 7,800 | - | - | 7,800 | 0 | - | Y |
| 10 | 06/18 | 카카오T | 11,200 | - | - | 11,200 | 0 | - | Y |
| 11 | 06/19 | 메가커피 | 4,500 | - | - | 4,500 | 0 | - | Y |
| 12 | 06/20 | 롯데마트 | 45,900 | - | - | 45,900 | 0 | - | Y |
| 13 | 06/22 | 유니클로 | 39,900 | - | - | 39,900 | 0 | - | Y |
| 14 | 06/23 | 기본연회비-바른카드 | 6,000 | - | - | 6,000 | 0 | - | N |
| 15 | 06/24 | 아파트관리비 | 246,090 | - | - | 246,090 | 0 | - | N |
| 16 | 06/26 | 도미노피자 | 27,900 | - | - | 27,900 | 0 | - | N |
| 17 | 06/27 | 교보문고 | 16,200 | - | - | 16,200 | 0 | - | N |
| 18 | 06/29 | CGV 서면 | 14,000 | - | - | 14,000 | 0 | - | N |
| 19 | 07/02 | 약국 | 6,700 | - | - | 6,700 | 0 | - | N |
| 20 | 06/21 | 세븐일레븐 | 3,500 | - | - | 3,500 | 0 | - | N |
| 21 | 06/25 | 파리바게뜨 | 8,900 | - | - | 8,900 | 0 | - | N |
| 22 | 06/28 | 지하철교통카드 | 20,000 | - | - | 20,000 | 0 | - | N |
| 23 | 06/30 | 세탁소 | 3,000 | - | - | 3,000 | 0 | - | N |
| 24 | 07/01 | 문구점 | 4,000 | - | - | 4,000 | 0 | - | N |
| 25 | 07/02 | 카페베네 | 3,915 | - | - | 3,915 | 0 | - | N |
| 26 | 06/01 | 포인트결제 | **-** | - | - | -300 | 0 | - | N |
| 27 | 06/05 | 카드론상환 | **-** | - | - | -1,000 | 0 | - | N |
| 28 | 03/20 | 테스트페이_강의 | 140,252 | 922(면제) | 6/4 | **23,375** | 0 | 46,750 | N |
| 29 | 04/15 | 테스트전자스토어 | 1,200,000 | - | 12/3 | 100,000 | 0 | 900,000 | N |
| 30 | 05/02 | 테스트항공 | 600,000 | - | 6/2 | 100,000 | 0 | 400,000 | N |
| 31 | 02/28 | 테스트폰코리아 | 360,000 | - | 12/5 | 30,000 | 0 | 210,000 | N |
| 32 | 07/03 | WWW.ALIEXPRESS.COM | 36,719 | - | - | 36,719 | 0 | - | N |
| 33 | 06/18 | 하이패스통행료 | 8,000 | - | - | 8,000 | 0 | - | N |
| 34 | 06/28 | 하이패스통행료 | 8,000 | - | - | 8,000 | 0 | - | N |

이 표가 만족하는 **골든 관계** (이후 step의 AC 근거 — 값을 바꾸면 안 된다):
- 계상 대상 거래 = **34건**, 청구금액 합계 = **882,646** = 39번 `합계` 행의 값 = page1 `청구금액`
- 28번 할부 행은 이용금액 **140,252을 계상하지 않고 청구액 23,375만** 계상한다 (D2)
- 이용금액 컬럼 등장 **32행** / 청구금액 **34행** / 포인트 **34행** / 할부잔여 **4행** (리더 실측 히스토그램과 동일한 구조)
- 42번 해외 상세 행은 청구금액 컬럼 값이 없어 자동 탈락 → `07/03 WWW.ALIEXPRESS.COM 36,719`이 **이중계상되지 않는다**
- `ySplit = Y`인 거래행은 12개(1,2,4,5,6,7,8,9,10,11,12,13)이고 그 청구금액 합은 **213,200** → y 허용오차 0으로 그룹핑하면 22건 / 669,446으로 **조용히 틀린다**

**page 3** (푸터만 — 아이템 6개. "아이템 0개로 이미지 PDF를 판정하면 안 된다"의 근거):
`NH테스트카드`(x=40) `고객센터 02-1234-5678`(x=100) `발행일 2026.07.15`(x=240) / `www.example-card.test`(x=40) `본 명세서는 안내용입니다`(x=240) / `3/3`(x=40)

#### (B) `year-boundary-sample.pdf` (암호화 없음)

page 1만. y=771.28부터 12.76 감소:
1. (x=202.8) `이용기간 : [일시불/할부] 2025.12.11 ~ 2026.01.10`
2. 표 헤더 (A와 동일한 8개)
3. `12/15` `연말선물가게` 이용금액 `10,000` 청구 `10,000` 포인트 `0`
4. `01/05` `신년마트` 이용금액 `20,000` 청구 `20,000` 포인트 `0`
5. `11/20` `가전할부` 이용금액 `600,000` 할부회차 `12/2` 청구 `50,000` 포인트 `0` 할부잔여 `550,000`
6. (x=60)`합계` , `80,000`(re 407.0)

골든 관계: **3건 / 합계 80,000**. 연도 추론 기대값 `2025-12-15`, `2026-01-05`, `2025-11-20`.

#### (C) `no-transactions-sample.pdf` (암호화 없음)

page 1에 `본 페이지는 안내문입니다` 한 줄과 `www.example-card.test` 한 줄만. `MM/DD`로 시작하는 아이템이 하나도 없다 → 거래행 후보 0건.

#### 픽스처 로더 — `src/services/pdf-parser/__fixtures__/load-fixture.ts`

```typescript
export const NH_FIXTURE_PASSWORD = "000000"
export function readPdfFixture(name: string): Buffer   // __fixtures__ 기준 상대 경로
```
테스트 전용이며 프로덕션 코드에서 import하지 않는다.

#### `__fixtures__/README.md`

실제 명세서 PDF·실제 비밀번호 커밋 금지, 가명 목록, 생성 명령(`node scripts/make-pdf-fixtures.mjs`), 폰트 의존성은 생성 시점에만 있다는 점을 적는다.

### 0-6. 배럴 — `src/services/pdf-parser/index.ts`

`extractPdfTextItems`, `isPdfBuffer`, `PdfPasswordRequiredError`, `UnsupportedPdfFormatError`, `PdfPasswordCase`를 re-export한다.

## Acceptance Criteria

- [ ] `pdfjs-dist`가 dependencies에 `4.10.38`로 핀되고, `pdfkit`이 **devDependencies에만** 있다. `canvas`/`@napi-rs/canvas`/`muhammara`/`hummus`는 추가되지 않았다.
- [ ] (테스트 경로에 생성 의존성 없음 CRITICAL) `src/` 전체에서 `pdfkit` import가 **0건**이고 시스템 폰트 경로(`/System/Library/Fonts`)를 참조하는 코드가 **0건**임을 grep으로 확인한다. `pdfkit`·폰트는 `scripts/make-pdf-fixtures.mjs`에서만 쓰인다. 픽스처 PDF 3개는 저장소에 커밋되어 있고 테스트는 읽기만 한다.
- [ ] `extract-text.ts`가 `pdfjs-dist/legacy/build/pdf.mjs`를 동적 import하고 `getDocument` 옵션에 `isEvalSupported: false`, `useSystemFonts: false`가 들어간다. `GlobalWorkerOptions.workerSrc`를 파일 경로로 지정하는 코드가 없다.
- [ ] `next.config.ts`가 생성되고 `serverExternalPackages`에 `"pdfjs-dist"`가 포함된다. `npm run build`가 성공한다.
- [ ] (비밀번호 3케이스 + code 구분) `nh-statement-sample.pdf`로 다음 테스트가 통과한다: (1) password 미제공 → `PdfPasswordRequiredError` & `passwordCase === "missing"`, (2) `wrong-pw` → `PdfPasswordRequiredError` & `passwordCase === "incorrect"`, (3) `000000` → 예외 없이 resolve되고 `pages.length === 3`.
- [ ] (비밀번호 미기록 CRITICAL) (2)에서 잡은 에러의 `message`에 `wrong-pw`와 `000000`이 **포함되지 않는다**고 단정하는 테스트가 통과한다. `src/services/pdf-parser/`(테스트·`__fixtures__` 제외) 전체에 `console.` 호출이 없고 `password`를 로그·에러 메시지·리턴값에 넣는 코드가 없음을 grep으로 확인한다.
- [ ] (실제 PII·실제 비밀번호 미커밋 CRITICAL) 알려진 실제 실명·주소·계좌·비밀번호 문자열에 대한 `git grep` 결과가 **각각 0건**이다. 픽스처 비밀번호는 `000000`이다.
- [ ] (손상 파일) `%PDF-`로 시작하지만 내용이 깨진 바이트열에서 `UnsupportedPdfFormatError`(`reason === "pdf_open_failed"`)가 throw되고 pdfjs 원본 예외 메시지가 노출되지 않는 테스트가 통과한다.
- [ ] (이미지 PDF를 여기서 거부하지 않음) `extract-text.ts`에 "텍스트 길이/아이템 개수가 적으면 throw"하는 코드가 **없다.** `no-transactions-sample.pdf`가 예외 없이 resolve되는 테스트가 통과한다.
- [ ] `PdfTextItem`에 `width`가 있고 pdfjs `item.width`를 그대로 채운다. 좌표에 `Math.round`가 쓰이지 않음을 grep으로 확인한다.
- [ ] `isPdfBuffer`가 `%PDF-1.4...` 버퍼에 `true`, CSV 텍스트 버퍼에 `false`를 반환한다.
- [ ] (원본 미보관 CRITICAL) `src/services/pdf-parser/`의 프로덕션 코드(테스트·`__fixtures__` 제외)에 `fs`/`node:fs`/`writeFile`/`createWriteStream` 사용이 없음을 grep으로 확인한다. 추출 후 `doc.destroy()`가 `finally`에서 호출된다.
- [ ] (픽스처 골든값 검증 — 이후 step의 기준) `nh-statement-sample.pdf`를 `000000`으로 추출한 결과에 대해 다음 테스트가 통과한다:
      page 3개 / page3 아이템 **정확히 6개** / right-edge가 `407.0 ± 1.5`인 숫자 아이템 중 `MM/DD`로 시작하는 행에 속한 것의 값 합이 **882,646**이고 개수가 **34**개 / `합계` 라벨과 같은 행의 청구 아이템 값도 **882,646**.
- [ ] (right-edge 오른쪽 정렬이 실제로 재현됨) 위 34개 청구금액 아이템의 `x + width`가 모두 `407.0 ± 1.5` 안에 들어오고, 이용금액 컬럼(`275.5 ± 1.5`)은 **32개**, 포인트(`445.5 ± 1.5`)는 **34개**, 할부잔여(`558.5 ± 1.5`)는 **4개**인 테스트가 통과한다.
- [ ] (y 미세 분리가 실제로 재현됨 — step1 회귀 테스트의 전제) `ySplit = Y`로 지정한 12개 거래행에서, 같은 시각적 행의 아이템 y 최대값과 최소값 차이가 **0보다 크고 0.5보다 작다**는 테스트가 통과한다.
- [ ] `node scripts/make-pdf-fixtures.mjs`가 3개 PDF를 생성하고, 생성 실패 시(폰트 없음 등) 명확한 에러로 종료한다. `year-boundary-sample.pdf`는 비밀번호 없이 열리고 3개 거래행을, `no-transactions-sample.pdf`는 `MM/DD`로 시작하는 아이템 0개를 갖는다.
- [ ] `__fixtures__/README.md`에 실제 PDF·실제 비밀번호 커밋 금지, 가명 목록, 생성 명령, "폰트 의존성은 생성 시점에만 있다"가 적혀 있다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 **기존 CSV 파이프라인 테스트가 하나도 깨지지 않는다**(INV-5).
