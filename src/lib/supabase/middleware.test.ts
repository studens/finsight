import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }))

vi.mock("@supabase/ssr", () => ({ createServerClient }))

import { updateSession } from "./middleware"

describe("updateSession", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
    createServerClient.mockReset()
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  })

  it("connects request/response cookies and returns the authenticated user", async () => {
    const user = { id: "user-1" }

    createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: vi.fn(async () => {
          options.cookies.setAll([
            { name: "sb-session", value: "refreshed", options: { httpOnly: true } },
          ])
          return { data: { user }, error: null }
        }),
      },
    }))

    const request = new NextRequest("https://finsight.test/dashboard", {
      headers: { cookie: "existing=value" },
    })
    const result = await updateSession(request)
    const options = createServerClient.mock.calls[0][2]

    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.any(Object),
    )
    expect(options.cookies.getAll()).toEqual(
      expect.arrayContaining([{ name: "existing", value: "value" }]),
    )
    expect(request.cookies.get("sb-session")?.value).toBe("refreshed")
    expect(result.response.cookies.get("sb-session")?.value).toBe("refreshed")
    expect(result.user).toBe(user)
  })
})
