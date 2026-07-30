import { beforeEach, describe, expect, it, vi } from "vitest"

const { createClient, exchangeCodeForSession } = vi.hoisted(() => ({
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))

vi.mock("../../../lib/supabase/server", () => ({ createClient }))

import { GET } from "./route"

function callGet(query = "?code=auth-code") {
  return GET(new Request(`https://finsight.test/auth/callback${query}`))
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset().mockResolvedValue({ error: null })
    createClient.mockReset().mockResolvedValue({ auth: { exchangeCodeForSession } })
  })

  it("exchanges the OAuth code for a session and lands on the dashboard", async () => {
    const response = await callGet()

    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code")
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://finsight.test/dashboard")
  })

  it("returns to the requested relative path after the exchange", async () => {
    const response = await callGet("?code=auth-code&next=%2Fdashboard%2Fanalysis-1")

    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code")
    expect(response.headers.get("location")).toBe(
      "https://finsight.test/dashboard/analysis-1",
    )
  })

  it.each([
    ["absolute URL", "https%3A%2F%2Fevil.test%2Fsteal"],
    ["protocol-relative URL", "%2F%2Fevil.test%2Fsteal"],
    ["backslash-prefixed URL", "%2F%5Cevil.test"],
    ["non-path value", "dashboard"],
  ])("ignores an open-redirect next value (%s)", async (_case, next) => {
    const response = await callGet(`?code=auth-code&next=${next}`)

    expect(response.headers.get("location")).toBe("https://finsight.test/dashboard")
  })

  it("sends the user back to login when the provider reports an error", async () => {
    const response = await callGet("?error=access_denied")

    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toBe("https://finsight.test/login?error=auth")
  })

  it("sends the user back to login when no code is present", async () => {
    const response = await callGet("")

    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toBe("https://finsight.test/login?error=auth")
  })

  it("sends the user back to login when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid grant" } })

    const response = await callGet()

    expect(response.headers.get("location")).toBe("https://finsight.test/login?error=auth")
  })
})
