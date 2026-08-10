import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { mapEventToSubscriptionStatus, SUBSCRIPTION_STATUS_BY_EVENT_TYPE } from "./subscription-status"

describe("subscription status mapping", () => {
  it.each([
    ["subscription.active", "active"],
    ["subscription.uncanceled", "active"],
    ["subscription.revoked", "inactive"],
    ["subscription.created", null],
    ["subscription.updated", null],
    ["order.paid", null],
    ["checkout.created", null],
    ["customer.created", null],
    ["", null],
    ["subscription.ACTIVE", null],
    ["unknown.event", null],
  ])("maps %s to %s", (eventType, expected) => {
    expect(mapEventToSubscriptionStatus(eventType)).toBe(expected)
  })

  it("keeps Premium active after subscription.canceled until subscription.revoked (ADR-006)", () => {
    expect(mapEventToSubscriptionStatus("subscription.canceled")).toBeNull()
  })

  it("keeps Premium active during subscription.past_due until subscription.revoked (ADR-006)", () => {
    expect(mapEventToSubscriptionStatus("subscription.past_due")).toBeNull()
  })

  it("exports exactly the three state-changing event types", () => {
    expect(Object.keys(SUBSCRIPTION_STATUS_BY_EVENT_TYPE).sort()).toEqual([
      "subscription.active",
      "subscription.revoked",
      "subscription.uncanceled",
    ])
  })
})
