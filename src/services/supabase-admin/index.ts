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
  const { data, error } = await supabase.rpc("merge_premium_report", {
    p_analysis_id: input.analysisId,
    p_user_id: input.userId,
    p_report_type: input.reportType,
    p_report: input.report as unknown as Json,
  })

  if (error) throw error
  if (data !== true) throw new Error("Analysis not found")
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
