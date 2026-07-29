# frontend PDF 계획 노트 (phase 4-pdf-statement, step 7~8)

> qa / api-routes가 참조하는 **컴포넌트 구조 + 상태 흐름 + 에러 코드→UI 분기 표**다.
> 계획 파일: `phases/4-pdf-statement/step7.md`, `step8.md` (index.json은 리더가 작성)
> 의존 계약: `_workspace/03_api-routes_pdf-contract.md`(**확정 — 반영 완료**), `_workspace/00_input/scope_4-pdf-statement.md`, `_workspace/00_input/pdf-extraction-algorithm-verified.md`, `ui-design` 스킬

## step ↔ 산출물

| step | 산출물 | 종류 |
|---|---|---|
| 7 | 신규 `src/components/PasswordPrompt.tsx` + `PasswordPrompt.test.tsx`, 수정 `src/components/UploadFlow.tsx`(드롭존 accept/검증 + 409 분기 + `password` 상태), 수정 `UploadFlow.test.tsx` | 업로드 1단계 |
| 8 | 수정 `src/components/UploadFlow.tsx`(analyze 확장 + D2 안내), **수정 `src/hooks/useApiError.ts`(PDF 문구 — step 8 단독 책임)**, 수정 `UploadFlow.test.tsx`·`ErrorModal.test.tsx` | 업로드 2단계 + 문구 |

새 화면/라우트는 없다. 대시보드 조립(`src/app/(app)/dashboard/page.tsx`)은 **변경하지 않는다** — `UploadFlow`의 props(`{ isSubscribed }`)가 그대로 유지된다.

## 상태 흐름 — File / password / pdfColumnSchema

`UploadFlow`(Client Component) 내부 `useState`만 사용한다. 스토리지(localStorage/sessionStorage/IndexedDB/cookie)·URL·쿼리파라미터는 **어느 값도** 사용하지 않는다.

```
[idle 드롭존]
  파일 선택/드롭 (.csv | .pdf)
    ├─ 확장자/MIME 미지원 → fetch 호출 안 함, 드롭존 내 안내문
    └─ file → setFile(file)                       ← 이후 절대 null로 만들지 않음
         POST /api/upload  FormData: ["file"]      ← CSV와 동일 (INV-5)
           ├─ 409 PDF_PASSWORD_REQUIRED → [비밀번호 모달] (에러 모달 아님)
           │     문구는 서버 body의 reason으로 분기: "missing" | "incorrect"
           │     제출 → setPassword(입력값)
           │     POST /api/upload FormData: ["file", "password"]   ← file은 동일 객체(toBe)
           │       ├─ 409 reason="incorrect" → 모달 유지, 입력 필드 비움, "비밀번호가 맞지 않아요"
           │       └─ 200 → 아래로
           ├─ 422 UNSUPPORTED_PDF_FORMAT → ErrorModal
           └─ 200 → setMapping / setSample / setPdfColumnSchema(응답 값 그대로)
                     step = "confirming"
                     ※ password는 초기화하지 않고 유지  ← 놓치면 analyze가 409로 실패

[confirming 매핑 확인]
  "분석 시작"
    POST /api/analyze  FormData 구성 (조건부 append):
      1. file            (upload와 동일 File 객체)
      2. mapping         JSON.stringify(ConfirmedMapping)
      3. password        password !== "" 일 때만
      4. pdfColumnSchema pdfColumnSchema != null 일 때만, JSON.stringify(그대로)
    → CSV:           ["file","mapping"]                            ← 기존과 완전 동일 (INV-5)
    → 평문 PDF:      ["file","mapping","pdfColumnSchema"]
    → 암호화 PDF:    ["file","mapping","password","pdfColumnSchema"]
      ├─ 409 (+reason) → [비밀번호 모달] (pendingStage="analyze") → 제출 시 /api/analyze 재요청
      │        (/api/upload를 다시 부르지 않는다 — 확인한 매핑을 잃지 않기 위해)
      ├─ 422 → ErrorModal ("이 명세서 형식은 아직 읽을 수 없어요…")
      ├─ 400 reason="pdf_schema_missing" → ErrorModal ("분석 정보가 만료됐어요. 파일을 다시 올려주세요.")
      │        ※ 서버 검증 순서상 스키마 누락이면 암호화 파일이어도 409가 아니라 400이 온다
      └─ 200 → setResult, step = "done"

[done 결과]
  pdfColumnSchema != null 일 때만 '이번 달 청구액 기준' 보조 텍스트 1줄 (data-testid="pdf-billing-notice")
  FreeSummaryCards + PremiumSection (기존)

reset("다시 올리기") → file/sample/mapping/result/password/pdfColumnSchema/pendingStage/모달상태 전부 초기화
```

