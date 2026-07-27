import type { ColumnMapping, MaskedRow } from "../../types/pipeline"
import { generateAnalysisText } from "./provider"

const MAX_SAMPLE_ROWS = 5

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function parseColumnMapping(text: string): ColumnMapping {
  const value: unknown = JSON.parse(text)

  if (typeof value !== "object" || value === null) {
    throw new TypeError("Column mapping must be a JSON object")
  }

  const mapping = value as Record<string, unknown>
  if (
    !nullableString(mapping.date) ||
    !nullableString(mapping.merchant) ||
    !nullableString(mapping.amount) ||
    !nullableString(mapping.category) ||
    typeof mapping.confidence !== "number" ||
    !Number.isFinite(mapping.confidence) ||
    mapping.confidence < 0 ||
    mapping.confidence > 1
  ) {
    throw new TypeError("Claude returned an invalid column mapping")
  }

  return {
    date: mapping.date,
    merchant: mapping.merchant,
    amount: mapping.amount,
    category: mapping.category,
    confidence: mapping.confidence,
  }
}

export async function inferColumnMapping(input: {
  headers: string[]
  sampleRows: MaskedRow[]
}): Promise<ColumnMapping> {
  const sampleRows = input.sampleRows.slice(0, MAX_SAMPLE_ROWS)
  const prompt = [
    "다음 CSV 헤더와 마스킹된 샘플 행을 보고 date, merchant, amount, category 컬럼을 추론하세요.",
    "확신이 없으면 낮은 confidence를 반환하세요. 억지로 컬럼을 매핑하지 말고 해당 값은 null로 반환하세요.",
    "confidence는 0부터 1 사이의 숫자여야 합니다.",
    "설명이나 마크다운 없이 date, merchant, amount, category, confidence 키를 가진 JSON 객체만 반환하세요.",
    `헤더: ${JSON.stringify(input.headers)}`,
    `샘플 행: ${JSON.stringify(sampleRows)}`,
  ].join("\n")

  const { text } = await generateAnalysisText({ prompt })

  return parseColumnMapping(text)
}
