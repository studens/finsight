import { beforeEach, describe, expect, it, vi } from "vitest"

const { PolarCtor } = vi.hoisted(() => ({ PolarCtor: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@polar-sh/sdk", () => ({ Polar: PolarCtor }))

import { createPolarClient } from "./client"
import { PolarConfigError } from "./errors"

describe("createPolarClient", () => {
  beforeEach(() => {
    process.env.POLAR_ACCESS_TOKEN = "test-token"
    process.env.POLAR_SERVER = "sandbox"
    PolarCtor.mockReset()
  })

  it("creates a client with the explicit server option", () => {
    createPolarClient()
    expect(PolarCtor).toHaveBeenCalledWith({ accessToken: "test-token", server: "sandbox" })
  })

  it.each([undefined, "staging"])("rejects an invalid POLAR_SERVER value: %s", (server) => {
    if (server === undefined) delete process.env.POLAR_SERVER
    else process.env.POLAR_SERVER = server

    expect(() => createPolarClient()).toThrow(PolarConfigError)
    expect(PolarCtor).not.toHaveBeenCalled()
  })

  it("rejects a missing access token without exposing its value", () => {
    const secretValue = process.env.POLAR_ACCESS_TOKEN!
    delete process.env.POLAR_ACCESS_TOKEN

    try {
      createPolarClient()
      throw new Error("Expected createPolarClient to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(PolarConfigError)
      expect((error as Error).message).toBe("POLAR_ACCESS_TOKEN is required")
      expect((error as Error).message).not.toContain(secretValue)
    }
    expect(PolarCtor).not.toHaveBeenCalled()
  })
})
