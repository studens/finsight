import type { AnalysisRecord, AnomalyReport } from "../../../types/pipeline"
import { generateAnalysisText } from "../provider"

type AnomalyPayload = Omit<AnomalyReport, "type">

function parseAnomalyPayload(text: string, transactionCount: number): AnomalyPayload {
  const value: unknown = JSON.parse(text)

  if (
    typeof value !== "object" ||
    value === null ||
    !("summary" in value) ||
    typeof value.summary !== "string" ||
    !("anomalies" in value) ||
    !Array.isArray(value.anomalies)
  ) {
    throw new TypeError("Claude returned an invalid anomaly report")
  }

  const anomalies = value.anomalies
  const valid = anomalies.every((anomaly: unknown) => {
    if (typeof anomaly !== "object" || anomaly === null) return false
    if (!("transactionIndex" in anomaly) || !("reason" in anomaly) || !("severity" in anomaly)) {
      return false
    }

    return (
      Number.isInteger(anomaly.transactionIndex) &&
      typeof anomaly.transactionIndex === "number" &&
      anomaly.transactionIndex >= 0 &&
      anomaly.transactionIndex < transactionCount &&
      typeof anomaly.reason === "string" &&
      ["low", "medium", "high"].includes(String(anomaly.severity))
    )
  })

  if (!valid) throw new TypeError("Claude returned invalid anomalies")

  return value as AnomalyPayload
}

export async function generateAnomalyDetection(input: {
  current: AnalysisRecord
}): Promise<AnomalyReport> {
  const { current } = input
  const { text } = await generateAnalysisText({
    prompt: [
      "다음 마스킹된 거래에서 이상 거래나 중복 결제 후보를 찾으세요.",
      "summary와 anomalies 배열을 가진 JSON만 반환하세요.",
      "각 anomaly는 transactionIndex(0부터 시작), reason, severity(low|medium|high)를 포함하세요.",
      `거래: ${JSON.stringify(current.maskedTransactions)}`,
    ].join("\n"),
  })

  return {
    type: "anomaly_detection",
    ...parseAnomalyPayload(text, current.maskedTransactions.length),
  }
}
