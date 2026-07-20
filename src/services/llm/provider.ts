import { anthropic } from "@ai-sdk/anthropic"

const ANALYSIS_MODEL_ID = "claude-opus-4-8"

export function getAnalysisModel() {
  return anthropic(ANALYSIS_MODEL_ID)
}
