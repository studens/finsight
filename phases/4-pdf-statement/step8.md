# Step 8: UploadFlow 상태 확장 (password/pdfColumnSchema를 analyze까지 전달) + PDF 에러 문구 + '이번 달 청구액 기준' 안내

## 작업

step 7에서 만든 `password` 상태와 비밀번호 모달을 **`/api/analyze`까지** 확장하고, PDF 전용 에러 문구와 D2(할부 = 이번 달 청구액) 오해 방지 안내를 추가한다.

수정/신규 파일:
- 수정 `src/components/UploadFlow.tsx`
- **수정 `src/hooks/useApiError.ts`** — PDF 에러 코드 문구 추가 + `BAD_REQUEST` 문구 중립화. **step 7은 409 흐름 보호를 위해 이 파일 수정을 금지했으므로, `useApiError.ts` 변경은 이 step 8이 단독으로 책임진다.** 이 step에서 하지 않으면 `UNSUPPORTED_PDF_FORMAT`이 기본 문구("문제가 발생했어요")로 떨어지고 PDF 사용자가 "CSV 형식을 확인해 주세요"를 보게 된다(api-routes 계약 3절 4·5항이 명시적으로 요구한 사항).
- 수정 `src/components/UploadFlow.test.tsx` — PDF analyze 흐름 테스트 추가
- 수정 `src/components/ErrorModal.test.tsx` — `UNSUPPORTED_PDF_FORMAT` 문구 매핑 케이스 추가(기존 케이스는 그대로 둔다)

### 1. `pdfColumnSchema` 왕복 (INV-2 — LLM 컬럼 판정은 업로드 시 한 번만)

`/api/analyze`는 `MaskedRow` 브랜드 불변식 때문에 서버에서 파일을 **재파싱**한다. 여기서 LLM 컬럼 판정을 다시 하면 두 판정 결과가 달라져 **사용자가 화면에서 본 숫자와 DB에 저장되는 숫자가 어긋날 수 있다.** 그래서 `/api/upload`가 판정 결과 `pdfColumnSchema`를 응답에 담아 주고, 클라이언트가 기존 `mapping`과 똑같은 방식으로 `/api/analyze`에 **그대로 되돌려보낸다.**

- `UploadResponse` 타입에 `pdfColumnSchema?: unknown`을 추가하고, 값을 그대로 상태(`pdfColumnSchema`)에 보관한다.
- **프론트엔드는 이 값의 내부 필드를 읽거나 가공하지 않는다.** 구조는 core-services가 정하는 것이고 프론트는 불투명한(opaque) 왕복 페이로드로만 취급한다. `JSON.stringify(pdfColumnSchema)`로 문자열화해 `/api/analyze`의 `pdfColumnSchema` 필드에 담는다.
- CSV 업로드 응답에는 `pdfColumnSchema`가 **없다**(`undefined`). 이때는 analyze 요청에 `pdfColumnSchema` 필드를 **추가하지 않는다.**

### 2. `password`를 analyze까지 전달 (놓치면 analyze가 409로 실패한다)

`/api/analyze`도 같은 PDF를 **서버에서 재파싱**하므로 비밀번호가 **다시 필요하다.** upload가 200으로 성공한 뒤에도 `password` 상태를 **초기화하지 말고 유지**해 analyze 요청에 함께 보낸다. 이걸 놓치면 매핑 확인까지 잘 진행한 사용자가 "분석 시작"에서 409로 막힌다.

`analyze()`의 `FormData` 구성 순서:

1. `file` — upload에 올린 것과 **동일한 원본 `File` 객체**(기존 동작)
2. `mapping` — `JSON.stringify(ConfirmedMapping)`(기존 동작)
3. `password` — `password` 상태가 **비어 있지 않을 때만** 추가
4. `pdfColumnSchema` — 상태에 값이 있을 때만 `JSON.stringify(...)`로 추가

따라서 FormData 키는:
- CSV: `["file", "mapping"]` (기존과 **완전히 동일** — INV-5)
- 암호 없는 PDF: `["file", "mapping", "pdfColumnSchema"]`
- 암호화된 PDF: `["file", "mapping", "password", "pdfColumnSchema"]`

