# Step 6: UploadFlow — 드롭존 → 컬럼 매핑 확인 → analyze (원본 File 유지)

## 작업
`src/components/UploadFlow.tsx`를 **Client Component**로 만든다. 대시보드의 핵심 인터랙션이다. props: `{ isSubscribed: boolean }`. 3개 내부 상태를 순서대로 거친다: `idle(드롭존)` → `confirming(매핑 확인 폼)` → `done(결과)`.

### 설계상 가장 중요한 지점 — 원본 File을 브라우저 메모리에 유지
ARCHITECTURE flow 1·2 최신 버전에 따라, **`/api/analyze`는 마스킹된 데이터가 아니라 사용자가 확인한 원본 CSV 파일을 다시 받는다**(서버가 마스킹을 재실행하기 위함, 보안상 이유). 따라서:
- 1단계에서 사용자가 올린 원본 `File` 객체를 컴포넌트 `useState`(브라우저 메모리)에 **계속 들고 있는다.**
- 2단계(매핑 확인)에서 사용자가 확인을 누르면, 그 **동일한 원본 File**을 `/api/analyze`에 다시 `multipart/form-data`로 전송한다.
- 서버로 "마스킹된 데이터"나 파싱 결과를 보내지 않는다. 클라이언트가 마스킹을 수행하지도 않는다(마스킹은 서버 책임).

### 1단계: 드롭존 (idle)
- CSV 파일 드래그&드롭 + 파일 선택 버튼. 선택 즉시 `POST /api/upload`(`multipart/form-data`, 필드 `file`) 호출.
- 계약(api-routes `_workspace/03_api-routes_contract.md`) 응답 200:
```json
{
  "mapping": { "date": "거래일시", "merchant": "가맹점명", "amount": "이용금액", "category": "업종", "confidence": 0.92 },
  "sample": {
    "headers": ["거래일시","가맹점명","이용금액","업종","카드번호"],
    "rows": [ { "거래일시":"2026-06-01","가맹점명":"스타벅스","이용금액":"5500","업종":"카페","카드번호":"************3456" } ],
    "excludedColumns": ["이름","전화번호"],
    "maskedColumns": ["카드번호"]
  }
}
```
- `mapping`(ColumnMapping)·`sample`을 상태에 저장하고 `confirming`으로 전환. 원본 `File`도 상태 유지.
- 400 `BAD_REQUEST` 등 실패는 step 1 `ErrorModal`로 통일 표시(코드 미노출).

### 2단계: 컬럼 매핑 확인 폼 (confirming)
- `sample.rows`(이미 **마스킹된** 미리보기 — 카드번호는 `************3456`처럼 뒤 4자리만)를 표로 보여준다. 원본 값은 클라이언트에 애초에 오지 않는다.
- 4개 필드 매핑을 사용자가 확인/수정: `date`, `merchant`, `amount`, `category`. 각 필드는 `sample.headers`에서 선택하는 셀렉트. `confidence`가 낮으면(예: < 0.7) 확인을 유도하는 안내 문구 표시.
- `excludedColumns`(이름·전화 등 제외됨), `maskedColumns`(마스킹된 컬럼)를 사용자에게 안내로 노출("이름·전화번호는 전송되지 않았어요", "카드번호는 뒤 4자리만 남겼어요").
- 확인 버튼 클릭 → `POST /api/analyze` 호출:
  - `multipart/form-data`, 필드 `file`(**1단계에서 보관한 원본 File**) + `mapping`(JSON 문자열, `ConfirmedMapping = { date, merchant, amount, category }`, `category`는 `null` 허용).
- 계약 응답 200:
```json
{ "analysisId": "b3f1c2a4-...-uuid", "freeSummary": { "totalSpent": 1250000, "transactionCount": 84, "categoryTotals": { "카페": 45000 }, "topMerchants": [ { "merchant": "스타벅스", "amount": 45000 } ] } }
```
- 실패는 `ErrorModal`로 통일 표시.

### 3단계: 결과 (done)
- `FreeSummaryCards`(step 4)에 `freeSummary`를 넘겨 렌더.
- `PremiumSection`(step 5)에 `{ analysisId, isSubscribed }`를 넘겨 렌더(미구독이면 잠금 CTA).
- 결과 전환에 `slide-up`(0.5s) 사용 가능.

스타일(ui-design 값 그대로):
- 드롭존/폼 카드 `rounded-[24px] bg-[#16181c] p-8`. 셀렉트/입력 `rounded-xl bg-[#16181c] border border-[#2a2d33] px-4 py-3 text-white`.
- 확인 버튼 Primary(`h-14 px-8 rounded-full bg-[#0052ff]`), 취소/다시올리기 Secondary. 콘텐츠 폭 `max-w-5xl`, 좌측 정렬.
- 업로드/분석 진행 상태는 정적 표시 또는 `fade-in`만. 글로우/무한 애니메이션 금지.

CRITICAL:
- 컴포넌트는 Claude/Supabase/Polar를 직접 호출하지 않는다. 오직 `fetch('/api/upload')`, `fetch('/api/analyze')`만 사용한다.
- 원본 File은 브라우저 메모리(useState)에서만 다루고 `/api/analyze` 전송 외의 용도로 저장/업로드하지 않는다. `localStorage`/`sessionStorage`/IndexedDB 등에 원본 CSV를 저장하지 않는다.
- 서버로 "마스킹된 데이터"를 보내지 않는다(마스킹 재실행은 서버 책임) — analyze 요청 본문은 원본 `file` + 확정 `mapping`뿐이다.

## Acceptance Criteria
- [ ] 파일 선택 시 `POST /api/upload`(field `file`)가 호출되고, 200 응답의 `mapping`/`sample`로 매핑 확인 폼(`confirming`)이 렌더됨을 Vitest+RTL 테스트로 확인한다.
- [ ] (원본 File 유지 — 핵심) 확인 버튼 클릭 시 `POST /api/analyze`의 `FormData`에 **1단계에서 업로드한 것과 동일한 원본 File 객체**와 `mapping` JSON(`{date,merchant,amount,category}`)이 담겨 전송됨을 테스트로 확인한다(analyze 요청에 마스킹 데이터·파싱 결과 JSON을 보내지 않는다).
- [ ] analyze 200 응답의 `analysisId`·`freeSummary`로 `FreeSummaryCards`와 `PremiumSection`(analysisId, isSubscribed 전달)이 렌더됨을 확인한다.
- [ ] 매핑 확인 폼이 `sample.rows`의 **마스킹된** 값을 그대로 보여주고, `excludedColumns`/`maskedColumns` 안내가 노출됨을 확인한다.
- [ ] upload/analyze 실패(400 등)가 코드 노출 없이 step 1 `ErrorModal`로 통일 표시되고 페이지 이동이 없음을 확인한다.
- [ ] (CRITICAL grep) 컴포넌트가 `fetch('/api/upload')`·`fetch('/api/analyze')`만 호출하고 Claude/Supabase/Polar SDK나 `services/*`를 import하지 않으며, 원본 CSV를 `localStorage`/`sessionStorage`/IndexedDB에 저장하는 코드가 없음을 확인한다.
- [ ] 폼 입력은 `rounded-xl`, 카드는 `rounded-[24px]`, 버튼은 `rounded-full`로 반경이 구분됨을 확인한다.
