---
name: review-code
description: "finsight의 변경 사항을 차원별 서브에이전트로 병렬 리뷰한다. 기본 3차원(security-privacy, correctness, architecture)을 동시에 띄워 각자 깊게 보게 하고, 결과를 중복 제거·심각도 정렬해 한 장으로 취합한다. '리뷰해줘', '코드 리뷰', '변경사항 검토', '머지 전 확인', 'PR 리뷰' 요청 시 사용한다. --deep 을 붙이면 Workflow로 실행해 각 지적을 반증 검증까지 거친다."
---

# review-code — 차원별 병렬 코드 리뷰

## 왜 병렬로 쪼개는가

한 에이전트에게 "버그도 보고 보안도 보고 구조도 봐라"라고 하면 주의가 분산돼 전부 얕게 훑는다. 차원을 **하나만** 주면 그것만 깊게 판다. 게다가 각 리뷰어가 자기 파일을 읽고 **결론만** 돌려주므로 메인 컨텍스트에 diff 전문이 쌓이지 않고, 3명이 동시에 돌아 벽시계 시간이 줄어든다. 차원 추가는 `dimensions/` 에 파일 하나 얹는 일이다.


## 두 가지 모드

| | 기본 (`/review-code`) | 깊게 (`/review-code --deep`) |
|---|---|---|
| 실행 | Agent 툴로 차원별 리뷰어 동시 spawn | Workflow 스크립트 `.claude/workflows/review-code.js` |
| 병렬 보장 | 모델이 한 메시지에 담아야 함 | 코드(`pipeline`)라 보장됨 |
| 출력 | 마크다운 | JSON 스키마 강제 |
| 반증 검증 | 없음 | 있음 — 지적마다 회의론자를 붙여 오탐 제거 |
| 결과 도착 | 대화에 바로 | 백그라운드 실행 후 알림 |
| 에이전트 수 | 차원 수 (3) | 차원 수 + 검증 최대 12 |

**기본을 쓴다.** `--deep`은 머지·배포 직전처럼 오탐을 감당할 수 없을 때, 또는 사용자가 "꼼꼼히/확실하게/deep"을 명시할 때만 쓴다. 1·2단계(대상 확정, 차원 선택)는 두 모드가 공통이고 3단계부터 갈린다.

---

## 1단계 — 리뷰 대상 확정

인자가 있으면 그것을 따르고(`/review-code src/services/llm`, `/review-code --staged`), 없으면 아래로 자동 판정한다.

```bash
CUR=$(git branch --show-current)
UNTRACKED=$(git ls-files --others --exclude-standard)   # 신규(미추적) 파일 — 어느 쪽이든 항상 포함
if [ "$CUR" = "main" ]; then
  BASE=HEAD
  TRACKED=$(git diff --name-only HEAD)                  # 미커밋 변경
  if [ -z "$TRACKED$UNTRACKED" ]; then                  # 없으면 최근 커밋
    BASE=$(git rev-parse HEAD~1)
    TRACKED=$(git diff --name-only HEAD~1 HEAD)
  fi
else
  BASE=$(git merge-base main HEAD)
  TRACKED=$(git diff --name-only "$BASE"...HEAD)
fi
```

확정한 **BASE 커밋 해시**와 **두 개의 파일 목록**(`TRACKED` / `UNTRACKED`)을 손에 쥔다. 이 셋은 그대로 리뷰어에게 넘어간다.

⚠️ **미추적 파일을 절대 `git diff`로 넘기지 마라.** 신규 파일은 `git diff <BASE> -- <파일>`이 **0바이트**를 돌려주므로, 리뷰어가 빈 diff를 보고 "발견 0건"을 보고한다 — 파일을 안 봤는데 깨끗하다고 말하는 최악의 실패다. 그래서 위 스크립트는 `git status --short` 대신 목록을 둘로 나눈다(`--short` 출력은 ` M `·`?? ` 접두사와 `R old -> new` 형식이 섞여 그대로 파일 목록으로 쓸 수 없다는 이유도 있다).

- 두 목록이 **합쳐서** 0개면 여기서 멈추고 사용자에게 알린다. 에이전트를 띄우지 않는다.
- 합쳐서 40개를 넘으면 사용자에게 범위 축소를 제안한 뒤 진행 여부를 묻는다.
- `package-lock.json`, 빌드 산출물, 대용량 fixture는 목록에서 제외하되 **제외했다는 사실을 최종 보고에 적는다**(조용한 누락 금지).

