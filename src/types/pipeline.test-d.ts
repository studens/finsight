import type { MaskedRow, RawRow } from "./pipeline"

const raw: RawRow = {}

// @ts-expect-error Raw rows must pass through the PII-masking boundary first.
const masked: MaskedRow = raw

void masked
