# Step 7: 드롭존 PDF 허용 + 비밀번호 입력 모달 (409 대응, 원본 File 메모리 유지)

## 작업

`src/components/UploadFlow.tsx`(기존 Client Component)의 **1단계 드롭존(idle)** 을 CSV 전용에서 **CSV + PDF**로 확장하고, 암호화된 PDF에 대한 **비밀번호 입력 모달**을 새로 만든다.

신규/수정 파일:
- 신규 `src/components/PasswordPrompt.tsx` — 비밀번호 입력 모달(Client Component)
- 신규 `src/components/PasswordPrompt.test.tsx` — 모달 단독 계약 테스트
- 수정 `src/components/UploadFlow.tsx` — 드롭존 accept/검증 + 409 분기 + `password` 상태
- 수정 `src/components/UploadFlow.test.tsx` — PDF 비밀번호 흐름 테스트 추가

이 step에서는 **`/api/upload`까지만** 다룬다. `password`/`pdfColumnSchema`를 `/api/analyze`까지 전달하는 일과 PDF 에러 문구·'이번 달 청구액' 안내는 **step 8**이 담당한다. step 7은 `password`를 컴포넌트 상태에 보관하는 것까지만 하고, 그 상태를 step 8이 그대로 이어 쓴다.

### 이 step의 핵심 UX 제약 — 파일을 다시 고르게 만들지 마라

`/api/upload`가 `409 { "code": "PDF_PASSWORD_REQUIRED" }`를 돌려준 뒤에도, **사용자가 이미 선택한 원본 `File` 객체는 컴포넌트 상태(브라우저 메모리)에 그대로 남아 있어야 한다.** 사용자는 비밀번호만 입력하고, 컴포넌트는 **똑같은 `File` 객체**로 `/api/upload`를 다시 호출한다. 드롭존으로 되돌아가 파일을 다시 고르게 만드는 구현은 이 step의 실패다.

기존 UploadFlow는 이미 "원본 `File`을 `useState`에 유지해 `/api/analyze`에 재전송"하는 패턴을 쓴다(step 6). 그 패턴을 그대로 확장한다.

### 드롭존 변경 (idle)

`accept` 속성과 **실제 검증** 양쪽을 모두 다룬다.

- 파일 input: `accept=".csv,text/csv,.pdf,application/pdf"`
- 파일 input `aria-label`: `"CSV 파일 선택"` → **`"CSV 또는 PDF 파일 선택"`** 으로 변경
- 카드 제목: `"거래내역 CSV 업로드"` → **`"거래내역 CSV·카드 명세서 PDF 업로드"`**
- 본문 안내: CSV뿐 아니라 카드사에서 받은 **명세서 PDF**도 올릴 수 있다는 문장 + "원본 파일은 저장하지 않아요"(기존 문장 유지)
- 드래그&드롭과 파일 선택 **양쪽 경로 모두**에서, 파일 확장자(소문자 비교)와 MIME이 CSV/PDF 어디에도 해당하지 않으면 **`fetch`를 호출하지 않고** 드롭존 안에 안내 문구를 노출한다: `"CSV 또는 PDF 파일만 올릴 수 있어요."` (에러 모달을 열지 않는다)

### 409 `PDF_PASSWORD_REQUIRED` 분기 — 이것은 에러가 아니라 정상 흐름의 한 단계다

`useApiError`/`ErrorModal`을 **거치지 않는다.** 비밀번호 요청은 실패가 아니라 대화의 한 턴이다.

`upload()`를 `upload(selectedFile: File, password?: string)` 형태로 확장하고, 다음 순서로 처리한다:

1. `FormData`에 `file`을 담고, `password`가 **비어 있지 않을 때만** `password` 필드를 추가한다(첫 시도에서는 `password` 키가 없어야 한다 — CSV 요청과 동일한 `["file"]`).
2. 응답이 `!response.ok && response.status === 409`이면, **`await response.clone().json()`** 으로 body를 먼저 엿본다(`.catch(() => null)`로 방어). `code === "PDF_PASSWORD_REQUIRED"`이면 실패 종류(아래 "두 종류" 절)를 판정해 비밀번호 모달을 열고 **함수를 반환한다** — `handleResponse`를 호출하지 않는다.
   - `response.clone()`을 쓰는 이유: `useApiError.handleResponse`가 body를 소비하므로, 클론 없이 읽으면 다른 에러 코드의 모달 표시 경로가 깨진다.
