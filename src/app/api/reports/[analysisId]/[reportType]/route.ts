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

// 에러 객체에는 프롬프트(requestBodyValues)·모델 원문(responseBody)·
// 파싱 실패 입력 조각·PostgrestError의 details(=offending value)가 실릴 수 있어,
// 종류를 식별하는 최소 필드만 허용 목록으로 뽑아 남긴다.
function describeError(error: unknown): {
  errorName: string
  statusCode?: number
  code?: string
} {
  if (!(error instanceof Error)) return { errorName: "UnknownError" }
  const statusCode = (error as { statusCode?: unknown }).statusCode
  const code = (error as { code?: unknown }).code
  return {
    errorName: error.name,
    ...(typeof statusCode === "number" ? { statusCode } : {}),
    ...(typeof code === "string" ? { code: code.slice(0, 32) } : {}),
  }
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
  } catch (error) {
    console.error("[reports] 리포트 생성 실패", {
      analysisId: analysisId.slice(0, 64),
      reportType,
      ...describeError(error),
    })
    // 로그 인자는 analysisId / reportType / errorName / statusCode? / code? 로 한정된다.
    return NextResponse.json({ code: "GENERATION_FAILED" }, { status: 502 })
  }

  try {
    await upsertPremiumReport({
      userId: user.id,
      analysisId,
      reportType,
      report,
    })
  } catch (error) {
    console.error("[reports] 리포트 캐시 저장 실패", {
      analysisId: analysisId.slice(0, 64),
      reportType,
      ...describeError(error),
    })
  }

  return NextResponse.json({ reportType, data: report })
}
