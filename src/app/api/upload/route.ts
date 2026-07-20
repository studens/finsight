import { NextResponse } from "next/server"

import { getSessionUser } from "../../../lib/supabase/server"
import { parseCsv } from "../../../services/csv-parser"
import { inferColumnMapping } from "../../../services/llm/column-mapping"
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
