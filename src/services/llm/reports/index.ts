import type {
  AnalysisRecord,
  PremiumReport,
  ReportType,
} from "../../../types/pipeline"
import { generateAnomalyDetection } from "./anomaly-detection"
import { generateBudgetRecommendation } from "./budget-recommendation"
import { generateMomComparison } from "./mom-comparison"
import { generateSavingsSuggestions } from "./savings-suggestions"

export function generateReport(input: {
  reportType: ReportType
  current: AnalysisRecord
  previous: AnalysisRecord | null
}): Promise<PremiumReport> {
  const { reportType, current, previous } = input

  switch (reportType) {
    case "mom_comparison":
      return generateMomComparison({ current, previous })
    case "anomaly_detection":
      return generateAnomalyDetection({ current })
    case "savings_suggestions":
      return generateSavingsSuggestions({ current })
    case "budget_recommendation":
      return generateBudgetRecommendation({ current })
  }
}
