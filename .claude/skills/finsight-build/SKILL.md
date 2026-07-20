---
name: finsight-build
description: "finsight MVP를 Codex(scripts/execute.py)가 구현하도록, Claude 에이전트 팀(db-schema, core-services, api-routes, frontend, qa)이 phase/step 계획을 세우고 QA로 검증한 뒤 execute.py 실행을 오케스트레이션하는 스킬. 'phase 계획 짜줘', 'MVP 구현 계획 세워줘', 'execute.py 실행해줘', 'Codex에게 넘겨줘', '계획대로 진행해줘' 요청 시 사용. 이 팀은 코드를 직접 작성하지 않고 계획·실행 트리거·검증만 담당한다. 후속 작업(특정 phase 계획만 다시, QA 지적사항 반영해 계획 수정, blocked/error 난 step 재실행)에도 이 스킬을 사용한다."
---

# finsight Build Orchestrator (Plan → Handoff → Verify)

이 팀은 **코드를 직접 작성하지 않는다.** finsight MVP 구현은 `scripts/execute.py`가 Codex CLI에 위임해 실제로 수행하고, 이 팀의 역할은 (1) Codex가 실행할 phase/step 계획을 짜고, (2) 계획을 QA로 검증하고, (3) `execute.py`를 실제로 트리거하고, (4) 실행 결과(성공/실패/차단)와 실제 코드를 다시 QA로 검증하는 것이다.

## 실행 모드: 에이전트 팀 (계획·검증) + 리더의 직접 실행 (execute.py 트리거)

## 왜 이렇게 나뉘는가

`scripts/execute.py`는 `codex exec --dangerously-bypass-approvals-and-sandbox`로 Codex에게 승인 절차 없이 코드 작성·git 커밋·브랜치 생성을 맡긴다. 되돌리기 어려운 실제 부작용(파일 변경, git 히스토리, 선택적으로 `--push`)이 있으므로, 이 실행 트리거는 팀원에게 위임하지 않고 **리더(오케스트레이터)가 사용자 확인을 받은 뒤 직접** Bash로 실행한다. 팀원들은 계획 수립과 검증까지만 담당한다.

## 에이전트 구성

| 팀원 | 에이전트 타입 | 역할 | 스킬 | 출력 |
|------|-------------|------|------|------|
| db-schema | 커스텀 | Supabase 스키마 phase 계획 | phase-planning, supabase-schema | `phases/0-db-schema/` |
| core-services | 커스텀 | csv-parser/pii-masking/llm phase 계획 | phase-planning, csv-pipeline | `phases/1-core-services/` |
| api-routes | 커스텀 | API Route/미들웨어 phase 계획 | phase-planning, api-route-conventions | `phases/2-api-routes/` |
| frontend | 커스텀 | 화면/컴포넌트 phase 계획 | phase-planning, ui-design | `phases/3-frontend/` |
| qa | 커스텀 | 계획 검증 + (실행 후) 코드 검증 | phase-planning, integration-qa | `_workspace/*_qa_plan_review.md`, `_workspace/*_qa_code_review.md` |

모든 Agent/TeamCreate 호출에 `model: "opus"`를 명시한다.

## 워크플로우

### Phase 0: 컨텍스트 확인 (후속 작업 지원)

1. `phases/` 디렉토리와 `_workspace/` 존재 여부 확인
2. 분기:
   - **`phases/` 미존재** → 초기 실행(계획부터). Phase 1로 진행
   - **`phases/` 존재, 아직 미실행(모든 step이 `pending`)** + 사용자가 특정 phase 계획만 수정 요청 → 해당 플래너만 재소집해 그 phase의 계획을 수정
   - **`phases/` 존재, 일부 phase는 실행 완료** + 사용자가 "계속 진행"/"다음 phase 실행" 요청 → Phase 4(실행 트리거)로 바로 진입, 남은 phase만 순서대로 트리거
   - **특정 phase가 `error`/`blocked` 상태** + 사용자가 재실행 요청 → 해당 phase의 `index.json`에서 실패 원인을 확인하고, 필요하면 해당 플래너를 재소집해 step 계획을 수정한 뒤(예: blocked 원인이 계획 누락이면) 그 phase만 다시 `execute.py`로 트리거
3. 애매하면 사용자에게 어느 phase/step을 대상으로 하는지 확인한다

### Phase 1: 준비

1. `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ADR.md`를 다시 읽어 이번 요청의 범위를 확인
2. phase 순서를 결정 — 기본 순서는 의존성에 따라 `0-db-schema` → `1-core-services` → `2-api-routes` → `3-frontend` (한 번에 한 브랜치만 checkout 가능하므로 phase는 병렬 실행이 아니라 순차 실행됨에 유의. 계획 수립 자체는 팀이 병렬로 할 수 있다)
3. `_workspace/00_input/scope.md`에 이번 실행 범위 기록

### Phase 2: 팀 구성 및 계획 착수 (팬아웃)

