import { Webhook } from "standardwebhooks"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  PolarConfigError,
  PolarWebhookPayloadError,
  PolarWebhookVerificationError,
} from "./errors"
import { resolveUserId, verifyPolarWebhook } from "./webhook"

const SECRET = "TestSecret"
const NOW = "2026-08-07T00:00:00Z"
const USER_ID = "11111111-2222-4333-8444-555555555555"

const subscriptionActiveFixture = {
  type: "subscription.active", timestamp: NOW,
  data: {
    id: "sub_1", created_at: NOW, modified_at: null,
    amount: 1000, currency: "usd", recurring_interval: "month", recurring_interval_count: 1,
    status: "active", current_period_start: NOW, current_period_end: NOW,
    current_meter_period_start: NOW, current_meter_period_end: NOW,
    trial_start: NOW, trial_end: NOW, pause_at_period_end: false, paused_at: NOW, resumes_at: NOW,
    past_due_at: null, cancel_at_period_end: false, canceled_at: null,
    started_at: NOW, ends_at: null, ended_at: null,
    customer_id: "cus_1", product_id: "prod_1", discount_id: null, checkout_id: null,
    customer_cancellation_reason: null, customer_cancellation_comment: null,
    metadata: { user_id: USER_ID },
    customer: {
      id: "cus_1", created_at: NOW, modified_at: null, metadata: {}, external_id: USER_ID,
      type: "individual", billing_name: "Test User", email: "a@b.com", email_verified: true,
      name: null, billing_address: null, tax_id: null, organization_id: "org_1", deleted_at: null,
      avatar_url: "https://example.test/a.png",
    },
    product: {
      id: "prod_1", created_at: NOW, modified_at: null, name: "finsight Premium", description: null,
      recurring_interval: "month", recurring_interval_count: 1, trial_interval: "month", trial_interval_count: 0,
      meter_interval: "month", meter_interval_count: 1, metadata: {}, attached_custom_fields: [],
      is_recurring: true, is_archived: false, visibility: "public", organization_id: "org_1",
      prices: [], benefits: [], medias: [],
    },
    discount: null, prices: [], meters: [], pending_update: null,
  },
}

function signedHeaders(body: string, secret = SECRET, id = "msg_1", timestamp = new Date()) {
  const base64Secret = Buffer.from(secret, "utf-8").toString("base64")
  return {
    "webhook-id": id,
    "webhook-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
    "webhook-signature": new Webhook(base64Secret).sign(id, timestamp, body),
  }
}

function verifyFixture(fixture: unknown = subscriptionActiveFixture) {
  const body = JSON.stringify(fixture)
  const result = verifyPolarWebhook({ body, headers: signedHeaders(body) })
  if (result.kind !== "event") throw new Error("Expected a supported event")
  return result.event
}

function verifyRawBody(body: string) {
  return verifyPolarWebhook({ body, headers: signedHeaders(body) })
}

