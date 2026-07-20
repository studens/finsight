# QA 계획 검증 리포트 (Codex 실행 전)

> 검증 시점: 2026-07-20 · 검증자: qa 에이전트
> 대상: `phases/index.json` + `0-db-schema`/`1-core-services`/`2-api-routes`/`3-frontend` 전체 step + `_workspace/*` 인터페이스 문서
> 기준: `integration-qa` 스킬 "0. 계획 검증" 체크리스트, CLAUDE.md/ADR/ARCHITECTURE CRITICAL 규칙

## 종합 판정: 통과 (실행 가능) — 개선 1건 해소 완료, 미해결 0건

4개 phase 계획은 실행 가능한 수준으로 견고하다. CRITICAL 보안 규칙이 문서 참조가 아니라 관련 step의 AC에 **직접 인용된 검증 가능한 조건**으로 들어가 있고, step 순서가 실제 의존성을 반영하며, 4개 플래너 산출물의 경계면이 정확히 맞물린다. 발견된 이슈는 모두 non-blocking(보안 CRITICAL 위반 0건)이며, 그중 1건만 실행 전 수정을 요청했다.

---

## 통과 항목

### 최상위 구조
- [통과] `phases/index.json`에 4개 phase가 `0-db-schema → 1-core-services → 2-api-routes → 3-frontend` 순서로 등록됨. 이 순서는 실제 의존성(스키마→서비스→라우트→화면)과 일치.

### AC 검증 가능성
- [통과] 모든 step의 AC가 "잘 처리하라"류 모호 문장이 아니라 구체적·검증 가능한 조건으로 작성됨.
  - 예: pii-masking step2 — "카드번호 `1234-5678-9012-3456`와 `1234567890123456` 두 케이스 모두 뒤 4자리만 남고 마스킹" / "이름·전화 컬럼은 `'이름' in row === false`, `excludedColumns`에 포함".
  - 예: reports step5 — "미구독 사용자 요청 시 `generateReport`가 호출되지 않고 캐시 조회도 없이 403 즉시 반환(mock 호출 순서/미호출로 검증)".

### CRITICAL 규칙의 step AC 직접 인용 (참조만 걸어둔 곳 없음)
| CRITICAL 규칙 | 인용된 step AC |
|---|---|
| 원본 CSV 미저장 | core-services step1/step2, api-routes step3/step4, frontend step6 (localStorage/sessionStorage/IndexedDB 금지 포함) |
| PII 마스킹(카드/계좌 뒤4자리, 이름/전화 컬럼 제외) | core-services step2 (구분자 2케이스·컬럼제외 구분·모호컬럼 값패턴 매칭), db-schema step0 (PII 전용 컬럼 0개) |
| 원본값 LLM 미전달 (브랜디드 타입) | core-services step0(브랜드), step3/4/5/6(`@ts-expect-error` 테스트), api-routes step3/step4(파이프라인 순서 mock 검증) |
| service-role 키 격리 | api-routes step0/step1/step2, frontend step3/step5/step7 (grep 확인 AC) |
| 소유권 직접 검증 | api-routes step2(`upsertPremiumReport` UPDATE 전 소유권 확인, 불일치 시 write mock 미호출), step5(소유권→404) |
| Premium 지연 생성 | api-routes step4(analyze 중 Premium 함수 0회 호출), step5(구독 확인이 캐시 조회보다 먼저·미구독 시 llm 미호출), frontend step5(미구독 시 fetch 0회, 블러/더미 금지) |
| RLS SELECT-only | db-schema step0/step1(쓰기 정책 0개 명시), step2(advisors 재확인) |
| Polar 웹훅 서명 검증(이번 phase=스텁) | api-routes step6(부수효과 0, DB 쓰기 미호출) |
| 미들웨어 라우팅 | api-routes step0(양방향 리다이렉트, /api 제외) |

### step 순서(의존성 반영)
- [통과] core-services: step0(공유타입) → step1(csv-parser) → step2(pii-masking) → step3~6(llm). `csv-parser→pii-masking→llm` 실제 순서와 일치.
- [통과] api-routes: step0(middleware,독립) → step1(읽기헬퍼) → step2(쓰기헬퍼) → step3/4/5(라우트) → step6(웹훅스텁). 라우트가 쓰는 헬퍼가 먼저.
- [통과] frontend: step0(프리미티브) → step1(ErrorModal) → step2~5(개별컴포넌트) → step6(UploadFlow, step4/5 소비) → step7(대시보드 조립).
- [통과] cross-phase 타입 의존: `database.ts`(db-schema step2), `pipeline.ts`(core-services step0)가 api-routes/frontend보다 먼저 산출됨.

