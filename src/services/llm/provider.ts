import { anthropic } from "@ai-sdk/anthropic"
import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"

type ProviderName = "anthropic" | "openai"

const DEFAULT_MODEL_IDS: Record<ProviderName, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.1",
}

function isProviderName(value: string | undefined): value is ProviderName {
  return value === "anthropic" || value === "openai"
}

function getPrimaryProvider(): ProviderName {
  const value = process.env.LLM_PRIMARY_PROVIDER
  return isProviderName(value) ? value : "anthropic"
}

function getFallbackProvider(primary: ProviderName): ProviderName | null {
  const value = process.env.LLM_FALLBACK_PROVIDER
  if (value === "none") return null
  if (isProviderName(value)) return value === primary ? null : value
  return primary === "anthropic" ? "openai" : "anthropic"
}

function getModel(provider: ProviderName) {
  const modelId = DEFAULT_MODEL_IDS[provider]
  return provider === "anthropic" ? anthropic(modelId) : openai(modelId)
}

export function getAnalysisModel() {
  return getModel(getPrimaryProvider())
}

export async function generateAnalysisText(input: { prompt: string }) {
  const primary = getPrimaryProvider()

  try {
    return await generateText({ model: getModel(primary), prompt: input.prompt })
  } catch (error) {
    const fallback = getFallbackProvider(primary)
    if (!fallback) throw error

    return await generateText({ model: getModel(fallback), prompt: input.prompt })
  }
}
