import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ConfirmedMapping, MaskedRow } from "../../types/pipeline"

const generateText = vi.fn()
const getAnalysisModel = vi.fn(() => ({ modelId: "test-model" }))

vi.mock("ai", () => ({ generateText }))
vi.mock("./provider", () => ({ getAnalysisModel }))

const mapping: ConfirmedMapping = {
  date: "date",
  merchant: "merchant",
  amount: "amount",
  category: "category",
}

function maskedRows(rows: Record<string, string>[]): MaskedRow[] {
  return rows as unknown as MaskedRow[]
}

describe("generateFreeSummary", () => {
  beforeEach(() => {
    generateText.mockReset()
    getAnalysisModel.mockClear()
  })

  it("calculates every Free summary field without calling Claude", async () => {
    const { generateFreeSummary } = await import("./free-summary")

    await expect(
      generateFreeSummary({
        rows: maskedRows([
          { date: "2026-07-01", merchant: "카페", amount: "5000", category: "식비" },
          { date: "2026-07-02", merchant: "마트", amount: "20000", category: "생활" },
          { date: "2026-07-03", merchant: "카페", amount: "7000", category: "식비" },
          { date: "2026-07-04", merchant: "서점", amount: "15000", category: "문화" },
          { date: "2026-07-05", merchant: "택시", amount: "9000", category: "교통" },
          { date: "2026-07-06", merchant: "약국", amount: "3000", category: "건강" },
          { date: "2026-07-07", merchant: "영화관", amount: "12000", category: "문화" },
        ]),
        mapping,
      }),
    ).resolves.toEqual({
      totalSpent: 71000,
      transactionCount: 7,
      categoryTotals: { 식비: 12000, 생활: 20000, 문화: 27000, 교통: 9000, 건강: 3000 },
      topMerchants: [
        { merchant: "마트", amount: 20000 },
        { merchant: "서점", amount: 15000 },
        { merchant: "카페", amount: 12000 },
        { merchant: "영화관", amount: 12000 },
        { merchant: "택시", amount: 9000 },
      ],
    })
    expect(generateText).not.toHaveBeenCalled()
    expect(getAnalysisModel).not.toHaveBeenCalled()
  })

  it("returns only existing merchants in descending amount order", async () => {
    const { generateFreeSummary } = await import("./free-summary")

    const summary = await generateFreeSummary({
      rows: maskedRows([
        { date: "1", merchant: "A", amount: "100", category: "기타" },
        { date: "2", merchant: "B", amount: "300", category: "기타" },
        { date: "3", merchant: "A", amount: "250", category: "기타" },
      ]),
      mapping,
    })

    expect(summary.topMerchants).toEqual([
      { merchant: "A", amount: 350 },
      { merchant: "B", amount: 300 },
    ])
  })

  it("parses won signs and comma separators", async () => {
    const { generateFreeSummary } = await import("./free-summary")

    const summary = await generateFreeSummary({
      rows: maskedRows([
        { date: "1", merchant: "A", amount: "₩12,300", category: "식비" },
        { date: "2", merchant: "B", amount: "12,300", category: "생활" },
      ]),
      mapping,
    })

    expect(summary.totalSpent).toBe(24600)
  })

  it("uses mocked Claude classification only when category is unmapped", async () => {
    generateText.mockResolvedValue({ text: JSON.stringify(["식비", "교통", "식비"]) })
    const { generateFreeSummary } = await import("./free-summary")

    await expect(
      generateFreeSummary({
        rows: maskedRows([
          { date: "1", merchant: "카페", amount: "5000" },
          { date: "2", merchant: "택시", amount: "9000" },
          { date: "3", merchant: "식당", amount: "12000" },
        ]),
        mapping: { ...mapping, category: null },
      }),
    ).resolves.toEqual({
      totalSpent: 26000,
      transactionCount: 3,
      categoryTotals: { 식비: 17000, 교통: 9000 },
      topMerchants: [
        { merchant: "식당", amount: 12000 },
        { merchant: "택시", amount: 9000 },
        { merchant: "카페", amount: 5000 },
      ],
    })
    expect(generateText).toHaveBeenCalledOnce()
    expect(getAnalysisModel).toHaveBeenCalledOnce()
    expect(generateText.mock.calls[0][0].prompt).toContain("카페")
    expect(generateText.mock.calls[0][0].prompt).toContain("JSON 문자열 배열")
  })
})