### 3. analyze 단계의 409 `PDF_PASSWORD_REQUIRED` — 여기서도 에러가 아니다

step 7에서 upload에 넣은 409 엿보기 로직을 **공용 헬퍼로 추출**해 upload와 analyze가 함께 쓰게 한다. 예:

```
async function isPasswordRequired(response: Response): Promise<boolean>
// response.status === 409 && (await response.clone().json().catch(() => null))?.code === "PDF_PASSWORD_REQUIRED"
```

`response.clone()`을 쓰는 이유: `useApiError.handleResponse`가 body를 소비하므로 클론 없이 읽으면 다른 코드의 모달 표시가 깨진다.

- **어떤 단계에서 비밀번호가 필요해졌는지 기억한다** — `pendingStage: "upload" | "analyze"` 상태를 두고, 비밀번호 모달 제출 시 그 단계를 **재실행**한다. analyze에서 409가 났다면 비밀번호 제출 후 **`/api/analyze`를 재요청**한다(`/api/upload`를 다시 호출해 매핑 확인 화면으로 되돌리지 않는다 — 사용자가 이미 확인한 매핑이 날아가면 안 된다).
- analyze 재요청에는 새로 입력한 `password`와 **기존과 동일한 `pdfColumnSchema`·`File`·`mapping`** 이 담긴다.
- 409는 `ErrorModal`을 열지 않는다.
- **step 7에서 정한 미제공/불일치 문구 구분을 analyze 단계에서도 그대로 적용한다.** 판정 근거는 **서버 409 body의 `reason`(`"missing" | "incorrect"`)뿐**이다(계약 3절 3항에서 확정). "이 요청에 `password`를 담았는가"로 추론하는 클라이언트 폴백 분기는 만들지 않는다.
- `incorrect`일 때 입력 필드를 비우고, 입력했던 비밀번호를 문구·화면에 평문으로 다시 노출하지 않는다.

### 4. PDF 에러 문구 — `src/hooks/useApiError.ts` 수정은 이 step의 책임이다

기존 규칙 그대로 **에러 코드·HTTP 상태 숫자를 화면에 노출하지 않고** 부드러운 한국어로 은닉한다. 현재 `ERROR_MESSAGES`에는 `PAYWALL_REQUIRED`/`NOT_FOUND`/`GENERATION_FAILED`/`BAD_REQUEST`만 있어, 이 step에서 손대지 않으면 **신규 PDF 코드가 기본 문구로 떨어진다.**

#### 4-1. `ERROR_MESSAGES` 추가/수정

```
UNSUPPORTED_PDF_FORMAT: "이 명세서 형식은 아직 읽을 수 없어요. 카드사에서 받은 거래내역 CSV 파일로 올려주시면 분석할 수 있어요.",
BAD_REQUEST: "파일을 읽지 못했어요. 파일 형식을 확인해 주세요.",   // 기존 CSV 전용 문구 중립화
```

- `BAD_REQUEST` 기존 문구는 `"파일을 읽지 못했어요. CSV 형식을 확인해 주세요."` — **CSV 전용**이라 PDF 업로드 사용자에게 엉뚱하게 보인다. 위처럼 **파일 포맷 중립적**으로 바꾼다(api-routes 계약 3절 5항 요구사항).
- **문구 문자열에 의존하는 기존 테스트가 있으면 함께 갱신한다.** 먼저 `grep -rn "CSV 형식을 확인" src/`로 확인하라. 현재 저장소에는 이 문구를 단정하는 테스트가 없는 것으로 파악됐지만, 있으면 **문구 문자열만** 새 값으로 갱신하고 단정 구조·개수는 바꾸지 않는다(약화 금지).
- **`PDF_PASSWORD_REQUIRED`는 `ERROR_MESSAGES`에 넣지 않는다.** 이 코드는 에러가 아니라 정상 흐름의 한 단계이므로 에러 모달 경로에 절대 도달해서는 안 된다(위 3번에서 이미 분기 처리됨). 맵에 넣으면 분기 버그가 났을 때 "에러처럼 보이는 화면"으로 조용히 새어 나간다. api-routes도 이 판단에 동의했다(계약 3절 4항).
- `PAYWALL_REQUIRED`/`NOT_FOUND`/`GENERATION_FAILED` 문구와 `DEFAULT_MESSAGE`는 **바꾸지 않는다**(기존 `ErrorModal.test.tsx` 케이스가 그대로 통과해야 한다).

