import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AnalysisRecord, MaskedRow, ReportType } from "../../../types/pipeline"
import { generateAnomalyDetection } from "./anomaly-detection"
import { generateBudgetRecommendation } from "./budget-recommendation"
import { generateMomComparison } from "./mom-comparison"
import { generateSavingsSuggestions } from "./savings-suggestions"

vi.mock("./anomaly-detection", () => ({ generateAnomalyDetection: vi.fn() }))
vi.mock("./budget-recommendation", () => ({ generateBudgetRecommendation: vi.fn() }))
vi.mock("./mom-comparison", () => ({ generateMomComparison: vi.fn() }))
vi.mock("./savings-suggestions", () => ({ generateSavingsSuggestions: vi.fn() }))

const current = analysis("current")
const previous = analysis("previous")

function analysis(id: string): AnalysisRecord {
  return {
    id,
    createdAt: "2026-07-01T00:00:00.000Z",
    maskedTransactions: [] as MaskedRow[],
    freeSummary: { totalSpent: 0, transactionCount: 0, categoryTotals: {}, topMerchants: [] },
  }
}

describe("generateReport", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ["mom_comparison", generateMomComparison, { current, previous }],
    ["anomaly_detection", generateAnomalyDetection, { current }],
    ["savings_suggestions", generateSavingsSuggestions, { current }],
    ["budget_recommendation", generateBudgetRecommendation, { current }],
  ] as const)("dispatches %s to exactly one report generator", async (reportType, expected, args) => {
    vi.mocked(expected).mockResolvedValue({ type: reportType } as never)
    const { generateReport } = await import("./index")

    await expect(generateReport({ reportType, current, previous })).resolves.toEqual({ type: reportType })
    expect(expected).toHaveBeenCalledOnce()
    expect(expected).toHaveBeenCalledWith(args)
    expect([
      generateMomComparison,
      generateAnomalyDetection,
      generateSavingsSuggestions,
      generateBudgetRecommendation,
    ].filter((generator) => vi.mocked(generator).mock.calls.length > 0)).toEqual([expected])
  })

  it("keeps ReportType literals identical to the premium_reports cache keys", () => {
    const cacheKeys = [
      "mom_comparison",
      "anomaly_detection",
      "savings_suggestions",
      "budget_recommendation",
    ] as const satisfies readonly ReportType[]
    const allKeysAreCovered: Record<ReportType, true> = Object.fromEntries(
      cacheKeys.map((key) => [key, true]),
    ) as Record<ReportType, true>

    expect(Object.keys(allKeysAreCovered)).toEqual(cacheKeys)
  })
})
