export type RawRow = Record<string, string>

export type ParsedCsv = {
  headers: string[]
  rows: RawRow[]
  rowCount: number
}

export type MaskedRow = Record<string, string> & {
  readonly __masked: unique symbol
}

export type MaskedDataset = {
  headers: string[]
  rows: MaskedRow[]
  excludedColumns: string[]
  maskedColumns: string[]
}

export type ColumnMapping = {
  date: string | null
  merchant: string | null
  amount: string | null
  category: string | null
  confidence: number
}

export type ConfirmedMapping = {
  date: string
  merchant: string
  amount: string
  category: string | null
}

export type FreeSummary = {
  totalSpent: number
  transactionCount: number
  categoryTotals: Record<string, number>
  topMerchants: {
    merchant: string
    amount: number
  }[]
}

export type ReportType =
  | "mom_comparison"
  | "anomaly_detection"
  | "savings_suggestions"
  | "budget_recommendation"

export type AnalysisRecord = {
  id: string
  createdAt: string
  maskedTransactions: MaskedRow[]
  freeSummary: FreeSummary
}

export type MonthOverMonthReport = {
  type: "mom_comparison"
  hasPrevious: boolean
  total: SpendingChange | null
  categories: (SpendingChange & { category: string })[]
  commentary: string | null
}

export type SpendingChange = {
  current: number
  previous: number
  change: number
  changeRate: number | null
}

export type AnomalyReport = {
  type: "anomaly_detection"
  summary: string
  anomalies: {
    transactionIndex: number
    reason: string
    severity: "low" | "medium" | "high"
  }[]
}

export type SavingsReport = {
  type: "savings_suggestions"
}

export type BudgetReport = {
  type: "budget_recommendation"
}

export type PremiumReport =
  | MonthOverMonthReport
  | AnomalyReport
  | SavingsReport
  | BudgetReport
