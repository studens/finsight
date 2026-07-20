# frontend phase 계획 노트 (phase 3-frontend)

> qa / api-routes가 참조하는 **화면·컴포넌트 목록 + API 엔드포인트 매핑**이다.
> 계획 파일: `phases/3-frontend/`. 의존 계약: api-routes `_workspace/03_api-routes_contract.md`, core-services `_workspace/02_core-services_interface.md`, `ui-design` 스킬.

## step ↔ 산출물

| step | 산출물 | 종류 |
|---|---|---|
| 0 | `src/components/ui/{Button,Badge,Card,IconBadge}` + 폰트/색상 토큰 + Vitest jsdom/RTL 셋업 | 프리미티브 |
| 1 | `src/components/ErrorModal.tsx`, `src/hooks/useApiError.ts` | 공용(에러 통일) |
| 2 | `src/app/(marketing)/page.tsx` | 랜딩(Server) |
| 3 | `src/app/login/page.tsx`, `src/components/GoogleSignInButton.tsx` | 로그인(Client 버튼) |
| 4 | `src/components/FreeSummaryCards.tsx` | 결과 프리젠테이션 |
| 5 | `src/components/PremiumSection.tsx` | Premium(Client) |
| 6 | `src/components/UploadFlow.tsx` | 업로드 흐름(Client) |
| 7 | `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/dashboard/[analysisId]/page.tsx`, `src/components/HistoryList.tsx` | 대시보드 조립(Server) |

## 화면 ↔ API 엔드포인트

| 화면/컴포넌트 | 호출 | 방식 |
|---|---|---|
| 랜딩 `/` | 없음(정적) | — |
| 로그인 `/login` | Supabase `auth.signInWithOAuth(google)` | 브라우저 클라이언트 `lib/supabase/client.ts`(auth만) |
| UploadFlow 1단계 | `POST /api/upload` (field `file`) | `fetch` multipart |
| UploadFlow 2단계 | `POST /api/analyze` (field `file`=**원본 File 재전송** + `mapping` JSON) | `fetch` multipart |
| PremiumSection(구독자) | `GET /api/reports/:analysisId/:reportType` | `fetch` |
| PremiumSection(미구독) | 호출 없음 — 정적 잠금 CTA | — |
| 대시보드 `/dashboard` (서버 읽기) | `getSubscriptionStatus()`, 사용자 분석 목록 | `lib/supabase/server.ts`(RLS) |
| 대시보드 상세 `/dashboard/[analysisId]` (서버 읽기) | `getAnalysisById()`, `getSubscriptionStatus()` | `lib/supabase/server.ts`(RLS) |

## 데이터 흐름 핵심 반영 (ARCHITECTURE flow 1·2)
- `/api/analyze`는 마스킹 데이터가 아니라 **사용자가 확인한 원본 CSV 파일을 다시 받는다**(서버 마스킹 재실행). UploadFlow는 원본 `File`을 브라우저 메모리(useState)에 유지하다 2단계에서 재전송한다. 클라이언트는 마스킹을 하지 않고, 원본을 localStorage/session/IndexedDB에 저장하지 않는다.
- 매핑 확인 폼이 보여주는 `sample.rows`는 서버가 이미 마스킹한 미리보기(카드번호 뒤 4자리)다 — 원본 값은 클라이언트로 오지 않는다.

## 에러 표시 (ARCHITECTURE flow 5)
- 401/400/403/404/502 모두 화면에 code/상태숫자를 노출하지 않고 step 1 `ErrorModal` 하나로 부드럽게 표시, 페이지 이동 없음. 401은 미들웨어가 이미 `/login`으로 보내므로 방어적 케이스.

## Premium 게이팅 (프론트 측)
- 미구독: 정적 잠금 CTA 카드만(블러/더미 데이터 금지). `GET /api/reports` 미호출.
- 구독: 카드 클릭 시 지연 조회. 서버/RLS가 최종 방어선이며 프론트 잠금은 참고용.

## api-routes 의존 (해소됨)
- 대시보드 이력 목록용 `lib/supabase/server.ts`의 `listUserAnalyses(): Promise<{ id, createdAt, freeSummary }[]>`(세션 기반 RLS, 본인 소유 행만 `created_at desc`)가 api-routes 계약(`_workspace/03_api-routes_contract.md` 읽기 경계)과 `phases/2-api-routes/step1.md`에 반영 완료됨. frontend step7은 이 함수를 그대로 호출한다(중복 헬퍼 생성 금지).
- shape 매핑: `listUserAnalyses()` 반환 `{ id, createdAt, freeSummary }` → `HistoryList` props `{ id, createdAt, totalSpent, transactionCount }`(대시보드 Server Component가 `freeSummary.totalSpent`/`freeSummary.transactionCount`로 변환).
