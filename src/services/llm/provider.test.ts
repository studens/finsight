import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const anthropic = vi.fn()
const openai = vi.fn()
const generateText = vi.fn()

vi.mock("@ai-sdk/anthropic", () => ({ anthropic }))
vi.mock("@ai-sdk/openai", () => ({ openai }))
vi.mock("ai", () => ({ generateText }))

const ENV_KEYS = ["LLM_PRIMARY_PROVIDER", "LLM_FALLBACK_PROVIDER"] as const
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

describe("getAnalysisModel", () => {
  beforeEach(() => {
    vi.resetModules()
    anthropic.mockReset()
    openai.mockReset()
    generateText.mockReset()
    ENV_KEYS.forEach((key) => delete process.env[key])
  })

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    })
  })

  it("returns the single configured Claude Opus 4.8 model by default", async () => {
    const model = { provider: "anthropic", modelId: "claude-opus-4-8" }
    anthropic.mockReturnValue(model)

    const { getAnalysisModel } = await import("./provider")

    expect(getAnalysisModel()).toBe(model)
    expect(anthropic).toHaveBeenCalledWith("claude-opus-4-8")
  })

  it("switches to the OpenAI model when LLM_PRIMARY_PROVIDER=openai", async () => {
    process.env.LLM_PRIMARY_PROVIDER = "openai"
    const model = { provider: "openai", modelId: "gpt-5.1" }
    openai.mockReturnValue(model)

    const { getAnalysisModel } = await import("./provider")

    expect(getAnalysisModel()).toBe(model)
    expect(openai).toHaveBeenCalledWith("gpt-5.1")
  })

  it("falls back to anthropic for an unrecognized LLM_PRIMARY_PROVIDER value", async () => {
    process.env.LLM_PRIMARY_PROVIDER = "not-a-real-provider"
    const model = { provider: "anthropic", modelId: "claude-opus-4-8" }
    anthropic.mockReturnValue(model)

    const { getAnalysisModel } = await import("./provider")

    expect(getAnalysisModel()).toBe(model)
  })
})

describe("generateAnalysisText", () => {
  beforeEach(() => {
    vi.resetModules()
    anthropic.mockReset()
    openai.mockReset()
    generateText.mockReset()
    ENV_KEYS.forEach((key) => delete process.env[key])
    anthropic.mockImplementation((modelId: string) => ({ provider: "anthropic", modelId }))
    openai.mockImplementation((modelId: string) => ({ provider: "openai", modelId }))
  })

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    })
  })

  it("calls generateText once with the primary model when it succeeds", async () => {
    generateText.mockResolvedValueOnce({ text: "ok" })

    const { generateAnalysisText } = await import("./provider")
    const result = await generateAnalysisText({ prompt: "hello" })

    expect(result).toEqual({ text: "ok" })
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateText).toHaveBeenCalledWith({
      model: { provider: "anthropic", modelId: "claude-opus-4-8" },
      prompt: "hello",
    })
  })

  it("retries with the fallback provider (openai by default) when the primary call throws", async () => {
    generateText
      .mockRejectedValueOnce(new Error("anthropic is down"))
      .mockResolvedValueOnce({ text: "from fallback" })

    const { generateAnalysisText } = await import("./provider")
    const result = await generateAnalysisText({ prompt: "hello" })

    expect(result).toEqual({ text: "from fallback" })
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(generateText).toHaveBeenNthCalledWith(2, {
      model: { provider: "openai", modelId: "gpt-5.1" },
      prompt: "hello",
    })
  })

  it("retries with anthropic when the primary is openai", async () => {
    process.env.LLM_PRIMARY_PROVIDER = "openai"
    generateText
      .mockRejectedValueOnce(new Error("openai is down"))
      .mockResolvedValueOnce({ text: "from fallback" })

    const { generateAnalysisText } = await import("./provider")
    const result = await generateAnalysisText({ prompt: "hello" })

    expect(result).toEqual({ text: "from fallback" })
    expect(generateText).toHaveBeenNthCalledWith(2, {
      model: { provider: "anthropic", modelId: "claude-opus-4-8" },
      prompt: "hello",
    })
  })

  it("rethrows the original error when LLM_FALLBACK_PROVIDER=none", async () => {
    process.env.LLM_FALLBACK_PROVIDER = "none"
    const originalError = new Error("anthropic is down")
    generateText.mockRejectedValueOnce(originalError)

    const { generateAnalysisText } = await import("./provider")

    await expect(generateAnalysisText({ prompt: "hello" })).rejects.toThrow("anthropic is down")
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it("rethrows the fallback's error when both providers fail", async () => {
    generateText
      .mockRejectedValueOnce(new Error("anthropic is down"))
      .mockRejectedValueOnce(new Error("openai is also down"))

    const { generateAnalysisText } = await import("./provider")

    await expect(generateAnalysisText({ prompt: "hello" })).rejects.toThrow("openai is also down")
    expect(generateText).toHaveBeenCalledTimes(2)
  })
})