대상을 확정한 뒤 **메인이 한 번만** `npm run typecheck && npm run lint && npm run build && npm run test` 를 돌린다(리뷰어 3명이 각자 돌리면 낭비다). 실패하면 그 자체가 지적이고, 결과는 5단계 산출물 B의 Walkthrough에 한 줄로 적는다.

## 2단계 — 차원 선택

기본은 `dimensions/` 아래 3개 전부다.

| 파일 | 차원 | 봄 |
|---|---|---|
| `security-privacy.md` | 🔒 보안·개인정보 | PII 마스킹, 원본 미저장, service-role 격리, 소유권 검증, 웹훅 서명, Premium 게이팅 |
| `correctness.md` | 🐛 정확성 | 로직 버그, CSV/인코딩/숫자/날짜 엣지, 비동기·멱등성, 에러 처리 |
| `architecture.md` | 🏛 아키텍처·규약 | services 경유, 디렉토리 배치, 테스트 존재(TDD), 경계면 정합성 |

사용자가 특정 차원만 요청하면(`/review-code --security`) 그것만 띄운다.

**차원을 늘리려면** `dimensions/` 에 같은 형식의 마크다운을 추가하기만 하면 된다. 다음 후보: `performance`(N+1, 불필요한 재렌더), `test-coverage`(architecture에서 분리), `cross-file-consistency`, `behavioral-correctness`(PRD 대비 동작), `conventions`(스타일·네이밍).

## 3단계(기본) — 병렬 fan-out ⚠️ 핵심

**선택한 차원 전부를 하나의 메시지 안에서 동시에 Agent 호출한다.** 한 번에 하나씩 호출하면 순차 실행이 되어 이 스킬의 존재 이유가 사라진다.

각 호출은 이렇게 구성한다.

- `subagent_type`: `"code-reviewer"`
- `name`: `review-security` / `review-correctness` / `review-architecture` (차원별로 다르게)
- `description`: `"{차원} 리뷰"`
- `prompt`: 아래 4개를 이어붙인 것
  1. `dimensions/{차원}.md` 파일의 **전문**
  2. BASE 커밋 해시 (`git diff <BASE> -- <파일>` 로 diff를 직접 뜨라고 지시)
  3. **변경 파일 목록**(`TRACKED`) 전문
  4. **신규 파일 목록**(`UNTRACKED`) 전문 — 있으면 `이 목록의 파일은 아직 git에 추적되지 않아 diff가 비어 있다. diff 대신 Read로 파일 전문을 읽고, 전체를 새로 추가된 코드로 간주해 리뷰하라.` 를 함께 넣는다. 목록이 비었으면 이 항목 자체를 생략한다.

리뷰어 정의(`.claude/agents/code-reviewer.md`)에 읽기 전용 규칙·심각도 기준·출력 형식이 이미 들어 있으므로 프롬프트에서 반복하지 않는다.

**리뷰어가 죽으면 그 차원은 "0건"이 아니라 "미검토"다.** Agent 호출이 결과를 못 돌려주거나 빈 응답이면, 그 차원을 통과로 세지 말고 최종 보고에 `{차원} 미검토 — 리뷰어 실패` 로 명시한다. 보안 리뷰어가 죽은 것을 "보안 문제 없음"으로 읽히게 두지 마라.


## 3단계(--deep) — Workflow 실행

`Workflow({ name: "review-code", args: { base, files, untracked, dimensions } })` 를 호출한다. **이 스킬의 지시에 따른 호출이므로 workflow opt-in 조건을 충족한다** — 사용자에게 따로 허락을 구하지 않아도 된다.

- `base`: 1단계에서 확정한 BASE 커밋 해시 (문자열)
- `files`: `TRACKED` 목록 (**문자열이 아니라 실제 배열**로 넘긴다. JSON 문자열로 넘기면 스크립트 안에서 `.map`이 터진다)
- `untracked`: `UNTRACKED` 목록 (역시 실제 배열). 스크립트가 리뷰어에게 "diff 말고 Read로 읽어라"를 붙여준다. 없으면 생략 가능
- `dimensions`: 차원 키 배열. 생략 시 3개 전부