#### 4-2. `reason: "pdf_schema_missing"` — 파일을 탓하지 않는 문구

api-routes가 이 한 케이스에만 **가산적 `reason`** 을 붙였다(계약 0절·2절):

```json
400 { "code": "BAD_REQUEST" }                                  // 기존: file/mapping 누락·형식오류 — reason 없음
400 { "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }   // 신규: PDF인데 pdfColumnSchema 누락·형식오류
```

이 케이스는 **파일에 아무 문제가 없다.** 프론트가 `pdfColumnSchema`를 잃었을 때 발생하므로, `"파일 형식을 확인해 주세요"`를 보여주면 사용자가 멀쩡한 파일을 바꿔가며 반복 실패한다.

- `useApiError`의 문구 결정을 `code`만 보는 방식에서 **`code` + (있으면) `reason` 조합**으로 확장한다. 예: 내부 조회 키를 `` `${code}:${reason}` `` 로 먼저 찾아보고 없으면 `code`로 폴백하는 방식 — 구현 형태는 자유지만 **기존 `code`-only 동작이 정확히 보존되어야 한다.**
- `BAD_REQUEST` + `reason: "pdf_schema_missing"` 문구: `"분석 정보가 만료됐어요. 파일을 다시 올려주세요."`
- **기존 400에는 `reason`이 붙지 않으므로**(계약 확정) 기존 `BAD_REQUEST` 경로는 4-1의 중립 문구를 그대로 쓴다. `reason`이 없거나 알 수 없는 값이면 항상 `code` 기반 문구로 폴백한다.
- `reason` 값을 화면에 그대로 노출하지 않는다(`"pdf_schema_missing"` 문자열이 모달 텍스트에 나타나면 안 된다 — 코드 은닉 규칙은 `reason`에도 적용된다).

### 5. '이번 달 청구액 기준' 안내 (D2 오해 방지)

D2에 따라 PDF 명세서 분석은 **이번 달 청구액**을 지출로 계상한다(할부 원 이용금액이 아님).

**이 안내가 필요한 근거 — 리더 실측 사례:** 실제 NH농협 명세서의 할부 건 `03/20 네이버페이_인프런`은 원 이용금액이 **140,252원**이지만 이번 달 청구액은 **23,375원**이고, 우리는 **23,375원만** 총 지출에 계상한다(그래서 34건 합계가 명세서 `합계` 행 882,646원과 오차 0으로 일치한다 — `_workspace/00_input/pdf-extraction-algorithm-verified.md`). 즉 사용자는 "내가 쓴 금액보다 총 지출이 적게 나오는데?"라고 느낄 수밖에 없다. 그 지점을 미리 설명하는 표기가 결과 화면에 있어야 한다.

- **PDF로 분석했을 때만** 노출한다(`pdfColumnSchema` 상태가 있을 때). CSV일 때는 노출하지 않는다.
- 위치: `done` 분기에서 `FreeSummaryCards` **바로 위**.
- 문구: `"PDF 명세서는 이번 달 청구액을 기준으로 계산했어요. 할부는 총액이 아니라 이번 달 청구 회차 금액만 반영돼요."`
- 스타일 — **과한 배너를 만들지 마라. 절제된 보조 텍스트 한 줄이다.** (원칙 3: 색상은 정보 전달에만, 장식 금지)
  - 배경 채움·테두리·아이콘 배지 없이 단락 하나로만 렌더한다: `<p className="text-[13px] leading-relaxed text-[#a8acb3]">` (기존 드롭존 보조 안내와 같은 결)
  - **금지: 전폭 색상 블록/배너, `border-l-4` 좌측 강조 바, 경고 아이콘 배지, `bg-[#cf202f]`/`bg-[#5b8bff]` 등 색 채움.** 이 안내는 경고가 아니라 계산 기준 설명이다.
  - 카드(`rounded-[24px]`)로 감싸지 않는다 — 결과 카드들과 같은 시각적 무게를 갖게 하면 안 된다.
