import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  createCheckoutSession,
  getSessionUser,
  getSubscriptionStatus,
  PolarApiError,
  PolarConfigError,
} = vi.hoisted(() => {
  class PolarApiError extends Error {}
  class PolarConfigError extends Error {}

  return {
    createCheckoutSession: vi.fn(),
    getSessionUser: vi.fn(),
    getSubscriptionStatus: vi.fn(),
    PolarApiError,
    PolarConfigError,
  }
})

vi.mock("../../../lib/supabase/server", () => ({
  getSessionUser,
  getSubscriptionStatus,
}))
vi.mock("../../../services/polar", () => ({
  createCheckoutSession,
  PolarApiError,
  PolarConfigError,
}))

import { POST } from "./route"

function request(init?: { origin?: string; body?: string }) {
  return new Request("https://finsight.test/api/checkout", {
    method: "POST",
    headers: init?.origin === undefined ? undefined : { Origin: init.origin },
    body: init?.body,
  })
}

describe("POST /api/checkout", () => {
  beforeEach(() => {
    getSessionUser.mockReset().mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
    })
    getSubscriptionStatus.mockReset().mockResolvedValue("inactive")
    createCheckoutSession.mockReset().mockResolvedValue({
      checkoutId: "co_1",
      url: "https://sandbox.polar.sh/checkout/co_1",
    })
  })

  it("returns only the hosted checkout URL in authentication and subscription order", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: "https://sandbox.polar.sh/checkout/co_1",
    })
    expect(createCheckoutSession).toHaveBeenCalledWith({
      userId: "user-1",
      email: "a@b.com",
    })
    expect(getSessionUser.mock.invocationCallOrder[0]).toBeLessThan(
      getSubscriptionStatus.mock.invocationCallOrder[0],
    )
    expect(getSubscriptionStatus.mock.invocationCallOrder[0]).toBeLessThan(
      createCheckoutSession.mock.invocationCallOrder[0],
    )
  })

  it("ignores user identifiers supplied in the request body", async () => {
    const response = await POST(
      request({
        body: '{"user_id":"00000000-0000-0000-0000-0000000000ff","userId":"00000000-0000-0000-0000-0000000000ff"}',
      }),
    )

    expect(response.status).toBe(200)
    expect(createCheckoutSession).toHaveBeenCalledWith({
      userId: "user-1",
      email: "a@b.com",
    })
  })

  it("passes null when the session user has no email", async () => {
    getSessionUser.mockResolvedValue({ id: "user-1", email: undefined })

    await POST(request())

    expect(createCheckoutSession).toHaveBeenCalledWith({
      userId: "user-1",
      email: null,
    })
  })

  it("returns UNAUTHORIZED before checking subscription or creating checkout", async () => {
    getSessionUser.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ code: "UNAUTHORIZED" })
    expect(getSubscriptionStatus).not.toHaveBeenCalled()
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it("prevents an active subscriber from creating a duplicate checkout", async () => {
    getSubscriptionStatus.mockResolvedValue("active")

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      code: "ALREADY_SUBSCRIBED",
    })
    expect(getSubscriptionStatus).toHaveBeenCalledWith("user-1")
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it("rejects a cross-origin request before reading the session", async () => {
    const response = await POST(request({ origin: "https://evil.test" }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: "FORBIDDEN" })
    expect(getSessionUser).not.toHaveBeenCalled()
    expect(getSubscriptionStatus).not.toHaveBeenCalled()
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  it.each([
    ["same origin", "https://finsight.test"],
    ["no origin header", undefined],
  ])("accepts %s", async (_case, origin) => {
    const response = await POST(request({ origin }))

    expect(response.status).toBe(200)
  })

  it("maps Polar API failures without exposing the error message", async () => {
    const secretMessage = "request failed with sensitive response"
    createCheckoutSession.mockRejectedValue(new PolarApiError(secretMessage))

    const response = await POST(request())

    expect(response.status).toBe(502)
    const responseForBody = response.clone()
    await expect(response.json()).resolves.toEqual({ code: "CHECKOUT_FAILED" })
    await expect(responseForBody.text()).resolves.not.toContain(secretMessage)
  })

  it.each([
    ["Polar configuration failure", new PolarConfigError("missing token")],
    ["unexpected failure", new Error("boom")],
  ])("maps %s to INTERNAL_ERROR", async (_case, error) => {
    createCheckoutSession.mockRejectedValue(error)

    const response = await POST(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ code: "INTERNAL_ERROR" })
  })
})
