#!/usr/bin/env bash
# review-ci.sh — review-code 스킬을 비대화(headless) 모드로 돌려 기계가 읽을 결과를 남긴다.
#
# pre-push 훅과 GitHub Action이 공유하는 단일 진입점이다.
# 리뷰 규칙·차원·심각도 기준은 전부 .claude/skills/review-code/ 에 있다 — 여기에 다시 적지 않는다.
#
# 사용법:
#   scripts/review-ci.sh --base <커밋해시> [--out <디렉터리>] [--deep] [--dimensions a,b,c]
#
# 산출물:
#   <out>/review.json  기계용 (판정·집계·지적 목록)
#   <out>/review.md    사람용 (스킬 산출물 B + A)
#
# 종료 코드:
#   0  Approve — critical/major 없음
#   1  조치 필요 — critical 또는 major 있음
#   2  리뷰 미완료 — 실행 실패·JSON 없음·미검토 차원 존재
#      ⚠️ 2를 "문제 없음"으로 취급하지 마라. 스킬의 제1원칙이다.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || exit 2

BASE=""
OUT="_workspace/review-ci"
DEEP=0
DIMENSIONS=""
need_value() { # 값이 없으면 shift 2 가 실패해 같은 인자를 무한히 다시 읽는다
  [ -n "${2:-}" ] || { echo "review-ci: $1 에 값이 필요합니다" >&2; exit 2; }
}
while [ $# -gt 0 ]; do
  case "$1" in
    --base)       need_value "$1" "${2:-}"; BASE="$2"; shift 2 ;;
    --out)        need_value "$1" "${2:-}"; OUT="$2"; shift 2 ;;
    --dimensions) need_value "$1" "${2:-}"; DIMENSIONS="$2"; shift 2 ;;
    --deep)       DEEP=1; shift ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done

