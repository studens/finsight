# Step 3: service-role 키가 클라이언트로 새지 않는지 자동 회귀 가드를 만든다

## 배경

이 프로젝트의 CRITICAL 규칙:

> `SUPABASE_SERVICE_ROLE_KEY`는 API Route(서버 전용 코드)에서만 사용한다. 클라이언트 컴포넌트로 절대 전달하지 않으며 `NEXT_PUBLIC_` 접두어를 붙이지 않는다.

현재 실제 상태는 규칙을 지키고 있다 — `SUPABASE_SERVICE_ROLE_KEY`는 `src/lib/supabase/service.ts`와 그 테스트에만 등장한다. 문제는 **이걸 지키고 있는지 확인하는 자동 검사가 없다**는 것이다. 지금까지는 사람이 눈으로 grep했고, 그 검증을 위해 `next build` 산출물을 저장소 안에 만들다가 168M 쓰레기(`private/`)를 남긴 전례가 있다.

필요한 것은 **빌드 없이 소스 레벨에서 도는 값싼 회귀 테스트**다. 클라이언트 컴포넌트가 서버 전용 모듈을 import하면 Next가 번들에 끌어들이므로, import 그래프에서 도달 불가임을 단정하면 번들 누출을 소스 단계에서 막을 수 있다.

## 작업

`src/lib/supabase/service-boundary.test.ts`(또는 이에 준하는 이름)를 만들어 Vitest로 다음을 검증한다. **`next build`를 실행하지 마라** — 빌드 산출물을 저장소에 만들지 않는다.

1. **환경변수 이름 검사.** `src/` 전체를 훑어 `SUPABASE_SERVICE_ROLE_KEY` 문자열이 등장하는 파일 목록을 구한다. 허용 목록은 `src/lib/supabase/service.ts`와 `src/lib/supabase/service.test.ts` 두 개뿐이다. 그 외 파일에 등장하면 실패한다.

2. **`NEXT_PUBLIC_` 오염 검사.** `src/` 전체에서 `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`, 그리고 더 일반적으로 `NEXT_PUBLIC_`와 `SERVICE_ROLE`이 같은 식별자에 함께 등장하는 경우가 **0건**임을 단정한다.

3. **import 그래프 도달성 검사(이 step의 핵심).** `src/` 아래 모든 `.ts`/`.tsx`에서 상대 경로 import를 추출해 그래프를 만들고, **`'use client'` 지시문으로 시작하는 모든 파일**을 시작점으로 BFS해서 다음 모듈에 **도달할 수 없음**을 단정한다:
   - `src/lib/supabase/service.ts` (service-role 클라이언트 생성)
   - `src/services/supabase-admin/` 하위 전체 (service-role 쓰기 경로)

   현재 `'use client'` 파일은 `src/components/PremiumSection.tsx`, `AiInsightDemo.tsx`, `UploadFlow.tsx`, `GoogleSignInButton.tsx`, `ErrorModal.tsx`, `CheckoutSuccessBanner.tsx`, `PasswordPrompt.tsx`, `src/hooks/useApiError.ts` 8개다. **이 목록을 테스트에 하드코딩하지 마라** — 파일 시스템을 훑어 `'use client'`를 가진 파일을 동적으로 찾아야 한다. 그래야 새 클라이언트 컴포넌트가 추가될 때 자동으로 검사 범위에 들어온다.

   테스트 파일(`*.test.ts`, `*.test.tsx`)은 그래프에서 제외한다.

4. **가드가 실제로 작동함을 보이는 자기 검증.** 위 3번 검사 로직이 "아무것도 못 찾는 빈 검사"가 아님을 확인하는 테스트를 하나 넣는다. 예: 그래프 탐색 함수를 export해두고, 인위적인 시작점(예: `src/services/supabase-admin/index.ts` 자기 자신)에서 출발하면 금지 모듈에 **도달한다**고 단정한다. 시작점 수집이 0개면 실패하도록 `expect(clientEntrypoints.length).toBeGreaterThan(0)`도 함께 단정한다.

5. 검사 대상 경로·허용 목록·금지 모듈 목록은 테스트 파일 상단에 상수로 모아 **한국어 주석**과 함께 둔다. 나중에 서버 전용 모듈이 늘면 여기만 고치면 되도록 한다.

## Acceptance Criteria

- [ ] 새 테스트 파일이 존재하고 `npm run test`에 포함되어 통과한다.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 등장 파일이 `src/lib/supabase/service.ts`, `src/lib/supabase/service.test.ts` 2개로 한정됨을 단정하는 테스트가 있다. 세 번째 파일이 생기면 실패한다.
- [ ] `NEXT_PUBLIC_`와 `SERVICE_ROLE`이 한 식별자에 함께 등장하는 경우가 0건임을 단정하는 테스트가 있다.
- [ ] `'use client'` 파일 목록을 **파일 시스템에서 동적으로 수집**한다(하드코딩된 8개 배열이 아니다). 수집 결과가 0개면 테스트가 실패한다.
- [ ] 수집된 모든 클라이언트 진입점에서 상대 경로 import를 따라가 `src/lib/supabase/service.ts`와 `src/services/supabase-admin/` 하위에 **도달하지 못함**을 단정한다.
- [ ] 탐색 로직이 실제로 도달을 감지할 수 있음을 보이는 양성 대조(positive control) 테스트가 있다 — 금지 모듈 자신을 시작점으로 주면 도달한다고 나온다.
- [ ] **`next build`를 실행하지 않았고, `.next`/`private/`/`.next-check` 같은 빌드 산출물이 새로 생기지 않았다**(`git status`에 새 untracked 빌드 디렉토리가 없다).
- [ ] 이 step에서 `src/` 하위 **프로덕션 코드는 수정하지 않는다** — 추가되는 것은 테스트 파일뿐이다. 검사가 현재 코드에서 이미 통과해야 한다(위반이 발견되면 고치지 말고 `blocked_reason`에 위반 파일 경로를 기록하고 멈춘다 — 그건 CRITICAL 보안 위반이므로 사람이 판단해야 한다).
- [ ] `npm run typecheck` 통과, `npm run lint` 소스 코드 0 errors, `npm run test` 전부 통과.
