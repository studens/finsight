# Step 0: middleware.ts — 세션 기반 라우팅 게이팅

## 작업
`src/middleware.ts`와 세션 갱신 헬퍼 `src/lib/supabase/middleware.ts`를 TDD로 구현한다. 이 step은 DB 스키마/서비스 계층에 의존하지 않는 독립 step이다. **테스트를 먼저 작성**하고 통과하는 구현을 작성한다.

`@supabase/ssr`의 `createServerClient`를 request/response 쿠키에 연결해 세션을 확인한다. `src/lib/supabase/middleware.ts`에 쿠키를 요청/응답에 반영하며 `supabase.auth.getUser()`를 호출하는 `updateSession(request: NextRequest)` 헬퍼를 만들고, `src/middleware.ts`가 이를 사용한다.

라우팅 규칙(CLAUDE.md / ARCHITECTURE.md 데이터 흐름 기준):
- 비로그인 사용자가 `/dashboard`(및 하위 경로)에 접근 → `/login`으로 리다이렉트.
- 로그인 사용자가 `/`(랜딩)에 접근 → `/dashboard`로 리다이렉트.
- `/login`은 로그인 여부와 무관하게 항상 접근 가능(로그인 사용자가 `/login`에 오면 `/dashboard`로 보내도 되지만, 이번 step의 필수 규칙은 위 두 가지다).

`config.matcher`는 `api`, `_next/static`, `_next/image`, 파비콘/정적 자산을 제외한다. **API 라우트(`/api/*`)는 미들웨어에서 리다이렉트하지 않는다** — API는 각 라우트 핸들러가 자체적으로 401을 반환한다(리다이렉트는 페이지 전용).

환경변수는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`만 사용한다. 미들웨어는 클라이언트에 노출되는 anon 키만 쓰며, `SUPABASE_SERVICE_ROLE_KEY`를 절대 참조하지 않는다.

## Acceptance Criteria
- [ ] 세션이 없는 요청이 `/dashboard`로 오면 `/login`으로 리다이렉트하는 테스트가 통과한다(`NextResponse.redirect`의 목적지 URL 경로가 `/login`).
- [ ] 세션이 있는 요청이 `/`로 오면 `/dashboard`로 리다이렉트하는 테스트가 통과한다.
- [ ] 세션이 없는 요청이 `/`로 오면 리다이렉트 없이 통과(랜딩 노출)하고, 세션이 있는 요청이 `/dashboard`로 오면 리다이렉트 없이 통과하는 테스트가 통과한다.
- [ ] `config.matcher`가 `/api/*`, `/_next/*`, 정적 자산을 제외함을 확인한다(matcher 정규식 테스트 또는 코드 검증).
- [ ] (service-role 격리 CRITICAL) `src/middleware.ts`와 `src/lib/supabase/middleware.ts` 어디에도 `SUPABASE_SERVICE_ROLE_KEY` 참조가 없음을 grep으로 확인한다. anon 키만 사용한다.
