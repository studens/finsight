# Step 0: 디자인 토큰 + 공용 UI 프리미티브 + 컴포넌트 테스트 셋업

## 작업
이후 모든 프론트 step이 재사용할 **디자인 토큰**과 **공용 프리미티브 컴포넌트**를 만들고, 컴포넌트용 Vitest 테스트 환경을 셋업한다. 색상/반경/폰트 값은 아래에 그대로 옮겨 적혀 있으니 임의로 바꾸지 말고 이 값을 쓴다.

### 1) 폰트 + 전역 스타일
- `Inter`(400/500/600/700)를 본문·제목, `JetBrains Mono`(400/500/600)를 수치/코드에 쓴다. `next/font/google`로 로드하고 CSS 변수(`--font-sans`, `--font-mono`)로 노출.
- 앱은 **다크모드 고정**. `<body>` 기본 배경 `#0a0b0d`, 기본 텍스트 `#ffffff`.
- 수치 표기용 유틸: `font-mono` + `font-variant-numeric: tabular-nums`(Tailwind `tabular-nums`).
- 애니메이션 키프레임 두 개만 정의: `fade-in`(0.4s), `slide-up`(0.5s). 그 외 글로우/바운스/무한반복 키프레임을 만들지 않는다.

### 2) 색상 토큰 (Tailwind theme 확장 또는 CSS 변수 — 아래 값 그대로)
| 토큰 | 값 |
|---|---|
| 페이지 배경 | `#0a0b0d` |
| 카드/패널 | `#16181c` |
| 중첩 리스트 아이템 | `#0a0b0d` |
| 주 텍스트 | `#ffffff` |
| 보조 텍스트 | `#a8acb3` |
| 비활성 텍스트 | `#6e7480` |
| Primary/브랜드 | `#0052ff` (hover `#003ecc`) |
| Opportunity(긍정) | `#05b169` |
| Risk(부정/경고) | `#cf202f` |
| Hygiene(정보) | `#5b8bff` |
| 테두리/구분선 | `#33363c` |
| 입력 테두리 | `#2a2d33` |

### 3) 공용 프리미티브 (`src/components/ui/`)
- `Button` — variant `primary | secondary | text`.
  - primary: `h-14 px-8 rounded-full bg-[#0052ff] text-white hover:bg-[#003ecc] font-semibold`
  - secondary: `h-14 px-8 rounded-full bg-transparent border border-[#33363c] text-white font-semibold`
  - text: `text-[#a8acb3] hover:text-white`
- `Badge` (eyebrow/label pill): `inline-flex px-4 py-2 rounded-full bg-[#16181c] text-[13px] font-semibold tracking-[0.08em] text-[#a8acb3]`
- `Card` (패널): `rounded-[24px] bg-[#16181c] p-8`, 다크 표면끼리는 **border 없이** 배경색 차이로만 구분(=`border`를 쓰지 않는다).
- `IconBadge` — 원형 아이콘 배지: `w-9 h-9 rounded-full`, 배경 = 전달받은 시맨틱 컬러 15% 투명도(rgba), 아이콘 색 = 그 시맨틱 컬러. `tone` prop으로 `risk | opportunity | hygiene | brand` 중 선택.

### 4) 컴포넌트 테스트 환경
- Vitest를 jsdom 환경 + React Testing Library(`@testing-library/react`, `@testing-library/jest-dom`)로 컴포넌트 렌더 테스트가 가능하도록 설정한다(아직 없다면 devDependency 추가 + `vitest.config` test.environment `jsdom` + setup 파일). 기존 서비스 유닛 테스트(node 환경)가 깨지지 않도록 한다.

CRITICAL/금지 패턴 (ui-design — 이 step 이후 모든 컴포넌트에 적용):
- `backdrop-filter: blur()`(glass morphism) 금지.
- 배경 그라데이션 텍스트(gradient-text) 금지.
- box-shadow 네온 글로우 애니메이션 금지(정적 elevation shadow는 허용).
- 보라/인디고 브랜드 색상 금지 — 포인트 컬러는 `#0052ff`.
- 역할 구분 없이 전부 같은 반경 금지: 카드=`rounded-[24px]`, 리스트 아이템=`rounded-2xl`, 배지·버튼=`rounded-full`.
- 배경 gradient orb(`blur-3xl` 원형 장식) 금지. "Powered by AI" 배지 금지.

## Acceptance Criteria
- [ ] `src/components/ui/`에 `Button`(primary/secondary/text), `Badge`, `Card`, `IconBadge`가 존재하고, 각각을 렌더하는 Vitest+RTL 테스트가 통과한다.
- [ ] `Button` primary가 `bg-[#0052ff]`·`rounded-full`, `Card`가 `rounded-[24px] bg-[#16181c]`, `Badge`가 `rounded-full`을 실제 클래스로 출력함을 렌더 테스트로 확인한다(역할별 반경 분리 검증).
- [ ] Inter/JetBrains Mono가 `next/font`로 로드되고 수치용 `tabular-nums` 유틸이 적용 가능한 상태다.
- [ ] `npm run test`가 jsdom 컴포넌트 테스트와 기존 node 서비스 테스트를 모두 통과하며 실행된다.
- [ ] (금지 패턴 grep) `src/components/ui/` 및 전역 스타일에 `backdrop-blur`/`backdrop-filter`, `bg-clip-text`(gradient-text), `blur-3xl`, 보라/인디고 색(`purple`/`indigo`/`violet`/`#7c3aed` 류) 문자열이 없음을 grep으로 확인한다.
