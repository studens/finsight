import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AnalysisRecord, MaskedRow } from "../../../types/pipeline"

const generateText = vi.fn()
const getAnalysisModel = vi.fn(() => ({ modelId: "test-model" }))

vi.mock("ai", () => ({ generateText }))
vi.mock("../provider", () => ({ getAnalysisModel }))

describe("generateAnomalyDetection", () => {
  beforeEach(() => {
    generateText.mockReset()
    getAnalysisModel.mockClear()
  })

  it("returns anomalies generated from only the current masked analysis", async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({
        summary: "평소보다 큰 결제가 발견되었습니다.",
        anomalies: [{ transactionIndex: 1, reason: "고액 결제", severity: "high" }],
      }),
    })
    const current: AnalysisRecord = {
      id: "analysis-1",
      createdAt: "2026-07-01T00:00:00.000Z",
      maskedTransactions: [
        { 날짜: "2026-07-01", 가맹점: "카페", 금액: "5000", 카드번호: "****1234" },
        { 날짜: "2026-07-02", 가맹점: "전자상가", 금액: "900000", 카드번호: "****5678" },
      ] as unknown as MaskedRow[],
      freeSummary: {
        totalSpent: 905_000,
        transactionCount: 2,
        categoryTotals: { 기타: 905_000 },
        topMerchants: [],
      },
    }
    const { generateAnomalyDetection } = await import("./anomaly-detection")

    await expect(generateAnomalyDetection({ current })).resolves.toEqual({
      type: "anomaly_detection",
      summary: "평소보다 큰 결제가 발견되었습니다.",
      anomalies: [{ transactionIndex: 1, reason: "고액 결제", severity: "high" }],
    })
    expect(generateText).toHaveBeenCalledOnce()
    expect(generateText.mock.calls[0][0].prompt).toContain("****5678")
    expect(generateText.mock.calls[0][0].prompt).not.toContain("analysis-1")
  })
})
