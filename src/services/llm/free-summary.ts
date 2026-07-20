import { generateText } from "ai"

import type {
  ConfirmedMapping,
  FreeSummary,
  MaskedRow,
} from "../../types/pipeline"
import { getAnalysisModel } from "./provider"

function parseAmount(value: string): number {
  const normalized = value.replace(/[^0-9.-]/g, "")
  const amount = Number(normalized)

  return Number.isFinite(amount) ? amount : 0
}

function parseCategories(text: string, rowCount: number): string[] {
  const value: unknown = JSON.parse(text)

  if (
    !Array.isArray(value) ||
    value.length !== rowCount ||
    !value.every((category) => typeof category === "string" && category.trim().length > 0)
  ) {
    throw new TypeError("Claude returned invalid transaction categories")
  }

  return value.map((category) => category.trim())
}

async function classifyCategories(
  rows: MaskedRow[],
  mapping: ConfirmedMapping,
): Promise<string[]> {
  const transactions = rows.map((row) => ({
    date: row[mapping.date],
    merchant: row[mapping.merchant],
    amount: row[mapping.amount],
  }))
  const prompt = [
    "다음 마스킹된 거래를 각각 하나의 지출 카테고리로 분류하세요.",
    "입력 순서와 동일하게 카테고리명만 담은 JSON 문자열 배열을 반환하세요.",
    "설명이나 마크다운을 포함하지 마세요.",
    `거래: ${JSON.stringify(transactions)}`,
  ].join("\n")
  const { text } = await generateText({
    model: getAnalysisModel(),
    prompt,
  })

  return parseCategories(text, rows.length)
}

export async function generateFreeSummary(input: {
  rows: MaskedRow[]
  mapping: ConfirmedMapping
}): Promise<FreeSummary> {
  const { rows, mapping } = input
  const categories = mapping.category
    ? rows.map((row) => row[mapping.category as string]?.trim() || "기타")
    : await classifyCategories(rows, mapping)
  const categoryTotals: Record<string, number> = {}
  const merchantTotals = new Map<string, number>()
  let totalSpent = 0

  rows.forEach((row, index) => {
    const amount = parseAmount(row[mapping.amount] ?? "")
    const merchant = row[mapping.merchant]?.trim() || "알 수 없음"
    const category = categories[index]

    totalSpent += amount
    categoryTotals[category] = (categoryTotals[category] ?? 0) + amount
    merchantTotals.set(merchant, (merchantTotals.get(merchant) ?? 0) + amount)
  })

  const topMerchants = Array.from(merchantTotals, ([merchant, amount]) => ({
    merchant,
    amount,
  }))
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5)

  return {
    totalSpent,
    transactionCount: rows.length,
    categoryTotals,
    topMerchants,
  }
}