### 경계면 교차 대조
- [통과] (a) DB 컬럼 ↔ api-routes: `insertAnalysis`가 `user_id`/`masked_transactions`/`free_summary`만 INSERT, `getAnalysisById`가 `premium_reports` 포함 반환, `upsertPremiumReport`가 `{[reportType]: report}` 병합 — db-schema `analyses` 컬럼(snake_case)과 정확히 일치. `subscriptions.status in ('active','inactive')` ↔ `getSubscriptionStatus(): 'active'|'inactive'` 일치.
- [통과] (b) core-services 시그니처 ↔ api-routes 호출: `parseCsv`/`maskPii`/`inferColumnMapping`/`generateFreeSummary`/`generateReport`의 인자·반환 타입이 라우트 step에 정확히 인용됨. `ReportType` 리터럴 4개가 `premium_reports` jsonb 키·경로 파라미터와 삼중 일치.
- [통과] (c) api-routes 에러코드/shape ↔ frontend: 401/400/404/403/502 전부 ErrorModal(step1)이 부드러운 문구로 매핑, 코드/상태숫자 미노출. 응답 shape(`{mapping,sample}`/`{analysisId,freeSummary}`/`{reportType,data}`)이 frontend 소비부(step5/6)와 일치.
- [통과] (d) POST /api/analyze "원본 파일 재전송" 결정이 frontend에 반영: step6이 원본 `File`을 useState에 유지→2단계에서 `/api/analyze`에 재전송, 클라이언트 마스킹 없음, 스토리지 저장 금지를 AC로 명시. api-routes step4도 동일하게 서버 `parseCsv→maskPii` 재실행으로 설계. ARCHITECTURE 최신 결정과 정합.

---

## 개선 요청 (non-blocking) — 해소 완료

### [해소됨] frontend step7 `listUserAnalyses` stale 노트
- 위치: `phases/3-frontend/step7.md`, `_workspace/03_frontend_notes.md`.
- 원문제: "이 읽기 헬퍼는 api-routes 계약에 아직 명시되지 않았다 / 없으면 추가한다"는 stale 문구가 Codex의 중복 헬퍼 생성을 유발할 수 있었음.
- 수정 확인(재검증 완료):
  - step7.md 작업 지시(line 9~11): `lib/supabase/server.ts`의 기존 `listUserAnalyses(): Promise<{ id, createdAt, freeSummary }[]>`를 그대로 호출, **중복 생성 금지** 명시, shape 매핑(`freeSummary.totalSpent`/`.transactionCount` → HistoryList props) 명시.
  - step7.md AC(line 37): 기존 헬퍼 사용 + shape 매핑을 검증 조건으로 추가.
  - `03_frontend_notes.md`(line 43~45): "api-routes 의존 (해소됨)"으로 갱신, shape 매핑 명시.
- 판정: 통과. 미해결 이슈 없음.

---

## 참고 사항 (수정 불필요 — 코드 검증 단계에서 확인할 포인트)

1. **HistoryList shape 매핑**: `listUserAnalyses()` 반환 `{id,createdAt,freeSummary}[]` → HistoryList props `{id,createdAt,totalSpent,transactionCount}[]`. 대시보드 Server Component에서 `freeSummary.totalSpent`/`.transactionCount`로 매핑 필요. 명백한 변환이라 low-risk이나 AC에 한 줄 명시 권장(frontend에 함께 전달).

2. **PremiumReport 구체 필드**: core-services step0은 placeholder로 선언, step5/6에서 구체화. step5/6 AC가 "카테고리별·총액 증감 계산"을 요구하므로 Codex가 자연히 필드를 정의하게 되나, `pipeline.ts` placeholder 갱신 지시가 명시적이지 않음(low-risk). frontend step5는 `data` 필드를 제너릭하게 렌더 — 마지막 phase라 실제 타입을 읽어 처리 가능. 코드 검증 단계에서 core-services↔frontend의 PremiumReport 필드 정합 확인 예정.

3. **브랜디드 `MaskedRow` DB 재캐스트**: `getAnalysisById`/`getPreviousAnalysis`가 DB jsonb(`unknown`)를 `MaskedRow[]`/`FreeSummary`로 매핑. 브랜드는 직렬화로 소실되므로 캐스트 불가피(저장 시점에 이미 마스킹된 데이터라 불변식 유지). 위반 아님. 코드 검증 시 이 캐스트가 국소적·의도적인지(와일드카드 `any` 아님) 확인 예정.

---

## 코드 검증 대기 (Codex 실행 후 수행)
- DB↔API, API↔프론트, core-services↔api-routes, 파일경로↔링크/미들웨어 경계면 실제 코드 교차 비교.
- 보안 CRITICAL 불변식 흐름 추적(원본→LLM 경로 부재, 원본 미저장, service-role 미노출, 쓰기 단일화+소유권, Premium 지연생성).
- 각 phase 실행 직후 점진적 검증(초기 불일치의 후속 phase 전파 방지).
