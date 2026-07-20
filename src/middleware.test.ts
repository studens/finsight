import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { updateSession } = vi.hoisted(() => ({ updateSession: vi.fn() }))

vi.mock("./lib/supabase/middleware", () => ({ updateSession }))

import { config, middleware } from "./middleware"

const requestFor = (pathname: string) =>
  new NextRequest(new URL(pathname, "https://finsight.test"))

describe("middleware", () => {
  beforeEach(() => {
    updateSession.mockReset()
  })

  it("redirects an unauthenticated dashboard request to login", async () => {
    updateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: null,
    })

    const response = await middleware(requestFor("/dashboard"))

    expect(response.headers.get("location")).toBe("https://finsight.test/login")
  })

  it("redirects an authenticated landing request to dashboard", async () => {
    updateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: { id: "user-1" },
    })

    const response = await middleware(requestFor("/"))

    expect(response.headers.get("location")).toBe("https://finsight.test/dashboard")
  })

  it.each([
    ["unauthenticated landing", "/", null],
    ["authenticated dashboard", "/dashboard", { id: "user-1" }],
  ])("allows an %s request through", async (_name, pathname, user) => {
    const nextResponse = NextResponse.next()
    updateSession.mockResolvedValue({ response: nextResponse, user })

    await expect(middleware(requestFor(pathname))).resolves.toBe(nextResponse)
  })

  it("excludes API, Next.js internals, and static assets from its matcher", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`)

    expect(matcher.test("/dashboard")).toBe(true)
    expect(matcher.test("/api/upload")).toBe(false)
    expect(matcher.test("/_next/static/chunk.js")).toBe(false)
    expect(matcher.test("/_next/image")).toBe(false)
    expect(matcher.test("/favicon.ico")).toBe(false)
    expect(matcher.test("/logo.svg")).toBe(false)
  })
})
