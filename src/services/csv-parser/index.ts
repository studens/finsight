import { parse } from "csv-parse/sync"
import iconv from "iconv-lite"

import type { ParsedCsv, RawRow } from "../../types/pipeline"

function decodeCsv(input: Buffer | Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input)
  } catch {
    return iconv.decode(
      Buffer.from(input.buffer, input.byteOffset, input.byteLength),
      "cp949",
    )
  }
}

export function parseCsv(input: Buffer | Uint8Array): ParsedCsv {
  if (input.byteLength === 0) {
    return { headers: [], rows: [], rowCount: 0 }
  }

  const records = parse(decodeCsv(input), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][]

  const [headers = [], ...dataRows] = records
  const rows: RawRow[] = dataRows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
  )

  return { headers, rows, rowCount: rows.length }
}