### 세 값의 수명과 취급

| 값 | 저장 위치 | 수명 | 전송 경로 | 화면 노출 |
|---|---|---|---|---|
| 원본 `File` | `useState` (브라우저 메모리) | 선택 시점 ~ reset | `/api/upload`, `/api/analyze`의 `file` | 파일명만 |
| `password` | `useState` | 입력 시점 ~ reset (**upload 성공 후에도 유지**) | `/api/upload`, `/api/analyze`의 `password` | **없음** (input type=password) |
| `pdfColumnSchema` | `useState` (opaque, 파싱/가공 안 함) | upload 200 ~ reset | `/api/analyze`의 `pdfColumnSchema` (JSON 문자열 왕복) | **없음** |

- `password`가 analyze에도 필요한 이유: `/api/analyze`가 `MaskedRow` 브랜드 불변식 때문에 **서버에서 PDF를 재파싱**한다(INV-2 / `03_api-routes_contract.md` 54행).
- `pdfColumnSchema`를 왕복시키는 이유: LLM 컬럼 판정을 upload에서 **한 번만** 하고 analyze에서 재판정하지 않기 위함(INV-2). 두 번 판정하면 사용자가 본 숫자와 저장된 숫자가 어긋난다.
- `pdfColumnSchema`는 PII 없는 구조 메타데이터지만 사용자에게 보여줄 정보가 아니라 내부 상태로만 다룬다.

## 에러 코드 → UI 분기 표

| HTTP | body | 단계 | UI 분기 | 문구 |
|---|---|---|---|---|
| 409 | `{code:"PDF_PASSWORD_REQUIRED", reason:"missing"}` | upload / analyze | **비밀번호 입력 모달** (`data-component="PasswordPrompt"`) — 에러 아님 | "이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요." |
| 409 | `{code:"PDF_PASSWORD_REQUIRED", reason:"incorrect"}` | upload / analyze | 같은 모달 유지 + 입력 필드 비움 | "비밀번호가 맞지 않아요. 다시 입력해 주세요." |
| 422 | `{code:"UNSUPPORTED_PDF_FORMAT"}` | upload / analyze | `ErrorModal` (**step8에서 `ERROR_MESSAGES` 신규 추가**) | "이 명세서 형식은 아직 읽을 수 없어요. 카드사에서 받은 거래내역 CSV 파일로 올려주시면 분석할 수 있어요." |
| 400 | `{code:"BAD_REQUEST"}` (reason 없음) | upload / analyze | `ErrorModal` (**step8에서 문구 중립화**) | "파일을 읽지 못했어요. 파일 형식을 확인해 주세요." |
| 400 | `{code:"BAD_REQUEST", reason:"pdf_schema_missing"}` | analyze | `ErrorModal` (**step8에서 `code`+`reason` 조합 문구 신규**) | "분석 정보가 만료됐어요. 파일을 다시 올려주세요." — **파일을 탓하지 않는다** |
| 401 | `{code:"UNAUTHORIZED"}` | — | 미들웨어가 `/login`으로 보냄(방어적) | 기본 문구 |
| 403 | `{code:"PAYWALL_REQUIRED"}` | reports | `ErrorModal` (기존) | 변경 없음 |
| 404 | `{code:"NOT_FOUND"}` | reports | `ErrorModal` (기존) | 변경 없음 |
| 502 | `{code:"GENERATION_FAILED"}` | reports | `ErrorModal` (기존) | 변경 없음 |
| — | 지원 안 되는 확장자 | 클라이언트 검증 | 드롭존 내 안내문 (fetch 미호출) | "CSV 또는 PDF 파일만 올릴 수 있어요." |

