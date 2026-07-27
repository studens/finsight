#!/usr/bin/env node
// 여러 git worktree(브랜치)에 미커밋 변경사항이 흩어져 있을 때, 상태를 한 번에 파악하는 조회 전용 도구.
// git을 변경하지 않는다(add/commit/checkout/merge 없음) — merge/push 판단은 사람(또는 에이전트)이 직접 한다.
//
// 사용법: node scripts/worktree-status.js [기준 브랜치, 기본값 main]

const { execFileSync } = require("child_process");

function git(args, opts = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function listWorktrees() {
  const raw = git(["worktree", "list", "--porcelain"]);
  if (!raw) return [];
  const worktrees = [];
  let current = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    } else if (line === "detached") {
      current.branch = "(detached)";
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

function main() {
  const base = process.argv[2] || "main";
  const worktrees = listWorktrees();

  console.log(`기준 브랜치: ${base}\n`);

  for (const wt of worktrees) {
    const branch = wt.branch || "(detached)";
    const status = git(["status", "--porcelain"], { cwd: wt.path }) || "";
    const dirtyCount = status ? status.split("\n").length : 0;

    let relation = "-";
    if (branch !== base && branch !== "(detached)") {
      const uniqueToBranch = git(["log", `${base}..${branch}`, "--oneline"], { cwd: wt.path });
      const uniqueToBase = git(["log", `${branch}..${base}`, "--oneline"], { cwd: wt.path });
      const aheadCount = uniqueToBranch ? uniqueToBranch.split("\n").length : 0;
      const behindCount = uniqueToBase ? uniqueToBase.split("\n").length : 0;

      if (aheadCount === 0 && behindCount === 0) {
        relation = "동일 (merge 불필요)";
      } else if (aheadCount > 0 && behindCount === 0) {
        relation = `${base}보다 ${aheadCount}개 커밋 앞섬 → fast-forward merge 가능`;
      } else if (aheadCount === 0 && behindCount > 0) {
        relation = `${base}보다 ${behindCount}개 커밋 뒤처짐`;
      } else {
        relation = `분기됨 (${base} 기준 +${aheadCount}/-${behindCount}) → 3-way merge, 충돌 가능성 있음`;
      }
    }

    console.log(`## ${wt.path}`);
    console.log(`   브랜치: ${branch}`);
    console.log(`   미커밋 변경: ${dirtyCount}개${dirtyCount === 0 ? " (깨끗함)" : ""}`);
    console.log(`   ${base} 대비: ${relation}`);
    console.log("");
  }

  console.log("다음 단계 가이드는 .claude/skills/git-worktree-merge/SKILL.md 참고.");
}

main();
