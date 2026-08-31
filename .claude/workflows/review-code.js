export const meta = {
  name: 'review-code',
  description: '변경 사항을 차원별로 병렬 리뷰하고, 각 지적을 반증 시도로 검증해 오탐을 걸러낸다',
  whenToUse: '머지/배포 전 확신이 필요한 리뷰. /review-code --deep 로 호출된다.',
  phases: [
    { title: 'Review', detail: '차원별 리뷰어를 병렬 실행 (security-privacy / correctness / architecture)' },
    { title: 'Verify', detail: '각 지적에 회의론자를 붙여 반증 시도 — 살아남은 것만 보고' },
  ],
}

// args: { base: "커밋해시", files: ["src/a.ts", ...], untracked: ["src/new.ts", ...], dimensions: ["security-privacy", ...] }
const BASE = args?.base
const FILES = args?.files ?? []
const UNTRACKED = args?.untracked ?? [] // 아직 git에 추적되지 않은 신규 파일 — diff가 비므로 Read로 읽어야 한다
const DIMENSIONS = args?.dimensions ?? ['security-privacy', 'correctness', 'architecture']

if (!BASE || FILES.length + UNTRACKED.length === 0) {
  return { error: 'args.base(커밋 해시)와 args.files/args.untracked(리뷰 대상 파일) 중 최소 하나가 필요합니다.' }
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['dimension', 'filesReviewed', 'findings'],
  properties: {
    dimension: { type: 'string' },
    filesReviewed: { type: 'number' },
    checked: { type: 'string', description: '발견이 0건일 때 무엇을 확인했는지 한 줄 요약' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'title', 'tldr', 'good', 'file', 'line', 'problem', 'evidence', 'fix', 'confidence'],
        properties: {
          severity: { enum: ['critical', 'major', 'minor', 'nit'] },
          title: { type: 'string', description: '한 줄 제목' },
          tldr: { type: 'string', description: '인라인 코멘트 2번째 줄 — 무엇이 왜 문제인지 한 문장' },
          good: { type: 'string', description: '인라인 코멘트 3번째 줄 — 이 코드에서 실제로 옳게 한 점. 억지 칭찬 금지, 없으면 "해당 없음"' },
          file: { type: 'string', description: '저장소 기준 상대 경로' },
          line: { type: 'number', description: '1-indexed 라인 번호' },
          problem: { type: 'string', description: '무엇이 잘못됐는지 한두 문장' },
          evidence: { type: 'string', description: '재현 시나리오(어떤 입력에서 어떻게 깨지는지) 또는 위반한 규칙 원문 인용' },
          fix: { type: 'string', description: '인라인 코멘트 4번째 줄 — 수정 코드 조각, 또는 코드로 못 쓰면 한 줄 지시' },
          confidence: { enum: ['높음', '중간', '낮음'] },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean', description: '이 지적이 틀렸으면 true' },
    reason: { type: 'string', description: '반박 근거 또는 반박 실패 사유. 확인한 파일:라인을 포함할 것' },
    severityAdjust: { enum: ['critical', 'major', 'minor', 'nit', '유지'], description: '심각도를 조정해야 하면 등급, 아니면 유지. 애매하면 낮은 쪽으로.' },
  },
}

// 반증은 관점을 다르게 줘야 잡히는 게 다르다 (동일 프롬프트 3벌은 같은 실수를 3번 한다)
const LENSES = [
  '이 지적이 **사실관계**를 틀렸을 가능성을 파헤쳐라. 해당 파일:라인을 직접 열어, 지적이 묘사한 코드가 실제로 그렇게 생겼는지부터 확인하라. 리뷰어가 코드를 잘못 읽었을 수 있다.',
  '이 문제를 **이미 다른 곳이 방어하고 있을 가능성**을 파헤쳐라. 호출부를 거슬러 올라가 상위 검증·미들웨어·타입 제약·기존 테스트가 이 케이스를 이미 막고 있는지 Grep으로 추적하라.',
  '이 코드 경로가 **실제로 도달 가능한지** 파헤쳐라. 지적이 말하는 입력·상태가 이 시스템에서 실제로 발생할 수 있는가? 도달 불가능한 경로에 대한 지적이면 반박하라.',
]

const reviewPrompt = (dim) => `
당신의 리뷰 차원은 **${dim}** 하나뿐이다.

먼저 \`.claude/skills/review-code/dimensions/${dim}.md\` 파일을 읽어라. 그 파일이 당신의 체크리스트다.

BASE 커밋: ${BASE}
${
  FILES.length > 0
    ? `변경 파일 (${FILES.length}개) — diff로 읽어라:
${FILES.map((f) => `- ${f}`).join('\n')}

각 파일의 diff는 \`git diff ${BASE} -- <파일>\` 로 직접 떠서 읽어라. diff만으로 판단이 안 되면 파일 전체를 읽고, 호출부는 Grep으로 추적하라.`
    : '변경 파일: 없음 (아래 신규 파일만 리뷰 대상이다)'
}
${
  UNTRACKED.length > 0
    ? `
신규 파일 (${UNTRACKED.length}개) — **diff를 시도하지 마라**:
${UNTRACKED.map((f) => `- ${f}`).join('\n')}

이 파일들은 아직 git에 추적되지 않아 \`git diff\` 가 **0바이트**를 돌려준다. 반드시 Read로 **파일 전문**을 읽고 **전체를 새로 추가된 코드로 간주해** 리뷰하라. 빈 diff를 근거로 "발견 0건"을 보고하는 것은 파일을 보지 않고 깨끗하다고 말하는 것이다.`
    : ''
}

