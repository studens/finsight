# api-routes 확정 계약 (phase 2-api-routes)

> frontend planner / qa가 참조하는 **엔드포인트 요청/응답 shape 계약**이다.
> 계획 파일: `phases/2-api-routes/`. 의존 계약: db-schema `_workspace/02_db-schema_schema.md`, core-services `_workspace/02_core-services_interface.md`.

## 공통 에러 코드 계약

| 상황 | HTTP | body |
|---|---|---|
| 세션 없음(비로그인) | 401 | `{ "code": "UNAUTHORIZED" }` |
| 잘못된 요청(파일/필드 누락·형식오류) | 400 | `{ "code": "BAD_REQUEST" }` |
| 리소스 없음 / 소유권 불일치 / 잘못된 reportType | 404 | `{ "code": "NOT_FOUND" }` |
| 미구독 사용자의 Premium 요청 | 403 | `{ "code": "PAYWALL_REQUIRED" }` |
| llm 생성 실패 | 502 | `{ "code": "GENERATION_FAILED" }` |

frontend는 이 `code`로 분기해 세 케이스(403/404/502)를 동일한 에러 모달로 부드럽게 처리한다(ARCHITECTURE flow 5, `ui-design` 스킬). 401은 페이지에서 미들웨어가 이미 `/login`으로 보내므로 API 401은 방어적 케이스.

---

## POST /api/upload
CSV를 메모리에서 파싱·마스킹하고 컬럼 매핑을 추론해 반환. **DB 쓰기 없음.**

요청: `multipart/form-data`
- `file`: CSV 파일

성공(200):
```json
{
  "mapping": {
    "date": "거래일시",
    "merchant": "가맹점명",
    "amount": "이용금액",
    "category": "업종",
    "confidence": 0.92
  },
  "sample": {
    "headers": ["거래일시", "가맹점명", "이용금액", "업종", "카드번호"],
    "rows": [
      { "거래일시": "2026-06-01", "가맹점명": "스타벅스", "이용금액": "5500", "업종": "카페", "카드번호": "************3456" }
    ],
    "excludedColumns": ["이름", "전화번호"],
    "maskedColumns": ["카드번호"]
  }
}
```
- `mapping`은 core-services `ColumnMapping`. `sample`은 프론트 매핑 확인 UI용 **마스킹된** 미리보기(앞 N행).
- 에러: 401 `UNAUTHORIZED`(세션 없음), 400 `BAD_REQUEST`(파일 없음/파싱 불가).

---

## POST /api/analyze
확정 매핑으로 Free 요약을 생성·저장. **Premium은 생성하지 않음(지연 생성).**

> 설계 주의: 서버가 원본 파일을 다시 받아 `parseCsv → maskPii`를 재실행한다. `MaskedRow` 브랜드는 `maskPii`만 부여할 수 있으므로(core-services 타입 불변식), 클라이언트가 보낸 "마스킹된 데이터"를 신뢰하지 않는다. 그래서 요청 필드가 "마스킹 데이터"가 아니라 `file`이다.

요청: `multipart/form-data`
- `file`: CSV 파일(upload에 올린 것과 동일 파일)
- `mapping`: JSON 문자열 — `ConfirmedMapping = { date, merchant, amount, category }` (`category`는 `null` 허용)

성공(200):
```json
{
  "analysisId": "b3f1c2a4-...-uuid",
  "freeSummary": {
    "totalSpent": 1250000,
    "transactionCount": 84,
    "categoryTotals": { "카페": 45000, "식비": 320000 },
    "topMerchants": [ { "merchant": "스타벅스", "amount": 45000 } ]
  }
}
```
- `freeSummary`는 core-services `FreeSummary`, `analyses.free_summary`에 그대로 저장.
- `analysisId`는 이후 Premium 리포트 조회 경로에 사용.
- 에러: 401 `UNAUTHORIZED`, 400 `BAD_REQUEST`(file/mapping 누락·형식오류).

---

## GET /api/reports/:analysisId/:reportType
Premium 리포트 지연 생성/조회. **게이팅 순서: 소유권 → 구독 → 캐시 → 생성.**

경로 파라미터:
- `analysisId`: uuid
- `reportType`: `mom_comparison` | `anomaly_detection` | `savings_suggestions` | `budget_recommendation` (core-services `ReportType`, `premium_reports` jsonb 키와 일치)

성공(200):
```json
{ "reportType": "mom_comparison", "data": { /* PremiumReport — 리포트 타입별 구체 필드 */ } }
```
에러:
```json
401 { "code": "UNAUTHORIZED" }        // 세션 없음
404 { "code": "NOT_FOUND" }           // 없음/소유권 불일치/잘못된 reportType
403 { "code": "PAYWALL_REQUIRED" }    // 미구독 — llm 생성/캐시 조회 없이 즉시
502 { "code": "GENERATION_FAILED" }   // llm 생성 실패
```
불변식(qa 검증 포인트):
- 미구독 사용자에겐 `generateReport`가 호출되지 않고 캐시도 노출되지 않는다(구독 확인이 캐시 조회보다 먼저).
- 캐시 히트 시 llm 호출 없음.
- 캐시 갱신은 service-role upsert, 쓰기 전 `analysisId` 소유권(`user_id`) 직접 검증.

---

## POST /api/webhooks/polar (이번 phase 범위 밖 — 스텁)
```json
501 { "code": "NOT_IMPLEMENTED" }
```
- 서명 검증·구독 갱신은 `polar-billing` phase에서 구현. 이번 phase 스텁은 어떤 DB 쓰기/구독 갱신도 하지 않는다.

---

## 읽기/쓰기 경계 (라우트 공통)
- 읽기: `lib/supabase/server.ts`(세션 기반 RLS) — `getSessionUser`, `getAnalysisById`, `getSubscriptionStatus`, `getPreviousAnalysis`, `listUserAnalyses`.
  - `listUserAnalyses(): Promise<{ id, createdAt, freeSummary }[]>` — 본인 소유 analyses 목록(`created_at desc`, RLS 적용). 대시보드 이력 목록(Server Component)이 별도 API 라우트 없이 직접 호출. `masked_transactions`/`premium_reports`는 미포함.
- 쓰기: `services/supabase-admin`(service-role, 소유권 직접 검증) — `insertAnalysis`, `upsertPremiumReport`. 라우트가 `lib/supabase/service.ts`를 직접 import하지 않는다.
- 외부 API(Claude/Supabase)는 `services/*` 경유로만 호출.
