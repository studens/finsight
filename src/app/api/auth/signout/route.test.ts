import { beforeEach, describe, expect, it, vi } from "vitest"

const { signOut } = vi.hoisted(() => ({
  signOut: vi.fn(),
}))

vi.mock("../../../../lib/supabase/server", () => ({ signOut }))

import { POST } from "./route"

function request(origin?: string) {
  const headers = origin === undefined ? undefined : { Origin: origin }
  return new Request("https://finsight.test/api/auth/signout", {
    method: "POST",
    headers,
  })
}

describe("POST /api/auth/signout", () => {
  beforeEach(() => {
    signOut.mockReset().mockResolvedValue(undefined)
  })

  it.each([
    ["matching origin", "https://finsight.test"],
    ["missing origin", undefined],
  ])("signs out and redirects with 303 for %s", async (_case, origin) => {
    const response = await POST(request(origin))

    expect(signOut).toHaveBeenCalledOnce()
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("https://finsight.test/login")
  })

  it("still redirects with 303 when signOut rejects", async () => {
    signOut.mockRejectedValue(new Error("sensitive auth failure"))

    const response = await POST(request())

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("https://finsight.test/login")
    await expect(response.text()).resolves.not.toContain("sensitive auth failure")
  })

  it("rejects a cross-origin request without signing out", async () => {
    const response = await POST(request("https://evil.test"))

    expect(response.status).toBe(403)
    expect(signOut).not.toHaveBeenCalled()
  })
})
