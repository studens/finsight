# api-routes PDF 확장 확정 계약 (phase 4-pdf-statement, step 5~6)

> frontend 플래너(step 7~8)와 qa가 참조하는 **최종 요청/응답 shape + 전체 에러 코드 표**다.
> 기존 계약 `_workspace/03_api-routes_contract.md`를 **대체하지 않고 확장**한다. 여기 적히지 않은 것은 기존 계약 그대로다.
> 근거: `_workspace/00_input/scope_4-pdf-statement.md`(D1~D4, INV-1~INV-5), `_workspace/00_input/pdf-extraction-algorithm-verified.md`(리더 실측).
> 계획 파일: `phases/4-pdf-statement/step5.md`, `step6.md`.

---

## 0. 전체 에러 코드 표 (기존 + 신규)

| 상황 | HTTP | body | 어디서 |
|---|---|---|---|
| 세션 없음(비로그인) | 401 | `{ "code": "UNAUTHORIZED" }` | 모든 라우트 |
| 잘못된 요청(파일/필드 누락·형식오류) | 400 | `{ "code": "BAD_REQUEST" }` | upload, analyze |
| **PDF인데 `pdfColumnSchema` 누락·형식오류** | 400 | `{ "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }` | **analyze (신규)** |
| 리소스 없음 / 소유권 불일치 / 잘못된 reportType | 404 | `{ "code": "NOT_FOUND" }` | reports |
| 미구독 사용자의 Premium 요청 | 403 | `{ "code": "PAYWALL_REQUIRED" }` | reports |
| **암호화 PDF — 비밀번호 미제공** | **409** | `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }` | **upload, analyze (신규)** |
| **암호화 PDF — 비밀번호 불일치** | **409** | `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }` | **upload, analyze (신규)** |
| **PDF 레이아웃 해석 실패 / 스캔 이미지 PDF / PDF 주장하지만 `%PDF-` 헤더 없음** | **422** | `{ "code": "UNSUPPORTED_PDF_FORMAT" }` | **upload, analyze (신규)** |
| llm 생성 실패 | 502 | `{ "code": "GENERATION_FAILED" }` | reports |
| Polar 웹훅 (미구현 스텁) | 501 | `{ "code": "NOT_IMPLEMENTED" }` | webhooks/polar |

**충돌 점검 결과:** 409·422는 이 프로젝트에서 처음 쓰는 상태코드이며 기존 401/400/403/404/501/502와 겹치지 않는다. `code` 문자열도 신규 두 개(`PDF_PASSWORD_REQUIRED`, `UNSUPPORTED_PDF_FORMAT`)가 기존 어느 값과도 겹치지 않는다. 신규 `code`는 이 둘로 **끝**이다 — 프론트가 분기해야 하는 `code` 집합은 기존 5개 + 신규 2개 = 7개다.

### 에러 body 키 규약 (확정)

| 케이스 | HTTP | 키 |
|---|---|---|
| 기존 400 (file/mapping 누락·형식오류) | 400 | `["code"]` — **변경 없음** |
| PDF인데 `pdfColumnSchema` 누락·형식오류 | 400 | `["code", "reason"]`, `reason: "pdf_schema_missing"` |
| 비밀번호 필요/불일치 | 409 | `["code", "reason"]`, `reason: "missing" \| "incorrect"` |
| 그 외 전부 (401/403/404/422/502/501) | — | `["code"]` |

- 예외의 `message`/`stack`은 **어떤** 에러 body에도 담기지 않는다.
- `reason`은 항상 **닫힌 리터럴 집합**이며 서버가 만든 분류값이다. 에러 메시지·비밀번호·파일명이 절대 들어가지 않는다.
- 두 라우트가 동일한 매핑을 쓰도록 `src/lib/pdf-error.ts`의 `toPdfErrorPayload(error, hadPassword)` 순수 함수로 분리한다(step 5 산출, step 6 재사용).

### core-services 에러 타입 ↔ HTTP 매핑 (step 0 확정 타입 기준)

