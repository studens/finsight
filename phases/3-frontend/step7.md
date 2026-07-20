# Step 7: 대시보드 페이지 조립 + 업로드 이력 (/dashboard, /dashboard/[analysisId])

## 작업
대시보드를 **Server Component**로 조립한다. 서버 상태(업로드 이력, 구독 상태, 특정 분석 결과)는 별도 상태관리 라이브러리 없이 `lib/supabase/server.ts`(세션 기반, RLS 적용, 읽기 전용)로 직접 조회한다(ARCHITECTURE "상태 관리").

### `src/app/(app)/dashboard/page.tsx` (Server Component)
1. 서버에서 읽기:
   - 구독 상태: `getSubscriptionStatus()` → `isSubscribed` 계산(`status === 'active'`).
   - 업로드 이력 목록: `lib/supabase/server.ts`의 `listUserAnalyses(): Promise<{ id: string; createdAt: string; freeSummary: FreeSummary }[]>`(api-routes step1 산출, 세션 기반 RLS로 본인 소유 행만 `created_at desc` 반환)를 그대로 호출한다.
     - **중복 생성 금지**: 이 읽기 헬퍼는 이미 api-routes 계약(`_workspace/03_api-routes_contract.md` 읽기 경계 섹션)과 `phases/2-api-routes/step1.md`에 정의돼 있고, phase 실행 순서상 2-api-routes가 먼저 실행되므로 이 step 시점엔 이미 존재한다. 대시보드 페이지에서 별도 읽기 헬퍼를 새로 만들지 말고 이 함수만 사용한다(직접 Claude/Polar/service-role 사용 금지).
     - **shape 매핑**: `listUserAnalyses()`는 `{ id, createdAt, freeSummary }[]`를 반환하므로, Server Component가 각 항목을 `HistoryList` props(`{ id, createdAt, totalSpent, transactionCount }`)로 변환할 때 `totalSpent = freeSummary.totalSpent`, `transactionCount = freeSummary.transactionCount`로 매핑해 넘긴다.
2. 렌더:
   - 상단: `UploadFlow`(step 6)에 `isSubscribed` 전달.
   - 하단: `HistoryList`(아래) — 이력 요약을 리스트로.

### `src/components/HistoryList.tsx` (프리젠테이션)
- props: 분석 요약 배열(`{ id, createdAt, totalSpent, transactionCount }[]`).
- 각 항목을 리스트 아이템(`rounded-2xl bg-[#0a0b0d] p-5 flex gap-4 items-start`)으로 렌더, 날짜 + 총 지출(`font-mono tabular-nums`). 클릭 시 `/dashboard/${id}`로 이동(Next `Link`).
- 이력이 없으면 빈 상태 안내("아직 업로드한 내역이 없어요 — CSV를 올려 시작해 보세요").

### `src/app/(app)/dashboard/[analysisId]/page.tsx` (Server Component — 이력 상세)
- 경로의 `analysisId`로 `getAnalysisById(analysisId)` 호출(RLS + 소유권; 없거나 남의 것이면 Next `notFound()`로 404 처리).
- 저장된 `freeSummary`로 `FreeSummaryCards`(step 4) 렌더 + `PremiumSection`(step 5)에 `{ analysisId, isSubscribed }` 전달.
- 이 페이지는 저장된 Free 요약을 다시 보는 화면이므로 새로 analyze하지 않는다. Premium은 step 5의 지연 조회 규칙을 그대로 따른다.

스타일(ui-design 값 그대로):
- 콘텐츠 폭 `max-w-5xl`, 좌측 정렬, 섹션 간 `space-y-8`. 카드 `rounded-[24px] bg-[#16181c]`, 이력 아이템 `rounded-2xl bg-[#0a0b0d]`.

CRITICAL:
- 읽기는 반드시 `lib/supabase/server.ts`(세션 기반, RLS)로 한다. `lib/supabase/service.ts`(service-role)나 `SUPABASE_SERVICE_ROLE_KEY`를 페이지/컴포넌트에서 import하지 않는다(쓰기 전용 경계, 이 phase는 읽기만).
- 페이지/컴포넌트에서 Claude/Polar를 직접 호출하지 않는다. Premium 데이터는 step 5의 `fetch('/api/reports/*')`로만.
- 소유권: 상세 페이지는 RLS로 소유자 행만 조회되며, 미존재/타인 소유 시 `notFound()`(404)로 처리한다.

## Acceptance Criteria
- [ ] `/dashboard`가 `UploadFlow`(isSubscribed 전달)와 `HistoryList`를 렌더하고, 이력이 없을 때 빈 상태 문구가 나옴을 확인한다.
- [ ] `HistoryList` 항목 클릭이 `/dashboard/${id}`로 연결되고, 각 항목이 날짜 + 총 지출(`font-mono tabular-nums`)을 표시함을 확인한다.
- [ ] 대시보드 페이지가 `lib/supabase/server.ts`의 기존 `listUserAnalyses()`를 그대로 호출하고(새 읽기 헬퍼를 만들지 않음), 반환값 `{ id, createdAt, freeSummary }`를 `HistoryList` props `{ id, createdAt, totalSpent, transactionCount }`로 매핑(`freeSummary.totalSpent`/`freeSummary.transactionCount`)해 넘김을 확인한다.
- [ ] `/dashboard/[analysisId]`가 `getAnalysisById`로 조회한 저장된 `freeSummary`를 `FreeSummaryCards`로 렌더하고 `PremiumSection`에 `analysisId`·`isSubscribed`를 전달함을 확인한다.
- [ ] (소유권) 존재하지 않거나 타인 소유의 `analysisId`로 접근하면 404(`notFound()`)가 됨을 확인한다(RLS로 소유자 행만 조회).
- [ ] (CRITICAL grep) 대시보드 페이지·상세 페이지·HistoryList가 `lib/supabase/service.ts`·`SUPABASE_SERVICE_ROLE_KEY`·Claude·Polar를 import하지 않고, 읽기는 `lib/supabase/server.ts`로만 수행함을 확인한다.
- [ ] `isSubscribed`가 `getSubscriptionStatus()`의 `status === 'active'`로 계산되어 `UploadFlow`/`PremiumSection`에 일관되게 전달됨을 확인한다.
- [ ] 카드 `rounded-[24px]` / 이력 아이템 `rounded-2xl` 반경 구분과 금지 패턴(backdrop-blur/gradient-text/보라·인디고) 부재를 grep으로 확인한다.
