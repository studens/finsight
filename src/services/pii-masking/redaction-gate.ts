export type RedactionFindingKind =
  | "subtotal_context"
  | "korean_name"
  | "masked_account"
  | "card_number"
  | "postal_address"
  | "phone_number"

const KOREAN_NAME_ALLOWLIST = new Set([
  "할인",
  "면제",
  "무이자",
  "취소",
  "승인",
  "일시불",
  "할부",
  "해외",
  "포인트",
  "적립",
  "국내",
  "연체",
  "정상",
])

const SUBTOTAL_CONTEXT_PATTERN = /(소계|합계|성명|예금주|카드주)/
const KOREAN_NAME_PATTERN = /\(([가-힣]{2,4})\)/g
const NAME_LABEL_VALUE_PATTERN = /성명\s*([가-힣]{2,4})/
const MASKED_ACCOUNT_PATTERN = /\d{2,4}\*{3,}\d{2,}/
const CARD_NUMBER_CANDIDATE_PATTERN =
  /(?<!\d)\d[\d -]{11,18}\d(?!\d)/g
const POSTAL_CODE_PATTERN = /(?<!\d)\d{5}\s/
const ADDRESS_KEYWORD_PATTERN =
  /(특별시|광역시|시|군|구|읍|면|동|로|길|번지)/
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

  for (const match of value.matchAll(KOREAN_NAME_PATTERN)) {
    const parenthesizedValue = match[1]
    if (
      parenthesizedValue &&
      !KOREAN_NAME_ALLOWLIST.has(parenthesizedValue)
    ) {
      findings.add("korean_name")
    }
  }
  if (NAME_LABEL_VALUE_PATTERN.test(value)) {
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
    ADDRESS_KEYWORD_PATTERN.test(value)
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
