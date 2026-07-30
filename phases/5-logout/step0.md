# Step 0: signOut 서버 래퍼 + POST /api/auth/signout 라우트

## 배경

현재 이 프로젝트에는 로그아웃 기능이 **의도적으로 빠져 있었다.** `docs/BROWSER-TEST-SCENARIOS.md`에 "로그아웃 UI 없음 — 세션 정리는 브라우저 쿠키/스토리지 삭제로 대체한다"라고 명시돼 있다. 이 phase는 그 공백을 메운다.

세션은 `@supabase/ssr`이 관리하는 **HTTP-only 쿠키**에 들어 있다. 따라서 브라우저에서 `document.cookie`를 지우는 방식으로는 세션을 없앨 수 없고, **서버 쿠키 저장소에 접근할 수 있는 서버 코드**가 `auth.signOut()`을 호출해야 한다. 이 step은 그 서버 경로만 만든다. UI는 step 1의 범위이며 여기서 만들지 않는다.

**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

## 작업

### 0-1. `src/lib/supabase/server.ts`에 `signOut` 추가

```typescript
export async function signOut(): Promise<void>
```

- 기존 `createClient()`(쿠키 기반 anon 클라이언트)를 그대로 재사용해 `supabase.auth.signOut()`을 호출한다.
- 에러가 있으면 그대로 throw한다. 라우트가 처리한다.
- **`withJwtClockSkewRetry`로 감싸지 마라.** 그 헬퍼는 PostgREST(DB 조회)의 PGRST303 전용이고, `auth.signOut()`은 GoTrue 호출이라 해당 없다.
- `getSessionUser`와 같은 위치(파일 상단 auth 관련 함수 근처)에 둔다.

**왜 `services/`가 아니라 `lib/supabase/server.ts`인가 (이 결정을 바꾸지 마라):**
CLAUDE.md의 "외부 API 호출은 `src/services/`를 통해서만 수행한다"는 규칙은 이 프로젝트에서 이미 다음과 같이 적용돼 있다 — **세션·RLS 읽기는 `lib/supabase/`, DB 쓰기(service-role)는 `services/supabase-admin`**. `docs/ARCHITECTURE.md`도 `lib/supabase/server.ts`를 "서버 컴포넌트/라우트용(세션 기반, RLS 적용, 읽기)"으로 규정하고 있고, 기존 라우트 핸들러들이 이미 여기서 `getSessionUser`/`getAnalysisById`를 import해 쓴다. `signOut`은 세션 조작이므로 `getSessionUser`와 같은 층에 두는 것이 기존 경계와 일치한다. **`src/services/` 아래에 새 디렉토리를 만들지 마라.**

기존 파일에 이미 있는 함수(`createClient`, `getSessionUser`, `getAnalysisById`, `getSubscriptionStatus`, `getPreviousAnalysis`, `listUserAnalyses`)의 동작을 바꾸지 않는다.

### 0-2. `src/app/api/auth/signout/route.ts` (신규)

```typescript
export async function POST(request: Request): Promise<NextResponse>
```

동작 규칙:

1. **`POST`만 export한다.** `GET`을 export하지 않는다 — 링크 프리페치나 주소창 접근으로 세션이 날아가면 안 된다. (Next.js가 정의되지 않은 메서드에 405를 자동 반환한다.)
2. **동일 출처 확인**: `Origin` 헤더가 존재하고 그 값이 `new URL(request.url).origin`과 다르면 `signOut`을 호출하지 않고 `403`을 반환한다. `Origin` 헤더가 아예 없으면 통과시킨다(비브라우저 클라이언트).
   - Supabase 세션 쿠키는 기본 `SameSite=Lax`라 교차 사이트 POST에는 애초에 쿠키가 실리지 않지만, 방어를 코드에 명시적으로 남긴다.
3. `signOut()`을 호출한다.
4. **성공/실패와 무관하게** `/login`으로 **303 See Other** 리다이렉트를 반환한다.
   - 303이어야 하는 이유: step 1의 로그아웃 버튼이 `<form method="post">`로 이 엔드포인트를 치는데, 307/308이면 리다이렉트 후에도 POST가 유지되어 `/login`에 POST가 날아간다. 303은 GET으로 바꿔준다.
   - `signOut()`이 throw해도 500을 반환하지 않는다. 로그아웃하려는 사용자를 에러 화면에 가두지 않는다.
5. **에러 내용을 로그하거나 응답에 담지 않는다.** `console.*` 호출을 넣지 않는다. 세션 토큰·쿠키 값이 로그로 새면 안 된다.

