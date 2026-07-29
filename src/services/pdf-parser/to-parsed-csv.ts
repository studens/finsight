import type {
  ColumnMapping,
  ParsedCsv,
  RawRow,
} from "../../types/pipeline"
import type {
  PdfColumnSchema,
  PdfLine,
  PdfStatementLayout,
} from "../../types/pdf"
import { UnsupportedPdfFormatError } from "./errors"

export const PDF_HEADERS = [
  "이용일",
  "가맹점",
  "청구금액",
  "구분",
] as const

/** api-routes가 그대로 반환하는 확정 매핑. PDF 파서가 헤더를 부여하므로 사용자 확인이 필요 없다. */
export const PDF_COLUMN_MAPPING: ColumnMapping = {
  date: "이용일",
  merchant: "가맹점",
  amount: "청구금액",
  category: "구분",
  confidence: 1,
}

export type PdfTransactionKind =
  | "일시불"
  | "할부"
  | "연회비"
  | "해외"
  | "기타"

const NUMERIC_ITEM_PATTERN = /^-?[\d,]+$/
const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})$/

function isNearRightEdge(
  rightEdge: number,
  expectedRightEdge: number,
  tolerance: number,
): boolean {
  return Math.abs(rightEdge - expectedRightEdge) < tolerance
}

function inferDate(
  value: string,
  periodEnd: string,
): string | null {
  const match = DATE_PATTERN.exec(value)
  if (!match) return null

  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const [endYearText, endMonthText, endDayText] = periodEnd.split("-")
  const endYear = Number(endYearText)
  const endMonthDay = Number(endMonthText) * 100 + Number(endDayText)
  const year = month * 100 + day > endMonthDay ? endYear - 1 : endYear

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function merchantFromLine(line: PdfLine): string {
  const merchant = line.items
    .slice(1)
    .filter((item) => !NUMERIC_ITEM_PATTERN.test(item.text.trim()))
    .map((item) => item.text)
    .join("")
    .trim()

  return merchant || "알 수 없음"
}

function hasValueAtRole(
  line: PdfLine,
  schema: PdfColumnSchema,
  role: "remainingBalance",
): boolean {
  const roleEdges = schema.columns
    .filter((column) => column.role === role)
    .map((column) => column.rightEdge)

  return line.items.some(
    (item) =>
      NUMERIC_ITEM_PATTERN.test(item.text.trim()) &&
      roleEdges.some((rightEdge) =>
        isNearRightEdge(
          item.x + item.width,
          rightEdge,
          schema.rightEdgeTolerance,
        ),
      ),
  )
}

function transactionKind(
  line: PdfLine,
  merchant: string,
  layout: PdfStatementLayout,
  schema: PdfColumnSchema,
): PdfTransactionKind {
  if (
    layout.sections.some(
      (section) =>
        section.sectionId === line.sectionId &&
        section.kind === "foreign",
    )
  ) {
    return "해외"
  }
  if (
    hasValueAtRole(line, schema, "remainingBalance") ||
    line.items
      .slice(1)
      .some((item) => DATE_PATTERN.test(item.text.trim()))
  ) {
    return "할부"
  }
  if (merchant.includes("연회비")) return "연회비"
  if (merchant === "알 수 없음") return "기타"
  return "일시불"
}

export function applyPdfColumnSchema(input: {
  layout: PdfStatementLayout
  schema: PdfColumnSchema
}): ParsedCsv {
  const { layout, schema } = input
  if (!layout.statementPeriod) {
    throw new UnsupportedPdfFormatError("statement_period_missing")
  }

  const rows: RawRow[] = []
  for (const line of layout.transactionLines) {
    const billedItems = line.items.filter(
      (item) =>
        NUMERIC_ITEM_PATTERN.test(item.text.trim()) &&
        isNearRightEdge(
          item.x + item.width,
          schema.billedAmountRightEdge,
          schema.rightEdgeTolerance,
        ),
    )
    if (billedItems.length !== 1) continue

    const date = inferDate(
      line.items[0]?.text.trim() ?? "",
      layout.statementPeriod.end,
    )
    if (!date) continue

    const merchant = merchantFromLine(line)
    rows.push({
      이용일: date,
      가맹점: merchant,
      청구금액: billedItems[0].text.trim().replaceAll(",", ""),
      구분: transactionKind(line, merchant, layout, schema),
    })
  }

  if (rows.length === 0) {
    throw new UnsupportedPdfFormatError("no_billed_rows")
  }

  return {
    headers: [...PDF_HEADERS],
    rows,
    rowCount: rows.length,
  }
}
