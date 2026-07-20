import { beforeEach, describe, expect, it, vi } from "vitest"

const { cookieStore, createServerClient } = vi.hoisted(() => ({
  cookieStore: {
    getAll: vi.fn(),
    set: vi.fn(),
  },
  createServerClient: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => cookieStore) }))
vi.mock("@supabase/ssr", () => ({ createServerClient }))

import {
  createClient,
  getAnalysisById,
  getPreviousAnalysis,
  getSessionUser,
  getSubscriptionStatus,
  listUserAnalyses,
} from "./server"

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  }

  for (const method of ["select", "eq", "lt", "order", "limit"] as const) {
    builder[method].mockReturnValue(builder)
  }

  return builder
}

describe("Supabase server reads", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
    cookieStore.getAll.mockReset().mockReturnValue([{ name: "sb", value: "session" }])
    cookieStore.set.mockReset()
    createServerClient.mockReset()
  })

  it("creates an anon-key client backed by server session cookies", async () => {
    const client = { auth: {}, from: vi.fn() }
    createServerClient.mockReturnValue(client)

    await expect(createClient()).resolves.toBe(client)
    const options = createServerClient.mock.calls[0][2]

    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.any(Object),
    )
    expect(options.cookies.getAll()).toEqual([{ name: "sb", value: "session" }])
    options.cookies.setAll([{ name: "refreshed", value: "token", options: { httpOnly: true } }])
    expect(cookieStore.set).toHaveBeenCalledWith("refreshed", "token", { httpOnly: true })
  })

  it("returns the authenticated user or null", async () => {
    const getUser = vi
      .fn()
      .mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: null })
    createServerClient.mockReturnValue({ auth: { getUser } })

    await expect(getSessionUser()).resolves.toEqual({ id: "user-1" })
    await expect(getSessionUser()).resolves.toBeNull()
  })

  it("returns an analysis unchanged and null when RLS makes it invisible", async () => {
    const row = {
      id: "analysis-1",
      user_id: "user-1",
      created_at: "2026-07-20T00:00:00Z",
      masked_transactions: [{ merchant: "Shop" }],
      free_summary: {
        totalSpent: 100,
        transactionCount: 1,
        categoryTotals: { food: 100 },
        topMerchants: [{ merchant: "Shop", amount: 100 }],
      },
      premium_reports: null,
    }
    const visible = query({ data: row, error: null })
    const invisible = query({ data: null, error: null })
    createServerClient
      .mockReturnValueOnce({ from: vi.fn(() => visible) })
      .mockReturnValueOnce({ from: vi.fn(() => invisible) })

    await expect(getAnalysisById("analysis-1")).resolves.toEqual(row)
    expect(visible.select).toHaveBeenCalledWith(
      "id, user_id, created_at, masked_transactions, free_summary, premium_reports",
    )
    expect(visible.eq).toHaveBeenCalledWith("id", "analysis-1")
    await expect(getAnalysisById("other-user-analysis")).resolves.toBeNull()
  })

  it("treats a missing subscription as inactive and recognizes active", async () => {
    const missing = query({ data: null, error: null })
    const active = query({ data: { status: "active" }, error: null })
    createServerClient
      .mockReturnValueOnce({ from: vi.fn(() => missing) })
      .mockReturnValueOnce({ from: vi.fn(() => active) })

    await expect(getSubscriptionStatus("user-1")).resolves.toBe("inactive")
    expect(missing.eq).toHaveBeenCalledWith("user_id", "user-1")
    await expect(getSubscriptionStatus("user-1")).resolves.toBe("active")
  })

  it("returns the immediately previous analysis in the AnalysisRecord shape", async () => {
    const row = {
      id: "previous",
      created_at: "2026-06-20T00:00:00Z",
      masked_transactions: [{ merchant: "Cafe" }],
      free_summary: {
        totalSpent: 50,
        transactionCount: 1,
        categoryTotals: { food: 50 },
        topMerchants: [{ merchant: "Cafe", amount: 50 }],
      },
    }
    const found = query({ data: row, error: null })
    const missing = query({ data: null, error: null })
    createServerClient
      .mockReturnValueOnce({ from: vi.fn(() => found) })
      .mockReturnValueOnce({ from: vi.fn(() => missing) })

    await expect(getPreviousAnalysis("user-1", "2026-07-20T00:00:00Z")).resolves.toEqual({
      id: "previous",
      createdAt: row.created_at,
      maskedTransactions: row.masked_transactions,
      freeSummary: row.free_summary,
    })
    expect(found.eq).toHaveBeenCalledWith("user_id", "user-1")
    expect(found.lt).toHaveBeenCalledWith("created_at", "2026-07-20T00:00:00Z")
    expect(found.order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(found.limit).toHaveBeenCalledWith(1)
    await expect(getPreviousAnalysis("user-1", row.created_at)).resolves.toBeNull()
  })

  it("lists only the compact analysis history in descending creation order", async () => {
    const rows = [
      { id: "new", created_at: "2026-07-20T00:00:00Z", free_summary: { totalSpent: 2 } },
      { id: "old", created_at: "2026-06-20T00:00:00Z", free_summary: { totalSpent: 1 } },
    ]
    const builder = query({ data: null, error: null })
    builder.order.mockResolvedValue({ data: rows, error: null })
    createServerClient.mockReturnValue({ from: vi.fn(() => builder) })

    await expect(listUserAnalyses()).resolves.toEqual([
      { id: "new", createdAt: rows[0].created_at, freeSummary: rows[0].free_summary },
      { id: "old", createdAt: rows[1].created_at, freeSummary: rows[1].free_summary },
    ])
    expect(builder.select).toHaveBeenCalledWith("id, created_at, free_summary")
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false })
  })
})