- **`PDF_PASSWORD_REQUIRED`는 `useApiError`의 `ERROR_MESSAGES`에 넣지 않는다.** 에러가 아니라 정상 흐름의 한 단계이므로 에러 모달 경로에 도달해서는 안 되고, 맵에 없으면 분기 버그가 났을 때 조용히 새지 않고 기본 문구로 드러난다. api-routes도 이 판단에 동의(계약 3절 4항).
- 409 body 파싱은 `await response.clone().json()`으로 한다 — `useApiError.handleResponse`가 body를 소비하므로 클론 없이 읽으면 다른 코드의 모달 표시가 깨진다. **409는 항상 JSON body를 갖는 것이 서버 AC로 보장됐다**(계약 "409 JSON body 보장" 절).
- **미제공/불일치 구분은 서버 `reason`만 쓴다** (계약 3절 3항 확정). 서버가 항상 둘 중 하나를 채워 보내므로(파서가 분류값을 못 주면 라우트가 `hadPassword`로 폴백 판정) **클라이언트 추론 폴백 분기는 만들지 않는다** — 남기면 서버 판정과 어긋날 때 오분류만 생긴다. `reason`이 예상 밖/누락이면 `"missing"` 문구로 폴백하고 모달은 정상 오픈(사용자를 막지 않음).
- `reason` 값 문자열(`"pdf_schema_missing"` 등)도 화면에 노출하지 않는다 — 코드 은닉 규칙은 `reason`에도 적용된다.

### `useApiError.ts` 수정 담당 = **step 8 단독**

step 7은 409 흐름 보호를 위해 `useApiError.ts` 수정을 금지했다. 따라서 문구 작업 전부가 step 8 몫이다:
1. `UNSUPPORTED_PDF_FORMAT` 문구 **추가** (없으면 기본 문구로 떨어짐)
2. `BAD_REQUEST` 문구 **중립화** (`"CSV 형식을 확인해 주세요"` → 포맷 중립). 이 문구를 단정하는 기존 테스트가 있으면 문구 문자열만 갱신(현재 저장소에는 없음)
3. `code` + `reason` 조합 조회 지원 (`pdf_schema_missing` 전용 문구). `reason` 없음/미지의 값/파싱 실패는 **기존 `code`-only 동작으로 폴백**
4. `PDF_PASSWORD_REQUIRED`는 **넣지 않음** — 부재 검증 AC 유지

## D2 오해 방지 표기

- PDF 결과에서만 노출, CSV에서는 미노출.
- 근거(리더 실측): 할부 건 `03/20 네이버페이_인프런`은 원 이용금액 140,252원이지만 이번 달 청구는 23,375원 → **23,375원만 계상**. 그래서 34건 합계가 명세서 `합계` 882,646원과 오차 0.
- 스타일: `<p className="text-[13px] leading-relaxed text-[#a8acb3]">` 한 줄. **배너·색 채움·좌측 강조 바·경고 아이콘 배지 금지**(경고가 아니라 계산 기준 설명). 카드로 감싸지 않는다.

## 기존 CSV 무회귀 (INV-5) 가드