3. 그 밖의 실패는 기존과 동일하게 `if (await handleResponse(response)) return;`로 `ErrorModal`에 위임한다(422 `UNSUPPORTED_PDF_FORMAT` 포함 — 문구는 step 8에서 추가하므로 이 step에서는 기본 메시지로 표시되면 된다).
4. 성공이면 기존과 동일하게 `mapping`/`sample`을 상태에 저장하고 `confirming`으로 전환한다.

`useApiError.ts`(`src/hooks/useApiError.ts`)는 이 step에서 **수정하지 않는다.** 409 분기는 UploadFlow 쪽에서 끝낸다. PDF 에러 문구(`UNSUPPORTED_PDF_FORMAT` 추가, `BAD_REQUEST` 중립화)는 **step 8이 담당**하므로, 이 step에서 422가 기본 문구("문제가 발생했어요…")로 표시되는 것은 정상이며 억지로 고치지 마라.

### 상태 추가

- `password: string` — 사용자가 입력한 비밀번호. 성공 이후에도 **초기화하지 않고 유지한다**(step 8에서 `/api/analyze`에 다시 필요하다).
- `passwordPrompt: null | { reason: "missing" | "incorrect" }` (또는 동등한 표현) — 모달 노출 여부 + 실패 종류
- `file`(기존) — 409 후에도 절대 `null`로 만들지 않는다.
- `reset()`("다시 올리기")은 `password`와 모달 상태까지 함께 초기화한다.

### 비밀번호 실패는 **두 종류**이고 문구를 반드시 구분한다 (리더 실측 확인)

리더가 실제 NH농협 PDF로 검증한 결과(`_workspace/00_input/pdf-extraction-algorithm-verified.md` "비밀번호 예외 구분"), pdfjs는 두 경우를 서로 다른 예외 코드로 구분한다:

| pdfjs | 상황 | HTTP | UI 문구 |
|---|---|---|---|
| `PasswordException code=1` (`No password given`) | 비밀번호 **미제공** | 409 `PDF_PASSWORD_REQUIRED` | `"이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요."` |
| `PasswordException code=2` | 비밀번호 **불일치** | 409 `PDF_PASSWORD_REQUIRED` | `"비밀번호가 맞지 않아요. 다시 입력해 주세요."` |

**두 경우의 HTTP status와 `code`는 동일하다.** 프론트가 구분하지 않으면 사용자는 "지금 처음 요청받은 건지, 내가 틀린 건지" 알 수 없고 흐름이 막힌다.

**구분 방법은 확정됐다 — 서버가 보내주는 409 body의 `reason`을 그대로 쓴다** (`_workspace/03_api-routes_pdf-contract.md` 0절·3절):

```json
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }     // 비밀번호 미제공
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }   // 비밀번호 불일치
```

- 서버는 `reason`을 **항상 둘 중 하나로 채워** 보낸다(파서가 분류값을 주지 못한 예외 상황에도 라우트가 `hadPassword`로 폴백 판정해 반드시 채운다 — 계약 0절 확정). 따라서 **클라이언트가 "이 요청에 password를 담았는가"로 추론하는 폴백 분기를 만들지 마라.** 폴백을 남기면 서버 판정과 어긋날 때 오분류만 생긴다.
- `reason`은 서버가 만든 **닫힌 리터럴 집합**이며 에러 메시지·비밀번호·파일명이 절대 들어가지 않는다(계약 "에러 body 키 규약"). 클라이언트가 읽어도 안전하다.
- `reason`이 `"missing"`/`"incorrect"` 외의 값이거나 누락된(계약 위반) 응답이 오면, 안전한 기본값으로 `"missing"` 문구를 보여주고 모달은 정상적으로 연다(사용자를 막지 않는다).

`incorrect`일 때:
- 모달을 **닫지 않는다.** 입력 필드만 **비우고**(빈 문자열로 초기화) 재입력을 받는다.
- **사용자가 입력했던 비밀번호를 화면에 다시 평문으로 노출하지 않는다** — 실패 문구에 입력값을 넣지 않고, 필드에 이전 값을 남겨두지도 않는다.
- 원본 `File`은 **그대로 유지**하고 드롭존으로 되돌리지 않는다.

### `PasswordPrompt` 컴포넌트