스크립트가 하는 일: 차원별 리뷰(`Review` 단계) → 각 지적에 회의론자를 붙여 반증 시도(`Verify` 단계). `pipeline`이라 **한 차원의 리뷰가 끝나는 즉시 그 차원의 지적들이 검증에 들어간다** — 다른 차원을 기다리지 않는다.

반증은 관점을 셋으로 나눠 준다(사실관계 오독 / 이미 방어됨 / 도달 불가능 경로). `critical`은 3개 관점 전부, `major`는 1개, `minor`·`nit`은 검증하지 않는다. **과반이 반박하면 탈락**이다.

반환값:
```
{ base, prVerdict, counts: {critical, major, minor, nit},
  filesReviewed, untrackedReviewed, dimensions,
  confirmed: [...],       // 살아남은 지적, 심각도순 정렬 완료
  refuted: [...],         // 반증으로 탈락한 지적
  unverifiedCount: n,     // 검증 상한(12) 때문에 미검증으로 남은 건수
  emptyDimensions: [...], // 검토는 됐고 발견이 0건인 차원
  failedDimensions: [...] // 리뷰어가 죽어 아예 검토되지 못한 차원 ← 0건과 다르다
}
```

`confirmed`를 5단계 형식으로 출력한다. `--deep`에서는 4단계 취합의 **1(중복 제거)·6(범위 밖 제거)·7(연결 관계 표시)** 을 수행한다 — 2(확신도 검증)·3(차원이탈)·4(등급 인플레이션)는 워크플로우의 반증 단계가 이미 처리했고, 5(심각도 정렬)는 스크립트가 정렬해서 돌려준다. **7은 반드시 남긴다** — 차원을 쪼갠 대가로 끊어진 연결을 다시 잇는 것은 어느 모드에서든 메인의 몫이다.

보고에 반드시 반영할 것:
- **`unverifiedCount`가 0이 아니면 최종 보고에 적는다** — 검증 안 된 지적이 검증된 것처럼 보이면 안 된다.
- **`failedDimensions`가 비어 있지 않으면 판정보다 먼저 적는다.** 그 차원은 통과가 아니라 미검토다. 이 배열이 비어 있지 않은데 판정을 `Approve`로 내보내지 마라 — `Approve (단, {차원} 미검토)` 로 표기한다.
- `refuted`는 본문에 넣지 말고 맨 아래 접은 형태로 건수만 밝힌다.

---

## 4단계 — 취합

세 리포트가 다 돌아오면 메인이 합친다. **리뷰어 보고를 그대로 붙여넣지 말고 반드시 아래를 거친다.**

1. **중복 제거** — 같은 파일:라인에 대한 지적이 여러 차원에서 오면 하나로 합치고 출처를 병기한다.
2. **확신도 `낮음` 검증** — `확신도: 낮음`인 `critical`/`major`는 메인이 해당 파일을 직접 열어 확인한다. 확인되면 확신도를 올리고, 아니면 목록에서 빼고 "검토했으나 오탐"으로 분류한다.
3. **차원이탈 표시 처리** — `[차원이탈]` 지적은 다른 리뷰어 결과와 중복인지 먼저 보고, 중복이면 버린다.
4. **등급 인플레이션 점검** — 리뷰어가 올려 잡은 등급을 메인이 내릴 수 있다. `critical`은 "머지하면 안 되는" 것만, `major`는 "머지 전 고쳐야 하는" 것만 남긴다.
5. **심각도 정렬** — critical → major → minor → nit.
6. **범위 밖 지적 제거** — 변경과 무관한 기존 코드 지적은 본문에서 빼고 "참고(범위 밖)"에 한 줄로만 남긴다.
7. **연결 관계 표시** — 서로 다른 차원의 지적이 같은 증상으로 수렴하거나(원인은 달라도 같은 실패로 나타남), 한쪽 수정이 다른 쪽을 함께 해소하면 그 관계를 명시한다. 차원을 나눈 대가로 끊어진 연결을 다시 잇는 것은 메인의 몫이다.

## 5단계 — 출력 (2종)

### 산출물 A — 인라인 코멘트 (라인별, 각 4줄)