- `data-testid="pdf-billing-notice"`를 붙여 테스트에서 존재/부재를 검증한다.

### 5-1. `pdfColumnSchema`는 화면에 노출하지 않는다

`pdfColumnSchema`는 PII가 없는 **순수 구조 메타데이터**(컬럼 클러스터 → 컬럼 의미 매핑)이므로 클라이언트 상태에 담아 analyze로 왕복시켜도 안전하다. 다만 사용자에게 보여줄 정보가 아니다 — **내부 상태로만 들고 가고**, 어떤 형태로도(디버그 출력, `<pre>`, `data-*` 속성, 툴팁) 화면에 렌더하지 않는다.

### 6. reset 정리

"다시 올리기"(`reset()`)는 `password`, `pdfColumnSchema`, `pendingStage`, 비밀번호 모달 상태를 **모두 초기화**한다. 초기화 후 CSV를 올리면 analyze FormData가 다시 정확히 `["file", "mapping"]`이어야 한다(PDF 세션의 잔여 상태가 CSV 요청에 새어 들어가면 안 된다).

### 스타일 규칙 (ui-design — 이 step에서 반드시 지킬 값)

- 인증 후 화면이므로 **다크 고정**. 라이트 토큰(`bg-white`, `border-[#dee1e6]`) 사용 금지.
- 역할별 반경 구분 유지: 카드/패널 `rounded-[24px] bg-[#16181c] p-8`, 리스트 아이템/중첩 표면 `rounded-2xl bg-[#0a0b0d]`, 입력 `rounded-xl`, 버튼·배지 `rounded-full`.
- **금지: `backdrop-filter`/`backdrop-blur`(glass morphism), gradient-text, 보라/인디고 브랜드 색, box-shadow 글로우 애니메이션, 배경 gradient orb(`blur-3xl`), "Powered by AI" 배지.**
- 허용 애니메이션은 `fade-in`·`slide-up`뿐.
- 색상은 정보 전달용으로만: 안내/정보 `#5b8bff`, 위험/실패 `#cf202f`, Primary CTA `#0052ff`, 보조 텍스트 `#a8acb3`.

### 보안 (INV-4 재확인)

- `password`는 React 상태에만 둔다. `localStorage`/`sessionStorage`/IndexedDB/`document.cookie`/URL·쿼리파라미터에 **절대 쓰지 않는다.**
- 비밀번호 값이 화면 텍스트·에러 모달 문구·`console.*`·`data-*` 속성·fetch URL에 나타나지 않는다. 전송 경로는 `FormData`의 `password` 필드뿐이다.
- `pdfColumnSchema`는 구조 메타데이터(컬럼 의미 순서)이며 PII가 아니다. 그래도 화면에 원문(JSON)을 렌더하지 않는다.
- 원본 PDF/CSV `File`은 브라우저 메모리에서만 다루고 어떤 스토리지에도 저장하지 않는다.

### 참고 — 확정 API 계약 (`_workspace/03_api-routes_pdf-contract.md`)

`POST /api/analyze` 요청 `multipart/form-data`:
- `file`, `mapping` (기존)
- `password`: (PDF가 암호화된 경우 필수) 서버 재파싱에 필요. PDF가 아니면 서버가 무시
- `pdfColumnSchema`: (PDF일 때 **필수**) JSON 문자열. upload가 반환한 **객체**를 `JSON.stringify`해 그대로 돌려보낸다
- 서버 검증 순서: 세션 → formData → file/mapping → 파일 종류 판별 → (PDF면) `pdfColumnSchema` 검증 → 재파싱. **따라서 `pdfColumnSchema`가 없으면 파일이 암호화됐어도 409가 아니라 400이 나간다** — 프론트가 스키마를 잃으면 비밀번호 모달이 아니라 400 문구를 보게 되므로 4-2의 전용 문구가 중요하다.

