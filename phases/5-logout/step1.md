# Step 1: (app) 공용 헤더 + 로그아웃 버튼 + 문서 갱신

## 배경

step 0에서 만든 `POST /api/auth/signout`을 사용자가 누를 수 있는 자리를 만든다.

현재 `src/app/(app)/` 아래에는 레이아웃 파일이 없어서 대시보드에 **공용 헤더가 아예 없다.** 이 step에서 `(app)` 라우트 그룹 레이아웃을 신설해 `/dashboard`와 `/dashboard/[analysisId]` 두 화면에 동시에 헤더가 붙게 한다.

**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

## 작업

### 1-1. `src/components/SignOutButton.tsx` (신규)

**Client Component가 아니다.** `"use client"`를 붙이지 않는다. 순수 `<form>` POST로 동작하므로 클라이언트 JS가 전혀 필요 없다.

```tsx
export function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="post">
      <Button variant="text" type="submit">로그아웃</Button>
    </form>
  )
}
```

- `Button`은 `src/components/ui`의 기존 컴포넌트를 재사용한다. **`variant="text"`** 를 쓴다(`text-[#a8acb3] hover:text-white`). 헤더의 부차적 액션이므로 Primary 파란 버튼을 쓰지 않는다.
- `Button`에 새로운 variant를 추가하지 마라. 기존 3종(`primary`/`secondary`/`text`)으로 충분하다.
- `method="post"`(소문자)로 쓴다.

### 1-2. `src/app/(app)/layout.tsx` (신규)

Server Component. `(app)` 라우트 그룹 전체를 감싼다.

```tsx
export default function AppLayout({ children }: { children: ReactNode })
```

구조:

```
<div className="min-h-screen bg-[#0a0b0d]">
  <header className="border-b border-[#33363c]">
    <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
      <Link href="/dashboard" ...>finsight</Link>
      <SignOutButton />
    </div>
  </header>
  {children}
</div>
```

스타일 규칙(ui-design 값 그대로):

- 페이지 배경 `#0a0b0d`, 구분선 `border-[#33363c]`.
- 헤더 내부 폭은 본문과 같은 `max-w-5xl`, 좌우 패딩 `px-6` — 아래 `<main className="mx-auto max-w-5xl ... px-6">`과 좌우 정렬이 맞아야 한다.
- 브랜드 워드마크 `finsight`: `text-lg font-normal tracking-tight text-white`. `/dashboard`로 가는 `next/link` `<Link>`로 감싼다.
- **인증 후 화면은 다크모드 고정**이다. 라이트 토큰(`#ffffff` 배경, `#dee1e6` 보더)을 쓰지 않는다.
- 좌측 정렬 기본. 헤더는 `justify-between`으로 브랜드(좌) / 로그아웃(우) 배치.

금지(ui-design 안티패턴 — 반드시 준수):

- `backdrop-blur`/`backdrop-filter`(glass morphism), `bg-clip-text`(gradient-text), `blur-3xl` 배경 orb, 보라/인디고/바이올렛 색상, "Powered by AI" 문구. 헤더를 sticky로 만들면서 반투명 + blur를 거는 흔한 패턴을 쓰지 마라.
- 글로우 애니메이션 금지. 헤더에 애니메이션을 넣지 않는다.

CRITICAL:

- 이 레이아웃은 **세션 검사를 하지 않는다.** 비로그인 사용자의 `/dashboard` 차단은 이미 `src/middleware.ts`가 담당하고 있다. 레이아웃에서 `getSessionUser()`를 호출해 중복 검사하거나 리다이렉트하지 마라.
- 레이아웃에서 `services/*`나 Supabase를 직접 호출하지 않는다.

### 1-3. 기존 페이지 조정

`src/app/(app)/dashboard/page.tsx`와 `src/app/(app)/dashboard/[analysisId]/page.tsx`의 `<main>`은 그대로 둔다. 레이아웃이 바깥을 감싸므로 페이지 쪽 변경은 원칙적으로 없다.

단, 두 페이지의 `<main>`에 이미 `py-12`가 있어 헤더 바로 아래 여백이 과할 수 있다. **레이아웃과 페이지 어느 쪽이든 상하 여백을 중복으로 늘리지 않는지 확인**하고, 겹치면 레이아웃에는 상하 패딩을 주지 않는 쪽으로 해결한다(페이지의 `py-12`를 유지).

### 1-4. 테스트 — `src/components/AppHeader.test.tsx` (신규)

