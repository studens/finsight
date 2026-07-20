---
name: phase-planning
description: "scripts/execute.py가 기대하는 phases/{dir}/index.json + step{N}.md 파일 스키마와 Acceptance Criteria 작성법 레퍼런스. db-schema/core-services/api-routes/frontend 플래너 에이전트가 자신의 phase 계획을 파일로 쓸 때 내부적으로 로드한다. 사용자가 'MVP 구현/phase 계획을 짜달라'고 직접 요청한 경우는 finsight-build 오케스트레이터를 대신 사용하라 — 이 스킬은 그 안에서 각 플래너가 참조하는 형식 문서일 뿐, 전체 워크플로우를 수행하지 않는다."
---

# Phase/Step 계획 작성 가이드 (execute.py 스키마)

`scripts/execute.py`는 여기서 만든 계획 파일을 그대로 읽어 Codex CLI에게 한 step씩 순차로 위임한다. 파일 형식이 조금이라도 다르면 스크립트가 그 자리에서 에러를 내고 멈추므로(`ERROR: {path} not found` 등), 아래 스키마를 정확히 지킨다.

## 디렉토리 구조

```
phases/
├── index.json                 ← 전체 phase 목록 (최상위, 있으면 진행률 추적에 쓰임)
├── 0-db-schema/
│   ├── index.json             ← 이 phase의 step 목록
│   ├── step0.md                ← step 0의 작업 지시서
│   ├── step1.md
│   └── ...
├── 1-core-services/
│   └── ...
```

phase 디렉토리 이름은 `{순서번호}-{슬러그}` 형식을 쓴다 (예: `0-db-schema`). 이 슬러그가 그대로 git 브랜치명(`feat-{phase}`)과 커밋 메시지(`feat({phase}): step N — 이름`)에 들어가므로, `index.json`의 `phase` 필드값과 디렉토리 슬러그를 일치시킨다.

## phases/index.json (최상위, 선택이지만 권장)

```json
{
  "phases": [
    { "dir": "0-db-schema", "status": "pending" },
    { "dir": "1-core-services", "status": "pending" },
    { "dir": "2-api-routes", "status": "pending" },
    { "dir": "3-frontend", "status": "pending" }
  ]
}
```

execute.py가 각 phase 완료/실패/차단 시 해당 항목의 `status`와 `completed_at`/`failed_at`/`blocked_at`을 자동으로 갱신한다. 플래너 팀은 초기값(`"pending"`)만 채우면 된다.

## phases/{dir}/index.json (phase별)

```json
{
  "project": "finsight",
  "phase": "db-schema",
  "steps": [
    { "step": 0, "name": "analyses 테이블 마이그레이션", "status": "pending" },
    { "step": 1, "name": "subscriptions 테이블 마이그레이션", "status": "pending" },
    { "step": 2, "name": "RLS 정책 적용 및 advisors 점검", "status": "pending" }
  ]
}
```

- `project`, `phase`, `steps`만 넣는다. `created_at`/`completed_at`은 execute.py가 실행 중 자동으로 채운다.
- 각 step은 `step`(0부터 순번), `name`, `status: "pending"` 세 필드만 초기 상태로 채운다. `completed_at`/`summary`/`error_message`/`blocked_reason`은 Codex가 실행하며 직접 기록하므로 미리 넣지 않는다.
- step 번호는 0부터 연속으로 매긴다 — 건너뛰면 `_execute_all_steps`가 다음 pending step을 순서대로 찾으므로 실행 자체는 되지만, 커밋 메시지의 번호가 어긋나 추적이 혼란스러워진다.

## phases/{dir}/step{N}.md (step별 작업 지시서)

이 파일의 전체 내용이 (자동으로 붙는 프리앰블 뒤에) 그대로 Codex 프롬프트가 된다. 프리앰블이 이미 다음을 자동으로 포함하므로 중복 작성하지 않는다:
- `AGENTS.md` 전체 + `docs/*.md` 전체 (가드레일 — CRITICAL 규칙이 이미 여기 포함됨)
- 이전에 완료된 step들의 `summary` 목록
- "이 step 작업만 하라, 기존 테스트를 깨지 마라, AC를 직접 검증하라, index.json 상태를 갱신하라, 커밋하라" 같은 공통 작업 규칙

따라서 `step{N}.md`에는 **이 step 고유의 내용만** 쓴다:

```markdown
# Step {N}: {한 줄 제목}

## 작업
{무엇을 만들/바꿀 것인지 구체적으로. 파일 경로, 함수/테이블 이름을 명시}

## Acceptance Criteria
- [ ] {검증 가능한 조건 1}
- [ ] {검증 가능한 조건 2}
- [ ] {보안/CRITICAL 규칙과 관련된 조건이 있다면 반드시 포함}
```

### AC(Acceptance Criteria) 작성 원칙

AC는 Codex가 "이 step이 끝났다"고 스스로 판단하는 유일한 기준이다. 모호하면 Codex가 임의로 완료 처리하거나, 반대로 계속 재시도만 반복한다.

**나쁜 예:** "PII를 잘 마스킹하라"
**좋은 예:** "카드번호(구분자 있음/없음 두 케이스), 계좌번호 마스킹 테스트가 Vitest로 통과한다. 이름/전화번호 컬럼은 마스킹이 아니라 결과 객체에서 키 자체가 제거되는지 별도 테스트로 확인한다."

**나쁜 예:** "페이월을 지켜라"
**좋은 예:** "미구독 사용자가 GET /api/reports/:id/:type 호출 시 llm 서비스가 호출되지 않고 403 {code: 'PAYWALL_REQUIRED'}가 즉시 반환되는 테스트가 통과한다."

CLAUDE.md/ADR의 CRITICAL 규칙 중 이 step과 관련된 것은 AC에 **그 규칙의 핵심 문장을 그대로 옮겨** 검증 가능한 조건으로 바꿔 적는다. "관련 문서를 참고하라"처럼 참조만 거는 것은 금지 — Codex는 이 step 파일과 자동 주입된 AGENTS.md/docs만 보고 판단하므로, 이번 step에서 정말 지켜야 할 규칙은 이 파일 안에 있어야 한다.

## step 크기 산정

한 step은 Codex의 **한 번의 `codex exec` 호출**로 끝난다 (실패 시 최대 3회 자동 재시도, `_execute_single_step` 참조). 다음 기준으로 크기를 정한다:

- 너무 크면: 실패 시 재시도 비용이 크고, AC가 여러 관심사를 섞게 되어 검증이 느슨해진다 → 관심사별로 쪼갠다
- 너무 작으면: 커밋 노이즈만 늘고 각 step이 앞뒤 step과 강하게 결합되어 재시도/재실행이 어려워진다 → 의미 있는 단위(테이블 하나, 서비스 함수 하나, 라우트 하나)로 묶는다
- 기준점: "이 step만 읽고 AC를 검증할 수 있는가?"가 아니오라면 너무 크거나 의존성이 잘못 나뉜 것이다

## 실행 방법 (참고 — 플래너가 직접 실행하지 않음)

계획 작성이 끝나면 오케스트레이터(리더)가 `python3 scripts/execute.py {phase-dir}`로 실제 실행을 트리거한다. 플래너 에이전트는 계획 파일만 작성하고 실행하지 않는다.
