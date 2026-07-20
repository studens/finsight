import { NextResponse } from "next/server"

import { getSessionUser } from "../../../lib/supabase/server"
import { parseCsv } from "../../../services/csv-parser"
import { generateFreeSummary } from "../../../services/llm/free-summary"
import { maskPii } from "../../../services/pii-masking"
import { insertAnalysis } from "../../../services/supabase-admin"
import type { ConfirmedMapping, MaskedRow } from "../../../types/pipeline"

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function parseMapping(value: FormDataEntryValue | null): ConfirmedMapping | null {
  if (typeof value !== "string") return null

  try {
    const mapping: unknown = JSON.parse(value)
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      return null
    }

    const candidate = mapping as Record<string, unknown>
    if (
      !isNonEmptyString(candidate.date) ||
      !isNonEmptyString(candidate.merchant) ||
      !isNonEmptyString(candidate.amount) ||
      !(candidate.category === null || isNonEmptyString(candidate.category))
    ) {
      return null
    }

    return {
      date: candidate.date,
      merchant: candidate.merchant,
      amount: candidate.amount,
      category: candidate.category,
    }
  } catch {
    return null
  }
}

function projectMappedColumns(
  rows: MaskedRow[],
  mapping: ConfirmedMapping,
): MaskedRow[] {
  const columns = [
    mapping.date,
    mapping.merchant,
    mapping.amount,
    ...(mapping.category ? [mapping.category] : []),
  ]

  return rows.map((row) => {
    const projected = {} as MaskedRow
    for (const column of columns) {
      projected[column] = row[column]
    }
    return projected
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 })
  }

  const file = formData.get("file")
  const mapping = parseMapping(formData.get("mapping"))
  if (!(file instanceof File) || file.size === 0 || !mapping) {
    return NextResponse.json({ code: "BAD_REQUEST" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = parseCsv(buffer)
  const masked = maskPii(parsed)
  const rows = projectMappedColumns(masked.rows, mapping)
  const freeSummary = await generateFreeSummary({ rows, mapping })
  const analysis = await insertAnalysis({
    userId: user.id,
    maskedTransactions: rows,
    freeSummary,
  })

  return NextResponse.json({
    analysisId: analysis.id,
    freeSummary,
  })
}
