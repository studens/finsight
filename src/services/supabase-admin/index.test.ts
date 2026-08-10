import { beforeEach, describe, expect, it, vi } from "vitest"

import type { FreeSummary, MaskedRow, PremiumReport } from "../../types/pipeline"

const { createServiceClient } = vi.hoisted(() => ({ createServiceClient: vi.fn() }))

vi.mock("../../lib/supabase/service", () => ({ createServiceClient }))

import {
  insertAnalysis,
  isUnknownUserError,
  upsertPremiumReport,
  upsertSubscriptionStatus,
} from "."

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

function subscriptionQuery(result: { error: unknown } = { error: null }) {
  const upsert = vi.fn(
    async (
      payload: {
        user_id: string
        status: "active" | "inactive"
        updated_at: string
      },
      options: { onConflict: string },
    ) => {
      void payload
      void options
      return result
    },
  )
  return { upsert }
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

  it("upserts a subscription status with an explicit updated timestamp", async () => {
    const query = subscriptionQuery()
    const from = vi.fn(() => query)
    createServiceClient.mockReturnValue({ from })

    await expect(
      upsertSubscriptionStatus({ userId: "user-1", status: "active" }),
    ).resolves.toBeUndefined()

    expect(from).toHaveBeenCalledWith("subscriptions")
    expect(query.upsert).toHaveBeenCalledTimes(1)
    const [payload, options] = query.upsert.mock.calls[0]
    expect(payload).toEqual({
      user_id: "user-1",
      status: "active",
      updated_at: expect.any(String),
    })
    expect(options).toEqual({ onConflict: "user_id" })
    expect(new Date(payload.updated_at).toString()).not.toBe("Invalid Date")
  })

  it("throws subscription upsert errors", async () => {
    const error = new Error("database unavailable")
    const query = subscriptionQuery({ error })
    createServiceClient.mockReturnValue({ from: vi.fn(() => query) })

    await expect(
      upsertSubscriptionStatus({ userId: "user-1", status: "inactive" }),
    ).rejects.toBe(error)
  })

  it.each([
    [{ code: "23503" }, true],
    [{ code: "23505" }, false],
    [new Error("boom"), false],
    [null, false],
    [undefined, false],
    ["23503", false],
  ])("classifies unknown-user database errors %#", (error, expected) => {
    expect(isUnknownUserError(error)).toBe(expected)
  })
})
