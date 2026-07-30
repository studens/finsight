# Scope — 5-logout

작성일: 2026-07-30

## 배경

`google-auth` 설정 작업 중 로그아웃 기능이 없다는 것이 확인됐다. 이는 누락이 아니라 **의도적 보류**였다 — `docs/BROWSER-TEST-SCENARIOS.md:16`에 "**로그아웃 UI 없음** — 세션 정리는 브라우저 쿠키/스토리지 삭제로 대체한다"로 명시돼 있었다. 이 phase는 그 보류를 해제한다.

## 사용자 결정 사항

| 항목 | 결정 |
|---|---|
| 산출물 형태 | Codex phase 계획 (`phases/5-logout/`) — CLAUDE.md 규약대로 execute.py에 위임 |
| 로그아웃 진입점 | **공용 대시보드 헤더 신설** (`src/app/(app)/layout.tsx`). `/dashboard`와 `/dashboard/[analysisId]` 양쪽에 적용되고, 향후 계정·구독 메뉴도 여기에 붙인다 |

대안으로 검토했다가 채택하지 않은 것: 대시보드 페이지 안에 버튼만 두는 최소 변경안 — 분석 상세 페이지(`/dashboard/[analysisId]`)에서 로그아웃이 사라지는 문제가 있어 제외.

## 범위

**포함**
- 서버 세션 종료 경로: `signOut()` 래퍼 + `POST /api/auth/signout` (303 → `/login`)
- `(app)` 라우트 그룹 공용 헤더 + 로그아웃 버튼 (클라이언트 JS 없는 form POST)
- `docs/BROWSER-TEST-SCENARIOS.md`, `docs/ARCHITECTURE.md` 갱신

**제외 (이번 phase에서 하지 않음)**
- 계정 메뉴·드롭다운·아바타 — 헤더 자리만 만들고 메뉴는 넣지 않는다
- 로그인 상태에서 `/login` 접근 시 `/dashboard`로 보내는 미들웨어 규칙 (현재 없음, 별건)
- `/login?error=auth` 실패 문구 UI (`google-auth` 작업에서 발견된 별개 미결 항목)
- 세션 만료·자동 로그아웃 처리

## 사전 확인된 사실 (계획의 근거)

- 세션은 `@supabase/ssr`의 **HTTP-only 쿠키**에 있다 → 클라이언트에서 지울 수 없고 서버 경로가 필요하다.
- `src/app/(app)/` 에 레이아웃 파일이 없다 → 헤더를 놓을 자리가 아예 없어 신설이 필요하다.
- `src/components/ui/button.tsx`에 `variant="text"`가 이미 있다 → 새 variant 추가 불필요.
- `src/middleware.ts`의 matcher는 `/api/*`를 제외한다 → signout 라우트에 미들웨어가 돌지 않으며, matcher 수정도 불필요.
- `vitest.config.ts`는 node 프로젝트가 `src/**/*.test.ts`, components 프로젝트가 `src/components/**/*.test.tsx`만 잡는다 → **`src/app/` 아래 `.tsx` 테스트는 실행되지 않는다.** 레이아웃 테스트는 `src/components/`에 둬야 한다(step1 AC에 반영).

## 실행 전 선행 조건 (CRITICAL)

`scripts/execute.py`의 `_commit_step`은 `git add -A`로 커밋한다. 실행 시점에 **작업 트리가 깨끗하지 않으면 무관한 변경이 로그아웃 커밋에 함께 섞인다.** 현재 `feat-4-pdf-statement` 브랜치에 google-auth 수정과 PDF phase 잔여 변경이 미커밋 상태이므로, 실행 전에 정리해야 한다.
