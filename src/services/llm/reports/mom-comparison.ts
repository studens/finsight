import type {
  AnalysisRecord,
  MonthOverMonthReport,
  SpendingChange,
} from "../../../types/pipeline"
import { generateAnalysisText } from "../provider"

function calculateChange(current: number, previous: number): SpendingChange {
  const change = current - previous

  return {
    current,
    previous,
    change,
    changeRate: previous === 0 ? null : (change / previous) * 100,
  }
}

export async function generateMomComparison(input: {
  current: AnalysisRecord
  previous: AnalysisRecord | null
}): Promise<MonthOverMonthReport> {
  const { current, previous } = input

  if (previous === null) {
    return {
      type: "mom_comparison",
      hasPrevious: false,
      total: null,
      categories: [],
      commentary: null,
    }
  }

  const total = calculateChange(
    current.freeSummary.totalSpent,
    previous.freeSummary.totalSpent,
  )
  const categoryNames = new Set([
    ...Object.keys(current.freeSummary.categoryTotals),
    ...Object.keys(previous.freeSummary.categoryTotals),
  ])
  const categories = Array.from(categoryNames, (category) => ({
    category,
    ...calculateChange(
      current.freeSummary.categoryTotals[category] ?? 0,
      previous.freeSummary.categoryTotals[category] ?? 0,
    ),
  }))
  const comparison = { total, categories }
  const { text } = await generateAnalysisText({
    prompt: [
      "다음 전월 대비 지출 수치를 간결한 한국어 한두 문장으로 해석하세요.",
      "수치는 이미 계산되었으므로 재계산하지 말고 중요한 변화만 설명하세요.",
      `비교: ${JSON.stringify(comparison)}`,
    ].join("\n"),
  })

  return {
    type: "mom_comparison",
    hasPrevious: true,
    ...comparison,
    commentary: text.trim(),
  }
}
