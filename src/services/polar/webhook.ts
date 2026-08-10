import "server-only"

import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks.js"

import { PolarConfigError, PolarWebhookVerificationError } from "./errors"

export type PolarWebhookEvent = ReturnType<typeof validateEvent>

export type VerifiedWebhook =
  | { kind: "event"; event: PolarWebhookEvent }
  | { kind: "unsupported" }

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "subscription.active",
  "subscription.canceled",
  "subscription.created",
  "subscription.past_due",
  "subscription.revoked",
  "subscription.uncanceled",
  "subscription.updated",
])

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizeHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key.toLowerCase()] = value
    })
  } else {
    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value
    }
  }
  return normalized
}

export function verifyPolarWebhook(input: {
  body: string
  headers: Headers | Record<string, string>
}): VerifiedWebhook {
  const secret = process.env.POLAR_WEBHOOK_SECRET
  if (!secret) {
    throw new PolarConfigError("POLAR_WEBHOOK_SECRET")
  }

  try {
    return {
      kind: "event",
      event: validateEvent(input.body, normalizeHeaders(input.headers), secret),
    }
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      throw new PolarWebhookVerificationError()
    }
    return { kind: "unsupported" }
  }
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" ? value : null
}

export function resolveUserId(event: PolarWebhookEvent): string | null {
  if (!SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
    return null
  }

  const data = event.data as unknown as Record<string, unknown>
  const customer = data.customer as Record<string, unknown> | undefined
  const metadata = data.metadata as Record<string, unknown> | undefined
  const candidate = customer?.externalId
    ?? (customer ? stringValue(customer, "external_id") : null)
    ?? (metadata ? stringValue(metadata, "user_id") : null)

  return typeof candidate === "string" && UUID_PATTERN.test(candidate)
    ? candidate
    : null
}