에러 전체:
```json
400 { "code": "BAD_REQUEST" }                                    // file/mapping 누락·형식오류 (기존, reason 없음)
400 { "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }      // PDF인데 pdfColumnSchema 누락·형식오류
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }
422 { "code": "UNSUPPORTED_PDF_FORMAT" }
```

프론트가 알아야 할 계약 확정 사항(계약 1절):
- **PDF일 때 `mapping`은 항상 고정값이고 `confidence: 1`이다.** 라우트가 LLM 컬럼 매핑 추론을 호출하지 않는다(INV-1로 헤더가 고정이므로). → 기존 `confidence < 0.7` "확신도 낮음" 경고 배너는 **PDF에서 절대 뜨지 않는다.** 이 분기를 PDF용으로 손대지 마라.
- **PDF의 `excludedColumns`/`maskedColumns`는 빈 배열이 정상이다.** 파서 헤더(`["이용일","가맹점","청구금액","구분"]`)에는 이름·주소·계좌·카드번호 컬럼이 애초에 없다(INV-1). 따라서 기존 "○○는 전송되지 않았어요 / 뒤 4자리만 남겼어요" 안내는 PDF에서 아무것도 렌더되지 않는다 — **그 자리를 대신하는 것이 5번의 D2 안내다.** 빈 배열을 이유로 경고를 띄우지 마라.
- `pdfColumnSchema`는 **객체**로 반환된다. 읽거나 변형하지 말고 불투명한 값으로 왕복만 시킨다.
- 서버는 확장자/MIME이 아니라 **매직바이트(`%PDF-`)로** 파일 종류를 판정한다.
- 프론트가 분기해야 하는 `code`는 기존 5개 + 신규 2개로 **끝**이다(신규 `code` 추가 없음).

`POST /api/upload` 200 응답(PDF일 때만 `pdfColumnSchema` 추가):
```json
{
  "mapping": { "date": "이용일", "merchant": "가맹점", "amount": "청구금액", "category": "구분", "confidence": 1 },
  "sample": { "headers": ["이용일","가맹점","청구금액","구분"], "rows": [], "excludedColumns": [], "maskedColumns": [] },
  "pdfColumnSchema": { }
}
```

위 내용은 `_workspace/03_api-routes_pdf-contract.md`에 **확정된 계약**이다. 그 문서와 이 step이 어긋나면 그 문서를 따른다.

### CRITICAL (프로젝트 규칙)

- 컴포넌트는 Claude/Supabase/Polar를 **직접 호출하지 않는다.** `fetch('/api/upload')`·`fetch('/api/analyze')`만 사용하고 `services/*`를 import하지 않는다.
- 서버로 "마스킹된 데이터"나 파싱 결과를 보내지 않는다. analyze 요청 본문은 원본 `file` + 확정 `mapping` (+ PDF일 때 `password`/`pdfColumnSchema`)뿐이다.
- **TDD**: 테스트를 먼저 작성하고 통과하는 구현을 작성한다. 기존 RTL 계약 테스트 방식(`vi.stubGlobal("fetch", ...)` + `fetchMock.mock.calls`에서 `FormData` 키·값 검증)을 그대로 따른다.
- `npm run test` 전체 통과 필수(INV-5). 기존 테스트의 단정문을 약화시키는 수정 금지 — 추가만 한다.

## Acceptance Criteria

