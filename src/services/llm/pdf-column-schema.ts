import type {
  PdfColumnAssignment,
  PdfColumnRole,
  PdfColumnSchema,
  PdfRightEdgeCluster,
  PdfSectionKind,
} from "../../types/pdf"
import { RIGHT_EDGE_TOLERANCE } from "../pdf-parser/layout"
import { generateAnalysisText } from "./provider"

export type PdfColumnSchemaRequest = {
  sections: { sectionId: string; kind: PdfSectionKind }[]
  headerLabels: { text: string; rightEdge: number }[]
  numericColumns: PdfRightEdgeCluster[]
  sampleRows: {
    sectionId: string | null
    date: string
    merchant: string
    values: { rightEdge: number; text: string }[]
  }[]
}

const PDF_COLUMN_ROLES: readonly PdfColumnRole[] = [
  "usageAmount",
  "discount",
  "billedAmount",
  "points",
  "remainingBalance",
  "foreignBilledAmount",
  "unknown",
]

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isColumnRole(value: unknown): value is PdfColumnRole {
  return (
    typeof value === "string" &&
    PDF_COLUMN_ROLES.includes(value as PdfColumnRole)
  )
}

function parseLlmSchema(text: string): Omit<
  PdfColumnSchema,
  "version" | "rightEdgeTolerance"
> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new TypeError("Claude returned invalid PDF column schema JSON")
  }

  if (typeof value !== "object" || value === null) {
    throw new TypeError("PDF column schema must be a JSON object")
  }

  const schema = value as Record<string, unknown>
  if (
    !isNullableString(schema.issuer) ||
    (typeof schema.issuer === "string" && schema.issuer.length > 40) ||
    !Array.isArray(schema.columns) ||
    typeof schema.billedAmountRightEdge !== "number" ||
    !Number.isFinite(schema.billedAmountRightEdge) ||
    typeof schema.confidence !== "number" ||
    !Number.isFinite(schema.confidence) ||
    schema.confidence < 0 ||
    schema.confidence > 1
  ) {
    throw new TypeError("Claude returned an invalid PDF column schema")
  }

  const columns: PdfColumnAssignment[] = schema.columns.map(
    (candidate: unknown) => {
      if (typeof candidate !== "object" || candidate === null) {
        throw new TypeError("Claude returned an invalid PDF column")
      }
      const column = candidate as Record<string, unknown>
      if (
        typeof column.rightEdge !== "number" ||
        !Number.isFinite(column.rightEdge) ||
        !isColumnRole(column.role) ||
        !isNullableString(column.headerLabel)
      ) {
        throw new TypeError("Claude returned an invalid PDF column")
      }
      return {
        rightEdge: column.rightEdge,
        role: column.role,
        headerLabel: column.headerLabel,
      }
    },
  )

  return {
    issuer: schema.issuer,
    columns,
    billedAmountRightEdge: schema.billedAmountRightEdge,
    confidence: schema.confidence,
  }
}

export async function inferPdfColumnSchema(
  request: PdfColumnSchemaRequest,
): Promise<PdfColumnSchema> {
  const prompt = [
    "다음 카드 명세서의 표 구조 조각을 보고 숫자 컬럼의 의미를 판정하세요.",
    `각 numericColumns 항목의 rightEdge에 대해 PdfColumnRole(${PDF_COLUMN_ROLES.join(", ")}) 중 하나를 배정하라.`,
    "headerLabels의 rightEdge가 컬럼의 rightEdge와 가까우면 그 라벨이 그 컬럼의 이름이다.",
    "billedAmount(이번 달 청구액)는 정확히 하나만 배정하라. 이용금액(원 거래액)과 혼동하지 마라 — 할부 거래에서 두 값이 다르다.",
    "확신이 없으면 unknown을 쓰고 confidence를 낮게 반환하라. 억지로 배정하지 마라.",
    "issuer, columns, billedAmountRightEdge, confidence 키를 포함하고 설명·마크다운 없이 JSON 객체만 반환하라.",
    `표 구조: ${JSON.stringify(request)}`,
  ].join("\n")

  const { text } = await generateAnalysisText({ prompt })
  const parsed = parseLlmSchema(text)

  return {
    version: 1,
    ...parsed,
    rightEdgeTolerance: RIGHT_EDGE_TOLERANCE,
  }
}