리다이렉트 대상 URL은 `new URL("/login", request.url)`로 만들어 현재 오리진을 따르게 한다(하드코딩된 도메인 금지).

### 0-3. 테스트 — `src/app/api/auth/signout/route.test.ts` (신규)

- **파일 확장자는 반드시 `.ts`다.** `vitest.config.ts`의 node 프로젝트가 `src/**/*.test.ts`만 잡는다. `.tsx`로 만들면 어느 프로젝트에도 걸리지 않아 **테스트가 조용히 실행되지 않는다.**
- `vi.hoisted` + `vi.mock("../../../../lib/supabase/server", () => ({ signOut }))` 패턴으로 `signOut`을 목킹한다. 기존 `src/app/api/reports/[analysisId]/[reportType]/route.test.ts`의 스타일을 따른다.
- 실제 Supabase에 접속하지 않는다.

## Acceptance Criteria

- [ ] `src/lib/supabase/server.ts`가 `signOut(): Promise<void>`를 export하고, 내부에서 `createClient()`로 만든 클라이언트의 `auth.signOut()`을 호출하며, 에러 시 throw하는 테스트가 `src/lib/supabase/server.test.ts`에서 통과한다.
- [ ] `signOut`이 `withJwtClockSkewRetry`로 감싸여 있지 않음을 확인한다(코드 확인). 기존 DB 읽기 4개 함수(`getAnalysisById`, `getSubscriptionStatus`, `getPreviousAnalysis`, `listUserAnalyses`)는 여전히 감싸여 있고 관련 기존 테스트가 그대로 통과한다.
- [ ] `POST /api/auth/signout`이 `signOut()`을 호출한 뒤 **status 303**, `location`이 `/login`으로 끝나는 응답을 반환하는 테스트가 통과한다. (307/308이 아님을 status 값으로 단정한다.)
- [ ] `signOut()`이 reject하는 경우에도 응답이 **303 + `/login`** 이고 예외가 밖으로 던져지지 않는(500이 아닌) 테스트가 통과한다.
- [ ] `Origin` 헤더가 `https://evil.test`처럼 요청 URL 오리진과 다를 때 **403**이 반환되고 `signOut`이 **호출되지 않음**(`expect(signOut).not.toHaveBeenCalled()`)을 단정하는 테스트가 통과한다.
- [ ] `Origin` 헤더가 요청 URL 오리진과 같을 때, 그리고 `Origin` 헤더가 아예 없을 때 모두 303이 반환되는 테스트가 통과한다.
- [ ] `route.ts`에 `GET`/`PUT`/`DELETE` export가 없고 `POST`만 export됨을 확인한다.
- [ ] (로그 유출 방지) `src/app/api/auth/signout/route.ts`에 `console.` 호출이 **0건**임을 grep으로 확인한다. 응답 본문·헤더에 에러 메시지나 토큰 값이 담기지 않는다.
- [ ] 리다이렉트 URL이 `new URL("/login", request.url)` 기반이며 `localhost`나 배포 도메인이 하드코딩되어 있지 않음을 grep으로 확인한다.
- [ ] (경계 유지 CRITICAL) `src/services/` 아래에 새 파일·디렉토리가 추가되지 않았고, `signOut`이 `src/lib/supabase/server.ts`에 있다. 라우트가 `@supabase/ssr`이나 `@supabase/supabase-js`를 **직접** import하지 않고 `lib/supabase/server`의 래퍼만 쓴다(grep으로 확인).
- [ ] (service-role 미사용 CRITICAL) `src/app/api/auth/signout/route.ts`와 새로 추가한 `signOut`에 `SUPABASE_SERVICE_ROLE_KEY`, `lib/supabase/service`, `services/supabase-admin` 참조가 **0건**이다. 로그아웃은 세션 쿠키 조작이므로 service-role이 필요 없다.
- [ ] (범위 유지) `src/middleware.ts`와 `src/lib/supabase/middleware.ts`가 **수정되지 않았다**(`git diff`로 확인). `/api/*`는 이미 미들웨어 matcher에서 제외돼 있으므로 이 라우트를 위해 matcher를 바꿀 필요가 없다. 기존 `src/middleware.test.ts`가 그대로 통과한다.
- [ ] 테스트 파일이 `src/app/api/auth/signout/route.test.ts`(**`.ts` 확장자**)이고, `npm run test` 출력의 테스트 파일 목록에 이 경로가 **실제로 나타남**을 확인한다(파일만 만들고 실행 안 되는 상태 금지).
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 **기존 테스트가 하나도 깨지지 않는다.**
