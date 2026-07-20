import { describe, expect, it } from "vitest"

import { POST } from "./route"

describe("POST /api/webhooks/polar", () => {
  it("returns NOT_IMPLEMENTED without processing the webhook", async () => {
    const request = new Request("https://finsight.test/api/webhooks/polar", {
      method: "POST",
      body: JSON.stringify({ type: "subscription.updated" }),
    })

    const response = await POST(request)

    expect(response.status).toBe(501)
    await expect(response.json()).resolves.toEqual({ code: "NOT_IMPLEMENTED" })
  })
})
