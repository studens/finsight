import { beforeEach, describe, expect, it, vi } from "vitest"

const { checkoutsCreate, PolarCtor } = vi.hoisted(() => {
  const checkoutsCreate = vi.fn()
  return {
    checkoutsCreate,
    PolarCtor: vi.fn(() => ({ checkouts: { create: checkoutsCreate } })),
  }
})

vi.mock("server-only", () => ({}))
vi.mock("@polar-sh/sdk", () => ({ Polar: PolarCtor }))

import { createCheckoutSession } from "./checkout"
import { PolarApiError, PolarConfigError } from "./errors"

describe("createCheckoutSession", () => {
  beforeEach(() => {
    process.env.POLAR_ACCESS_TOKEN = "test-token"
    process.env.POLAR_SERVER = "sandbox"
    process.env.POLAR_PRODUCT_ID = "product-1"
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"
    checkoutsCreate.mockReset()
    PolarCtor.mockClear()
    checkoutsCreate.mockResolvedValue({ id: "checkout-1", url: "https://checkout.test/1", clientSecret: "secret" })
  })

  it("creates a checkout with the required user mapping", async () => {
    await createCheckoutSession({ userId: "user-1", email: "a@b.com" })
    expect(checkoutsCreate).toHaveBeenCalledWith({
      products: ["product-1"],
      successUrl: "http://localhost:3000/dashboard?checkout=success",
      externalCustomerId: "user-1",
      metadata: { user_id: "user-1" },
      customerEmail: "a@b.com",
    })
  })

  it("removes a trailing slash from the app URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000/"
    await createCheckoutSession({ userId: "user-1" })
    expect(checkoutsCreate.mock.calls[0][0].successUrl).toBe("http://localhost:3000/dashboard?checkout=success")
  })

  it.each([undefined, null])("omits customerEmail when email is %s", async (email) => {
    await createCheckoutSession({ userId: "user-1", email })
    expect(checkoutsCreate.mock.calls[0][0]).not.toHaveProperty("customerEmail")
  })

  it("returns only the safe checkout fields", async () => {
    await expect(createCheckoutSession({ userId: "user-1" })).resolves.toEqual({
      checkoutId: "checkout-1",
      url: "https://checkout.test/1",
    })
  })

  it("wraps SDK failures without leaking the original message", async () => {
    checkoutsCreate.mockRejectedValue(new Error("SDK leaked test-token"))
    try {
      await createCheckoutSession({ userId: "user-1" })
      throw new Error("Expected createCheckoutSession to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(PolarApiError)
      expect((error as Error).message).toBe("Failed to create Polar checkout session")
      expect((error as Error).message).not.toContain("SDK leaked")
      expect((error as Error).message).not.toContain("test-token")
    }
  })

  it.each(["POLAR_PRODUCT_ID", "NEXT_PUBLIC_APP_URL"])("rejects missing %s before the API call", async (name) => {
    delete process.env[name]
    await expect(createCheckoutSession({ userId: "user-1" })).rejects.toBeInstanceOf(PolarConfigError)
    expect(checkoutsCreate).not.toHaveBeenCalled()
  })
})
