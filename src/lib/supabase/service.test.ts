import { beforeEach, describe, expect, it, vi } from "vitest"

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@supabase/supabase-js", () => ({ createClient }))

import { createServiceClient } from "./service"

describe("Supabase service-role client", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key"
    createClient.mockReset()
  })

  it("creates a non-persistent service-role client", () => {
    const client = { from: vi.fn() }
    createClient.mockReturnValue(client)

    expect(createServiceClient()).toBe(client)
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-key",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
  })

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])(
    "throws immediately when %s is missing",
    (name) => {
      delete process.env[name]

      expect(() => createServiceClient()).toThrow(name)
      expect(createClient).not.toHaveBeenCalled()
    },
  )
})
