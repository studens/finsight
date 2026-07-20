# Step 2: 랜딩 페이지 (marketing) /

## 작업
`src/app/(marketing)/page.tsx`에 랜딩 페이지를 **Server Component**로 만든다. 로그인 세션 처리는 미들웨어가 담당하므로(로그인 사용자는 `/`→`/dashboard`로 리다이렉트) 이 페이지는 정적 마케팅 콘텐츠만 렌더한다. 인터랙션(로그인 이동)은 `/login`으로 가는 링크/버튼이면 충분하다.

구성(위 → 아래):
1. **히어로**: 제품 한 줄 가치 제안 + 서브카피 + Primary CTA("무료로 시작하기" → `/login`).
   - 랜딩 히어로에 한해 **중앙 정렬 허용**(그 외 섹션은 좌측 정렬).
   - 제목 타이포: `font-normal tracking-[-0.03em] leading-[1.02] text-white text-5xl~6xl`.
2. **작동 방식(3단계)**: "CSV 업로드 → 컬럼 자동 매핑 확인 → 인사이트 확인". `grid-cols-3 gap-6`, 각 항목은 `Card`(`rounded-[24px] bg-[#16181c] p-8`) + 상단 `IconBadge`.
3. **Free / Premium 기능 비교**: 2개 `Card`.
   - Free(무료·무제한): 카테고리별 지출 합계, 총 지출/거래 건수, 가맹점 Top 5.
   - Premium(구독): 전월 대비 증감, 이상 거래·중복구독 탐지, 절약 제안, 카테고리별 예산 추천. Premium 카드 상단에 `Badge`("PREMIUM").
4. **데이터 처리 신뢰 메시지**(PRD H5): "원본 CSV는 저장하지 않아요 — 분석에 필요한 마스킹된 요약만 남겨요. 카드/계좌번호는 뒤 4자리만, 이름·전화번호는 아예 전송하지 않아요." `text-sm text-[#a8acb3] leading-relaxed`.
5. **하단 CTA**: Primary 버튼 → `/login`.

레이아웃/스타일(ui-design 값 그대로):
- 콘텐츠 폭 `max-w-5xl`, 섹션 간 `space-y-8`.
- 색상: 배경 `#0a0b0d`, 카드 `#16181c`, 보조 텍스트 `#a8acb3`, Primary `#0052ff`.
- 카드 등장에 `fade-in`(0.4s) 정도만. 그 외 애니메이션 금지.

금지(ui-design 안티패턴 — 반드시 준수):
- 배경 gradient orb(`blur-3xl` 원형), gradient-text(`bg-clip-text`), glass morphism(`backdrop-blur`), "Powered by AI" 배지, 보라/인디고 색상 사용 금지.

CRITICAL:
- 이 페이지는 순수 정적 콘텐츠다. Claude/Supabase/Polar 등 외부 서비스나 `services/*`를 호출하지 않는다.

## Acceptance Criteria
- [ ] `/` 라우트가 히어로, 3단계 작동방식(`grid-cols-3`), Free/Premium 비교 카드, 데이터 처리 신뢰 메시지, 하단 CTA를 렌더한다(렌더 테스트 또는 실제 렌더 확인).
- [ ] Premium 카드에 표기된 기능이 정확히 "전월 대비 증감 / 이상 거래·중복구독 탐지 / 절약 제안 / 카테고리별 예산 추천" 4가지이고, Free 카드가 "카테고리별 합계 / 총 지출·거래 건수 / 가맹점 Top 5"임을 확인한다(PRD 페이월 경계와 일치).
- [ ] CTA가 `/login`으로 연결된다.
- [ ] (금지 패턴 grep) 페이지 및 하위 마케팅 컴포넌트에 `blur-3xl`, `bg-clip-text`, `backdrop-blur`/`backdrop-filter`, `purple`/`indigo`/`violet`, "Powered by AI" 문자열이 없음을 확인한다.
- [ ] 카드는 `rounded-[24px]`, 배지는 `rounded-full`을 사용해 역할별 반경이 구분됨을 확인한다.
- [ ] 이 페이지가 Server Component이며 `services/*`/Claude/Supabase/Polar를 import하지 않음을 확인한다.