```
TeamCreate(
  team_name: "finsight-plan-team",
  members: [
    { name: "db-schema", agent_type: "db-schema", model: "opus",
      prompt: "phase-planning과 supabase-schema 스킬을 로드하라. docs/ARCHITECTURE.md, docs/ADR.md(ADR-004~007) 기준으로 phases/0-db-schema/index.json과 step*.md를 작성하라. 코드를 직접 작성하지 마라 — 계획 파일만 작성한다. 완료 시 _workspace/02_db-schema_schema.md에 확정 스키마를 남기고 api-routes에게 알려라." },
    { name: "core-services", agent_type: "core-services", model: "opus",
      prompt: "phase-planning과 csv-pipeline 스킬을 로드하라. docs/ADR.md(ADR-002,003,005) 기준으로 phases/1-core-services/index.json과 step*.md를 작성하라. 코드를 직접 작성하지 마라. 완료 시 _workspace/02_core-services_interface.md에 함수 시그니처를 남기고 api-routes에게 알려라." },
    { name: "api-routes", agent_type: "api-routes", model: "opus",
      prompt: "db-schema/core-services 산출물이 준비되는 대로 phase-planning과 api-route-conventions 스킬을 로드해 phases/2-api-routes/index.json과 step*.md를 작성하라. 완료 시 _workspace/03_api-routes_contract.md를 남기고 frontend에게 알려라." },
    { name: "frontend", agent_type: "frontend", model: "opus",
      prompt: "phase-planning과 ui-design 스킬을 로드하라. api-routes 계약이 아직 없으면 docs/ARCHITECTURE.md 데이터 흐름 기준으로 우선 계획하고, 계약 도착 후 갱신하라. phases/3-frontend/index.json과 step*.md를 작성하라." },
    { name: "qa", agent_type: "qa", model: "opus",
      prompt: "phase-planning과 integration-qa 스킬을 로드하라. 각 플래너가 phase 계획을 완료하면 즉시 계획 검증(0단계)을 수행해 _workspace/{phase}_qa_plan_review.md에 기록하고, 문제 발견 시 해당 플래너에게 SendMessage로 구체적 수정을 요청하라." }
  ]
)
```

```
TaskCreate(tasks: [
  { title: "0-db-schema phase 계획 작성", assignee: "db-schema" },
  { title: "1-core-services phase 계획 작성", assignee: "core-services" },
  { title: "2-api-routes phase 계획 작성", assignee: "api-routes", depends_on: ["0-db-schema phase 계획 작성", "1-core-services phase 계획 작성"] },
  { title: "3-frontend phase 계획 작성", assignee: "frontend", depends_on: ["2-api-routes phase 계획 작성"] },
  { title: "0-db-schema 계획 검증", assignee: "qa", depends_on: ["0-db-schema phase 계획 작성"] },
  { title: "1-core-services 계획 검증", assignee: "qa", depends_on: ["1-core-services phase 계획 작성"] },
  { title: "2-api-routes 계획 검증", assignee: "qa", depends_on: ["2-api-routes phase 계획 작성"] },
  { title: "3-frontend 계획 검증", assignee: "qa", depends_on: ["3-frontend phase 계획 작성"] }
])
```

### Phase 3: 계획 확정

1. 모든 팀원 작업 완료 대기 (TaskGet)
2. qa의 모든 계획 검증 리포트에서 미해결 지적이 없는지 확인 — 있으면 해당 플래너에게 마지막 수정 기회를 준 뒤 재검증
3. `phases/index.json`(최상위)을 리더가 직접 작성/갱신 — 모든 phase-dir이 올바른 순서로 등록되어 있는지 확인
4. `TeamDelete`로 계획 팀 정리 (계획 산출물은 `phases/`, `_workspace/`에 파일로 남아있으므로 팀을 유지할 필요 없음)
5. 사용자에게 계획 요약 보고 — phase 개수, 각 phase의 step 목록, qa 검증 결과. **여기서 반드시 실행 여부를 사용자에게 확인받는다.**

### Phase 4: execute.py 실행 (리더가 직접, 순차)

> **항상 사용자 확인 후 실행한다.** `--dangerously-bypass-approvals-and-sandbox`로 Codex가 승인 없이 코드/커밋을 만들기 때문에, phase 하나를 실행하기 전마다(첫 실행이든 후속 실행이든) 사용자에게 "이제 `{phase-dir}`을 Codex로 실행합니다"라고 알리고 진행 여부를 확인한다. `--push`는 별도로 명시적 요청이 있을 때만 사용한다.

1. 순서대로 (`0-db-schema` → `1-core-services` → `2-api-routes` → `3-frontend`) 다음을 반복:
   - 사용자에게 이번에 실행할 phase와 step 목록을 다시 요약하고 확인받는다
   - `Bash: python3 scripts/execute.py {phase-dir}` 실행 (리더가 직접, 팀원에게 위임하지 않음)
   - 종료 코드와 `phases/{phase-dir}/index.json`을 확인:
     - 전체 `completed` → 다음 phase로 진행
     - 특정 step `blocked` (exit code 2) → 사용자에게 `blocked_reason` 그대로 전달, 해결 전까지 다음 phase로 넘어가지 않는다
     - 특정 step `error` (exit code 1) → `error_message` 확인, qa에게 원인 분석 요청 후 사용자에게 보고. 계획 결함이면 해당 플래너를 재소집해 step을 수정한 뒤 재실행

