import { NextResponse } from "next/server"

import {
  getSessionUser,
  getSubscriptionStatus,
} from "../../../lib/supabase/server"
import {
  createCheckoutSession,
  PolarApiError,
  PolarConfigError,
} from "../../../services/polar"

export async function POST(request: Request): Promise<NextResponse> {
  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get("origin")

  if (origin !== null && origin !== requestOrigin) {
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  }

  const user = await getSessionUser()

  if (user === null) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 })
  }

  const status = await getSubscriptionStatus(user.id)

  if (status === "active") {
    return NextResponse.json(
      { code: "ALREADY_SUBSCRIBED" },
      { status: 409 },
    )
  }

  try {
    const session = await createCheckoutSession({
      userId: user.id,
      email: user.email ?? null,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    if (error instanceof PolarApiError) {
      return NextResponse.json({ code: "CHECKOUT_FAILED" }, { status: 502 })
    }

    if (error instanceof PolarConfigError) {
      return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
    }

    return NextResponse.json({ code: "INTERNAL_ERROR" }, { status: 500 })
  }
}
