import { NextResponse } from "next/server"

import {
  getAnalysisById,
  getPreviousAnalysis,
  getSessionUser,
  getSubscriptionStatus,
} from "../../../../../lib/supabase/server"
import { generateReport } from "../../../../../services/llm/reports"
import { upsertPremiumReport } from "../../../../../services/supabase-admin"
import type {
  AnalysisRecord,
  MaskedRow,
  ReportType,
} from "../../../../../types/pipeline"

const REPORT_TYPES: readonly ReportType[] = [
  "mom_comparison",
  "anomaly_detection",
  "savings_suggestions",
  "budget_recommendation",
]

function isReportType(value: string): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType)
}

type RouteContext = {
  params: Promise<{
    analysisId: string
    reportType: string
  }>
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 })
  }

  const { analysisId, reportType } = await context.params
  if (!isReportType(reportType)) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  }

  const analysis = await getAnalysisById(analysisId)
  if (!analysis || analysis.user_id !== user.id) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 })
  }

  const subscriptionStatus = await getSubscriptionStatus(user.id)
  if (subscriptionStatus !== "active") {
    return NextResponse.json({ code: "PAYWALL_REQUIRED" }, { status: 403 })
  }

  const cachedReport = analysis.premium_reports?.[reportType]
  if (cachedReport !== undefined) {
    return NextResponse.json({ reportType, data: cachedReport })
  }

  const current: AnalysisRecord = {
    id: analysis.id,
    createdAt: analysis.created_at,
    maskedTransactions: analysis.masked_transactions as MaskedRow[],
    freeSummary: analysis.free_summary,
  }
  const previous =
    reportType === "mom_comparison"
      ? await getPreviousAnalysis(user.id, analysis.created_at)
      : null

  let report
  try {
    report = await generateReport({ reportType, current, previous })
  } catch {
    return NextResponse.json({ code: "GENERATION_FAILED" }, { status: 502 })
  }

  await upsertPremiumReport({
    userId: user.id,
    analysisId,
    reportType,
    report,
  })

  return NextResponse.json({ reportType, data: report })
}