### Phase 5: 코드 검증 (phase 완료마다)

1. 해당 phase 실행이 `completed`되면 qa 에이전트(팀 해체 후에는 단일 Agent 호출로 재소집)를 다시 불러 코드 검증(1단계) 수행
2. qa가 문제를 발견하면: 계획 자체의 결함인지, 이번 Codex 실행의 실수인지 구분
   - 계획 결함이면 해당 플래너 재소집 → step 수정 → 같은 phase 재실행(`python3 scripts/execute.py {phase-dir}`, 이미 completed된 step은 건너뛰지 않으므로 문제 step의 status를 `pending`으로 되돌린 뒤 재실행 — `_check_blockers`가 error 상태를 만나면 멈추므로, 재시도하려면 해당 step 상태를 pending으로 리셋해야 함을 사용자에게 안내)
   - Codex의 일회성 실수면 다음 phase로 진행하되 qa 리포트에 남긴다
3. `_workspace/{phase}_qa_code_review.md`에 기록

### Phase 6: 정리 및 보고

1. 모든 phase 완료(또는 사용자가 여기서 멈추기로 결정) 시 `npm run test`, `npm run lint`를 리더가 직접 실행해 결과 확인
2. 사용자에게 요약 보고: 실행된 phase, qa 계획/코드 검증 핵심 발견, 남은 이슈, 다음 제안
3. `phases/`, `_workspace/` 보존 (감사 추적용)

## 에러 핸들링

| 상황 | 전략 |
|---|---|
| 계획 단계에서 플래너 1명 실패/중지 | 유휴 알림 감지 → 상태 확인 → 재시작. 재실패 시 사용자에게 알리고 해당 phase 없이 진행할지 확인 |
| qa가 계획 결함(AC 모호, CRITICAL 규칙 누락) 발견 | 실행 전 반드시 해소 — 미해소 상태로 execute.py를 트리거하지 않는다 |
| execute.py가 `blocked`로 종료 (API 키 등 사용자 개입 필요) | 실행을 멈추고 `blocked_reason`을 그대로 사용자에게 전달, 해결 후 재시도 안내 |
| execute.py가 `error`로 종료 (3회 재시도 후 실패) | `error_message` 확인 → qa에게 원인 분석 요청 → 계획 문제면 step 수정 후 해당 step 상태를 pending으로 리셋, Codex 문제면 그대로 재시도 여부를 사용자에게 확인 |
| qa가 코드 검증에서 보안 CRITICAL 위반 발견 | 최우선 에스컬레이션. 다음 phase 실행을 보류하고 사용자에게 즉시 보고 |
| 팀원 간 인터페이스 불일치(예: api-routes가 core-services 시그니처 오해) | qa가 계획 검증 단계에서 발견 즉시 양쪽에 알림, 실행 전에 조정 |

## 테스트 시나리오

### 정상 흐름
1. 사용자가 "phase 계획 짜줘" 요청
2. Phase 0: `phases/` 없음 → 초기 실행
3. Phase 2: 5인 팀 구성, 4개 도메인 계획 + qa 검증 병행
4. Phase 3: 계획 확정, `phases/index.json` 작성, 팀 정리, 사용자에게 요약 + 실행 여부 확인
5. 사용자 승인 → Phase 4: `0-db-schema`부터 순서대로 사용자 확인 후 `execute.py` 실행
6. Phase 5: 각 phase 완료마다 qa 코드 검증
7. Phase 6: 전체 완료, `npm run test`/`npm run lint` 확인, 요약 보고

### 후속 흐름 (일부 phase만 재실행)
1. 사용자가 "1-core-services에서 blocked 났던 거 다시 해줘" 요청
2. Phase 0: `phases/` 존재, 특정 phase 재실행 요청 감지
3. `phases/1-core-services/index.json`에서 `blocked_reason` 확인, 필요 시 core-services 플래너 재소집해 step 조정
4. 사용자에게 재실행 확인 후 `python3 scripts/execute.py 1-core-services` 재실행
5. 완료 후 qa 코드 검증, 결과 보고

### 에러 흐름
1. Phase 4에서 `2-api-routes` 실행 중 step 2가 3회 재시도 후 `error`
2. 리더가 `error_message` 확인 → qa에게 원인 분석 요청
3. qa가 계획(step AC 모호)의 문제로 판단 → api-routes 플래너 재소집해 AC 구체화
4. 리더가 해당 step 상태를 `pending`으로 리셋 후 `python3 scripts/execute.py 2-api-routes` 재실행
5. 성공 후 다음 phase(`3-frontend`)로 진행, 최종 보고서에 "step 2 1차 실패 → 계획 보완 → 재실행 성공" 기록
