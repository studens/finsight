import { beforeEach, describe, expect, it, vi } from "vitest"

import type { FreeSummary, MaskedRow, PremiumReport } from "../../types/pipeline"

const { createServiceClient } = vi.hoisted(() => ({ createServiceClient: vi.fn() }))

vi.mock("../../lib/supabase/service", () => ({ createServiceClient }))

import { insertAnalysis, upsertPremiumReport } from "."

const maskedTransactions = [
  { merchant: "Cafe", card: "****1234" },
] as unknown as MaskedRow[]
const freeSummary: FreeSummary = {
  totalSpent: 12000,
  transactionCount: 1,
  categoryTotals: { food: 12000 },
  topMerchants: [{ merchant: "Cafe", amount: 12000 }],
}

function insertQuery(result: { data: unknown; error: unknown }) {
  const single = vi.fn(async () => result)
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select }))
  return { insert, select, single }
}

function reportQuery(options: {
  owner: { user_id: string; premium_reports: Record<string, unknown> | null } | null
  updateError?: unknown
}) {
  const ownerSingle = vi.fn(async () => ({ data: options.owner, error: null }))
  const eqOwner = vi.fn(() => ({ single: ownerSingle }))
  const select = vi.fn(() => ({ eq: eqOwner }))
  const eqUpdate = vi.fn(async () => ({ error: options.updateError ?? null }))
  const update = vi.fn(() => ({ eq: eqUpdate }))
  return { select, eqOwner, ownerSingle, update, eqUpdate }
}

describe("supabase-admin writes", () => {
  beforeEach(() => createServiceClient.mockReset())

  it("inserts only the authenticated owner and masked analysis payload", async () => {
    const query = insertQuery({ data: { id: "analysis-1" }, error: null })
    const from = vi.fn(() => query)
    createServiceClient.mockReturnValue({ from })

    await expect(
      insertAnalysis({ userId: "user-1", maskedTransactions, freeSummary }),
    ).resolves.toEqual({ id: "analysis-1" })

    expect(from).toHaveBeenCalledWith("analyses")
    expect(query.insert).toHaveBeenCalledWith({
      user_id: "user-1",
      masked_transactions: maskedTransactions,
      free_summary: freeSummary,
    })
    expect(query.select).toHaveBeenCalledWith("id")
  })

  it.each([
    ["another owner", { user_id: "user-2", premium_reports: null }],
    ["a missing analysis", null],
  ])("rejects %s before calling the service-role update", async (_label, owner) => {
    const query = reportQuery({ owner })
    createServiceClient.mockReturnValue({ from: vi.fn(() => query) })

    await expect(
      upsertPremiumReport({
        userId: "user-1",
        analysisId: "analysis-1",
        reportType: "anomaly_detection",
        report: { type: "anomaly_detection", summary: "none", anomalies: [] },
      }),
    ).rejects.toThrow("Analysis not found")

    expect(query.update).not.toHaveBeenCalled()
  })

  it("preserves cached reports while merging the requested report key", async () => {
    const cached = {
      mom_comparison: { type: "mom_comparison", commentary: "cached" },
    }
    const report: PremiumReport = {
      type: "anomaly_detection",
      summary: "one unusual payment",
      anomalies: [{ transactionIndex: 0, reason: "large", severity: "high" }],
    }
    const query = reportQuery({
      owner: { user_id: "user-1", premium_reports: cached },
    })
    createServiceClient.mockReturnValue({ from: vi.fn(() => query) })

    await expect(
      upsertPremiumReport({
        userId: "user-1",
        analysisId: "analysis-1",
        reportType: "anomaly_detection",
        report,
      }),
    ).resolves.toBeUndefined()

    expect(query.update).toHaveBeenCalledWith({
      premium_reports: { ...cached, anomaly_detection: report },
    })
    expect(query.eqUpdate).toHaveBeenCalledWith("id", "analysis-1")
  })
})
