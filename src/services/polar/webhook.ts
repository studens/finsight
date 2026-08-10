import "server-only"

import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks.js"

import {
  PolarConfigError,
  PolarWebhookPayloadError,
  PolarWebhookVerificationError,
} from "./errors"
import { mapEventToSubscriptionStatus } from "./subscription-status"

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

type RawEventTypeProbe = { kind: "type"; type: string } | { kind: "unreadable" }

/**
 * 서명 검증을 통과한 뒤에만 호출된다.
 * 이 파싱은 서명 검증을 대체하지 않는다 — 실패한 전달을 "우리가 처리하는 이벤트인지"
 * 분류하기 위한 용도로만 쓴다. 이 결과로 DB를 쓰거나 사용자를 식별하지 않는다.
 */
function probeRawEventType(body: string): RawEventTypeProbe {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { kind: "unreadable" }
    }
    const type = (parsed as Record<string, unknown>).type
    return typeof type === "string"
      ? { kind: "type", type }
      : { kind: "unreadable" }
  } catch {
    return { kind: "unreadable" }
  }
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

    // 여기 도달 = 서명 검증은 이미 통과했다(validateEvent는 검증 후에 파싱한다).
    // 처리 대상 이벤트가 "아님을 확인한" 경우에만 무시한다. 확인할 수 없으면 던진다.
    const probe = probeRawEventType(input.body)
    if (probe.kind === "unreadable") {
      throw new PolarWebhookPayloadError()
    }
    if (mapEventToSubscriptionStatus(probe.type) !== null) {
      throw new PolarWebhookPayloadError()
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
