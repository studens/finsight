import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AnalysisRecord, MaskedRow } from "../../../types/pipeline"

const generateText = vi.fn()
const getAnalysisModel = vi.fn(() => ({ modelId: "test-model" }))

vi.mock("ai", () => ({ generateText }))
vi.mock("../provider", () => ({ getAnalysisModel }))

describe("generateBudgetRecommendation", () => {
  beforeEach(() => {
    generateText.mockReset()
    getAnalysisModel.mockClear()
  })

  it("returns a budget recommendation generated from only the current masked analysis", async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({
        summary: "현재 지출을 기준으로 현실적인 예산을 제안합니다.",
        categories: [{
          category: "식비",
          currentSpending: 300_000,
          recommendedBudget: 270_000,
          reason: "외식 빈도를 소폭 줄일 수 있습니다.",
        }],
      }),
    })
    const current: AnalysisRecord = {
      id: "analysis-secret-id",
      createdAt: "2026-07-01T00:00:00.000Z",
      maskedTransactions: [] as MaskedRow[],
      freeSummary: {
        totalSpent: 300_000,
        transactionCount: 10,
        categoryTotals: { 식비: 300_000 },
        topMerchants: [],
      },
    }
    const { generateBudgetRecommendation } = await import("./budget-recommendation")

    await expect(generateBudgetRecommendation({ current })).resolves.toEqual({
      type: "budget_recommendation",
      summary: "현재 지출을 기준으로 현실적인 예산을 제안합니다.",
      categories: [{
        category: "식비",
        currentSpending: 300_000,
        recommendedBudget: 270_000,
        reason: "외식 빈도를 소폭 줄일 수 있습니다.",
      }],
    })
    expect(generateText).toHaveBeenCalledOnce()
    expect(generateText.mock.calls[0][0].prompt).toContain('"식비":300000')
    expect(generateText.mock.calls[0][0].prompt).not.toContain("analysis-secret-id")
  })
})