**파일 위치가 중요하다.** `vitest.config.ts`의 components 프로젝트는 `src/components/**/*.test.tsx`만 포함한다. 레이아웃 테스트를 `src/app/` 아래에 `.tsx`로 만들면 **어느 프로젝트에도 걸리지 않아 조용히 실행되지 않는다.** 따라서 레이아웃을 테스트하더라도 테스트 파일은 `src/components/` 안에 두고 거기서 `../app/(app)/layout`을 import한다. 기존 `src/components/DashboardPages.test.tsx`가 `src/app`의 페이지를 import하는 것과 같은 방식이다.

검증 대상: `SignOutButton` 단독 + `AppLayout`이 헤더와 children을 함께 렌더하는지.

## Acceptance Criteria

- [ ] `src/components/SignOutButton.tsx`가 존재하고 **`"use client"`가 없다**(grep으로 0건 확인). 클라이언트 상태·이벤트 핸들러·`useRouter`를 쓰지 않는다.
- [ ] `SignOutButton`이 렌더한 `<form>`의 `action`이 정확히 `/api/auth/signout`이고 `method`가 `post`이며, 내부 버튼의 `type`이 `submit`, 접근 가능한 이름이 `로그아웃`인 RTL 테스트가 통과한다.
- [ ] 로그아웃 버튼이 기존 `Button`의 `variant="text"`를 사용해 `text-[#a8acb3]` 클래스를 가짐을 단정하는 테스트가 통과한다. `src/components/ui/button.tsx`에 새 variant가 추가되지 않았음을 확인한다.
- [ ] `src/app/(app)/layout.tsx`가 존재하고, 렌더 결과에 (1) `/dashboard`로 링크된 `finsight` 워드마크, (2) 로그아웃 form, (3) 전달된 children이 **모두** 나타나는 RTL 테스트가 통과한다.
- [ ] 테스트 파일이 `src/components/AppHeader.test.tsx`(**`src/components/` 아래, `.tsx`**)이고, `npm run test` 출력의 테스트 파일 목록에 이 경로가 **실제로 나타남**을 확인한다.
- [ ] (세션 검사 중복 금지 CRITICAL) `src/app/(app)/layout.tsx`에 `getSessionUser`, `createClient`, `redirect`, `services/` import가 **0건**임을 grep으로 확인한다. 인증 게이팅은 `src/middleware.ts`만 담당한다.
- [ ] (금지 패턴 grep) `src/app/(app)/layout.tsx`와 `src/components/SignOutButton.tsx`에 `backdrop-blur`, `backdrop-filter`, `bg-clip-text`, `blur-3xl`, `purple`, `indigo`, `violet` 문자열이 **0건**이다.
- [ ] 헤더가 다크 토큰만 사용한다: 배경 `#0a0b0d`, 구분선 `#33363c`. 라이트 토큰(`bg-white`, `#dee1e6`, `#5b616e`)이 쓰이지 않음을 grep으로 확인한다.
- [ ] 헤더 내부 컨테이너가 `max-w-5xl`과 `px-6`을 사용해 본문 `<main className="mx-auto max-w-5xl ... px-6">`과 좌우 정렬이 일치한다.
- [ ] `/dashboard`와 `/dashboard/[analysisId]` **두 화면 모두**에 헤더가 적용된다(같은 `(app)` 그룹 레이아웃 아래에 있음을 파일 경로로 확인하고, 기존 `src/components/DashboardPages.test.tsx`가 그대로 통과함을 확인한다).
- [ ] (문서 갱신) `docs/BROWSER-TEST-SCENARIOS.md`의 "**로그아웃 UI 없음** — 세션 정리는 브라우저 쿠키/스토리지 삭제로 대체한다" 항목을 삭제하고, 새 동작을 반영한 시나리오를 추가한다: "대시보드 헤더의 로그아웃 클릭 → `/login`으로 이동 → 뒤로가기나 주소창으로 `/dashboard` 재접근 시 다시 `/login`으로 리다이렉트(세션 쿠키가 실제로 지워졌는지 확인)". 문서에 `로그아웃 UI 없음` 문자열이 남아 있지 않음을 grep으로 확인한다.
- [ ] (문서 갱신) `docs/ARCHITECTURE.md`의 `src/app/` 디렉토리 트리에 이번에 추가된 두 경로가 반영된다: `(app)/layout.tsx`(공용 헤더 — 브랜드 + 로그아웃)와 `api/auth/signout/`(POST — 세션 종료 후 `/login`으로 303). 트리의 기존 형식·주석 스타일을 그대로 따른다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 **기존 테스트가 하나도 깨지지 않는다.**
- [ ] `npm run build`가 성공한다.
