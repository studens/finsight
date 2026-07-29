import type {
  PdfColumnAssignment,
  PdfColumnRole,
  PdfColumnSchema,
  PdfStatementLayout,
} from "../../types/pdf"
import {
  inferPdfColumnSchema,
  type PdfColumnSchemaRequest,
} from "../llm/pdf-column-schema"
import {
  assertRedacted,
  RedactionGateError,
} from "../pii-masking/redaction-gate"
import { UnsupportedPdfFormatError } from "./errors"

export const MIN_SCHEMA_CONFIDENCE = 0.5

const MAX_SAMPLE_ROWS = 8
const NUMERIC_ITEM_PATTERN = /^-?[\d,]+$/
const PDF_COLUMN_ROLES: readonly PdfColumnRole[] = [
  "usageAmount",
  "discount",
  "billedAmount",
  "points",
  "remainingBalance",
  "foreignBilledAmount",
  "unknown",
]

function isColumnRole(value: unknown): value is PdfColumnRole {
  return (
    typeof value === "string" &&
    PDF_COLUMN_ROLES.includes(value as PdfColumnRole)
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

export function buildColumnSchemaExcerpt(
  layout: PdfStatementLayout,
): PdfColumnSchemaRequest {
  return {
    sections: layout.sections.map(({ sectionId, kind }) => ({
      sectionId,
      kind,
    })),
    headerLabels: layout.headerLabels.map(({ text, rightEdge }) => ({
      text,
      rightEdge,
    })),
    numericColumns: layout.numericColumns.map(
      ({ rightEdge, rowCount, sampleValues }) => ({
        rightEdge,
        rowCount,
        sampleValues: [...sampleValues],
      }),
    ),
    sampleRows: layout.transactionLines
      .slice(0, MAX_SAMPLE_ROWS)
      .map((line) => {
        const [dateItem, ...remainingItems] = line.items
        const numericItems = remainingItems.filter((item) =>
          NUMERIC_ITEM_PATTERN.test(item.text.trim()),
        )
        return {
          sectionId: line.sectionId,
          date: dateItem?.text.trim() ?? "",
          merchant: remainingItems
            .filter(
              (item) =>
                !NUMERIC_ITEM_PATTERN.test(item.text.trim()),
            )
            .map((item) => item.text)
            .join("")
            .trim(),
          values: numericItems.map((item) => ({
            rightEdge: item.x + item.width,
            text: item.text,
          })),
        }
      }),
  }
}

function collectExcerptStrings(
  excerpt: PdfColumnSchemaRequest,
): string[] {
  return [
    ...excerpt.sections.map((section) => section.sectionId),
    ...excerpt.headerLabels.map((label) => label.text),
    ...excerpt.numericColumns.flatMap((column) => column.sampleValues),
    ...excerpt.sampleRows.flatMap((row) => [
      ...(row.sectionId === null ? [] : [row.sectionId]),
      row.date,
      row.merchant,
      ...row.values.map((value) => value.text),
    ]),
  ]
}

export function parsePdfColumnSchema(value: unknown): PdfColumnSchema {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("PDF column schema must be an object")
  }

  const schema = value as Record<string, unknown>
  if (
    schema.version !== 1 ||
    !isNullableString(schema.issuer) ||
    (typeof schema.issuer === "string" && schema.issuer.length > 40) ||
    !Array.isArray(schema.columns) ||
    typeof schema.billedAmountRightEdge !== "number" ||
    !Number.isFinite(schema.billedAmountRightEdge) ||
    typeof schema.rightEdgeTolerance !== "number" ||
    !Number.isFinite(schema.rightEdgeTolerance) ||
    schema.rightEdgeTolerance <= 0 ||
    schema.rightEdgeTolerance > 5 ||
    typeof schema.confidence !== "number" ||
    !Number.isFinite(schema.confidence) ||
    schema.confidence < 0 ||
    schema.confidence > 1
  ) {
    throw new TypeError("Invalid PDF column schema")
  }

  const columns: PdfColumnAssignment[] = schema.columns.map(
    (candidate: unknown) => {
      if (typeof candidate !== "object" || candidate === null) {
        throw new TypeError("Invalid PDF column assignment")
      }
      const column = candidate as Record<string, unknown>
      if (
        typeof column.rightEdge !== "number" ||
        !Number.isFinite(column.rightEdge) ||
        !isColumnRole(column.role) ||
        !isNullableString(column.headerLabel)
      ) {
        throw new TypeError("Invalid PDF column assignment")
      }
      return {
        rightEdge: column.rightEdge,
        role: column.role,
        headerLabel: column.headerLabel,
      }
    },
  )
  const billedColumns = columns.filter(
    (column) => column.role === "billedAmount",
  )
  if (
    billedColumns.length !== 1 ||
    billedColumns[0].rightEdge !== schema.billedAmountRightEdge
  ) {
    throw new TypeError("Invalid billed PDF column")
  }

  return {
    version: 1,
    issuer: schema.issuer,
    columns,
    billedAmountRightEdge: schema.billedAmountRightEdge,
    rightEdgeTolerance: schema.rightEdgeTolerance,
    confidence: schema.confidence,
  }
}

export async function determinePdfColumnSchema(
  layout: PdfStatementLayout,
): Promise<PdfColumnSchema> {
  const excerpt = buildColumnSchemaExcerpt(layout)

  try {
    assertRedacted(collectExcerptStrings(excerpt))
  } catch (error) {
    if (error instanceof RedactionGateError) {
      throw new UnsupportedPdfFormatError("redaction_gate_blocked")
    }
    throw error
  }

  if (excerpt.numericColumns.length === 0) {
    throw new UnsupportedPdfFormatError("no_numeric_columns")
  }

  let schema: PdfColumnSchema
  try {
    schema = await inferPdfColumnSchema(excerpt)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new UnsupportedPdfFormatError("column_schema_invalid")
    }
    throw error
  }

  const billedColumns = schema.columns.filter(
    (column) => column.role === "billedAmount",
  )
  if (billedColumns.length !== 1) {
    throw new UnsupportedPdfFormatError(
      "billed_column_not_identified",
    )
  }
  if (schema.confidence < MIN_SCHEMA_CONFIDENCE) {
    throw new UnsupportedPdfFormatError(
      "column_schema_low_confidence",
    )
  }

  return schema
}
