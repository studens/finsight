import type { MaskedRow, RawRow } from "../../types/pipeline"
import { inferColumnMapping } from "./column-mapping"

declare const maskedRows: MaskedRow[]
declare const rawRows: RawRow[]

void inferColumnMapping({ headers: [], sampleRows: maskedRows })

// @ts-expect-error Raw rows must be masked before reaching the LLM boundary.
void inferColumnMapping({ headers: [], sampleRows: rawRows })