- `/api/upload` FormData 키: CSV·평문 PDF 첫 시도 모두 `["file"]`
- `/api/analyze` FormData 키: CSV는 정확히 `["file","mapping"]` — 기존 `UploadFlow.test.tsx`의 `expect([...body.keys()]).toEqual(["file","mapping"])`가 그대로 회귀 가드 역할을 한다
- reset 후 CSV 업로드 시 PDF 세션의 `password`/`pdfColumnSchema` 잔여값이 새어 들어가지 않는다(전용 AC 있음)
- **허용된 기존 테스트 수정은 단 하나**: `UploadFlow.test.tsx`의 `getByLabelText("CSV 파일 선택")` 4곳 → `"CSV 또는 PDF 파일 선택"` (라벨 문자열만, 단정문 내용 불변). `ErrorModal.test.tsx`는 `UNSUPPORTED_PDF_FORMAT` 케이스 **추가만** 하고 기존 3개 코드 케이스는 손대지 않는다.

## PDF일 때 기존 UI가 자동으로 조용해지는 부분 (계약 1절 — 손대지 말 것)

- **`confidence: 1` 고정** → 기존 `confidence < 0.7` "확신도 낮음" 경고 배너는 PDF에서 절대 뜨지 않는다(라우트가 LLM 컬럼 매핑 추론을 호출하지 않음). PDF용으로 이 분기를 개조하지 않는다.
- **`excludedColumns`/`maskedColumns` 빈 배열이 정상** → "○○는 전송되지 않았어요 / 뒤 4자리만 남겼어요" 안내가 PDF에서 아무것도 렌더되지 않는다(INV-1: 파서 헤더에 이름·주소·계좌·카드번호 컬럼이 애초에 없음). 빈 배열을 이유로 경고를 띄우지 않는다. **그 자리를 대신하는 것이 D2 '이번 달 청구액 기준' 안내다**(계약 1절이 명시적으로 step 8의 몫으로 지정).
- 서버는 확장자/MIME이 아니라 **매직바이트(`%PDF-`)로** 파일 종류를 판정한다. 프론트의 `accept`·확장자 검증은 **UX 힌트일 뿐** 최종 판정이 아니다.

## 리스크 처리 현황

| # | 리스크 | 상태 |
|---|---|---|
| 1 | 409에 JSON body가 없으면 `clone().json()` 실패 → 비밀번호 흐름이 조용히 막힘 | **해소** — api-routes가 "`clone().json()` 성공 + `code` 읽힘"을 상태코드와 **별개 AC**로 분리해 강제 |
| 2 | `password`를 upload·analyze 한쪽만 받으면 사용자가 매핑 확인 후 영구 차단 | **해소** — api-routes step 5·6 양쪽에 각각 `password` 수용 AC 존재 |
| 3 | 미제공/불일치 구분 불가 → 사용자가 원인을 모른 채 막힘 | **해소** — 409 body에 `reason: "missing" \| "incorrect"` 확정. 클라이언트 추론 폴백은 **제거**함(오분류 위험 제거) |
| 4 | `pdfColumnSchema` 누락 400이 "파일을 탓하는" 엉뚱한 문구 → 멀쩡한 파일로 반복 실패 | **해소** — `reason: "pdf_schema_missing"` 가산 확정. step 8이 전용 문구("분석 정보가 만료됐어요. 파일을 다시 올려주세요.") 적용 |
| 5 | `PDF_PASSWORD_REQUIRED`가 다른 사유에 재사용되면 프론트 정상흐름 분기가 오작동 | **해소** — 비밀번호 사유 전용이 서버 AC(grep 검증 포함)로 강제 |
| 6 | 이력 상세 화면(`/dashboard/[analysisId]`)에 '이번 달 청구액' 표기 불가 | **남음(후속 과제)** — `analyses`에 출처 플래그가 없어 Server Component가 PDF 여부를 알 수 없다. 이번 phase는 DB 변경 없음이 확정이라 업로드 직후 결과 화면에만 표기한다. 리더가 사용자 보고용 후속 과제로 접수(→ `analyses`에 source 컬럼, db-schema) |
