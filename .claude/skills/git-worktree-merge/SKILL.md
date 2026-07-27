---
name: git-worktree-merge
description: "이 프로젝트는 여러 git worktree(.claude/worktrees/*)에 각각 다른 미커밋 작업이 동시에 존재하는 경우가 많다. 여러 워크트리/브랜치의 변경사항을 main에 합치거나 push해야 할 때, 또는 merge 전 위험도를 파악해야 할 때 이 스킬을 먼저 로드한다."
---

# 여러 워크트리를 안전하게 main에 합치는 절차

이 프로젝트는 db-schema/core-services/api-routes/frontend 등 여러 브랜치를 별도 `.claude/worktrees/*`에서 병렬로 작업하는 습관이 있다. 각 워크트리는 서로 다른 시점에서 분기했고, 미커밋 변경사항을 그대로 갖고 있는 경우가 흔하다. 이 상태에서 브랜치를 잘못된 순서로 checkout/merge하면 작업이 섞이거나 유실될 수 있다.

## 0. 절대 하지 말 것

- 미커밋 변경사항이 있는 워크트리에서 다른 브랜치로 `checkout`하기 전에 **반드시 먼저 stash 또는 commit**한다. (checkout이 거부되면 그건 안전장치가 작동한 것 — `--force`로 뚫지 않는다.)
- `git merge`나 `git push`를 실행하기 전에, 정말 그 범위(어느 브랜치의 어느 변경사항까지)를 합치는 게 맞는지 사용자에게 확인한다. "main에 합쳐줘"가 어느 브랜치/어느 미커밋 변경사항까지 포함하는지는 대개 불명확하다 — 짐작하지 말고 물어본다.
- 원격(`origin`)으로 push하는 것은 공유 상태를 바꾸는 행동이다. 로컬 merge까지는 검증 후 진행해도 되지만, push는 테스트가 다 통과한 뒤에만.

## 1. 먼저 전체 그림 파악 (읽기 전용)

```bash
node scripts/worktree-status.js main
```

각 워크트리의 브랜치, 미커밋 변경 개수, `main` 기준 ahead/behind를 한 번에 보여준다. 이 결과로 다음을 판단한다:

- **"동일 (merge 불필요)"** — 이미 main에 다 들어가 있음, 손댈 것 없음.
- **"fast-forward merge 가능"** — 분기된 커밋 없이 그냥 앞서 있음, 충돌 위험 없음.
- **"분기됨 (+N/-M)"** — 3-way merge 필요, 충돌 가능성 있음. 어떤 파일이 겹치는지 먼저 확인(§2).
- **미커밋 변경 개수 > 0** — 그 워크트리에서 브랜치를 옮기기 전에 반드시 stash 또는 commit.

## 2. 충돌 위험 사전 점검 (여러 브랜치를 합칠 때)

두 브랜치를 각각 main에 합치기 전에, 서로 같은 파일을 건드리는지 확인해두면 실제 merge 때 놀랄 일이 없다.

```bash
git diff --name-only <base>...<branch-A>
git diff --name-only <base>...<branch-B>
# 두 목록에 공통으로 나오는 파일이 있으면 그 파일만 미리 diff로 비교
```

`tsconfig.json`처럼 `next dev`가 자동으로 추가하는 설정은 여러 브랜치가 독립적으로 똑같이 수정하는 경우가 많다 — 이 경우 git이 동일한 변경으로 인식해 충돌 없이 자동 병합된다.

## 3. 실행 순서 (전형적인 패턴)

```bash
# A. 워크트리 W1에 미커밋 변경이 있다면, W1에서:
git stash push -u -m "설명"

# B. main을 가진 워크트리(보통 메인 워크트리)에서:
git checkout main
git merge <branch-A> --ff-only      # ahead-only면 이걸로 끝
git merge <branch-B> --no-edit      # 분기됐으면 3-way, 충돌 나면 아래 §4

# C. 검증 (반드시 merge 직후, push 전에)
npm run test
npm run typecheck
npm run lint
npm run build            # 실제 next build — tsc/vitest만으로는 프로덕션 빌드 실패를 못 잡는다
# UI를 건드렸다면 visual-check 스킬로 브라우저 스모크 테스트도 추가

# D. 전부 통과하면 push
git push origin main

# E. 원래 작업 브랜치로 복귀 + stash 복원
git checkout <원래 브랜치>
git stash pop
```

## 4. 충돌이 실제로 발생하면

- `git status`로 충돌 파일 목록 확인 → 각 파일을 열어 `<<<<<<<`/`=======`/`>>>>>>>` 구간을 실제 내용을 보고 판단해서 합친다(자동으로 한쪽을 버리지 않는다).
- 합친 뒤 반드시 §3-C 검증을 전부 통과시킨다 — 충돌 해결 자체가 새 버그를 만들 수 있다.
- 충돌 해결 방향이 애매하면(어느 쪽 로직이 맞는지 코드만 봐서 판단 안 될 때) 사용자에게 확인한다.

## 5. 커밋 그루핑 원칙

미커밋 변경사항을 커밋할 때는 성격이 다른 변경을 하나로 묶지 않는다(예: 버그수정 / 문서 추가 / UI 변경은 각각 별도 conventional commit). 이유: 나중에 `git log`나 `git blame`으로 "이 변경이 왜 들어갔는지" 추적할 때, 묶여 있으면 무관한 변경까지 같이 걸려 나온다.

`handoff.md`처럼 세션 인수인계용 메모는 기본적으로 커밋 대상에서 제외한다(코드베이스 문서가 아니라 작업 중 스크래치 노트이기 때문) — 다만 사용자가 명시적으로 원하면 포함한다.