**출력**: 당신의 에이전트 정의에 적힌 마크다운 출력 형식은 무시하고, StructuredOutput 툴로 스키마에 맞춰 반환하라. 그 외의 규칙(읽기 전용 / 추측 금지 / 변경된 코드만 / 자기 차원만 / 발견 0건은 정상)은 그대로 지켜라.
`

const refutePrompt = (f, lens) => `
아래는 다른 리뷰어가 제기한 코드 지적이다. 당신의 임무는 이 지적을 **반박하는 것**이다. 동의하는 게 아니라 무너뜨리려고 시도하라.

BASE 커밋: ${BASE}

[${f.severity}] ${f.title}
- 위치: ${f.file}:${f.line}
- 문제 주장: ${f.problem}
- 제시된 근거: ${f.evidence}
- 리뷰어 확신도: ${f.confidence}

**당신의 관점**: ${lens}

반드시 해당 파일을 실제로 열어 확인한 뒤 판정하라. 코드를 읽지 않고 판정하면 안 된다.
**애매하면 refuted: true 로 기울여라** — 확실한 지적만 사용자에게 보내는 것이 목표이고, 오탐 하나가 진짜 지적 전체의 신뢰를 깎는다.
`

log(
  `리뷰 시작: ${FILES.length + UNTRACKED.length}개 파일` +
    (UNTRACKED.length > 0 ? `(신규 ${UNTRACKED.length}개 포함)` : '') +
    ` × ${DIMENSIONS.length}개 차원 (BASE ${BASE.slice(0, 8)})`,
)

// minor/nit은 검증하지 않는다(비용 대비 효과 없음). critical은 관점 3개, major는 1개.
const lensesFor = (sev) => (sev === 'critical' ? LENSES : sev === 'major' ? [LENSES[0]] : [])
const VERIFY_CAP = 12
let verifySpent = 0
let verifySkipped = 0
// 리뷰어가 죽어 아예 검토되지 못한 차원. "발견 0건"과 절대 섞지 않는다 —
// 섞으면 보안 리뷰어가 죽은 것이 "보안 문제 없음"으로 읽힌다.
const failedDimensions = []

// 검증자 과반이 같은 등급으로 조정을 요구할 때만 조정한다.
// (first-wins 로 하면 3명 중 1명의 소수 의견이 critical 을 nit 으로 끌어내린다)
const RANK_ORDER = ['critical', 'major', 'minor', 'nit']
const majorityAdjust = (votes) => {
  const tally = new Map()
  for (const v of votes) {
    if (!v?.severityAdjust || v.severityAdjust === '유지') continue
    tally.set(v.severityAdjust, (tally.get(v.severityAdjust) ?? 0) + 1)
  }
  const winners = [...tally.entries()].filter(([, n]) => n > votes.length / 2).map(([sev]) => sev)
  if (winners.length === 0) return null
  // 동률 방어: 과반을 넘긴 등급이 여럿이면 가장 보수적인(높은) 쪽을 남긴다
  return winners.sort((a, b) => RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b))[0]
}

const results = await pipeline(
  DIMENSIONS,
  (dim) =>
    agent(reviewPrompt(dim), {
      label: `review:${dim}`,
      phase: 'Review',
      agentType: 'code-reviewer',
      schema: FINDINGS_SCHEMA,
    }),

  (review, dim) => {
    if (!review) {
      // agent() 가 null 을 돌려준 경우 = 사용자 스킵 또는 터미널 에러. 통과가 아니라 미검토다.
      failedDimensions.push(dim)
      log(`⚠️ ${dim}: 리뷰어 실패 — 이 차원은 검토되지 않았다(0건 아님)`)
      return []
    }
    const found = review.findings ?? []
    log(`${dim}: ${found.length}건 발견 (검토 ${review.filesReviewed}개 파일)`)

    return parallel(
      found.map((f) => async () => {
        const lenses = lensesFor(f.severity)
        if (lenses.length === 0) return { ...f, dimension: dim, verdict: null }

        if (verifySpent + lenses.length > VERIFY_CAP) {
          verifySkipped += 1
          return { ...f, dimension: dim, verdict: null, verifySkipped: true }
        }
        verifySpent += lenses.length

        const votes = (
          await parallel(
            lenses.map((lens, i) => () =>
              agent(refutePrompt(f, lens), {
                label: `verify:${f.file.split('/').pop()}#${i + 1}`,
                phase: 'Verify',
                agentType: 'code-reviewer',
                schema: VERDICT_SCHEMA,
              }),
            ),
          )
        ).filter(Boolean)

        if (votes.length === 0) return { ...f, dimension: dim, verdict: null }

        const refutals = votes.filter((v) => v.refuted)
        const refuted = refutals.length > votes.length / 2 // 과반이 반박하면 탈락
        const adjust = majorityAdjust(votes) // 등급 조정도 과반 규칙을 따른다

        return {
          ...f,
          dimension: dim,
          severity: !refuted && adjust ? adjust : f.severity,
          verdict: {
            refuted,
            votes: `${refutals.length}/${votes.length} 반박`,
            reasons: votes.map((v) => v.reason),
          },
        }
      }),
    )
  },
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter((f) => !f.verdict?.refuted)
const refuted = all.filter((f) => f.verdict?.refuted)

