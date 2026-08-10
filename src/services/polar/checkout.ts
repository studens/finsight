import { createPolarClient } from "./client"
import { PolarApiError, PolarConfigError } from "./errors"

export type CreateCheckoutSessionInput = {
  userId: string
  email?: string | null
}

export type CheckoutSession = {
  checkoutId: string
  url: string
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSession> {
  const productId = process.env.POLAR_PRODUCT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  if (!productId) {
    throw new PolarConfigError("POLAR_PRODUCT_ID")
  }
  if (!appUrl) {
    throw new PolarConfigError("NEXT_PUBLIC_APP_URL")
  }

  const polar = createPolarClient()
  const payload = {
    products: [productId],
    successUrl: `${appUrl.replace(/\/$/, "")}/dashboard?checkout=success`,
    externalCustomerId: input.userId,
    metadata: { user_id: input.userId },
    ...(input.email ? { customerEmail: input.email } : {}),
  }

  try {
    const checkout = await polar.checkouts.create(payload)
    return { checkoutId: checkout.id, url: checkout.url }
  } catch {
    throw new PolarApiError("Failed to create Polar checkout session")
  }
}