- [ ] (TDD) 신규 테스트를 먼저 작성해 실패를 확인한 뒤 구현했고, 최종적으로 `npm run test`, `npm run typecheck`, `npm run lint`가 모두 통과한다.
- [ ] (핵심 — password가 analyze까지 간다) 암호화된 PDF 흐름(upload 409 → 비밀번호 입력 → upload 200 → 분석 시작)에서 `POST /api/analyze`의 `FormData` 키가 정확히 `["file", "mapping", "password", "pdfColumnSchema"]`이고, `password` 값이 사용자가 입력한 값과 같으며 `file`이 최초 선택한 **동일 `File` 객체**(`toBe`)임을 테스트로 확인한다.
- [ ] (pdfColumnSchema 왕복 — INV-2) upload 응답의 `pdfColumnSchema`(중첩 객체 포함 임의 값)가 가공되지 않고 `JSON.parse(body.get("pdfColumnSchema"))`가 upload 응답 값과 **`toEqual`로 동일**함을 확인한다. 컴포넌트 코드가 `pdfColumnSchema`의 내부 필드에 접근(프로퍼티 읽기/구조분해)하지 않음을 확인한다.
- [ ] 암호화되지 않은 PDF(409 없이 200)에서는 analyze `FormData` 키가 정확히 `["file", "mapping", "pdfColumnSchema"]`(=`password` 미포함)임을 확인한다.
- [ ] (INV-5 무회귀) CSV 흐름에서 analyze `FormData` 키가 **정확히 `["file", "mapping"]`** 이고 `password`/`pdfColumnSchema`가 `null`임을 기존 테스트가 그대로 통과함으로써 확인한다.
- [ ] (409는 에러가 아니다 — analyze 단계) analyze가 `409 { code: "PDF_PASSWORD_REQUIRED" }`를 반환하면 `data-component="PasswordPrompt"` 모달이 열리고 `data-component="ErrorModal"`은 렌더되지 않으며, 컬럼 매핑 확인 화면이나 드롭존으로 되돌아가지 않음을 확인한다.
- [ ] analyze 409 후 비밀번호를 다시 입력하면 **`/api/analyze`가 재요청**되고(`/api/upload`는 추가 호출되지 않음), 그 요청에 새 `password`와 **동일한 `file`·`mapping`·`pdfColumnSchema`** 가 담김을 확인한다.
- [ ] (**`useApiError.ts` 수정 — 이 step 단독 책임**) `src/hooks/useApiError.ts`의 `ERROR_MESSAGES`에 `UNSUPPORTED_PDF_FORMAT` 문구가 **추가**되어 `422 { code: "UNSUPPORTED_PDF_FORMAT" }`이 기본 문구(`"문제가 발생했어요…"`)가 **아니라** `"이 명세서 형식은 아직 읽을 수 없어요."` + CSV 대안 안내(`"CSV"` 문자열 포함)로 표시됨을 `ErrorModal.test.tsx`의 신규 케이스로 확인한다. 모달 텍스트에 `"UNSUPPORTED_PDF_FORMAT"`·`"422"`가 포함되지 않는다(upload·analyze 두 단계 모두).
- [ ] (**`useApiError.ts` 수정 — `BAD_REQUEST` 중립화**) `BAD_REQUEST` 문구에서 `"CSV 형식을 확인해 주세요"`가 제거되고 파일 포맷 중립 문구로 바뀌었음을 확인한다(grep으로 `"CSV 형식을 확인"`이 `src/` 전체에 남아 있지 않음). 이 문구를 단정하는 기존 테스트가 있다면 **문구 문자열만** 갱신하고 단정 구조·개수는 유지한다.
- [ ] (`pdf_schema_missing`) `400 { code: "BAD_REQUEST", reason: "pdf_schema_missing" }`이 `"분석 정보가 만료됐어요. 파일을 다시 올려주세요."`로 표시되어 **파일을 탓하는 문구가 아님**을 확인하고, `reason`이 없는 기존 `400 { code: "BAD_REQUEST" }`는 4-1의 중립 문구로 표시되어 **두 문구가 서로 다름**을 확인한다. 모달 텍스트에 `"pdf_schema_missing"`·`"BAD_REQUEST"`·`"400"`이 포함되지 않는다.
- [ ] (`reason` 폴백 안전성) `reason`이 없는 응답, 알 수 없는 `reason` 값, JSON 파싱 실패 응답 모두에서 기존 `code` 기반 문구/기본 문구로 폴백되어 **기존 `code`-only 동작이 정확히 보존됨**을 확인한다.
- [ ] `PDF_PASSWORD_REQUIRED`가 `src/hooks/useApiError.ts`의 `ERROR_MESSAGES`에 **존재하지 않음**을 grep으로 확인하고, upload·analyze 어느 단계의 409에서도 에러 모달이 열리지 않음을 테스트로 확인한다.
- [ ] `ErrorModal.test.tsx`의 기존 3개 코드(`PAYWALL_REQUIRED`/`NOT_FOUND`/`GENERATION_FAILED`) 문구와 `DEFAULT_MESSAGE` 폴백 케이스가 수정 없이 통과한다(추가만 하고 기존 케이스를 손대지 않는다).
- [ ] (D2 안내) PDF 분석 결과 화면에 `data-testid="pdf-billing-notice"`가 렌더되고 `"이번 달 청구액"`과 `"할부"`가 문구에 포함되며, **CSV 분석 결과 화면에는 렌더되지 않음**(`queryByTestId`가 `null`)을 확인한다.
- [ ] (ui-design — 과한 배너 금지) `pdf-billing-notice`가 `<p>` 한 줄(`text-[13px] leading-relaxed text-[#a8acb3]`)이고, className에 `rounded-[24px]`·`border-l-4`·`bg-[#16181c]`·`bg-[#0a0b0d]` 같은 카드/배너 채움이 **없으며** 아이콘 배지를 포함하지 않음을 확인한다. 같은 화면의 결과 카드는 `rounded-[24px]`를 유지해 시각적 무게가 구분된다.
- [ ] (pdfColumnSchema 미노출) `pdfColumnSchema`로 넣은 값의 문자열이 결과·매핑 확인 화면의 텍스트나 렌더된 DOM 속성에 나타나지 않음을 테스트로 확인한다.
- [ ] (analyze 단계 실패 문구 구분) analyze 409에서도 **서버 `reason`(`"missing"`/`"incorrect"`)** 으로 문구가 구분되어 표시되고, 불일치 시 입력 필드가 비워지며 입력했던 비밀번호가 문구에 포함되지 않음을 확인한다. "이 요청에 password를 담았는가"로 추론하는 클라이언트 폴백 분기가 코드에 존재하지 않음을 확인한다.
- [ ] (grep) 이 step에서 추가·수정한 코드에 `backdrop-blur`/`backdrop-filter`, `bg-gradient`+`bg-clip-text`(gradient-text), `blur-3xl`, `animate-pulse`/`animate-bounce`/글로우 `shadow-*` 애니메이션, 보라/인디고 색상(`purple`, `indigo`, `violet`, `#6366f1`, `#8b5cf6`), 라이트 토큰(`bg-white`, `border-[#dee1e6]`), "Powered by AI" 문구가 없음을 확인한다.
- [ ] (비밀번호 은닉 — INV-4) analyze까지 진행한 뒤에도 입력한 비밀번호 문자열이 화면 텍스트·`localStorage`·`sessionStorage`·`document.cookie`·`window.location.search`·fetch 호출 URL·에러 모달 문구 어디에도 등장하지 않음을 테스트로 확인하고, `UploadFlow.tsx`에 `localStorage`·`sessionStorage`·`indexedDB`·`document.cookie`·`URLSearchParams`·`console.log`가 없음을 grep으로 확인한다.
- [ ] (reset) "다시 올리기" 후 CSV를 새로 업로드해 분석하면 analyze `FormData` 키가 다시 정확히 `["file", "mapping"]`이고 `pdf-billing-notice`가 렌더되지 않음을 확인한다(PDF 세션 잔여 상태 누출 없음).
- [ ] (CRITICAL) `UploadFlow.tsx`가 `services/*`나 Claude/Supabase/Polar SDK를 import하지 않고 `fetch('/api/upload')`·`fetch('/api/analyze')`만 호출하며, 클라이언트가 마스킹을 수행하거나 파싱 결과를 서버로 보내지 않음을 확인한다.