| core-services 에러 (`src/services/pdf-parser`) | HTTP | body |
|---|---|---|
| `PdfPasswordRequiredError` (`passwordCase: "missing"`) | 409 | `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }` |
| `PdfPasswordRequiredError` (`passwordCase: "incorrect"`) | 409 | `{ "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }` |
| `UnsupportedPdfFormatError` (모든 `reason` 값) | 422 | `{ "code": "UNSUPPORTED_PDF_FORMAT" }` |
| 그 외 예외 | — | 매핑하지 않고 **재던지기** (임의 500 body 생성 금지) |

- 판별은 `instanceof` + `code` 필드로 한다. `message` 문자열 매칭은 금지.
- 응답 `reason`(409)은 `PdfPasswordRequiredError.passwordCase`를 그대로 옮긴 값이다. `passwordCase`가 비어 있으면 라우트가 "요청에 `password`를 담았는가"로 폴백 판정해 **반드시 둘 중 하나를 채운다.**
- ⚠️ **`UnsupportedPdfFormatError.reason`(예 `"pdf_open_failed"`)은 응답에 나가지 않는다.** 필드명이 409 body의 `reason`과 겹쳐 실수로 흘리기 쉬운 지점이라 step 5·6 AC에 "응답 body에 이 라벨이 없음"을 검증하는 항목을 넣었다.
- **매직바이트 판별은 `src/services/pdf-parser`의 `isPdfBuffer`를 쓴다**(core-services step 0 산출). api-routes는 `src/lib/file-type.ts`에 `claimsPdf`(확장자/MIME 보조 신호)만 둔다.

### 409 JSON body 보장 (프론트 블로킹 요구 — 해결)

프론트는 409를 `await response.clone().json()`으로 엿봐 `code`를 읽는다. 따라서 409는 **반드시 `NextResponse.json(...)`으로 JSON body와 `Content-Type: application/json`을 갖는다.** 빈 body 409(`new NextResponse(null, { status: 409 })`)는 금지이며, step 5·6 AC에 **상태코드와 별개로** "`clone().json()`이 성공하고 `code === "PDF_PASSWORD_REQUIRED"`"를 검증하는 테스트가 들어간다.

### `PDF_PASSWORD_REQUIRED`의 사용 범위 (프론트 요청 — 수락)

이 코드는 **비밀번호 사유에만** 쓴다. 다른 실패에 재사용하지 않는다. 프론트가 이 코드를 "에러 모달이 아니라 비밀번호 입력 모달을 여는 정상 흐름 신호"로 쓰기 때문이다. step 5·6 AC에 "이 문자열이 비밀번호 분기에서만 등장함"을 코드로 확인하는 항목이 있다.

---

## 1. POST /api/upload

요청 `multipart/form-data`:

| 필드 | 필수 | 설명 |
|---|---|---|
| `file` | O | CSV **또는** PDF |
| `password` | X | PDF 비밀번호. **PDF가 아니면 무시된다** |

### 파일 종류 판별 규칙 (upload/analyze 공통)

확장자/MIME만으로 판정하지 않는다. **매직바이트가 1차 기준**이다.

| # | 조건 | 처리 |
|---|---|---|
| 1 | `isPdfBuffer(buffer) === true` (`src/services/pdf-parser`, `%PDF-` 매직바이트) | **PDF 경로** (확장자가 `.csv`여도 PDF로 처리) |
| 2 | `isPdfBuffer === false` + `claimsPdf(file) === true` (파일명 `.pdf` 또는 MIME `application/pdf`) | `422 UNSUPPORTED_PDF_FORMAT` — `parseCsv`에 절대 넘기지 않는다 |
| 3 | 그 외 | **CSV 경로** (기존 동작) |

### 성공(200) — CSV: 기존과 완전히 동일 (`pdfColumnSchema` 키 **없음**)

```json
{
  "mapping": { "date": "거래일시", "merchant": "가맹점명", "amount": "이용금액", "category": "업종", "confidence": 0.92 },
  "sample": {
    "headers": ["거래일시", "가맹점명", "이용금액", "업종", "카드번호"],
    "rows": [{ "거래일시": "2026-06-01", "가맹점명": "스타벅스", "이용금액": "5500", "업종": "카페", "카드번호": "************3456" }],
    "excludedColumns": ["이름", "전화번호"],
    "maskedColumns": ["카드번호"]
  }
}
```

