import { insertAnalysis } from "."
import type { FreeSummary, RawRow } from "../../types/pipeline"

declare const rawRows: RawRow[]
declare const freeSummary: FreeSummary

insertAnalysis({
  userId: "user-1",
  // @ts-expect-error RawRow[] has not crossed the PII masking branded boundary.
  maskedTransactions: rawRows,
  freeSummary,
})