describe("verifyPolarWebhook", () => {
  beforeEach(() => { process.env.POLAR_WEBHOOK_SECRET = SECRET })

  it("verifies a real Standard Webhooks signature", () => {
    const event = verifyFixture()
    expect(event.type).toBe("subscription.active")
    if (event.type === "subscription.active") expect(event.data.customer.externalId).toBe(USER_ID)
  })

  it("rejects a body changed after signing", () => {
    const body = JSON.stringify(subscriptionActiveFixture)
    expect(() => verifyPolarWebhook({ body: `${body} `, headers: signedHeaders(body) })).toThrow(PolarWebhookVerificationError)
  })

  it("rejects a signature created with another secret", () => {
    const body = JSON.stringify(subscriptionActiveFixture)
    expect(() => verifyPolarWebhook({ body, headers: signedHeaders(body, "OtherSecret") })).toThrow(PolarWebhookVerificationError)
  })

  it.each(["missing signature", "all missing"])("rejects headers when %s", (variant) => {
    const body = JSON.stringify(subscriptionActiveFixture)
    const headers: Record<string, string> = variant === "all missing" ? {} : signedHeaders(body)
    if (variant === "missing signature") delete headers["webhook-signature"]
    expect(() => verifyPolarWebhook({ body, headers })).toThrow(PolarWebhookVerificationError)
  })

  it("accepts mixed-case header keys", () => {
    const body = JSON.stringify(subscriptionActiveFixture)
    const headers = signedHeaders(body)
    const result = verifyPolarWebhook({ body, headers: {
      "Webhook-Id": headers["webhook-id"],
      "Webhook-Timestamp": headers["webhook-timestamp"],
      "Webhook-Signature": headers["webhook-signature"],
    } })
    expect(result.kind).toBe("event")
  })

  it("accepts a Headers instance", () => {
    const body = JSON.stringify(subscriptionActiveFixture)
    expect(verifyPolarWebhook({ body, headers: new Headers(signedHeaders(body)) }).kind).toBe("event")
  })

  it("distinguishes missing configuration from an invalid signature", () => {
    delete process.env.POLAR_WEBHOOK_SECRET
    let caught: unknown
    try { verifyPolarWebhook({ body: "{}", headers: {} }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(PolarConfigError)
    expect(caught).not.toBeInstanceOf(PolarWebhookVerificationError)
  })

  it("ignores a validly signed unknown event", () => {
    const body = JSON.stringify({ type: "unknown.event", data: {} })
    expect(verifyPolarWebhook({ body, headers: signedHeaders(body) })).toEqual({ kind: "unsupported" })
  })

  it.each([
    "subscription.active",
    "subscription.uncanceled",
    "subscription.revoked",
  ])("rejects an invalid payload for supported event %s", (type) => {
    const body = `{"type":"${type}","data":{"id":"sub_1"}}`
    let caught: unknown
    try { verifyRawBody(body) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(PolarWebhookPayloadError)
    expect(caught).not.toBeInstanceOf(PolarWebhookVerificationError)
  })

  it("ignores an invalid payload for an unsupported subscription event", () => {
    const body = '{"type":"subscription.canceled","data":{"id":"sub_1"}}'
    expect(verifyRawBody(body)).toEqual({ kind: "unsupported" })
  })

  it.each([
    '{"type":"subscription.active"',
    '"just a string"',
    "null",
    '{"data":{}}',
    '{"type":123,"data":{}}',
  ])("rejects an unreadable event body: %s", (body) => {
    expect(() => verifyRawBody(body)).toThrow(PolarWebhookPayloadError)
  })

  it("keeps an invalid signature on the verification error path", () => {
    const body = '{"type":"subscription.active","data":{"id":"sub_1"}}'
    let caught: unknown
    try {
      verifyPolarWebhook({ body, headers: signedHeaders(body, "OtherSecret") })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PolarWebhookVerificationError)
    expect(caught).not.toBeInstanceOf(PolarWebhookPayloadError)
  })
})

describe("resolveUserId", () => {
  beforeEach(() => { process.env.POLAR_WEBHOOK_SECRET = SECRET })

  it("uses the parsed customer external id", () => expect(resolveUserId(verifyFixture())).toBe(USER_ID))

  it("falls back to metadata.user_id", () => {
    const fixture = { ...subscriptionActiveFixture, data: { ...subscriptionActiveFixture.data,
      customer: { ...subscriptionActiveFixture.data.customer, external_id: null } } }
    expect(resolveUserId(verifyFixture(fixture))).toBe(USER_ID)
  })

  it("returns null when both mapping values are absent", () => {
    const fixture = { ...subscriptionActiveFixture, data: { ...subscriptionActiveFixture.data, metadata: {},
      customer: { ...subscriptionActiveFixture.data.customer, external_id: null } } }
    expect(resolveUserId(verifyFixture(fixture))).toBeNull()
  })

  it("rejects a numeric metadata user_id", () => {
    const fixture = { ...subscriptionActiveFixture, data: { ...subscriptionActiveFixture.data, metadata: { user_id: 12345 },
      customer: { ...subscriptionActiveFixture.data.customer, external_id: null } } }
    expect(resolveUserId(verifyFixture(fixture))).toBeNull()
  })

  it.each(["not-a-uuid", "", "'; drop table subscriptions; --"])("rejects an invalid external id: %s", (externalId) => {
    const fixture = { ...subscriptionActiveFixture, data: { ...subscriptionActiveFixture.data, metadata: {},
      customer: { ...subscriptionActiveFixture.data.customer, external_id: externalId } } }
    expect(resolveUserId(verifyFixture(fixture))).toBeNull()
  })

  it("returns null for a non-subscription event", () => {
    expect(resolveUserId({ type: "checkout.created", data: {} } as never)).toBeNull()
  })
})
