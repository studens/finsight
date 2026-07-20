import { generateText } from "ai"

import type { AnalysisRecord, BudgetReport } from "../../../types/pipeline"
import { getAnalysisModel } from "../provider"

type BudgetPayload = Omit<BudgetReport, "type">

function parseBudgetPayload(text: string): BudgetPayload {
  const value: unknown = JSON.parse(text)

  if (
    typeof value !== "object" ||
    value === null ||
    !("summary" in value) ||
    typeof value.summary !== "string" ||
    !("categories" in value) ||
    !Array.isArray(value.categories)
  ) {
    throw new TypeError("Claude returned an invalid budget report")
  }

  const valid = value.categories.every((category: unknown) => {
    if (typeof category !== "object" || category === null) return false

    return (
      "category" in category &&
      typeof category.category === "string" &&
      "currentSpending" in category &&
      typeof category.currentSpending === "number" &&
      Number.isFinite(category.currentSpending) &&
      category.currentSpending >= 0 &&
      "recommendedBudget" in category &&
      typeof category.recommendedBudget === "number" &&
      Number.isFinite(category.recommendedBudget) &&
      category.recommendedBudget >= 0 &&
      "reason" in category &&
      typeof category.reason === "string"
    )
  })

  if (!valid) throw new TypeError("Claude returned invalid budget categories")

  return value as BudgetPayload
}

export async function generateBudgetRecommendation(input: {
  current: AnalysisRecord
}): Promise<BudgetReport> {
  const { current } = input
  const { text } = await generateText({
    model: getAnalysisModel(),
    prompt: [
      "다음 현재 지출 요약을 바탕으로 카테고리별 월 예산을 추천하세요.",
      "summary와 categories 배열을 가진 JSON만 반환하세요.",
      "각 category는 category, currentSpending, recommendedBudget, reason을 포함하세요.",
      "금액은 모두 0 이상의 숫자로 반환하세요.",
      `지출 요약: ${JSON.stringify(current.freeSummary)}`,
    ].join("\n"),
  })

  return {
    type: "budget_recommendation",
    ...parseBudgetPayload(text),
  }
}