### 성공(200) — PDF: 기존 응답 + `pdfColumnSchema`

```json
{
  "mapping": { "date": "이용일", "merchant": "가맹점", "amount": "청구금액", "category": "구분", "confidence": 1 },
  "sample": {
    "headers": ["이용일", "가맹점", "청구금액", "구분"],
    "rows": [
      { "이용일": "2026-06-13", "가맹점": "이마트24 부산초량점", "청구금액": "4447", "구분": "일시불" },
      { "이용일": "2026-03-20", "가맹점": "네이버페이_인프런", "청구금액": "23375", "구분": "할부" }
    ],
    "excludedColumns": [],
    "maskedColumns": []
  },
  "pdfColumnSchema": { "…": "core-services가 확정한 PdfColumnSchema (클러스터 → 컬럼 의미 매핑)" }
}
```

프론트가 알아야 할 점:
- **`mapping`은 PDF일 때 항상 위 고정값이고 `confidence: 1`이다.** INV-1이 파서 헤더를 `["이용일","가맹점","청구금액","구분"]`으로 고정했으므로 라우트가 LLM 컬럼 매핑 추론(`inferColumnMapping`)을 호출하지 않는다. → `confidence < 0.7`일 때 뜨는 "확신도 낮음" 경고 배너는 PDF에서 절대 뜨지 않는다.
- **`excludedColumns`/`maskedColumns`가 빈 배열인 것은 정상이다.** PDF 파서 헤더에는 이름·주소·계좌·카드번호 컬럼이 애초에 존재하지 않는다(INV-1). 프론트의 "○○는 전송되지 않았어요 / 뒤 4자리만 남겼어요" 안내는 PDF에서 아무것도 렌더되지 않으므로, 대신 **"이번 달 청구액 기준"(D2) 안내**를 보여주는 것이 step 8의 몫이다.
- **`청구금액`은 "이번 달 청구액"이다**(D2). 할부 건은 원 이용금액이 아니라 이번 달 청구분만 들어간다(실측: `03/20 네이버페이_인프런`은 140,252이 아니라 **23,375**). 명세서 `합계` 행과 일치한다.
- **`pdfColumnSchema`는 객체로 반환된다.** analyze에 보낼 때 프론트가 `JSON.stringify`한다. 내용을 읽거나 변형하지 말고 **불투명한 값으로 왕복만** 시킨다. PII가 아닌 구조 메타데이터(클러스터 → 컬럼 의미 매핑)라 왕복이 안전하다.

### 에러

```json
401 { "code": "UNAUTHORIZED" }
400 { "code": "BAD_REQUEST" }                                          // file 없음/빈 파일
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }            // 암호화 PDF, 비밀번호 미제공
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }          // 암호화 PDF, 비밀번호 불일치
422 { "code": "UNSUPPORTED_PDF_FORMAT" }                                // 레이아웃 해석 실패/스캔 PDF/헤더 없음
```

---

## 2. POST /api/analyze

요청 `multipart/form-data`:

| 필드 | 필수 | 설명 |
|---|---|---|
| `file` | O | upload에 올린 것과 **동일 파일** (서버가 재파싱한다) |
| `mapping` | O | JSON 문자열 `ConfirmedMapping = { date, merchant, amount, category }` (`category`는 `null` 허용) — 기존과 동일 |
| `password` | PDF가 암호화된 경우 O | 재파싱에 필요. **PDF가 아니면 무시** |
| `pdfColumnSchema` | **PDF일 때 필수** | JSON 문자열. upload가 반환한 객체를 `JSON.stringify`해서 그대로 되돌려보낸다 |

### 성공(200) — PDF/CSV 동일, 기존과 완전히 동일

