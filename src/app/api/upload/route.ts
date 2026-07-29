import { NextResponse } from "next/server"

import { claimsPdf } from "../../../lib/file-type"
import { toPdfErrorPayload } from "../../../lib/pdf-error"
import { getSessionUser } from "../../../lib/supabase/server"
import { parseCsv } from "../../../services/csv-parser"
import { inferColumnMapping } from "../../../services/llm/column-mapping"
import {
  isPdfBuffer,
  parsePdfStatement,
  PDF_COLUMN_MAPPING,
} from "../../../services/pdf-parser"
import { maskPii } from "../../../services/pii-masking"

const MAX_SAMPLE_ROWS = 5

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const isPdf = isPdfBuffer(buffer)
  if (!isPdf && claimsPdf(file)) {
    return NextResponse.json(
      { code: "UNSUPPORTED_PDF_FORMAT" },
      { status: 422 },
    )
  }

  if (isPdf) {
    const passwordField = formData.get("password")
    const password =
      typeof passwordField === "string" && passwordField.length > 0
        ? passwordField
        : undefined

    try {
      const { parsed, pdfColumnSchema } = await parsePdfStatement({
        data: buffer,
        password,
      })
      const masked = maskPii(parsed)

      return NextResponse.json({
        mapping: PDF_COLUMN_MAPPING,
        sample: {
          headers: masked.headers,
          rows: masked.rows.slice(0, MAX_SAMPLE_ROWS),
          excludedColumns: masked.excludedColumns,
          maskedColumns: masked.maskedColumns,
        },
        pdfColumnSchema,
      })
    } catch (error) {
      const payload = toPdfErrorPayload(error, password !== undefined)
      if (payload) {
        return NextResponse.json(payload.body, { status: payload.status })
      }
      throw error
    }
  }

  const parsed = parseCsv(buffer)
  const masked = maskPii(parsed)
  const sampleRows = masked.rows.slice(0, MAX_SAMPLE_ROWS)
  const mapping = await inferColumnMapping({
    headers: masked.headers,
    sampleRows,
  })

  return NextResponse.json({
    mapping,
    sample: {
      headers: masked.headers,
      rows: sampleRows,
      excludedColumns: masked.excludedColumns,
      maskedColumns: masked.maskedColumns,
    },
  })
}
