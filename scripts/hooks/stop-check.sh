#!/bin/bash
# Stop Hook — 세션 종료 전 lint/build/test 실행
# (Claude .claude/settings.json 과 Codex .codex/hooks.json 양쪽에서 공유하는 스크립트)
#
# 실패 시 exit code 2 + stderr 로 "계속 진행(수정)하라"는 신호를 보낸다.
# 성공 시 Codex의 Stop 이벤트는 exit 0일 때 stdout에 JSON을 기대하므로 빈 continue 응답을 출력한다.

cat >/dev/null  # stdin의 hook JSON payload는 사용하지 않음

# 프로젝트가 아직 스캐폴딩되지 않았으면(package.json 없음) 검사를 건너뛴다.
# tdd-guard.sh와 동일한 부트스트랩 예외.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
if [ ! -f "$ROOT/package.json" ]; then
  echo '{"continue": true}'
  exit 0
fi

OUTPUT=$( { npm run lint && npm run build && npm run test; } 2>&1 )
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "$OUTPUT" >&2
  exit 2
fi

echo '{"continue": true}'
