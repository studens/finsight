import type {
  MaskedDataset,
  MaskedRow,
  ParsedCsv,
} from "../../types/pipeline"

const MASKED_COLUMN_KEYWORDS = ["카드번호", "카드", "계좌", "account", "card"]
const EXCLUDED_COLUMN_KEYWORDS = [
  "이름",
  "성명",
  "name",
  "전화",
  "연락처",
  "휴대폰",
  "phone",
  "tel",
]

function headerIncludes(header: string, keywords: string[]): boolean {
  const normalizedHeader = header.toLocaleLowerCase()
  return keywords.some((keyword) => normalizedHeader.includes(keyword))
}

function isObviousSensitiveNumber(value: string): boolean {
  const trimmed = value.trim()
  if (!/^\d[\d -]*\d$/.test(trimmed)) {
    return false
  }

  const digitCount = trimmed.replace(/\D/g, "").length
  return digitCount >= 13 && digitCount <= 16
}

function maskAllButLastFourDigits(value: string): string {
  const digitCount = value.replace(/\D/g, "").length
  if (digitCount <= 4) {
    return value
  }

  let seenDigits = 0
  const digitsToMask = digitCount - 4

  return value.replace(/\d/g, (digit) => {
    seenDigits += 1
    return seenDigits <= digitsToMask ? "*" : digit
  })
}

export function maskPii(parsed: ParsedCsv): MaskedDataset {
  const excludedColumns = parsed.headers.filter((header) =>
    headerIncludes(header, EXCLUDED_COLUMN_KEYWORDS),
  )
  const excludedColumnSet = new Set(excludedColumns)

  const headers = parsed.headers.filter((header) => !excludedColumnSet.has(header))
  const maskedColumns = headers.filter(
    (header) =>
      headerIncludes(header, MASKED_COLUMN_KEYWORDS) ||
      parsed.rows.some((row) => isObviousSensitiveNumber(row[header] ?? "")),
  )
  const maskedColumnSet = new Set(maskedColumns)

  const rows = parsed.rows.map((row) => {
    const processedRow = Object.fromEntries(
      headers.map((header) => {
        const value = row[header] ?? ""
        return [
          header,
          maskedColumnSet.has(header) ? maskAllButLastFourDigits(value) : value,
        ]
      }),
    )

    return processedRow as MaskedRow
  })

  return { headers, rows, excludedColumns, maskedColumns }
}
