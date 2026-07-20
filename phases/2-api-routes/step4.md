# Step 4: POST /api/analyze — Free 요약 생성/저장

## 작업
`src/app/api/analyze/route.ts`에 `POST` 핸들러를 TDD로 구현한다. 확정된 컬럼 매핑으로 **Free 요약만** 생성해 `analyses`에 저장한다. Premium은 이 시점에 절대 생성하지 않는다(지연 생성). **테스트를 먼저 작성**한다.

### 설계 결정 (중요 — ARCHITECTURE flow 2 문구 대비 정정)
ARCHITECTURE.md flow 2는 analyze가 "마스킹된 데이터"를 클라이언트에서 받는다고 표현하지만, core-services 확정 타입 계약(`_workspace/02_core-services_interface.md` line 39)상 **`MaskedRow` 브랜드는 오직 `maskPii`만 부여**하며 llm 함수는 브랜드된 `MaskedRow[]`만 받는다. 따라서 클라이언트가 보낸 JSON을 신뢰해 브랜딩하는 경로는 타입상 존재할 수 없고, 존재한다면 `maskPii`를 거치지 않은 값이 llm으로 가는 CRITICAL 위반이 된다.

**결론:** analyze는 **원본 파일을 다시 받아** 서버에서 `parseCsv → maskPii`를 재실행하고, 그 출력(`MaskedRow[]`)으로만 `generateFreeSummary`를 호출·저장한다. 클라이언트가 보낸 "마스킹된 데이터"를 신뢰하지 않는다. 파일은 요청 처리 중 메모리에서만 다루고 응답 후 폐기한다.

요청: `multipart/form-data`, 필드 `file`(CSV) + 필드 `mapping`(JSON 문자열, `ConfirmedMapping`).

처리 순서:
1. `getSessionUser()` — 없으면 `401 { code: "UNAUTHORIZED" }`.
2. `file`/`mapping` 파싱. 누락·형식오류면 `400 { code: "BAD_REQUEST" }`. `mapping`은 `ConfirmedMapping = { date, merchant, amount, category }`로 검증(필수 필드 존재).
3. `parseCsv(buffer)` → `maskPii(parsed)` → `MaskedDataset`.
4. `generateFreeSummary({ rows: masked.rows, mapping })` → `FreeSummary`.
5. `insertAnalysis({ userId: user.id, maskedTransactions: masked.rows, freeSummary })` → `{ id }`.
6. 응답 `200`: `{ analysisId, freeSummary }`.

계약 인용 (core-services):
- `generateFreeSummary(input: { rows: MaskedRow[]; mapping: ConfirmedMapping }): Promise<FreeSummary>`.
- `ConfirmedMapping = { date: string; merchant: string; amount: string; category: string|null }`.
- `FreeSummary = { totalSpent, transactionCount, categoryTotals, topMerchants }` — `analyses.free_summary` jsonb에 그대로 저장.

계약 인용 (db-schema): 저장은 step 2 `insertAnalysis`(service-role, `user_id = user.id`)를 통해서만. `masked_transactions`/`free_summary`만 저장, 원본 저장 금지.

CRITICAL 규칙 (이 step에서 반드시 지킴):
- Premium 인사이트는 Free 사용자에 대해 애초에 생성하지 않는다 — 이 라우트는 `generateReport`/Premium llm 함수를 **호출하지 않는다**. 업로드 시점엔 Free 요약만 계산/저장.
- 카드/계좌는 `maskPii`를 거친 뒤에만 llm(`generateFreeSummary`)에 전달. 원본은 응답 후 폐기.
- DB 쓰기는 `services/supabase-admin`(service-role) 경유로만, `user_id`는 인증된 세션값 사용.

## Acceptance Criteria
- [ ] 인증 + 유효한 `file`/`mapping` 요청이 `generateFreeSummary` → `insertAnalysis` 순으로 호출하고 `200 { analysisId, freeSummary }`를 반환하는 테스트가 통과한다.
- [ ] (Premium 미생성 CRITICAL) 이 라우트 실행 중 Premium 리포트 생성 함수(`generateReport`/`generateMomComparison` 등)가 **한 번도 호출되지 않음**을 확인하는 테스트가 통과한다.
- [ ] (파이프라인/타입 경계 CRITICAL) `generateFreeSummary`에 전달되는 `rows`가 서버의 `maskPii` 출력(`MaskedRow[]`)이며, 클라이언트가 보낸 원본/임의 JSON을 브랜딩해 llm이나 DB로 넘기는 경로가 없음을 확인하는 테스트가 통과한다.
- [ ] `insertAnalysis` 호출 시 `userId`가 클라이언트 입력이 아니라 `getSessionUser()`가 반환한 세션 사용자 id로 세팅됨을 확인하는 테스트가 통과한다.
- [ ] 세션 없음 → `401 { code: "UNAUTHORIZED" }`, `file`/`mapping` 누락·형식오류 → `400 { code: "BAD_REQUEST" }` 테스트가 통과한다.
- [ ] (원본 미보관 CRITICAL) 라우트 코드에 원본 CSV를 디스크·Storage·로그에 남기는 호출이 없음을 grep으로 확인한다. DB에는 `insertAnalysis`를 통해 마스킹 요약만 저장된다.
