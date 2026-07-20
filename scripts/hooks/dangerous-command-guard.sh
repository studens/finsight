#!/bin/bash
# PreToolUse[Bash] Hook — 위험한 명령어 차단
# rm -rf, force push, reset --hard, DROP TABLE 등을 실행 전에 차단한다.
# (Claude .claude/settings.json 과 Codex .codex/hooks.json 양쪽에서 공유하는 스크립트)
#
# 두 도구 모두 PreToolUse 훅에 tool_input을 stdin JSON으로 전달하고,
# exit code 2 + stderr 를 "차단" 신호로 취급한다.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE 'rm\s+-rf|git\s+push\s+--force|git\s+reset\s+--hard|DROP\s+TABLE'; then
  echo "BLOCKED: 위험한 명령어가 감지되었습니다." >&2
  exit 2
fi

exit 0
