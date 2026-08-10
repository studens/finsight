import { NextResponse } from "next/server"

import {
  mapEventToSubscriptionStatus,
  PolarWebhookVerificationError,
  resolveUserId,
  verifyPolarWebhook,
} from "../../../../services/polar"
import type { VerifiedWebhook } from "../../../../services/polar"
import {
  isUnknownUserError,
  upsertSubscriptionStatus,
} from "../../../../services/supabase-admin"

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text()

  let verified: VerifiedWebhook
  try {
    verified = verifyPolarWebhook({ body, headers: request.headers })
  } catch (error) {
    if (error instanceof PolarWebhookVerificationError) {
      return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 403 })
    }
    return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
  }

  if (verified.kind === "unsupported") {
    return NextResponse.json({ received: true, ignored: "unhandled_event" })
  }

  const userId = resolveUserId(verified.event)
  if (userId === null) {
    return NextResponse.json({ received: true, ignored: "unresolved_customer" })
  }

  const status = mapEventToSubscriptionStatus(verified.event.type)
  if (status === null) {
    return NextResponse.json({ received: true, ignored: "unhandled_event" })
  }

  try {
    await upsertSubscriptionStatus({ userId, status })
  } catch (error) {
    if (isUnknownUserError(error)) {
      return NextResponse.json({ received: true, ignored: "unknown_user" })
    }
    return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
