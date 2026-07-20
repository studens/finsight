import { generateText } from "ai"

import type { AnalysisRecord, SavingsReport } from "../../../types/pipeline"
import { getAnalysisModel } from "../provider"

type SavingsPayload = Omit<SavingsReport, "type">

function parseSavingsPayload(text: string): SavingsPayload {
  const value: unknown = JSON.parse(text)

  if (
    typeof value !== "object" ||
    value === null ||
    !("summary" in value) ||
    typeof value.summary !== "string" ||
    !("suggestions" in value) ||
    !Array.isArray(value.suggestions)
  ) {
    throw new TypeError("Claude returned an invalid savings report")
  }

  const valid = value.suggestions.every((suggestion: unknown) => {
    if (typeof suggestion !== "object" || suggestion === null) return false

    return (
      "title" in suggestion &&
      typeof suggestion.title === "string" &&
      "description" in suggestion &&
      typeof suggestion.description === "string" &&
      "estimatedMonthlySavings" in suggestion &&
      typeof suggestion.estimatedMonthlySavings === "number" &&
      Number.isFinite(suggestion.estimatedMonthlySavings) &&
      suggestion.estimatedMonthlySavings >= 0
    )
  })

  if (!valid) throw new TypeError("Claude returned invalid savings suggestions")

  return value as SavingsPayload
}

export async function generateSavingsSuggestions(input: {
  current: AnalysisRecord
}): Promise<SavingsReport> {
  const { current } = input
  const analysis = {
    maskedTransactions: current.maskedTransactions,
    freeSummary: current.freeSummary,
  }
  const { text } = await generateText({
    model: getAnalysisModel(),
    prompt: [
      "다음 마스킹된 거래와 지출 요약을 바탕으로 실행 가능한 절약 제안을 만드세요.",
      "summary와 suggestions 배열을 가진 JSON만 반환하세요.",
      "각 suggestion은 title, description, estimatedMonthlySavings(0 이상의 숫자)를 포함하세요.",
      `분석: ${JSON.stringify(analysis)}`,
    ].join("\n"),
  })

  return {
    type: "savings_suggestions",
    ...parseSavingsPayload(text),
  }
}
