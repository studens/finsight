# Step 5: PremiumSection — 잠금 CTA 카드 + 구독자 지연조회

## 작업
`src/components/PremiumSection.tsx`를 **Client Component**로 만든다. Premium 리포트 4종을 카드로 보여주고, 구독 여부에 따라 다르게 동작한다. props: `{ analysisId: string; isSubscribed: boolean }`.

Premium 리포트 4종(core-services `ReportType`, api-routes 계약 경로 파라미터와 정확히 일치):
- `mom_comparison` — "전월 대비 지출 변화"
- `anomaly_detection` — "이상 거래·중복구독 탐지"
- `savings_suggestions` — "절약 제안"
- `budget_recommendation` — "카테고리별 예산 추천"

### 미구독(`isSubscribed === false`) — 잠금 CTA 빈 상태
- 각 리포트를 **정적 잠금 카드**로 렌더한다. 리포트 이름 + 한 줄 설명(예: "전월 대비 지출 변화를 확인하세요") + `text-[#a8acb3]` + Primary 버튼("Premium으로 보기").
- **CRITICAL(ui-design): 실제 데이터를 블러 처리하지 않는다.** Premium 리포트는 미구독자에게 서버가 생성 자체를 하지 않으므로(지연 생성) 흐릴 값이 없다. 반드시 **빈 상태 + CTA로만** 구성한다. `backdrop-filter: blur()` 및 가짜 더미 수치를 흐리게 보여주는 방식 금지.
- 이 상태에서는 GET /api/reports를 **호출하지 않는다**(미구독자 요청은 서버가 403으로 거부하므로 클릭 시에도 fetch를 시도하지 않고, "Premium으로 보기"는 업그레이드 유도용). 방어적으로 클릭해 403이 오면 step 1의 `ErrorModal`로 부드럽게 표시한다.

### 구독(`isSubscribed === true`) — 지연 조회
- 각 카드를 클릭하면 `GET /api/reports/${analysisId}/${reportType}`를 fetch한다(ARCHITECTURE flow 3).
  - 로딩 중: 카드에 짧은 로딩 상태 표시(스피너/스켈레톤 — 글로우 애니메이션 금지, `fade-in`/정적 표시만).
  - 성공(200): 응답 `{ reportType, data }`의 `data`(PremiumReport)를 카드 안에 펼쳐 렌더한다. 각 리포트 타입별 필드 렌더는 리스트 아이템(`rounded-2xl bg-[#0a0b0d] p-5`) + 시맨틱 컬러로: Risk=`#cf202f`(이상거래), Opportunity=`#05b169`(절약/기회), Hygiene=`#5b8bff`(예산/정보). 좌측 `border-l-4`로 강조 가능.
  - 실패(403/404/502): 코드를 화면에 노출하지 말고 step 1 `ErrorModal`로 통일 표시(현재 화면 유지, 페이지 이동 없음).
- 캐시/생성은 서버 책임이며 프론트는 결과만 렌더한다.

계약 인용 (api-routes `_workspace/03_api-routes_contract.md`):
```
GET /api/reports/:analysisId/:reportType
 성공 200: { "reportType": "mom_comparison", "data": { /* PremiumReport */ } }
 401 { "code": "UNAUTHORIZED" }  404 { "code": "NOT_FOUND" }
 403 { "code": "PAYWALL_REQUIRED" }  502 { "code": "GENERATION_FAILED" }
```

스타일(ui-design 값 그대로):
- 카드 `rounded-[24px] bg-[#16181c] p-8`, 상단 `Badge`("PREMIUM"), 버튼 `rounded-full`.
- 내부 리스트 아이템 `rounded-2xl bg-[#0a0b0d] p-5`, 수치 `font-mono tabular-nums`.

CRITICAL:
- Claude/Supabase/Polar를 직접 호출하지 않는다. Premium 데이터는 오직 `GET /api/reports/*`를 `fetch`로 호출해 받는다.
- 클라이언트 UI의 잠금은 참고용일 뿐이며 실제 방어선은 서버/RLS다 — 프론트는 미구독 시 fetch를 생략하되, 서버가 403을 반환하는 것이 최종 게이팅임을 전제로 동작한다.

## Acceptance Criteria
- [ ] `isSubscribed=false`일 때 4종 리포트가 모두 **정적 잠금 CTA 카드**(이름 + 한 줄 설명 + "Premium으로 보기" 버튼)로 렌더되고, 실제/더미 데이터를 `backdrop-blur`로 흐리게 보여주는 요소가 없음을 Vitest+RTL 테스트/grep으로 확인한다.
- [ ] `isSubscribed=false`에서는 렌더 시점과 CTA 클릭 시점 모두 `GET /api/reports`가 호출되지 않음을 테스트로 확인한다(fetch mock 호출 0회; 방어적 클릭으로 403을 받으면 ErrorModal 표시).
- [ ] `isSubscribed=true`에서 카드 클릭 시 `GET /api/reports/${analysisId}/${reportType}`가 호출되고, 4종 각각의 경로가 `mom_comparison`/`anomaly_detection`/`savings_suggestions`/`budget_recommendation`와 정확히 일치함을 테스트로 확인한다.
- [ ] 200 응답의 `data`가 카드에 렌더되고, 403/404/502 응답이 **코드 노출 없이** step 1 `ErrorModal`로 통일 표시되며 페이지 이동이 없음을 테스트로 확인한다.
- [ ] 카드 `rounded-[24px]` / 리스트 아이템 `rounded-2xl` / 배지·버튼 `rounded-full` 반경 구분과, 시맨틱 컬러(#cf202f/#05b169/#5b8bff)만 정보전달용으로 쓰였음을 확인한다.
- [ ] (CRITICAL grep) 컴포넌트가 Claude/Supabase/Polar SDK나 `services/*`, `lib/supabase/service.ts`를 import하지 않고 `fetch('/api/reports/...')`로만 데이터를 얻음을 확인한다.
