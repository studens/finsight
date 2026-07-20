# Step 3: 로그인 페이지 /login — Google OAuth 버튼

## 작업
`src/app/login/page.tsx`에 로그인 화면을 만든다. finsight는 **Google OAuth 전용**(이메일/비밀번호 없음)이므로 화면은 간결하게: 제품명/한 줄 카피 + "Google로 계속하기" 버튼 하나.

- OAuth를 트리거하는 버튼은 인터랙션이 필요하므로 **Client Component**로 분리한다(`src/components/GoogleSignInButton.tsx`).
- 로그인은 **브라우저 Supabase 클라이언트 래퍼** `lib/supabase/client.ts`를 통해 `auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/dashboard } })`를 호출한다. (auth 목적의 브라우저 클라이언트 사용은 허용된다 — service-role 키나 Claude/Polar 직접 호출이 아니다.)
- 로그인 성공 후 미들웨어가 세션을 인식해 대시보드로 보낸다. redirect 대상은 `/dashboard`.

스타일(ui-design 값 그대로):
- 배경 `#0a0b0d`, 카드 `rounded-[24px] bg-[#16181c] p-8`.
- 로그인 버튼: Primary(`h-14 px-8 rounded-full bg-[#0052ff] text-white hover:bg-[#003ecc] font-semibold`) 또는 Secondary 톤 중 하나로 통일. 좌측에 Google 글리프(strokeWidth 1.5 SVG 또는 심플 글리프) 허용.
- 이 화면은 예외적으로 중앙 정렬 허용(단일 카드 로그인).

CRITICAL:
- `SUPABASE_SERVICE_ROLE_KEY`나 `lib/supabase/service.ts`를 클라이언트에서 절대 import/사용하지 않는다. 로그인은 오직 브라우저용 `lib/supabase/client.ts`(anon/publishable 키)만 쓴다.
- Claude/Polar/`services/*`를 호출하지 않는다.

## Acceptance Criteria
- [ ] `/login`이 "Google로 계속하기" 버튼과 제품 카피를 렌더한다.
- [ ] 버튼 클릭 시 `lib/supabase/client.ts`의 `signInWithOAuth`(provider `google`, redirect `/dashboard`)가 호출됨을 Vitest+RTL 테스트(클라이언트 모듈 mock)로 확인한다.
- [ ] (CRITICAL) 로그인 관련 코드가 `lib/supabase/service.ts`·`SUPABASE_SERVICE_ROLE_KEY`를 import/참조하지 않음을 grep으로 확인한다.
- [ ] OAuth 버튼 컴포넌트가 Client Component(`"use client"`)이고, 페이지 카드가 `rounded-[24px] bg-[#16181c]`·버튼이 `rounded-full`임을 확인한다.
- [ ] (금지 패턴) `backdrop-blur`/`bg-clip-text`/보라·인디고 색상이 없음을 grep으로 확인한다.
