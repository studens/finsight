import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  AnalysisRecord,
  AnomalyReport,
  FreeSummary,
} from "../../../../../types/pipeline"

const {
  generateReport,
  getAnalysisById,
  getPreviousAnalysis,
  getSessionUser,
  getSubscriptionStatus,
  upsertPremiumReport,
} = vi.hoisted(() => ({
  generateReport: vi.fn(),
  getAnalysisById: vi.fn(),
  getPreviousAnalysis: vi.fn(),
  getSessionUser: vi.fn(),
  getSubscriptionStatus: vi.fn(),
  upsertPremiumReport: vi.fn(),
}))

vi.mock("../../../../../lib/supabase/server", () => ({
  getAnalysisById,
  getPreviousAnalysis,
  getSessionUser,
  getSubscriptionStatus,
}))
vi.mock("../../../../../services/llm/reports", () => ({ generateReport }))
vi.mock("../../../../../services/supabase-admin", () => ({ upsertPremiumReport }))

import { GET } from "./route"

const freeSummary: FreeSummary = {
  totalSpent: 12000,
  transactionCount: 2,
  categoryTotals: { food: 12000 },
  topMerchants: [{ merchant: "Cafe", amount: 12000 }],
}

const report: AnomalyReport = {
  type: "anomaly_detection",
  summary: "No unusual spending",
  anomalies: [],
}

function analysis(premiumReports: Record<string, unknown> | null = null) {
  return {
    id: "analysis-1",
    user_id: "user-1",
    created_at: "2026-07-20T00:00:00.000Z",
    masked_transactions: [{ card: "****1234", amount: "12000" }],
    free_summary: freeSummary,
    premium_reports: premiumReports,
  }
}

function callGet(
  reportType = "anomaly_detection",
  analysisId = "analysis-1",
) {
  return GET(new Request("https://finsight.test/api/reports"), {
    params: Promise.resolve({ analysisId, reportType }),
  })
}

describe("GET /api/reports/[analysisId]/[reportType]", () => {
  beforeEach(() => {
    getSessionUser.mockReset().mockResolvedValue({ id: "user-1" })
    getAnalysisById.mockReset().mockResolvedValue(analysis())
    getSubscriptionStatus.mockReset().mockResolvedValue("active")
    getPreviousAnalysis.mockReset().mockResolvedValue(null)
    generateReport.mockReset().mockResolvedValue(report)
    upsertPremiumReport.mockReset().mockResolvedValue(undefined)
  })

  it("returns UNAUTHORIZED before reading route resources", async () => {
    getSessionUser.mockResolvedValue(null)

    const response = await callGet()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ code: "UNAUTHORIZED" })
    expect(getAnalysisById).not.toHaveBeenCalled()
  })

  it("rejects an invalid report type before ownership and subscription checks", async () => {
    const response = await callGet("foo")

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ code: "NOT_FOUND" })
    expect(getAnalysisById).not.toHaveBeenCalled()
    expect(getSubscriptionStatus).not.toHaveBeenCalled()
    expect(generateReport).not.toHaveBeenCalled()
  })

  it.each([
    ["missing analysis", null],
    ["owner mismatch", { ...analysis(), user_id: "other-user" }],
  ])("returns NOT_FOUND for %s without checking subscription", async (_case, value) => {
    getAnalysisById.mockResolvedValue(value)

    const response = await callGet()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ code: "NOT_FOUND" })
    expect(getSubscriptionStatus).not.toHaveBeenCalled()
    expect(generateReport).not.toHaveBeenCalled()
  })

  it("checks the paywall before accessing cache or generating a report", async () => {
    const cacheRead = vi.fn()
    const ownedAnalysis = analysis()
    Object.defineProperty(ownedAnalysis, "premium_reports", {
      get: cacheRead,
    })
    getAnalysisById.mockResolvedValue(ownedAnalysis)
    getSubscriptionStatus.mockResolvedValue("inactive")

    const response = await callGet()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: "PAYWALL_REQUIRED" })
    expect(getSubscriptionStatus).toHaveBeenCalledWith("user-1")
    expect(cacheRead).not.toHaveBeenCalled()
    expect(generateReport).not.toHaveBeenCalled()
    expect(upsertPremiumReport).not.toHaveBeenCalled()
    expect(getAnalysisById.mock.invocationCallOrder[0]).toBeLessThan(
      getSubscriptionStatus.mock.invocationCallOrder[0],
    )
  })

  it("returns a cached report after the active subscription check", async () => {
    getAnalysisById.mockResolvedValue(
      analysis({ anomaly_detection: report }),
    )

    const response = await callGet()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      reportType: "anomaly_detection",
      data: report,
    })
    expect(getSubscriptionStatus).toHaveBeenCalledWith("user-1")
    expect(generateReport).not.toHaveBeenCalled()
    expect(upsertPremiumReport).not.toHaveBeenCalled()
  })

  it("lazy-generates, caches, and returns a missing report", async () => {
    const response = await callGet()

    const current: AnalysisRecord = {
      id: "analysis-1",
      createdAt: "2026-07-20T00:00:00.000Z",
      maskedTransactions: [{ card: "****1234", amount: "12000" }] as never,
      freeSummary,
    }
    expect(generateReport).toHaveBeenCalledWith({
      reportType: "anomaly_detection",
      current,
      previous: null,
    })
    expect(getPreviousAnalysis).not.toHaveBeenCalled()
    expect(upsertPremiumReport).toHaveBeenCalledWith({
      userId: "user-1",
      analysisId: "analysis-1",
      reportType: "anomaly_detection",
      report,
    })
    expect(generateReport.mock.invocationCallOrder[0]).toBeLessThan(
      upsertPremiumReport.mock.invocationCallOrder[0],
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      reportType: "anomaly_detection",
      data: report,
    })
  })

  it.each([
    ["a previous record", { id: "previous-1" }],
    ["no previous record", null],
  ])("passes %s to month-over-month generation", async (_case, previous) => {
    getPreviousAnalysis.mockResolvedValue(previous)

    await callGet("mom_comparison")

    expect(getPreviousAnalysis).toHaveBeenCalledWith(
      "user-1",
      "2026-07-20T00:00:00.000Z",
    )
    expect(generateReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportType: "mom_comparison",
        previous,
      }),
    )
  })

  it("returns GENERATION_FAILED without caching when generation throws", async () => {
    generateReport.mockRejectedValue(new Error("provider unavailable"))

    const response = await callGet()

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ code: "GENERATION_FAILED" })
    expect(upsertPremiumReport).not.toHaveBeenCalled()
  })
})
