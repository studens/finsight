#!/usr/bin/env node
// post-review.mjs — review-ci.sh 가 남긴 결과를 PR에 게시한다.
//
//   1) 요약(스킬 산출물 B) → 고정 코멘트 1개를 in-place 갱신 (push마다 새 코멘트를 쌓지 않는다)
//   2) critical/major 지적 → diff에 존재하는 라인에만 인라인 리뷰 코멘트
//
// diff에 없는 라인에 인라인 코멘트를 달면 GitHub API가 리뷰 전체를 거부한다.
// 그래서 라인 유효성을 먼저 확인하고, 붙일 수 없는 지적은 요약 코멘트 본문으로 넘긴다.
//
// 사용법: node scripts/ci/post-review.mjs <review.json> <review.md> <PR번호>
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [jsonPath, mdPath, prNumber] = process.argv.slice(2);
if (!jsonPath || !prNumber) {
  console.error("사용법: post-review.mjs <review.json> <review.md> <PR번호>");
  process.exit(2);
}

const MARKER = "<!-- finsight-ai-review -->";
const REPO = process.env.GITHUB_REPOSITORY;
if (!REPO) { console.error("GITHUB_REPOSITORY 가 없습니다"); process.exit(2); }

const gh = (args, input) =>
  execFileSync("gh", args, { input, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

// --slurp 없이 --paginate 를 쓰면 페이지마다 별개의 JSON 배열이 이어져 나와 JSON.parse 가 던진다
// (GitHub 기본 per_page=30 → 파일 31개부터). --slurp 이 전체를 한 배열로 감싸므로 flat() 으로 펼친다.
//
// ⚠️ 이 선언은 반드시 아래 "결과 읽기"보다 위에 있어야 한다. upsertSticky 는 호이스팅되는
//    함수 선언이라 어디서든 호출되지만 본문에서 ghJson 을 쓴다 — 선언이 아래에 있으면
//    리뷰 실패 경로(결과 파일 없음)에서 호출할 때 TDZ 로 죽는다.
//    그 경로는 "이것은 문제 없음이 아니라 미검토입니다"를 알리는 유일한 통로이므로,
//    거기서 죽으면 PR에 아무 설명도 남지 않은 채 job 만 빨간불이 된다(실측 재현).
const ghJson = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

// ── 결과 읽기 ────────────────────────────────────────────────────────────────
let review;
try { review = JSON.parse(readFileSync(jsonPath, "utf8")); }
catch (e) {
  // 리뷰가 완료되지 못한 경우다. 조용히 넘어가면 "문제 없음"으로 읽힌다 — 그걸 막는다.
  upsertSticky(`${MARKER}\n## 🤖 AI 코드 리뷰 — 실행 실패\n\n리뷰가 결과 파일을 남기지 못했습니다. Actions 로그를 확인하세요.\n\n> 이것은 "문제 없음"이 아니라 **미검토**입니다.`);
  process.exit(0);
}

if (review.skipped) {
  console.log("리뷰 대상이 없어 게시를 건너뜁니다.");
  process.exit(0);
}

const md = mdPath && existsSync(mdPath) ? readFileSync(mdPath, "utf8").trim() : "";
const findings = Array.isArray(review.confirmed) ? review.confirmed : [];
const failed = Array.isArray(review.failedDimensions) ? review.failedDimensions : [];

// ── diff에 존재하는 라인 집합 만들기 ─────────────────────────────────────────
// PR files API의 patch에서 hunk 헤더(@@ -a,b +c,d @@)를 읽어 신규(RIGHT) 측 라인을 모은다.
const validLines = new Map(); // path -> Set<line>

for (const f of ghJson(`repos/${REPO}/pulls/${prNumber}/files`)) {
  if (!f.patch) continue;
  const set = new Set();
  let line = 0;
  for (const l of f.patch.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (m) { line = Number(m[1]); continue; }
    if (l.startsWith("+")) set.add(line++);
    else if (l.startsWith("-")) continue;
    else if (l.startsWith("\\")) continue;
    else line++;                       // 컨텍스트 줄 — 코멘트 가능하지만 신규 줄만 쓴다
  }
  validLines.set(f.filename, set);
}

// ── 인라인 코멘트 (critical/major만) ─────────────────────────────────────────
const SEV = { critical: "🔴 critical", major: "🟠 major", minor: "🟡 minor", nit: "⚪ nit" };
const inlineBody = (f) =>
  [`> ${SEV[f.severity] ?? f.severity} | ${f.title}`,
   `> TL;DR: ${f.tldr}`,
   `> ✓ Good: ${f.good}`,
   `> → Fix: ${f.fix}`].join("\n");

const inline = [], orphan = [];
for (const f of findings) {
  if (f.severity !== "critical" && f.severity !== "major") continue;
  if (validLines.get(f.file)?.has(Number(f.line))) {
    inline.push({ path: f.file, line: Number(f.line), side: "RIGHT", body: inlineBody(f) });
  } else {
    orphan.push(f);
  }
}

if (inline.length > 0) {
  try {
    gh(["api", "--method", "POST", `repos/${REPO}/pulls/${prNumber}/reviews`, "--input", "-"],
       JSON.stringify({ body: `${MARKER}\nAI 리뷰 인라인 코멘트 ${inline.length}건`, event: "COMMENT", comments: inline }));
    console.log(`인라인 코멘트 ${inline.length}건 게시`);
  } catch (e) {
    // 리뷰 게시가 실패하면 지적을 잃지 않도록 전부 요약으로 넘긴다.
    // orphan 에 이미 들어간 것과 겹치지 않게 다시 만든다 (push 하면 같은 지적이 두 번 나온다)
    console.error(`인라인 코멘트 게시 실패 — 요약으로 넘깁니다: ${e.message}`);
    orphan.length = 0;
    orphan.push(...findings.filter((f) => f.severity === "critical" || f.severity === "major"));
  }
}

// ── 요약 고정 코멘트 ─────────────────────────────────────────────────────────
const c = review.counts ?? {};
const n = (k) => Number(c[k] ?? 0);
let body = `${MARKER}\n`;

if (failed.length > 0) {
  body += `> [!CAUTION]\n> **미검토 차원 ${failed.length}개: ${failed.join(", ")}** — 이 차원은 "문제 없음"이 아니라 **검토되지 않았습니다**.\n\n`;
}
if (review.unverifiedCount) {
  body += `> [!NOTE]\n> 검증 상한에 걸려 ${review.unverifiedCount}건은 반증 검증을 거치지 않았습니다.\n\n`;
}

body += md || `## 판정: ${review.prVerdict}\n🔴 ${n("critical")} · 🟠 ${n("major")} · 🟡 ${n("minor")} · ⚪ ${n("nit")}`;

if (orphan.length > 0) {
  body += `\n\n---\n\n### diff 밖 라인의 지적 ${orphan.length}건\n`;
  body += `해당 라인이 이 PR의 diff에 없어 인라인으로 달 수 없었습니다.\n\n`;
  for (const f of orphan) {
    body += `- \`${f.file}:${f.line}\` · ${SEV[f.severity] ?? f.severity} — **${f.title}**\n  ${f.tldr}\n  → ${f.fix}\n`;
  }
}
body += `\n\n<sub>🤖 \`review-code\` 스킬 · base \`${String(review.base ?? "").slice(0, 8)}\` · 파일 ${review.filesReviewed ?? 0}개</sub>`;

upsertSticky(body);

function upsertSticky(text) {
  const comments = ghJson(`repos/${REPO}/issues/${prNumber}/comments`);
  // 마커만으로 찾으면 마커를 인용한 사람의 코멘트를 덮어쓸 수 있다 — 봇이 쓴 것만 갱신한다.
  const mine = comments.find(
    (x) => typeof x.body === "string" && x.body.includes(MARKER) && x.user?.type === "Bot",
  );
  if (mine) {
    gh(["api", "--method", "PATCH", `repos/${REPO}/issues/comments/${mine.id}`, "--input", "-"],
       JSON.stringify({ body: text }));
    console.log(`요약 코멘트 갱신 (#${mine.id})`);
  } else {
    gh(["api", "--method", "POST", `repos/${REPO}/issues/${prNumber}/comments`, "--input", "-"],
       JSON.stringify({ body: text }));
    console.log("요약 코멘트 생성");
  }
}