[ -n "$BASE" ] || { echo "review-ci: --base <커밋해시> 가 필요합니다" >&2; exit 2; }
git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || {
  echo "review-ci: BASE '$BASE' 를 이 저장소에서 찾을 수 없습니다 (CI라면 fetch-depth: 0 확인)" >&2
  exit 2
}
command -v claude >/dev/null || { echo "review-ci: claude CLI 를 찾을 수 없습니다" >&2; exit 2; }
# CI에는 대화형 로그인도 키체인도 없다. 인증이 없으면 claude 가 알기 어려운 에러로 죽으므로
# 여기서 먼저 끊어 무엇을 설정해야 하는지 알려준다. (로컬은 OAuth 로그인 상태를 쓰므로 통과)
if [ -n "${CI:-}" ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "review-ci: CI에 Claude 인증이 없습니다 — CLAUDE_CODE_OAUTH_TOKEN 또는 ANTHROPIC_API_KEY 시크릿을 설정하세요." >&2
  echo "  구독 토큰 발급: claude setup-token → gh secret set CLAUDE_CODE_OAUTH_TOKEN" >&2
  exit 2
fi

BASE_SHA=$(git rev-parse "$BASE")
mkdir -p "$OUT"
JSON="$OUT/review.json"
MD="$OUT/review.md"
rm -f "$JSON" "$MD"

# ── 리뷰 대상 확정 ────────────────────────────────────────────────────────────
# 스킬 1단계와 같은 규칙이지만, 브랜치를 추측하지 않고 주어진 BASE만 쓴다.
# 리뷰 가치가 없는 경로는 제외하고, 제외했다는 사실은 프롬프트에 적어 보고에 남게 한다.
EXCLUDE='^(package-lock\.json|_workspace/|phases/|\.next|node_modules/|.*\.(png|jpg|jpeg|gif|svg|ico|pdf|csv|lock)$)'

# 시크릿 경로(`.env*`)는 .gitignore 로도 막지만 여기서 한 번 더 막는다 — 방어를 한 겹에만
# 두면 .gitignore 가 느슨해지는 순간(과거 `.env*.local` 만 막던 시절) 시크릿 전문이
# "Read 로 읽어라"는 프롬프트와 함께 LLM 세션과 review.md 로 나간다.
# `.env.example` 은 값이 빈 템플릿이라 리뷰 대상으로 남긴다.
# ERE 에는 부정 룩어헤드가 없으므로 정규식에 끼워넣지 않고 awk 로 basename 을 검사한다.
drop_secret_paths() {
  awk '{ b=$0; sub(/.*\//, "", b); if (b ~ /^\.env/ && b != ".env.example") next; print }'
}
# core.quotePath=false : 비ASCII 경로를 큰따옴표+8진 이스케이프로 내보내지 않게 한다.
# 이스케이프된 경로가 프롬프트에 실리면 리뷰어의 Read/git diff가 실패하고, 그 차원은
# "발견 0건"으로 보고된다 — 보지 않은 것을 봤다고 말하는, 이 하네스 최악의 실패다.
TRACKED=$(git -c core.quotePath=false diff --name-only "$BASE_SHA"...HEAD 2>/dev/null | grep -vE "$EXCLUDE" | drop_secret_paths || true)
# 미추적(신규) 파일 — diff가 0바이트로 나오므로 Read로 읽어야 한다. CI에서는 보통 비어 있다.
UNTRACKED=$(git -c core.quotePath=false ls-files --others --exclude-standard 2>/dev/null | grep -vE "$EXCLUDE" | drop_secret_paths || true)

N_TRACKED=$(printf '%s\n' "$TRACKED" | grep -c . || true)
N_UNTRACKED=$(printf '%s\n' "$UNTRACKED" | grep -c . || true)
TOTAL=$((N_TRACKED + N_UNTRACKED))

if [ "$TOTAL" -eq 0 ]; then
  printf '{"skipped":true,"reason":"리뷰할 변경 파일이 없습니다","base":"%s","prVerdict":"Approve","counts":{"critical":0,"major":0,"minor":0,"nit":0},"confirmed":[],"failedDimensions":[]}\n' "$BASE_SHA" > "$JSON"
  echo "리뷰할 변경 파일이 없습니다 — 건너뜁니다." | tee "$MD"
  exit 0
fi
if [ "$TOTAL" -gt 40 ]; then
  echo "review-ci: 변경 파일 $TOTAL 개 — 스킬 상한(40)을 넘습니다. 범위를 좁혀 다시 실행하세요." >&2
  exit 2
fi

echo "리뷰 대상: 변경 $N_TRACKED · 신규 $N_UNTRACKED (base ${BASE_SHA:0:8})"

# ── 프롬프트 구성 ─────────────────────────────────────────────────────────────
PROMPT=$(cat <<EOF
review-code 스킬을 **CI 모드**로 실행하라. 먼저 \`.claude/skills/review-code/SKILL.md\` 를 읽고,
그 안의 "## CI 모드" 절이 정하는 규칙을 따르라.

CI 모드 파라미터:
- BASE 커밋: $BASE_SHA
- 출력 JSON 경로: $JSON
- 출력 마크다운 경로: $MD
- 깊은 검증(--deep): $([ "$DEEP" -eq 1 ] && echo "예" || echo "아니오")
- 차원: $([ -n "$DIMENSIONS" ] && echo "$DIMENSIONS" || echo "기본 3개 전부")

변경 파일 (${N_TRACKED}개) — \`git diff $BASE_SHA...HEAD -- <파일>\` 로 diff를 떠서 리뷰하라
(파일 목록도 같은 3-dot 범위에서 뽑았다 — 2-dot 으로 뜨면 범위가 어긋난다):
$(printf '%s\n' "$TRACKED" | sed 's/^/- /')

$(if [ "$N_UNTRACKED" -gt 0 ]; then
  printf '신규(미추적) 파일 (%s개) — diff가 비어 있다. Read로 파일 전문을 읽고 전체를 새 코드로 간주해 리뷰하라:\n' "$N_UNTRACKED"
  printf '%s\n' "$UNTRACKED" | sed 's/^/- /'
else
  printf '신규(미추적) 파일: 없음\n'
fi)

리뷰 대상에서 제외한 경로: package-lock.json, _workspace/, phases/, 빌드 산출물, 바이너리·CSV·이미지.
이 사실을 마크다운 보고 하단에 한 줄로 남겨라.

이 세션은 자동화가 호출했다. 사람이 답할 수 없으니 질문하지 말고, 확인을 구하지 말고, 끝까지 진행하라.
마지막에 반드시 위 두 파일을 **Write로 생성**하라. 파일이 없으면 이 실행은 실패로 처리된다.
EOF
)

# ── 실행 ──────────────────────────────────────────────────────────────────────
# REVIEW_CI=1 : scripts/hooks/stop-check.sh 가 검증 빌드(lint/build/test)를 건너뛰게 한다.
#               CI에서는 별도 job이, 로컬에서는 Stop 훅이 이미 담당하므로 여기서 또 돌릴 이유가 없다.
# --disallowedTools : Edit/NotebookEdit(파일 수정)과 WebFetch/WebSearch(외부 반출 경로)를 막는다.
#   ⚠️ Bash는 남아 있으므로 이것은 "코드를 못 고친다"는 보장이 아니다 — Bash로 우회할 수 있다.
#      리뷰 대상이 PR이 통제하는 내용(diff·SKILL.md 등)이라 프롬프트 인젝션 표면이 존재한다.
#      반출 대상에는 CLAUDE_CODE_OAUTH_TOKEN(구독 연동 토큰)과 ANTHROPIC_API_KEY(종량 과금
#      API 키)가 포함된다. 후자가 새면 그 키가 속한 계정에 직접 청구된다.
#      현재 완화책: fork PR에는 시크릿 미전달(워크플로의 head.repo 동일성 검사로 job 자체를
#      실행하지 않음) · 이 스텝에 GITHUB_TOKEN 미주입 · 워크플로의 persist-credentials: false
#      · PreToolUse[Bash] 위험 명령 가드.
#      ⚠️ 2026-09-01 저장소가 public으로 전환되어 "private 저장소" 완화책은 사라졌다.
#      다만 fork 가드가 있어 인젝션 표면은 "이 저장소에 push 권한이 있는 사람이 올린 PR"로
#      한정된다. 외부 컨트리뷰터를 실제로 받게 되면 Bash 화이트리스트로 좁혀야 한다.
TREE_BEFORE=$(git status --porcelain --untracked-files=no)

REVIEW_CI=1 claude \
  --print \
  --model "${REVIEW_MODEL:-opus}" \
  --dangerously-skip-permissions \
  --disallowedTools Edit NotebookEdit WebFetch WebSearch \
  --output-format text \
  "$PROMPT" > "$OUT/session.log" 2>&1
CLAUDE_STATUS=$?

TREE_AFTER=$(git status --porcelain --untracked-files=no)
if [ "$TREE_BEFORE" != "$TREE_AFTER" ]; then
  echo "⚠️ review-ci: 리뷰가 추적 중인 파일을 변경했습니다. 리뷰는 읽기 전용이어야 합니다 — 확인 필요." >&2
fi

if [ "$CLAUDE_STATUS" -ne 0 ]; then
  echo "review-ci: claude 실행 실패 (exit $CLAUDE_STATUS). 로그: $OUT/session.log" >&2
  tail -30 "$OUT/session.log" >&2
  exit 2
fi
if [ ! -s "$JSON" ]; then
  echo "review-ci: $JSON 이 생성되지 않았습니다 — 리뷰 미완료입니다. 통과로 취급하지 마세요." >&2
  tail -30 "$OUT/session.log" >&2
  exit 2
fi

# ── 판정 → 종료 코드 ──────────────────────────────────────────────────────────
node -e '
const fs = require("fs");
let r;
try { r = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("review-ci: review.json 파싱 실패 — " + e.message); process.exit(2); }

// 종료 코드는 LLM이 스스로 적은 counts가 아니라 confirmed 배열을 직접 센 값으로 정한다.
// counts만 누락되거나 틀린 JSON이 exit 0으로 새어나가면 게이트 전체가 무의미해진다.
const SEV = ["critical", "major", "minor", "nit"];
if (!Array.isArray(r.confirmed) || typeof r.prVerdict !== "string" || r.counts == null) {
  console.error("review-ci: review.json 이 계약을 지키지 않습니다 (confirmed/prVerdict/counts) — 미검토로 처리합니다.");
  process.exit(2);
}
const actual = Object.fromEntries(SEV.map((s) => [s, r.confirmed.filter((f) => f.severity === s).length]));
const n = (k) => actual[k];

const drift = SEV.filter((s) => Number(r.counts[s] ?? -1) !== actual[s]);
if (drift.length > 0) {
  console.error(`review-ci: counts 가 confirmed 와 불일치합니다 (${drift.join(", ")}) — 결과를 신뢰할 수 없어 미검토로 처리합니다.`);
  console.error(`  counts=${JSON.stringify(r.counts)} 실제=${JSON.stringify(actual)}`);
  process.exit(2);
}

const failed = Array.isArray(r.failedDimensions) ? r.failedDimensions : [];
console.log(`판정: ${r.prVerdict}  🔴 ${n("critical")} · 🟠 ${n("major")} · 🟡 ${n("minor")} · ⚪ ${n("nit")}`);
if (r.unverifiedCount) console.log(`미검증 지적: ${r.unverifiedCount}건`);

// 미검토 차원은 "통과"가 아니다 — 스킬이 가장 위험한 실패로 지목한 케이스.
if (failed.length > 0) {
  console.error(`미검토 차원 ${failed.length}개: ${failed.join(", ")} — 통과로 세지 않습니다.`);
  process.exit(2);
}
process.exit(n("critical") + n("major") > 0 ? 1 : 0);
' "$JSON"
EXIT=$?

echo "산출물: $JSON · $MD"
exit $EXIT