const RANK = { critical: 0, major: 1, minor: 2, nit: 3 }
confirmed.sort((a, b) => RANK[a.severity] - RANK[b.severity])

if (verifySkipped > 0) {
  log(`⚠️ 검증 상한(${VERIFY_CAP}) 도달 — ${verifySkipped}건은 미검증 상태로 보고됨`)
}
if (failedDimensions.length > 0) {
  log(`⚠️ 미검토 차원 ${failedDimensions.length}개: ${failedDimensions.join(', ')} — 통과로 세지 마라`)
}
log(`완료: 확정 ${confirmed.length}건 / 반증 탈락 ${refuted.length}건`)

const count = (sev) => confirmed.filter((f) => f.severity === sev).length
// f.verdict(지적별 반증 판정)와 구분하기 위해 prVerdict
const prVerdict =
  count('critical') > 0 ? 'Blocked' : count('major') > 0 ? 'Changes Requested' : 'Approve'
log(`판정: ${prVerdict}${failedDimensions.length > 0 ? ` (단, ${failedDimensions.join('/')} 미검토)` : ''}`)

return {
  base: BASE,
  prVerdict,
  counts: {
    critical: count('critical'),
    major: count('major'),
    minor: count('minor'),
    nit: count('nit'),
  },
  filesReviewed: FILES.length,
  untrackedReviewed: UNTRACKED.length,
  dimensions: DIMENSIONS,
  confirmed,
  refuted,
  unverifiedCount: verifySkipped,
  // 검토는 됐고 발견이 0건인 차원. 리뷰어가 죽은 차원은 여기가 아니라 failedDimensions 로 간다.
  emptyDimensions: results
    .map((r, i) => (Array.isArray(r) && r.length === 0 ? DIMENSIONS[i] : null))
    .filter((d) => d && !failedDimensions.includes(d)),
  failedDimensions,
}