props: `{ isOpen: boolean; reason: "missing" | "incorrect"; isWorking: boolean; onSubmit: (password: string) => void; onCancel: () => void }`

- `reason`에 따라 설명 문구를 위 표대로 다르게 렌더한다. `reason`이 바뀌어 `incorrect`가 되면 입력값을 비운다.

- `ErrorModal`과 같은 모달 구조: 오버레이 `fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in`, 패널 `w-full max-w-md rounded-[24px] bg-[#16181c] p-8`, `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
- `ErrorModal`과 구분되도록 패널에 **`data-component="PasswordPrompt"`** 를 붙인다(`ErrorModal`은 `data-component="ErrorModal"`).
- 제목 `text-xl font-semibold text-white`, 설명 `text-sm leading-relaxed text-[#a8acb3]`.
- 입력 필드(ui-design 입력 필드 토큰 그대로): `rounded-xl bg-[#16181c] border border-[#2a2d33] px-4 py-3 text-white`
  - **`type="password"`, `autoComplete="off"`**, `aria-label="명세서 비밀번호"`
- `<form onSubmit={...}>`으로 감싸 Enter 제출을 지원한다. 핸들러에서 `event.preventDefault()`를 호출하고, form에 **`action`/`method` 속성을 주지 않는다**(비밀번호가 쿼리스트링으로 새 나가는 경로를 원천 차단).
- 버튼: Primary(제출) `"비밀번호 확인"` — `Button`(`h-14 px-8 rounded-full bg-[#0052ff]`), Secondary(취소/다시 올리기) `"다시 올리기"`.
- 실패 안내는 `text-sm text-[#cf202f]`(Risk 컬러)로 표시한다.

### 보안 (INV-4 — 비밀번호 미보관)

- 비밀번호는 **React 상태에만** 둔다. `localStorage`/`sessionStorage`/IndexedDB/`document.cookie`/URL·쿼리파라미터에 **절대 쓰지 않는다.**
- 비밀번호 값을 화면 텍스트, 에러 모달 문구, `console.*`, `data-*` 속성, fetch URL에 **넣지 않는다.** 전송 경로는 `FormData`의 `password` 필드 하나뿐이다.
- 원본 PDF `File`도 CSV와 동일하게 브라우저 메모리에서만 다루고 어떤 스토리지에도 저장하지 않는다.

### 스타일 규칙 (ui-design — 이 step에서 반드시 지킬 값)

- 카드/패널 `rounded-[24px] bg-[#16181c] p-8`, 리스트 아이템/중첩 표면 `rounded-2xl bg-[#0a0b0d]`, 입력 `rounded-xl`, 배지·버튼 `rounded-full` — **역할별로 반경을 다르게** 쓴다(전부 같은 반경 금지).
- 인증 후 화면이므로 **다크 고정**. 라이트 토큰(`bg-white`, `border-[#dee1e6]`) 사용 금지.
- **금지: `backdrop-filter`/`backdrop-blur`(glass morphism), gradient-text(배경 그라데이션 텍스트), 보라/인디고 브랜드 색, box-shadow 글로우 애니메이션, 배경 gradient orb(`blur-3xl` 원형), "Powered by AI" 배지.**
- 허용 애니메이션은 `fade-in`(0.4s)·`slide-up`(0.5s)뿐. 무한 반복/바운스/글로우 금지.
- 색상은 정보 전달용으로만: 실패=`#cf202f`, 정보/안내=`#5b8bff`, Primary CTA=`#0052ff`(hover `#003ecc`), 보조 텍스트=`#a8acb3`, 비활성=`#6e7480`.

### 기존 CSV 경로 무회귀 (INV-5)

- CSV 흐름의 요청 shape은 바뀌지 않는다: `/api/upload` FormData 키는 CSV/암호 없는 PDF 첫 시도 모두 정확히 `["file"]`, `/api/analyze`는 정확히 `["file", "mapping"]`(step 8에서 PDF일 때만 확장).
- `npm run test` 전체가 통과해야 한다.
- **기존 테스트 수정은 딱 하나만 허용한다**: `src/components/UploadFlow.test.tsx`의 `getByLabelText("CSV 파일 선택")` 4곳을 `getByLabelText("CSV 또는 PDF 파일 선택")`으로 바꾸는 것. **단정문(assertion)의 내용·개수는 바꾸지 않는다.** 다른 기존 테스트 파일은 손대지 않는다.

### 참고 — 확정 API 계약 (`_workspace/03_api-routes_pdf-contract.md`)

`POST /api/upload` 요청 `multipart/form-data`: `file`(CSV 또는 PDF), `password`(선택, PDF 비밀번호. PDF가 아니면 서버가 무시)

```
400 { "code": "BAD_REQUEST" }                                    // file 없음/빈 파일
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }      // 암호화 PDF, 비밀번호 미제공
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }    // 암호화 PDF, 비밀번호 불일치
422 { "code": "UNSUPPORTED_PDF_FORMAT" }                          // 레이아웃 해석 실패/스캔 PDF/%PDF- 헤더 없음
```

- 409는 **반드시 JSON body를 갖는다**(계약 "409 JSON body 보장" 절 — api-routes step 5·6에 상태코드와 별개의 전용 AC로 강제됨). 따라서 `clone().json()` 엿보기가 안전하다.
- `PDF_PASSWORD_REQUIRED`는 **비밀번호 사유에만** 쓰인다(계약 확정). 다른 실패에 재사용되지 않는다.
- 프론트가 분기해야 하는 `code`는 기존 5개 + 신규 2개(`PDF_PASSWORD_REQUIRED`, `UNSUPPORTED_PDF_FORMAT`)로 **끝**이다.
- 서버 응답에는 비밀번호 값이 담기지 않는다. 담겨 있어도 화면에 렌더하지 않는다.
- 서버는 확장자/MIME이 아니라 **매직바이트(`%PDF-`)로 파일 종류를 판정**한다. 프론트의 `accept`·확장자 검증은 UX 힌트일 뿐 최종 판정이 아니다(계약 3절 6항).

### CRITICAL (프로젝트 규칙)

- 컴포넌트는 Claude/Supabase/Polar를 **직접 호출하지 않는다.** `fetch('/api/upload')`(및 기존 `fetch('/api/analyze')`)만 사용하고 `services/*`를 import하지 않는다.
- 원본 파일은 `/api/upload`·`/api/analyze` 전송 외의 용도로 저장/업로드하지 않는다.
- **TDD**: 테스트를 먼저 작성하고, 통과하는 구현을 작성한다. 기존 RTL 계약 테스트 방식(`fireEvent` + `vi.stubGlobal("fetch", ...)` + `fetchMock.mock.calls`에서 `FormData` 검증)을 그대로 따른다.

## Acceptance Criteria

- [ ] (TDD) `PasswordPrompt.test.tsx`와 `UploadFlow.test.tsx`의 신규 테스트를 먼저 작성해 실패를 확인한 뒤 구현했고, 최종적으로 `npm run test`, `npm run typecheck`, `npm run lint`가 모두 통과한다.
- [ ] 파일 input의 `accept`가 `.csv`/`text/csv`/`.pdf`/`application/pdf`를 모두 포함하고, `aria-label`이 `"CSV 또는 PDF 파일 선택"`임을 RTL 테스트로 확인한다.
- [ ] `.pdf` 파일을 선택하면 `POST /api/upload`가 호출되고, 첫 시도의 `FormData` 키가 정확히 `["file"]`(=`password` 미포함)이며 `body.get("file")`이 선택한 `File` 객체와 **동일 객체**(`toBe`)임을 확인한다.
- [ ] (409는 에러가 아니다) `409 { code: "PDF_PASSWORD_REQUIRED" }` 응답 시 `data-component="PasswordPrompt"` 모달이 열리고, **`data-component="ErrorModal"` 요소는 렌더되지 않으며**, 드롭존(`data-testid="upload-card"`)으로 되돌아가지 않음을 테스트로 확인한다.
- [ ] (파일 메모리 유지 — 핵심) 409 후 사용자가 비밀번호만 입력해 제출하면, 두 번째 `POST /api/upload`의 `FormData`에 **첫 시도와 동일한 `File` 객체**(`expect(body.get("file")).toBe(file)`)와 입력한 값이 담긴 `password` 필드가 함께 전송됨을 확인한다(사용자가 파일을 다시 선택하는 상호작용이 테스트에 등장하지 않는다).
- [ ] (두 실패 종류 구분 — 서버 `reason` 사용) `409 { code: "PDF_PASSWORD_REQUIRED", reason: "missing" }`에서는 `"이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요."`가, `reason: "incorrect"`에서는 `"비밀번호가 맞지 않아요. 다시 입력해 주세요."`가 노출되어 **두 문구가 서로 다름**을 테스트로 확인한다.
- [ ] (폴백 분기 금지) 문구 판정이 **서버 `reason`만**을 근거로 하고, "이 요청에 `password`를 담았는가"로 추론하는 클라이언트 분기가 코드에 **존재하지 않음**을 확인한다. `reason`이 예상 밖 값이거나 누락된 응답에서는 `"missing"` 문구로 폴백하되 모달은 정상적으로 열려 사용자가 막히지 않음을 테스트로 확인한다.
- [ ] 비밀번호가 틀려 **두 번째로 409**가 와도 모달이 닫히지 않고, 입력 필드의 `value`가 **빈 문자열로 초기화**되며(이전 입력값이 필드에 남지 않는다), 실패 문구에 입력했던 비밀번호 문자열이 포함되지 않고, 세 번째 시도의 `FormData`에도 여전히 **같은 `File` 객체**가 담김을 확인한다.
- [ ] 비밀번호 제출이 200으로 성공하면 `mapping`/`sample`로 컬럼 매핑 확인 화면(`data-testid="mapping-card"`)이 렌더됨을 확인한다.
- [ ] (비밀번호 은닉 — INV-4) 입력 필드가 `type="password"`, `autoComplete="off"`이고, 제출 후 입력한 비밀번호 문자열이 **화면 텍스트(`screen.queryByText`)·`localStorage`·`sessionStorage`·`document.cookie`·`window.location.search`·fetch 호출 URL 어디에도 등장하지 않고** 오직 `FormData`의 `password` 값으로만 전달됨을 테스트로 확인한다.
- [ ] (grep) `PasswordPrompt.tsx`/`UploadFlow.tsx`에 `localStorage`·`sessionStorage`·`indexedDB`·`document.cookie`·`URLSearchParams`·`console.log`가 등장하지 않고, 비밀번호 모달 `<form>`에 `action`/`method` 속성이 없으며 submit 핸들러가 `preventDefault()`를 호출함을 확인한다.
- [ ] `422 { code: "UNSUPPORTED_PDF_FORMAT" }` 응답 시 **비밀번호 모달이 열리지 않고** `ErrorModal`이 열리며, 모달 텍스트에 `"UNSUPPORTED_PDF_FORMAT"`과 `"422"`가 포함되지 않음을 확인한다.
- [ ] `.xlsx` 등 지원하지 않는 파일을 드래그&드롭하거나 선택하면 `fetch`가 **한 번도 호출되지 않고** 드롭존에 `"CSV 또는 PDF 파일만 올릴 수 있어요."` 안내가 노출됨을 확인한다(드롭·선택 두 경로 모두).
- [ ] (ui-design) 비밀번호 모달 패널이 `rounded-[24px] bg-[#16181c] p-8`, 오버레이가 `bg-black/60 animate-fade-in`, 입력이 `rounded-xl border-[#2a2d33]`, 제출 버튼이 `rounded-full bg-[#0052ff]`임을 확인하고, 오버레이+패널+입력 className에 `backdrop-blur`/`backdrop-filter`가 없음을 정규식으로 확인한다.
- [ ] (grep) 이 step에서 추가·수정한 코드에 `bg-gradient`+`bg-clip-text`(gradient-text), `blur-3xl`, `animate-pulse`/`animate-bounce`/글로우 `shadow-*` 애니메이션, 보라/인디고 계열 색상(`purple`, `indigo`, `violet`, `#6366f1`, `#8b5cf6`), `bg-white`/`border-[#dee1e6]`(라이트 토큰)가 없음을 확인한다.
- [ ] (CRITICAL) `UploadFlow.tsx`/`PasswordPrompt.tsx`가 `services/*`나 Claude/Supabase/Polar SDK를 import하지 않고 `fetch('/api/upload')`·`fetch('/api/analyze')`만 호출함을 확인한다.
- [ ] (INV-5 무회귀) 기존 CSV 테스트가 그대로 통과한다 — CSV 업로드 `FormData` 키는 `["file"]`, analyze는 `["file", "mapping"]`로 유지된다. 기존 테스트 수정은 `UploadFlow.test.tsx`의 `getByLabelText("CSV 파일 선택")` → `"CSV 또는 PDF 파일 선택"` 라벨 문자열 변경뿐이며, 단정문 내용은 바뀌지 않았다.
