# Harness Framework

Claude Code로 기능을 phase/step 단위로 나눠 순차 실행·자가교정·자동 커밋하는 개발 하네스입니다.

## 구성

```
.claude/commands/
├── harness.md    # 탐색 → 논의 → step 설계 → 파일 생성 → 실행 워크플로우
└── review.md     # 변경 사항을 CLAUDE.md/ARCHITECTURE.md/ADR 기준으로 리뷰

docs/
├── PRD.md            # 목표, 사용자, 핵심 기능
├── ARCHITECTURE.md   # 디렉토리 구조, 데이터 흐름, 상태 관리
├── ADR.md            # 아키텍처 결정 기록
└── UI_GUIDE.md       # 디자인 원칙, 색상, 컴포넌트 스타일

scripts/
├── execute.py        # phase 내 step을 순차 실행하는 executor
└── test_execute.py   # executor 테스트

CLAUDE.md             # 기술 스택, 아키텍처 규칙, 개발 프로세스
```

`docs/`와 `CLAUDE.md`는 템플릿이며, 실제 프로젝트에 맞게 `{}` 플레이스홀더를 채워 사용합니다.

## 워크플로우

1. **탐색** — `docs/` 문서를 읽고 프로젝트의 기획·아키텍처·설계 의도를 파악
2. **논의** — 구현 전 결정이 필요한 사항을 사용자와 정리
3. **Step 설계** — 작업을 여러 step으로 쪼갠 초안 작성 (scope 최소화, 자기완결성, AC는 실행 가능한 커맨드)
4. **파일 생성** — `phases/index.json`, `phases/{task-name}/index.json`, `phases/{task-name}/step{N}.md` 생성
5. **실행** — `scripts/execute.py`로 step을 순차 실행

자세한 규칙은 `.claude/commands/harness.md` 참고.

## 사용법

```bash
# task의 모든 step 순차 실행
python3 scripts/execute.py {task-name}

# 실행 후 feat-{task-name} 브랜치를 origin에 push
python3 scripts/execute.py {task-name} --push
```

executor가 자동으로 처리하는 것:

- `feat-{task-name}` 브랜치 생성/checkout
- CLAUDE.md + docs/*.md를 가드레일로 매 step 프롬프트에 주입
- 완료된 step의 summary를 다음 step 컨텍스트로 누적 전달
- 실패 시 최대 3회 재시도 (이전 에러를 프롬프트에 피드백)
- 코드 변경(`feat`)과 메타데이터(`chore`) 커밋 분리
- step/phase 상태 및 타임스탬프 자동 기록 (`pending` → `completed`/`error`/`blocked`)

`error`/`blocked` 상태 복구: `phases/{task-name}/index.json`에서 해당 필드를 지우고 `status`를 `pending`으로 되돌린 뒤 재실행합니다.

## 요구 사항

- [Claude Code](https://claude.com/claude-code) CLI (`claude` 명령이 PATH에 있어야 함)
- Python 3.9+, `pytest` (테스트 실행 시)

## 테스트

```bash
pip install pytest
python3 -m pytest scripts/test_execute.py
```
