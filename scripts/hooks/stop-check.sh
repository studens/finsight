#!/bin/bash
# Stop Hook — 세션 종료 전 lint/build/test 실행
# (Claude .claude/settings.json 과 Codex .codex/hooks.json 양쪽에서 공유하는 스크립트)
#
# 실패 시 exit code 2 + stderr 로 "계속 진행(수정)하라"는 신호를 보낸다.
# 성공 시 Codex의 Stop 이벤트는 exit 0일 때 stdout에 JSON을 기대하므로 빈 continue 응답을 출력한다.

cat >/dev/null  # stdin의 hook JSON payload는 사용하지 않음

# scripts/review-ci.sh 가 띄운 리뷰 전용 헤드리스 세션에서는 검증 빌드를 돌리지 않는다.
# 리뷰는 읽기 전용이고, lint/build/test는 CI의 별도 job(또는 로컬 pre-commit)이 담당한다.
if [ -n "${REVIEW_CI:-}" ]; then
  echo '{"continue": true}'
  exit 0
fi

# 프로젝트가 아직 스캐폴딩되지 않았으면(package.json 없음) 검사를 건너뛴다.
# tdd-guard.sh와 동일한 부트스트랩 예외.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
if [ ! -f "$ROOT/package.json" ]; then
  echo '{"continue": true}'
  exit 0
fi

# 검증 빌드는 .next-check로 출력한다(next.config.ts의 NEXT_DIST_DIR).
# 실행 중인 dev 서버가 .next를 쓰고 있으므로 같은 디렉터리에 빌드하면
# 양쪽 산출물이 섞여 "Cannot find module for page: /_document" 등으로 깨진다.
OUTPUT=$( { npm run lint && NEXT_DIST_DIR=.next-check npm run build && npm run test; } 2>&1 )
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "$OUTPUT" >&2
  exit 2
fi

echo '{"continue": true}'
