import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AnalysisRecord, MaskedRow } from "../../../types/pipeline"

const generateAnalysisText = vi.fn()

vi.mock("../provider", () => ({ generateAnalysisText }))

describe("generateSavingsSuggestions", () => {
  beforeEach(() => {
    generateAnalysisText.mockReset()
  })

  it("returns savings suggestions generated from only the current masked analysis", async () => {
    generateAnalysisText.mockResolvedValue({
      text: JSON.stringify({
        summary: "반복 지출을 줄일 여지가 있습니다.",
        suggestions: [{
          title: "카페 지출 줄이기",
          description: "주 1회 홈카페로 대체하세요.",
          estimatedMonthlySavings: 20_000,
        }],
      }),
    })
    const current: AnalysisRecord = {
      id: "analysis-secret-id",
      createdAt: "2026-07-01T00:00:00.000Z",
      maskedTransactions: [
        { 날짜: "2026-07-01", 가맹점: "카페", 금액: "5000", 카드번호: "****1234" },
      ] as unknown as MaskedRow[],
      freeSummary: {
        totalSpent: 5_000,
        transactionCount: 1,
        categoryTotals: { 카페: 5_000 },
        topMerchants: [{ merchant: "카페", amount: 5_000 }],
      },
    }
    const { generateSavingsSuggestions } = await import("./savings-suggestions")

    await expect(generateSavingsSuggestions({ current })).resolves.toEqual({
      type: "savings_suggestions",
      summary: "반복 지출을 줄일 여지가 있습니다.",
      suggestions: [{
        title: "카페 지출 줄이기",
        description: "주 1회 홈카페로 대체하세요.",
        estimatedMonthlySavings: 20_000,
      }],
    })
    expect(generateAnalysisText).toHaveBeenCalledOnce()
    expect(generateAnalysisText.mock.calls[0][0].prompt).toContain("****1234")
    expect(generateAnalysisText.mock.calls[0][0].prompt).not.toContain("analysis-secret-id")
  })
})
