import type { ParsedCsv } from "../../types/pipeline"
import type { PdfColumnSchema } from "../../types/pdf"
import { determinePdfColumnSchema } from "./column-schema"
import { UnsupportedPdfFormatError } from "./errors"
import { extractPdfTextItems } from "./extract-text"
import { buildStatementLayout } from "./layout"
import { applyPdfColumnSchema } from "./to-parsed-csv"

export {
  PdfPasswordRequiredError,
  UnsupportedPdfFormatError,
} from "./errors"
export type { PdfPasswordCase } from "./errors"
export { extractPdfTextItems, isPdfBuffer } from "./extract-text"
export {
  buildStatementLayout,
  clusterItemsIntoLines,
  RIGHT_EDGE_TOLERANCE,
  Y_CLUSTER_TOLERANCE,
} from "./layout"
export {
  buildColumnSchemaExcerpt,
  determinePdfColumnSchema,
  MIN_SCHEMA_CONFIDENCE,
  parsePdfColumnSchema,
} from "./column-schema"

async function extractLayout(input: {
  data: Buffer | Uint8Array
  password?: string
}) {
  const doc = await extractPdfTextItems(input)
  const layout = buildStatementLayout(doc)
  if (layout.transactionLines.length === 0) {
    throw new UnsupportedPdfFormatError("no_transaction_rows")
  }
  return layout
}

/** /api/upload 경로: 레댁션 이후 LLM 컬럼 판정을 정확히 한 번 수행한다. */
export async function parsePdfStatement(input: {
  data: Buffer | Uint8Array
  password?: string
}): Promise<{
  parsed: ParsedCsv
  pdfColumnSchema: PdfColumnSchema
}> {
  const layout = await extractLayout(input)
  const pdfColumnSchema = await determinePdfColumnSchema(layout)
  const parsed = applyPdfColumnSchema({
    layout,
    schema: pdfColumnSchema,
  })

  return { parsed, pdfColumnSchema }
}

/** /api/analyze 경로: 신뢰 경계에서 검증된 스키마만 적용하며 LLM을 호출하지 않는다. */
export async function parsePdfStatementWithSchema(input: {
  data: Buffer | Uint8Array
  password?: string
  schema: PdfColumnSchema
}): Promise<ParsedCsv> {
  const layout = await extractLayout(input)
  return applyPdfColumnSchema({ layout, schema: input.schema })
}

export {
  applyPdfColumnSchema,
  PDF_COLUMN_MAPPING,
  PDF_HEADERS,
} from "./to-parsed-csv"
export type { PdfTransactionKind } from "./to-parsed-csv"
