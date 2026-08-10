export type SubscriptionStatusUpdate = "active" | "inactive"

export const SUBSCRIPTION_STATUS_BY_EVENT_TYPE: Readonly<
  Record<string, SubscriptionStatusUpdate>
> = {
  "subscription.active": "active",
  "subscription.uncanceled": "active",
  "subscription.revoked": "inactive",
}

export function mapEventToSubscriptionStatus(
  eventType: string,
): SubscriptionStatusUpdate | null {
  return SUBSCRIPTION_STATUS_BY_EVENT_TYPE[eventType] ?? null
}
