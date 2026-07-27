import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AnalysisRecord, MaskedRow } from "../../../types/pipeline"

const generateAnalysisText = vi.fn()

vi.mock("../provider", () => ({ generateAnalysisText }))

function analysis(
  id: string,
  totalSpent: number,
  categoryTotals: Record<string, number>,
): AnalysisRecord {
  return {
    id,
    createdAt: "2026-07-01T00:00:00.000Z",
    maskedTransactions: [] as MaskedRow[],
    freeSummary: { totalSpent, transactionCount: 0, categoryTotals, topMerchants: [] },
  }
}

describe("generateMomComparison", () => {
  beforeEach(() => {
    generateAnalysisText.mockReset()
  })

  it("calculates total and category changes in code and adds Claude commentary", async () => {
    generateAnalysisText.mockResolvedValue({ text: "식비 증가가 전체 지출 상승을 이끌었습니다." })
    const { generateMomComparison } = await import("./mom-comparison")

    await expect(
      generateMomComparison({
        current: analysis("current", 150_000, { 식비: 100_000, 교통: 50_000 }),
        previous: analysis("previous", 100_000, { 식비: 80_000, 문화: 20_000 }),
      }),
    ).resolves.toEqual({
      type: "mom_comparison",
      hasPrevious: true,
      total: { current: 150_000, previous: 100_000, change: 50_000, changeRate: 50 },
      categories: [
        { category: "식비", current: 100_000, previous: 80_000, change: 20_000, changeRate: 25 },
        { category: "교통", current: 50_000, previous: 0, change: 50_000, changeRate: null },
        { category: "문화", current: 0, previous: 20_000, change: -20_000, changeRate: -100 },
      ],
      commentary: "식비 증가가 전체 지출 상승을 이끌었습니다.",
    })
    expect(generateAnalysisText).toHaveBeenCalledOnce()
    expect(generateAnalysisText.mock.calls[0][0].prompt).toContain('"change":50000')
  })

  it("returns a normal no-previous result without calling Claude", async () => {
    const { generateMomComparison } = await import("./mom-comparison")

    await expect(
      generateMomComparison({ current: analysis("current", 10_000, { 식비: 10_000 }), previous: null }),
    ).resolves.toEqual({
      type: "mom_comparison",
      hasPrevious: false,
      total: null,
      categories: [],
      commentary: null,
    })
    expect(generateAnalysisText).not.toHaveBeenCalled()
  })
})
