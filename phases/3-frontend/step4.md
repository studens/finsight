# Step 4: FreeSummaryCards — Free 요약 결과 프리젠테이션 컴포넌트

## 작업
`src/components/FreeSummaryCards.tsx`를 만든다. `FreeSummary` 하나를 props로 받아 화면에 렌더하는 **프리젠테이션 컴포넌트**다(데이터 fetch 없음). UploadFlow(step 6, 방금 분석한 결과)와 대시보드 상세 페이지(step 7, 저장된 결과) 양쪽에서 재사용된다.

props 타입은 core-services 공유 타입 `FreeSummary`(`src/types/pipeline.ts`)를 그대로 쓴다:
```typescript
type FreeSummary = {
  totalSpent: number;
  transactionCount: number;
  categoryTotals: Record<string, number>;               // 예: { "카페": 45000, "식비": 320000 }
  topMerchants: { merchant: string; amount: number }[];  // 예: [{ merchant: "스타벅스", amount: 45000 }]
};
```
(POST /api/analyze 응답의 `freeSummary` shape과 동일 — api-routes 계약 `_workspace/03_api-routes_contract.md`.)

렌더 구성:
1. **요약 헤더**: 총 지출(`totalSpent`) + 거래 건수(`transactionCount`).
   - 강조 수치: `font-mono tabular-nums font-medium text-3xl~5xl text-white`. 지출 금액은 원화 포맷(`toLocaleString`).
2. **카테고리별 합계**(`categoryTotals`): `Card` 안에 리스트 아이템(`rounded-2xl bg-[#0a0b0d] p-5 flex gap-4 items-start`)으로 나열. 금액은 `font-mono tabular-nums`. 값이 클수록 위로 정렬(내림차순).
3. **가맹점 Top 5**(`topMerchants`): 동일한 리스트 아이템 스타일. 좌측 `IconBadge`(tone `hygiene`=`#5b8bff`) 사용 가능.

스타일(ui-design 값 그대로):
- 카드 `rounded-[24px] bg-[#16181c] p-8`, 카드 제목 `text-sm font-medium text-[#a8acb3]`.
- 리스트 아이템 `rounded-2xl bg-[#0a0b0d] p-5`(카드=24px와 반경 구분).
- 콘텐츠 폭 `max-w-5xl`, 좌측 정렬, 섹션 간 `space-y-8`, 통계는 `grid-cols-3 gap-6` 활용 가능.
- 결과 등장 전환은 `slide-up`(0.5s) 사용 가능. 그 외 애니메이션 금지.
- 금액 색상은 정보 전달용으로만: 지출(음수 의미)에 필요 시 `#cf202f` 계열, 절약/긍정에 `#05b169`. 장식용 컬러 금지.

CRITICAL:
- 순수 프리젠테이션 — 이 컴포넌트에서 fetch/Supabase/Claude/Polar 호출을 하지 않는다. 데이터는 props로만 받는다.

## Acceptance Criteria
- [ ] `FreeSummary` mock을 주입하면 총 지출·거래 건수, `categoryTotals` 전 항목, `topMerchants` 전 항목이 렌더됨을 Vitest+RTL 테스트로 확인한다.
- [ ] 강조 수치에 `font-mono`·`tabular-nums`가 적용되고 금액이 천단위 포맷으로 표시됨을 확인한다.
- [ ] `categoryTotals`가 금액 내림차순으로 정렬되어 렌더됨을 테스트로 확인한다.
- [ ] 카드는 `rounded-[24px]`, 내부 리스트 아이템은 `rounded-2xl`로 반경이 구분됨을 확인한다.
- [ ] (CRITICAL) 컴포넌트 코드에 `fetch`/Supabase/Claude/Polar/`services/*` 호출이 없음을 grep으로 확인한다(props-only 프리젠테이션).
- [ ] (금지 패턴) `backdrop-blur`/`bg-clip-text`/보라·인디고 색상이 없음을 확인한다.
