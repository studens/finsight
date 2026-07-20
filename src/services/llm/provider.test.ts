import { beforeEach, describe, expect, it, vi } from "vitest"

const anthropic = vi.fn()

vi.mock("@ai-sdk/anthropic", () => ({ anthropic }))

describe("getAnalysisModel", () => {
  beforeEach(() => {
    vi.resetModules()
    anthropic.mockReset()
  })

  it("returns the single configured Claude Opus 4.8 model", async () => {
    const model = { provider: "anthropic", modelId: "claude-opus-4-8" }
    anthropic.mockReturnValue(model)

    const { getAnalysisModel } = await import("./provider")

    expect(getAnalysisModel()).toBe(model)
    expect(anthropic).toHaveBeenCalledWith("claude-opus-4-8")
  })
})
