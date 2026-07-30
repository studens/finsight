# QA 계획 검증 — 5-logout (Codex 실행 전)

검증일: 2026-07-30
대상: `phases/5-logout/index.json`, `step0.md`, `step1.md`

> 주: 이번 검증은 별도 qa 에이전트를 소집하지 않고 오케스트레이터가 `integration-qa` 0단계(계획 검증) 기준으로 직접 수행했다.

## 결과 요약

| 항목 | 상태 |
|---|---|
| 스키마 유효성 (execute.py 파싱) | 통과 |
| AC 검증 가능성 | 통과 |
| CRITICAL 규칙의 step 파일 내 인용 | 보완 후 통과 (3건 수정) |
| step 순서 ↔ 실제 의존성 | 통과 |
| 파일경로 ↔ 링크/미들웨어 경계 | 통과 |
| 보안 불변식 | 해당 없음 / 경계 유지 AC로 대체 |

## 통과 항목

**스키마.** `phases/5-logout/index.json`이 `project`/`phase`/`steps` 3필드만 갖고, step 번호가 0,1 연속이며 모두 `status: "pending"`이다. `step0.md`/`step1.md`가 존재한다. `phase` 값 `"5-logout"`이 디렉토리 슬러그와 일치하므로 브랜치는 `feat-5-logout`, 커밋은 `feat(5-logout): step N — ...`이 된다 (`4-pdf-statement`와 같은 최신 관례).

**step 순서.** step 1의 `<form action="/api/auth/signout">`이 step 0에서 만드는 라우트를 가리키므로 0 → 1 순서가 실제 의존성과 일치한다. 역순이면 step 1의 버튼이 404를 친다.

**파일경로 ↔ 링크 경계.**
- `/login` — `src/app/login/page.tsx` 존재 ✓
- `/dashboard` (헤더 워드마크 링크) — `src/app/(app)/dashboard/page.tsx` 존재 ✓
- `/api/auth/signout` — step 0에서 신설, step 1의 form action과 문자열 일치 ✓
- 미들웨어: matcher가 `api(?:/|$)`를 제외하므로 signout 라우트에 세션 갱신 로직이 개입하지 않는다. 로그아웃 후 `/login`은 user=null로 통과, `/dashboard` 재접근은 `/login`으로 리다이렉트 ✓

**AC 검증 가능성.** 전 항목이 grep 결과 개수, 테스트 통과 여부, HTTP status 값, 클래스명 존재처럼 기계적으로 판정 가능한 형태다. "잘 처리하라"류 없음.

## 지적 사항 및 조치 (모두 반영 완료)

### 1. `services/` 경계 규칙이 step 파일에 인용되지 않음 — 반영함

CLAUDE.md의 "외부 API 호출(Claude, Supabase, Polar)은 `src/services/`를 통해서만 수행한다. 컴포넌트나 라우트 핸들러에서 직접 호출하지 않는다"만 보면, Codex가 `signOut`을 `src/services/auth/` 같은 새 디렉토리로 옮기는 "수정"을 할 위험이 있었다.

실제 이 프로젝트의 경계는 **세션·RLS 읽기 = `lib/supabase/`, service-role 쓰기 = `services/supabase-admin`**이고 `docs/ARCHITECTURE.md`도 그렇게 규정한다. step0.md에 이 근거와 "`src/services/` 아래에 새 디렉토리를 만들지 마라"를 명시하고, 대응 AC(라우트가 `@supabase/*`를 직접 import하지 않고 래퍼만 사용)를 추가했다.

### 2. 범위 이탈 방지 장치 없음 — 반영함

미들웨어 matcher를 건드릴 이유가 없는데도 Codex가 "API 라우트니까 matcher를 손봐야 하나" 판단할 여지가 있었다. step0.md에 `src/middleware.ts`/`src/lib/supabase/middleware.ts`가 `git diff` 기준 무변경이어야 한다는 AC를 추가했다. service-role 미참조 AC도 함께 추가했다.

### 3. `docs/ARCHITECTURE.md` 갱신 누락 — 반영함

step1.md가 `BROWSER-TEST-SCENARIOS.md`만 갱신하도록 돼 있었다. `ARCHITECTURE.md`의 `src/app/` 트리에 `(app)/layout.tsx`와 `api/auth/signout/`을 추가하는 AC를 넣었다.

## 특별히 강조한 함정 (계획에 이미 반영됨)

**303 vs 307.** `NextResponse.redirect()`의 기본 status는 307이고, 307은 리다이렉트 후에도 메서드를 유지한다. form POST → 307 → `/login`에 POST가 날아가 실패한다. step0 AC가 status를 **303으로 명시 단정**하도록 했다.

**테스트가 조용히 실행되지 않는 문제.** `vitest.config.ts`는 node 프로젝트가 `src/**/*.test.ts`, components 프로젝트가 `src/components/**/*.test.tsx`만 포함한다. 즉 `src/app/(app)/layout.test.tsx`는 **어느 프로젝트에도 걸리지 않아 통과도 실패도 하지 않는다.** 두 step 모두 "테스트 파일 경로가 `npm run test` 출력 목록에 실제로 나타남"을 AC로 요구하도록 했다.

**로그아웃 실패 시 사용자 가두지 않기.** `signOut()`이 throw해도 500이 아니라 303 `/login`을 반환하도록 AC에 명시했다.

## 미검증 (실행 후 코드 검증 단계로 이월)

- **세션 쿠키가 실제로 지워지는지.** 단위 테스트는 `signOut`을 목킹하므로 `Set-Cookie` 실물을 확인할 수 없다. Route Handler에서 `cookies()` 변경분이 `NextResponse.redirect()` 응답에 병합되는지는 브라우저 확인이 필요하다. step1의 문서 갱신 AC에 "뒤로가기/주소창으로 `/dashboard` 재접근 시 `/login`으로 리다이렉트"를 수동 시나리오로 넣어 두었고, 실행 후 코드 검증에서 실제 브라우저로 확인한다.
- CSRF 방어의 실효성 — `Origin` 헤더 검사는 단위 테스트로 덮이지만, 실제 브라우저 form POST가 same-origin `Origin`을 보내는지는 실행 후 확인.

## 실행 차단 사유

없음. 다만 아래 선행 조건이 해소되지 않으면 커밋이 오염된다.

**작업 트리 정리 필요 (실행 전 필수).** `execute.py._commit_step`이 `git add -A`를 쓴다. 현재 `feat-4-pdf-statement`에 google-auth 수정 등 미커밋 변경이 있어, 이대로 실행하면 `feat(5-logout): step 0` 커밋에 무관한 파일이 함께 들어간다.
