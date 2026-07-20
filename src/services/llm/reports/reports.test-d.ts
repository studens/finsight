import { generateAnomalyDetection } from "./anomaly-detection"
import { generateBudgetRecommendation } from "./budget-recommendation"
import { generateReport } from "./index"
import { generateMomComparison } from "./mom-comparison"
import { generateSavingsSuggestions } from "./savings-suggestions"
import type { AnalysisRecord, RawRow } from "../../../types/pipeline"

declare const analysis: AnalysisRecord
declare const rawRows: RawRow[]

generateMomComparison({ current: analysis, previous: null })
generateAnomalyDetection({ current: analysis })
generateSavingsSuggestions({ current: analysis })
generateBudgetRecommendation({ current: analysis })
generateReport({ reportType: "savings_suggestions", current: analysis, previous: null })

// @ts-expect-error Raw rows cannot bypass the masked AnalysisRecord boundary.
generateAnomalyDetection({ current: { ...analysis, maskedTransactions: rawRows } })

// @ts-expect-error Raw rows cannot bypass the masked AnalysisRecord boundary.
generateSavingsSuggestions({ current: { ...analysis, maskedTransactions: rawRows } })
