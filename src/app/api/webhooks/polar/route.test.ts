import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  isUnknownUserError,
  mapEventToSubscriptionStatus,
  resolveUserId,
  upsertSubscriptionStatus,
  verifyPolarWebhook,
  PolarWebhookPayloadError,
  PolarWebhookVerificationError,
  PolarConfigError,
} = vi.hoisted(() => {
  class PolarWebhookPayloadError extends Error {}
  class PolarWebhookVerificationError extends Error {}
  class PolarConfigError extends Error {}
  return {
    isUnknownUserError: vi.fn(),
    mapEventToSubscriptionStatus: vi.fn(),
    resolveUserId: vi.fn(),
    upsertSubscriptionStatus: vi.fn(),
    verifyPolarWebhook: vi.fn(),
    PolarWebhookPayloadError,
    PolarWebhookVerificationError,
    PolarConfigError,
  }
})

vi.mock("../../../../services/polar", () => ({
  mapEventToSubscriptionStatus,
  resolveUserId,
  verifyPolarWebhook,
  PolarWebhookPayloadError,
  PolarWebhookVerificationError,
  PolarConfigError,
}))
vi.mock("../../../../services/supabase-admin", () => ({
  isUnknownUserError,
  upsertSubscriptionStatus,
}))

import { POST } from "./route"

const userId = "11111111-1111-4111-8111-111111111111"

function request(body: string) {
  return new Request("https://finsight.test/api/webhooks/polar", {
    method: "POST",
    headers: { "webhook-id": "msg_1", "webhook-signature": "v1,sig" },
    body,
  })
}

function verifiedEvent(type = "supported.event") {
  return { kind: "event", event: { type } }
}

describe("POST /api/webhooks/polar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyPolarWebhook.mockReturnValue(verifiedEvent())
    resolveUserId.mockReturnValue(userId)
    mapEventToSubscriptionStatus.mockReturnValue("active")
    upsertSubscriptionStatus.mockResolvedValue(undefined)
    isUnknownUserError.mockReturnValue(false)
  })

  it("passes the exact raw body and request Headers to verification", async () => {
    const raw = '{"type":"supported.event",   "data":{"x":1}}'
    const incoming = request(raw)

    await POST(incoming)

    expect(verifyPolarWebhook).toHaveBeenCalledWith({
      body: raw,
      headers: incoming.headers,
    })
  })

  it("rejects an invalid signature before resolving or writing", async () => {
    const detail = "expected v1,abc got v1,xyz"
    verifyPolarWebhook.mockImplementation(() => {
      throw new PolarWebhookVerificationError(detail)
    })

    const response = await POST(request("raw-body"))

    expect(response.status).toBe(403)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ code: "INVALID_SIGNATURE" })
    expect(text).not.toContain(detail)
    expect(resolveUserId).not.toHaveBeenCalled()
    expect(mapEventToSubscriptionStatus).not.toHaveBeenCalled()
    expect(upsertSubscriptionStatus).not.toHaveBeenCalled()
  })

  it("returns 500 for Polar configuration errors", async () => {
    verifyPolarWebhook.mockImplementation(() => {
      throw new PolarConfigError("missing secret")
    })

    const response = await POST(request("raw-body"))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ code: "INTERNAL_ERROR" })
    expect(upsertSubscriptionStatus).not.toHaveBeenCalled()
  })

  it("contains unexpected verification errors as internal errors", async () => {
    verifyPolarWebhook.mockImplementation(() => {
      throw new Error("boom")
    })

    const response = await POST(request("raw-body"))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ code: "INTERNAL_ERROR" })
  })

  it("returns 5xx for invalid verified payloads without resolving or writing", async () => {
    verifyPolarWebhook.mockImplementation(() => {
      throw new PolarWebhookPayloadError()
    })

    const response = await POST(request("raw-body"))

    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(resolveUserId).not.toHaveBeenCalled()
    expect(upsertSubscriptionStatus).not.toHaveBeenCalled()
  })

  it("acknowledges unsupported verified events without writing", async () => {
    verifyPolarWebhook.mockReturnValue({ kind: "unsupported" })

    const response = await POST(request("raw-body"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      received: true,
      ignored: "unhandled_event",
    })
    expect(upsertSubscriptionStatus).not.toHaveBeenCalled()
  })

  it("acknowledges events whose customer cannot be resolved", async () => {
    resolveUserId.mockReturnValue(null)

    const response = await POST(request("raw-body"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      received: true,
      ignored: "unresolved_customer",
    })
    expect(upsertSubscriptionStatus).not.toHaveBeenCalled()
  })

  it("acknowledges unmapped events without writing", async () => {
    mapEventToSubscriptionStatus.mockReturnValue(null)

    const response = await POST(request("raw-body"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      received: true,
      ignored: "unhandled_event",
    })
    expect(upsertSubscriptionStatus).not.toHaveBeenCalled()
  })

  // ADR-006: 취소 후에도 결제 기간 끝까지 Premium을 유지하며 구독 해제는 revoked 이벤트로만 일어난다.
  it("does not update status for a canceled subscription", async () => {
    verifyPolarWebhook.mockReturnValue(verifiedEvent("subscription.canceled"))
    mapEventToSubscriptionStatus.mockReturnValue(null)

    const response = await POST(request("raw-body"))

    expect(response.status).toBe(200)
    expect(mapEventToSubscriptionStatus).toHaveBeenCalledWith(
      "subscription.canceled",
    )
    expect(upsertSubscriptionStatus).not.toHaveBeenCalled()
  })

  it("writes a resolved status only after verification", async () => {
    const response = await POST(request("raw-body"))

    expect(upsertSubscriptionStatus).toHaveBeenCalledWith({
      userId,
      status: "active",
    })
    expect(verifyPolarWebhook.mock.invocationCallOrder[0]).toBeLessThan(
      upsertSubscriptionStatus.mock.invocationCallOrder[0],
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ received: true })
  })

  it("acknowledges a delayed event for a deleted user", async () => {
    const error = { code: "23503" }
    upsertSubscriptionStatus.mockRejectedValue(error)
    isUnknownUserError.mockReturnValue(true)

    const response = await POST(request("raw-body"))

    expect(isUnknownUserError).toHaveBeenCalledWith(error)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      received: true,
      ignored: "unknown_user",
    })
  })

  it("returns 5xx so Polar retries transient database failures", async () => {
    upsertSubscriptionStatus.mockRejectedValue(new Error("temporary"))
    isUnknownUserError.mockReturnValue(false)

    const response = await POST(request("raw-body"))

    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(response.status).toBeLessThan(600)
    await expect(response.json()).resolves.toEqual({ code: "INTERNAL_ERROR" })
  })

  it("is idempotent for repeated deliveries", async () => {
    const first = await POST(request("same-body"))
    const second = await POST(request("same-body"))

    expect(upsertSubscriptionStatus).toHaveBeenCalledTimes(2)
    expect(upsertSubscriptionStatus.mock.calls[0]).toEqual(
      upsertSubscriptionStatus.mock.calls[1],
    )
    await expect(first.json()).resolves.toEqual({ received: true })
    await expect(second.json()).resolves.toEqual({ received: true })
  })
})