지적 하나당 하나. 파일 → 라인 순으로 정렬한다.

```
`src/app/api/webhooks/polar/route.ts:37`
> 🟠 major | 웹훅이 구독 제품을 검증하지 않는다
> TL;DR: 웹훅 시크릿이 조직 단위라, 같은 조직의 다른 제품 구독으로도 Premium이 열린다.
> ✓ Good: 서명 검증을 DB 쓰기보다 앞에 두고 실패 시 403으로 끊는 순서는 정확하다.
> → Fix: `if (data.productId !== process.env.POLAR_PRODUCT_ID) return NextResponse.json({ received: true, ignored: "other_product" })`
```

**정확히 4줄을 지킨다.** 리뷰어가 넘긴 `· 근거` / `· 확신도` 메타는 여기 넣지 않는다 — 취합 검증에만 쓰고 버린다. 단 근거가 최종 판단의 핵심이면 요약해 `TL;DR`에 녹인다.

### 산출물 B — PR 전체 요약 (1개)

```markdown
## 판정: {Approve | Changes Requested | Blocked}
🔴 critical {n} · 🟠 major {n} · 🟡 minor {n} · ⚪ nit {n}

### Walkthrough
{이 변경이 무엇을 하는지 2~3줄. 지적이 아니라 설명이다}

### 잘된 점
- {실제로 잘한 것. 없으면 이 절을 생략한다 — 억지로 채우지 않는다}

### critical / major
1. **{제목}** · `{파일}:{라인}` · {차원}
   {한두 줄 요약 + 조치}

### 다음 액션
- [ ] {구체적 행동. 우선순위 순}
```

**판정 규칙** (기계적으로 적용한다):

| 조건 | 판정 |
|---|---|
| `critical` ≥ 1 | **Blocked** |
| `critical` 0, `major` ≥ 1 | **Changes Requested** |
| `critical` 0, `major` 0 | **Approve** (minor/nit는 후속 처리) |

`minor`·`nit`은 요약 본문에 나열하지 않는다 — 집계 숫자와 산출물 A에만 존재한다.

### 파일 저장

두 산출물을 함께 `_workspace/review_{브랜치}_{YYYY-MM-DD}.md` 로 저장한다(B를 위에, A를 아래에). `qa` 에이전트가 `_workspace/qa_code_review_{phase}.md` 를 쓰는 기존 관례와 같은 자리다. 저장 경로를 사용자에게 알린다.

터미널에는 **B 전문 + A 중 critical/major만** 출력하고, minor/nit 인라인 코멘트는 저장 파일에서 보라고 안내한다.

---

## 지켜야 할 것

- **리뷰어는 코드를 수정하지 않는다.** 이 스킬은 진단까지다. 사용자가 고치라고 하면 그때 메인이 고친다.
- **없는 문제를 만들지 않는다.** 세 차원 모두 0건이면 판정은 Approve이고 "문제 없음"이 정답이다. 억지로 nit을 채우지 마라.
- **`✓ Good`에 억지 칭찬을 쓰지 않는다.** 사실이 없으면 "해당 없음"이 정직하다.
- **리뷰어 보고를 그대로 신뢰하지 않는다.** 4단계 검증을 건너뛰지 마라 — 서브에이전트는 확신 있게 틀린 말을 한다.
- **조용히 줄이지 않는다.** 파일을 제외했거나, 차원을 뺐거나, 40개 초과로 범위를 잘랐다면 최종 보고에 명시한다.
- **"검토 안 됨"을 "문제 없음"으로 바꾸지 않는다.** 이 스킬에서 가장 위험한 실패는 지적을 놓치는 게 아니라 **보지 않은 것을 봤다고 보고하는 것**이다. 세 갈래로 새기 쉬우니 매번 확인한다.
  1. **신규(미추적) 파일** — `git diff`가 빈 결과를 주므로 Read로 파일 전문을 읽어야 한다(1단계에서 목록을 분리해 넘긴다).
  2. **죽은 리뷰어** — 결과가 안 오면 그 차원은 미검토다. `failedDimensions`가 비어 있지 않으면 `Approve`로 끝내지 않는다.
  3. **미검증 지적** — `--deep`의 `unverifiedCount`가 0이 아니면 그 건수를 밝힌다.
