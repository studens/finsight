import { createServiceClient } from "../../lib/supabase/service"
import type { Json } from "../../types/database"
import type {
  FreeSummary,
  MaskedRow,
  PremiumReport,
  ReportType,
} from "../../types/pipeline"

export async function insertAnalysis(input: {
  userId: string
  maskedTransactions: MaskedRow[]
  freeSummary: FreeSummary
}): Promise<{ id: string }> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("analyses")
    .insert({
      user_id: input.userId,
      masked_transactions: input.maskedTransactions as unknown as Json,
      free_summary: input.freeSummary as unknown as Json,
    })
    .select("id")
    .single()

  if (error) throw error
  return { id: data.id }
}

export async function upsertPremiumReport(input: {
  userId: string
  analysisId: string
  reportType: ReportType
  report: PremiumReport
}): Promise<void> {
  const supabase = createServiceClient()
  const { data: analysis, error: readError } = await supabase
    .from("analyses")
    .select("user_id, premium_reports")
    .eq("id", input.analysisId)
    .single()

  if (readError || !analysis || analysis.user_id !== input.userId) {
    throw new Error("Analysis not found")
  }

  const cachedReports =
    analysis.premium_reports &&
    typeof analysis.premium_reports === "object" &&
    !Array.isArray(analysis.premium_reports)
      ? analysis.premium_reports
      : {}
  const { error: updateError } = await supabase
    .from("analyses")
    .update({
      premium_reports: {
        ...cachedReports,
        [input.reportType]: input.report,
      } as unknown as Json,
    })
    .eq("id", input.analysisId)

  if (updateError) throw updateError
}

export async function upsertSubscriptionStatus(input: {
  userId: string
  status: "active" | "inactive"
}): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: input.userId,
      status: input.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  )

  if (error) throw error
}

export function isUnknownUserError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23503"
  )
}
