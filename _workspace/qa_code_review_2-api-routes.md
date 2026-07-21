# QA 코드 검증 — 2-api-routes phase

- 대상 브랜치: `feat-api-routes`
- 검증 시각: 2026-07-20
- 결과: **전체 통과** (허용 목록 방어 실재 확인, CRITICAL 위반 없음)
- 자동 검증: `npx vitest run` → 19 파일 / 74 테스트 전부 통과. `npx tsc --noEmit` → exit 0.

## 핵심 확인 — 매핑 허용 목록 방어 (step4)

**반영됨.** `src/app/api/analyze/route.ts:44-62`의 `projectMappedColumns`가 `MaskedRow[]`에서
`mapping`의 4개 필드(date/merchant/amount/category)만 프로젝션한다.

- `route.ts:86` — `masked.rows`가 아니라 프로젝션 결과 `rows`를 사용.
- `route.ts:87` — `generateFreeSummary({ rows })`에 프로젝션 결과 전달.
- `route.ts:88-92` — `insertAnalysis({ maskedTransactions: rows })`에도 동일 프로젝션 결과 전달.
- 프로젝션은 `maskPii` 출력(`masked.rows`)에서만 파생됨 — 원본 파싱 결과/클라이언트 입력에서 만들지 않음.

**테스트 실재·통과.** `route.test.ts:119-156`:
- 픽스처에 키워드 목록에 없는 미지 전화번호 헤더 `연락수단X`(값 `010-1234-5678`)와 카드번호 컬럼 포함(test.ts:44-67).
- `projectedRows`가 정확히 4개 키만 갖는지 assert(test.ts:136-143).
- `generateFreeSummary`·`insertAnalysis` **양쪽** 인자에 프로젝션 결과가 전달됨을 assert(test.ts:146-151).
- 즉 미지 컬럼(전화번호)이 LLM 호출·DB 저장 어느 쪽에도 나타나지 않음이 코드+테스트로 보장됨.

## 표준 검증 결과

| 항목 | 결과 | 근거 |
|---|---|---|
| 소유권 검증 (쓰기 전) | 통과 | `supabase-admin/index.ts:43` upsertPremiumReport가 UPDATE 전 `user_id !== input.userId` 확인 후 throw. insertAnalysis는 `user_id`를 세션값으로 세팅(:19). 라우트도 getAnalysisById로 선검증(reports route.ts:50) — 이중 방어. |
| 페이월 순서 | 통과 | reports `route.ts` 순서: 소유권(50) → 구독확인(54) → **캐시조회(59)** → generate(77). 구독확인이 캐시조회·생성보다 먼저. 미구독 시 403 즉시 반환하며 generateReport 미호출. 테스트 `route.test.ts:113-133`가 getter 스파이로 캐시조회 자체가 일어나지 않음을 assert. |
| 에러 코드 계약 | 통과 | 401 UNAUTHORIZED / 400 BAD_REQUEST / 404 NOT_FOUND / 403 PAYWALL_REQUIRED / 502 GENERATION_FAILED 각각 정확한 status+code로 반환. 502는 캐시 쓰기 없이 반환(route.ts:76-80, test:203-211). |
| middleware 양방향 리다이렉트 | 통과 | `middleware.ts:14-15` 비로그인+/dashboard→/login, `:18-19` 로그인+/→/dashboard. matcher(:26-28)가 `/api` 제외. test:50-59가 `/api/upload`·`_next`·정적자산 제외 확인. |
| webhooks/polar 스텁 | 통과 | `route.ts` 서명검증/DB갱신 로직 없이 501 NOT_IMPLEMENTED만 반환. 부수효과 없음(이번 phase 범위 밖 규칙 준수). |
| service-role 키 격리 | 통과 | `SUPABASE_SERVICE_ROLE_KEY` 참조는 `lib/supabase/service.ts`(server-only import)와 그 테스트뿐. NEXT_PUBLIC_ 접두어 없음, 'use client' 파일에 미노출. |
| 쓰기 경로 단일화 | 통과 | `.insert(`/`.update(`는 `services/supabase-admin` 내부에서만 발생. |
| 원본 CSV 미저장 | 통과 | api/services 전역에 fs.write/writeFile/Storage upload/원본 console.log 없음. upload·analyze 모두 buffer를 인메모리로만 처리. |
| LLM 프롬프트 원본 미포함 | 통과 | analyze: 프로젝션된 MaskedRow만 전달. upload: `masked.rows` 샘플만 inferColumnMapping에 전달(route.ts:25-29), 원본 RawRow 직접 전달 경로 없음. |

## 관찰 사항 (비차단, 참고)

1. **upload 라우트의 컬럼매핑 LLM 경계 잔여 리스크(설계상 불가피, 이번 phase 위반 아님).**
   `upload/route.ts:25-29`는 `masked.rows` 샘플을 `inferColumnMapping`(LLM)에 넘긴다. 이 시점엔 매핑이 아직 미확정이라 허용 목록 프로젝션을 적용할 수 없다. 따라서 pii-masking 키워드 매칭이 비표준 신원 컬럼(예: 미지 전화번호 헤더)을 놓치면 그 값이 컬럼매핑 LLM에 노출될 수 있다. 이는 step3 스펙(마스킹 출력만 전달)을 준수한 상태이며, 바로 이 잔여 리스크 때문에 analyze에 허용 목록 방어가 추가된 것. 근본 완화는 core-services(pii-masking 신원 컬럼 탐지 강화) 영역이므로 api-routes phase 차단 사유 아님.

2. **upload 라우트 formData() try/catch 부재(경미).**
   `analyze/route.ts:71-75`는 `request.formData()`를 try/catch로 감싸 malformed multipart를 400으로 변환하지만, `upload/route.ts:16`은 감싸지 않아 malformed 바디에서 미처리 예외(500)가 발생할 수 있다. 보안 영향 없음, 스펙에 명시 안 됨. 일관성 차원의 경미한 개선 여지.

## 미검증

없음 — phase 전 step 실행 완료, 모든 경계 검증 가능.