```json
{
  "analysisId": "b3f1c2a4-...-uuid",
  "freeSummary": {
    "totalSpent": 882646,
    "transactionCount": 34,
    "categoryTotals": { "일시불": 812271, "할부": 23375, "연회비": 6000, "해외": 36719, "기타": 4281 },
    "topMerchants": [{ "merchant": "아파트관리비", "amount": 246090 }]
  }
}
```

`pdfColumnSchema`를 되돌려주지 않는다. (위 `freeSummary` 숫자는 실측 골든값 기준의 예시 형태이며 카테고리 분해는 픽스처에 따라 달라진다. 확정된 것은 **합계가 명세서 `합계` 행과 일치한다**는 점이다.)

### 에러

```json
401 { "code": "UNAUTHORIZED" }
400 { "code": "BAD_REQUEST" }                                            // file/mapping 누락·형식오류 (기존, reason 없음)
400 { "code": "BAD_REQUEST", "reason": "pdf_schema_missing" }             // PDF인데 pdfColumnSchema 누락·형식오류
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "missing" }
409 { "code": "PDF_PASSWORD_REQUIRED", "reason": "incorrect" }
422 { "code": "UNSUPPORTED_PDF_FORMAT" }
```

**검증 순서 (라우트 불변식):** 세션 → formData → file/mapping → 파일 종류 판별 → (PDF면) `pdfColumnSchema` 검증 → 재파싱. 따라서 `pdfColumnSchema`가 없으면 파일이 암호화됐어도 **409가 아니라 400**이 나간다.

### `pdfColumnSchema` 누락에 전용 `code`를 만들지 않은 이유 (프론트 리스크 2에 대한 답)

scope가 "PDF인데 `pdfColumnSchema`가 없으면 `400 BAD_REQUEST`"로 확정했으므로 **HTTP 상태와 `code`는 그대로 둔다.** 대신 **가산적(additive) `reason: "pdf_schema_missing"`** 을 이 한 케이스에만 붙였다.

- **새 `code`를 만들지 않은 이유:** `PDF_SCHEMA_REQUIRED` 같은 코드를 도입하면 (a) scope 계약 위반, (b) 프론트가 분기해야 하는 `code` 집합이 늘고 `useApiError`/step 7~8 계획을 다시 수정해야 한다.
- **`reason`을 붙인 이유:** 기존 400 문구("파일을 읽지 못했어요. 형식을 확인해 주세요")는 **파일에 문제가 없는데 파일을 탓해** 사용자가 다른 파일로 반복 실패하게 만든다. `reason`이 있으면 프론트가 "분석 정보가 만료됐어요. 파일을 다시 올려주세요" 같은 원인에 맞는 문구를 줄 수 있다.
- **프론트 영향 없음(선택 사용):** `code`만 보는 현재 구현은 그대로 동작한다. step 8에서 문구를 개선하고 싶으면 `reason`을 참조하면 되고, 안 해도 계약 위반이 아니다.
- 기존 400(file/mapping 오류)에는 `reason`을 **붙이지 않는다** — 기존 응답 shape을 바꾸면 INV-5(무회귀)에 걸리고 기존 테스트의 `toEqual({ code: "BAD_REQUEST" })` 단정이 깨진다.

---

## 3. 프론트가 반드시 지켜야 할 것 (step 7~8 필수 반영)

1. **`password`를 메모리에만 유지하고 analyze까지 전달한다.** upload에서 409를 받아 비밀번호를 입력받았다면, analyze 요청에도 **같은 비밀번호를 다시 보내야 한다**(서버가 파일을 재파싱하므로). 이 값을 `localStorage`/`sessionStorage`/URL/쿼리스트링/로그에 넣지 않는다.
2. **`pdfColumnSchema`를 상태로 보관해 analyze에 그대로 전달한다.** 누락하면 400 BAD_REQUEST다. 내용을 수정·정규화하지 않는다(INV-2: 값이 변형되면 저장되는 금액이 화면에서 본 금액과 어긋난다).
3. **409의 `reason`으로 문구를 분기한다 — 분류 필드가 확정됐으므로 클라이언트 추론 폴백은 필요 없다.**
   - `"missing"` → "이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요."
   - `"incorrect"` → "비밀번호가 맞지 않아요. 다시 입력해 주세요."
   - `03_frontend_pdf-notes.md`의 폴백(②"요청에 password를 담았는가")은 **더 이상 필요하지 않다.** 서버가 `reason`을 항상 채워 보낸다(판별 값이 없는 예외 상황에도 `hadPassword`로 서버가 폴백 판정해 반드시 둘 중 하나를 채운다). 방어적으로 남겨도 무해하지만, 1순위는 항상 `reason`이다.
