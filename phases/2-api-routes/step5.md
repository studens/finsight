# Step 5: GET /api/reports/[analysisId]/[reportType] — Premium 지연 생성 + 페이월 게이팅

## 작업
`src/app/api/reports/[analysisId]/[reportType]/route.ts`에 `GET` 핸들러를 TDD로 구현한다. 이 라우트는 finsight의 핵심 비즈니스 규칙(소유권·페이월·지연 생성·에러 계약)이 모두 모이는 지점이다. **테스트를 먼저 작성**한다.

경로 파라미터: `analysisId`(uuid), `reportType`(`ReportType` 리터럴 중 하나).

### 처리 순서 — 이 순서를 반드시 지킨다 (api-route-conventions: 확인 → 캐시 → 생성)
1. `getSessionUser()` — 없으면 `401 { code: "UNAUTHORIZED" }`.
2. `reportType`이 유효한 `ReportType`(`mom_comparison`|`anomaly_detection`|`savings_suggestions`|`budget_recommendation`)인지 검증. 아니면 `404 { code: "NOT_FOUND" }`(잘못된 타입은 존재하지 않는 리소스로 취급, 내부 정보 미노출).
3. **소유권 확인:** `getAnalysisById(analysisId)`(RLS 적용 읽기). `null`이거나 `analysis.user_id !== user.id`이면 `404 { code: "NOT_FOUND" }`. (RLS로 남의 레코드는 애초에 `null` — "존재하지만 남의 것"이라는 정보를 노출하지 않도록 404로 통일.)
4. **구독 확인(페이월):** `getSubscriptionStatus(user.id)`. `'active'`가 아니면 **여기서 즉시** `403 { code: "PAYWALL_REQUIRED" }` 반환. 이 지점 이후의 캐시 조회·llm 생성은 실행되지 않는다.
5. **캐시 확인:** `analysis.premium_reports?.[reportType]`가 존재하면 즉시 `200 { reportType, data: <캐시값> }` 반환(llm 호출 없음).
6. **지연 생성:** 캐시가 없으면 llm으로 생성한다.
   - `reportType === 'mom_comparison'`이면 `getPreviousAnalysis(user.id, analysis.created_at)`로 직전 레코드(`previous`)를 조회(없으면 `null`).
   - `current`는 `getAnalysisById` 결과를 `AnalysisRecord`(`{ id, createdAt, maskedTransactions, freeSummary }`)로 매핑.
   - `generateReport({ reportType, current, previous })` 호출. **throw되면** `502 { code: "GENERATION_FAILED" }`.
   - 성공 시 `upsertPremiumReport({ userId: user.id, analysisId, reportType, report })`로 캐시.
   - `200 { reportType, data: report }` 반환.

### 순서가 왜 중요한가 (구멍 방지)
- **4번(구독)이 5번(캐시)보다 먼저다.** 순서를 바꾸면, 과거에 한 번 생성된 캐시를 미구독 사용자가 볼 수 있는 구멍이 생긴다. 구독 확인이 항상 먼저다.
- **미구독이면 llm 생성 함수(`generateReport`)가 절대 호출되지 않는다.** 4번에서 종료되므로 6번에 도달하지 않는다.

계약 인용:
- (core-services) `generateReport(input: { reportType: ReportType; current: AnalysisRecord; previous: AnalysisRecord | null }): Promise<PremiumReport>`. `previous`는 `mom_comparison`에서만 사용. llm 함수는 구독 여부를 확인하지 않는다 — 게이팅은 이 라우트 책임.
- (db-schema) 게이팅 판정 = `subscriptions`에 본인 `status='active'` 행 존재 여부. `premium_reports` jsonb 키 = `ReportType` 리터럴과 정확히 일치. 캐시 갱신은 service-role upsert(step 2 `upsertPremiumReport`, 소유권 검증 포함).

### 에러 코드 계약 (frontend가 그대로 분기)
| 상황 | HTTP | code |
|---|---|---|
| 세션 없음 | 401 | `UNAUTHORIZED` |
| 리소스 없음 / 소유권 불일치 / 잘못된 reportType | 404 | `NOT_FOUND` |
| 미구독 사용자의 Premium 요청 | 403 | `PAYWALL_REQUIRED` |
| llm 생성 실패 | 502 | `GENERATION_FAILED` |

## Acceptance Criteria
- [ ] (페이월 순서 CRITICAL) 미구독(`getSubscriptionStatus`가 `'inactive'`) 사용자가 본인 소유 `analysisId`로 요청하면, **`generateReport`가 호출되지 않고** 캐시 조회도 하지 않으며 `403 { code: "PAYWALL_REQUIRED" }`가 즉시 반환되는 테스트가 통과한다(구독 확인이 캐시 조회보다 먼저임을 mock 호출 순서/미호출로 검증).
- [ ] (소유권 CRITICAL) 다른 사용자의 `analysisId`(또는 존재하지 않는 id) 요청 시 `getAnalysisById`가 `null`/불일치를 반환하고 `404 { code: "NOT_FOUND" }`가 반환되며, 구독 확인·llm 생성이 실행되지 않는 테스트가 통과한다.
- [ ] (지연 생성) 구독 사용자 + 캐시 없음이면 `generateReport`가 호출되고 결과가 `upsertPremiumReport`로 캐시된 뒤 `200 { reportType, data }`가 반환되는 테스트가 통과한다.
- [ ] (캐시 히트 시 llm 미호출) 구독 사용자 + `premium_reports[reportType]` 존재 시 `generateReport`가 호출되지 않고 캐시값이 `200 { reportType, data }`로 반환되는 테스트가 통과한다.
- [ ] (전월 대비) `reportType='mom_comparison'` + 캐시 없음일 때 `getPreviousAnalysis`로 `previous`를 조회해 `generateReport`의 `previous` 인자로 넘기고, 직전 레코드가 없으면 `null`을 넘기는 테스트가 통과한다.
- [ ] (생성 실패) `generateReport`가 throw하면 `upsertPremiumReport`를 호출하지 않고 `502 { code: "GENERATION_FAILED" }`를 반환하는 테스트가 통과한다.
- [ ] 잘못된 `reportType`(예: `foo`) 요청 시 소유권/구독 조회 전에 `404 { code: "NOT_FOUND" }`를 반환하는 테스트가 통과한다.
- [ ] (에러 코드 정확성) 403/404/502 응답이 각각 정확한 HTTP 상태와 `code`(`PAYWALL_REQUIRED`/`NOT_FOUND`/`GENERATION_FAILED`)를 `NextResponse.json`으로 반환함을 확인한다.
- [ ] (서비스 경유 CRITICAL) 라우트가 `lib/supabase/service.ts`를 직접 import하지 않고, 쓰기는 `services/supabase-admin`, 읽기는 `lib/supabase/server.ts`, llm은 `services/llm`을 경유함을 확인한다.
