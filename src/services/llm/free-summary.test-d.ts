import { generateFreeSummary } from "./free-summary"
import type { ConfirmedMapping, RawRow } from "../../types/pipeline"

declare const rawRows: RawRow[]
declare const mapping: ConfirmedMapping

// @ts-expect-error Raw rows must cross the PII-masking boundary first.
generateFreeSummary({ rows: rawRows, mapping })