4. **`useApiError`의 `ERROR_MESSAGES`에 `UNSUPPORTED_PDF_FORMAT`을 추가해야 한다.** 현재는 `PAYWALL_REQUIRED`/`NOT_FOUND`/`GENERATION_FAILED`/`BAD_REQUEST`만 있어 신규 코드가 기본 문구("문제가 발생했어요")로 떨어진다. `PDF_PASSWORD_REQUIRED`는 **에러가 아니라 정상 흐름**이므로 `ERROR_MESSAGES`에 넣지 말고 `useApiError` 도달 **전에** 분기해 비밀번호 입력 모달로 보낸다(step 7~8 계획과 일치).
5. **`BAD_REQUEST` 문구가 현재 "CSV 형식을 확인해 주세요"로 CSV 전용이다.** PDF도 받게 되므로 문구를 파일 포맷 중립적으로 바꾼다.
6. **드롭존/파일 input의 `accept`를 `.csv,text/csv`에서 PDF 포함으로 확장한다.** 단 서버는 확장자를 신뢰하지 않으므로 `accept`는 UX 힌트일 뿐이다.

---

## 4. qa 검증 포인트 (실행 후 코드 대조용)

- `src/app/api/{upload,analyze}/route.ts`의 실제 `NextResponse.json()` 호출이 위 표의 status/body와 1:1 대응하는지.
- 위 "에러 body 키 규약" 표대로 키가 정확한지. 어떤 에러 body에도 예외 `message`/`stack`이 없는지.
- **409에 JSON body가 실재하는지** — 상태코드만 검증하는 테스트로는 부족하다. `clone().json()`이 성공하고 `code`가 읽히는 단정이 `route.test.ts`에 실제로 있는지 확인한다(없으면 프론트 비밀번호 흐름이 런타임에 조용히 막힌다).
- **`password`를 upload·analyze 양쪽이 모두 받는지** — 한쪽만 받으면 사용자가 매핑 확인 후 영구히 막힌다. 두 `route.test.ts`에 각각 `password` 전달 단정이 있는지 대조한다.
- `PDF_PASSWORD_REQUIRED`가 비밀번호 사유 외에 쓰이지 않는지(grep).
- PDF 경로 진입 조건이 **매직바이트 판정**뿐인지(확장자/MIME 단독 판정 경로 없음).
- **INV-2**: analyze 처리 중 LLM 컬럼 의미 판정 함수가 호출되지 않는지 (`route.test.ts`에 모킹 기반 `toHaveBeenCalledTimes(0)` 단정이 실제로 존재하는지). 추가로 `src/services/llm/provider`의 `generateAnalysisText`가 PDF analyze 경로에서 0회 호출인지.
- **INV-4**: 두 라우트에 `console.*`, `fs`/`node:fs`, `tmpdir`, `writeFile`, `storage`가 없는지. 비밀번호가 응답 body·로그·`insertAnalysis` 인자에 없는지(테스트 단정 존재 여부까지 확인).
- **INV-5**: 기존 upload/analyze 테스트가 단정이 약화되지 않은 채 통과하는지. CSV 성공 응답의 전체 객체 동등 비교가 유지돼 `pdfColumnSchema` 키 부재가 보장되는지.
- 두 라우트가 판별/에러 매핑을 각자 구현하지 않고 `src/lib/file-type.ts`·`src/lib/pdf-error.ts`를 공유하는지.
- 라우트가 `pdfjs-dist`를 직접 import하지 않고 `src/services/pdf-parser`만 경유하는지.
