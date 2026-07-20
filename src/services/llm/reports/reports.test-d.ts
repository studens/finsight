import { generateAnomalyDetection } from "./anomaly-detection"
import { generateMomComparison } from "./mom-comparison"
import type { AnalysisRecord, RawRow } from "../../../types/pipeline"

declare const analysis: AnalysisRecord
declare const rawRows: RawRow[]

generateMomComparison({ current: analysis, previous: null })
generateAnomalyDetection({ current: analysis })

// @ts-expect-error Raw rows cannot bypass the masked AnalysisRecord boundary.
generateAnomalyDetection({ current: { ...analysis, maskedTransactions: rawRows } })
