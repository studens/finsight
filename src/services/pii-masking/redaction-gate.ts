export type RedactionFindingKind =
  | "subtotal_context"
  | "korean_name"
  | "masked_account"
  | "card_number"
  | "postal_address"
  | "phone_number"

/**
 * 소계/합계는 표 헤더의 합성어(예: `이용금액합계`)에도 들어간다. 행 시작 또는
 * 독립 토큰일 때만 소계/합계 행으로 본다 — 그러지 않으면 정상 명세서의 헤더가
 * 걸려 업로드 전체가 차단된다.
 */
const SUBTOTAL_CONTEXT_PATTERN =
  /(?:^|\s)(?:소계|합계)|성명|예금주|카드주/

/**
 * 실명이 실려 나오는 문맥. 괄호 안 한글(`(강남점)`, `(즉시할인)`)은 대부분
 * 지점명·혜택명이고 실명과 정규식으로 구별할 수 없다. 단어를 열거하는 allowlist는
 * 원리적으로 완성될 수 없으므로(하나만 빠져도 정상 업로드가 422로 막힌다),
 * 열거 대신 **이 문맥 안에서만** 괄호 한글을 실명으로 판정한다.
 */
const NAME_CONTEXT_PATTERN =
  /(?:^|\s)(?:소계|합계)|성명|예금주|카드주|귀하/
const KOREAN_NAME_PATTERN = /\(([가-힣]{2,4})\)/g
const NAME_LABEL_VALUE_PATTERN = /성명\s*([가-힣]{2,4})/
/** 실제 명세서 1면은 `성명` 라벨 없이 `홍길동 귀하` 형태로 이름을 싣는다. */
const HONORIFIC_NAME_PATTERN = /([가-힣]{2,4})\s*귀하/
const MASKED_ACCOUNT_PATTERN = /\d{2,4}\*{3,}\d{2,}/
const CARD_NUMBER_CANDIDATE_PATTERN =
  /(?<!\d)\d[\d -]{11,18}\d(?!\d)/g
const POSTAL_CODE_PATTERN = /(?<!\d)\d{5}\s/
/**
 * 맨 `로`/`동`/`시`는 지점명(`동일로점`, `신사동점`)에 흔하고 5자리 숫자는
 * 가맹점 코드일 수 있다. 행정구역 토큰을 함께 요구해 오탐을 막는다.
 */
const ADDRESS_DIVISION_PATTERN =
  /특별시|광역시|특별자치시|특별자치도|[가-힣]{2,}(?:시|군|구|도)(?=\s)/
const PHONE_NUMBER_PATTERN =
  /(?<!\d)0\d{1,2}-\d{3,4}-\d{4}(?!\d)|(?<!\d)01[016789]\d{7,8}(?!\d)/

export class RedactionGateError extends Error {
  readonly code = "REDACTION_GATE_BLOCKED" as const
  readonly findings: RedactionFindingKind[]

  constructor(findings: RedactionFindingKind[]) {
    super(`Redaction gate blocked: ${findings.join(", ")}`)
    this.name = "RedactionGateError"
    this.findings = findings
  }
}

export function findPiiPatterns(
  value: string,
): RedactionFindingKind[] {
  const findings = new Set<RedactionFindingKind>()

  if (SUBTOTAL_CONTEXT_PATTERN.test(value)) {
    findings.add("subtotal_context")
  }

  if (NAME_CONTEXT_PATTERN.test(value)) {
    for (const match of value.matchAll(KOREAN_NAME_PATTERN)) {
      if (match[1]) {
        findings.add("korean_name")
      }
    }
  }
  if (
    NAME_LABEL_VALUE_PATTERN.test(value) ||
    HONORIFIC_NAME_PATTERN.test(value)
  ) {
    findings.add("korean_name")
  }

  if (MASKED_ACCOUNT_PATTERN.test(value)) {
    findings.add("masked_account")
  }

  for (const match of value.matchAll(CARD_NUMBER_CANDIDATE_PATTERN)) {
    const digitCount = match[0].replace(/\D/g, "").length
    if (digitCount >= 13 && digitCount <= 16) {
      findings.add("card_number")
      break
    }
  }

  if (
    POSTAL_CODE_PATTERN.test(value) &&
    ADDRESS_DIVISION_PATTERN.test(value)
  ) {
    findings.add("postal_address")
  }

  if (PHONE_NUMBER_PATTERN.test(value)) {
    findings.add("phone_number")
  }

  return [...findings]
}

export function assertRedacted(values: string[]): void {
  const findings = new Set<RedactionFindingKind>()

  for (const value of values) {
    for (const finding of findPiiPatterns(value)) {
      findings.add(finding)
    }
  }

  if (findings.size > 0) {
    throw new RedactionGateError([...findings])
  }
}
