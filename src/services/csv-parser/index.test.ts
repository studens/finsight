import iconv from "iconv-lite"
import { describe, expect, expectTypeOf, it } from "vitest"

import type { MaskedRow, ParsedCsv, RawRow } from "../../types/pipeline"
import { parseCsv } from "."

describe("parseCsv", () => {
  it("parses a UTF-8 CSV buffer into raw rows", () => {
    const input = Buffer.from(
      "date,merchant,amount\n2026-07-01,Coffee Shop,4500\n2026-07-02,Bookstore,12000",
      "utf8",
    )

    const result = parseCsv(input)

    expect(result).toEqual({
      headers: ["date", "merchant", "amount"],
      rows: [
        { date: "2026-07-01", merchant: "Coffee Shop", amount: "4500" },
        { date: "2026-07-02", merchant: "Bookstore", amount: "12000" },
      ],
      rowCount: 2,
    })
  })

  it("detects and decodes a CP949-encoded Korean CSV", () => {
    const input = iconv.encode(
      "거래일,가맹점,금액\n2026-07-01,서울식당,15000",
      "cp949",
    )

    expect(parseCsv(input)).toEqual({
      headers: ["거래일", "가맹점", "금액"],
      rows: [{ 거래일: "2026-07-01", 가맹점: "서울식당", 금액: "15000" }],
      rowCount: 1,
    })
  })

  it.each([
    ["an empty file", Buffer.alloc(0), []],
    ["a header-only file", Buffer.from("date,merchant,amount", "utf8"), ["date", "merchant", "amount"]],
  ])("returns no rows for %s", (_label, input, headers) => {
    expect(parseCsv(input)).toEqual({ headers, rows: [], rowCount: 0 })
  })

  it("keeps a quoted field containing a comma as one value", () => {
    const result = parseCsv(
      Buffer.from('date,location,amount\n2026-07-01,"서울, 강남",9000', "utf8"),
    )

    expect(result.rows).toEqual([
      { date: "2026-07-01", location: "서울, 강남", amount: "9000" },
    ])
  })

  it("exposes ParsedCsv containing RawRow rather than MaskedRow", () => {
    const result = parseCsv(new Uint8Array())

    expectTypeOf(result).toEqualTypeOf<ParsedCsv>()
    expectTypeOf(result.rows).toEqualTypeOf<RawRow[]>()
    expectTypeOf(result.rows).not.toEqualTypeOf<MaskedRow[]>()
  })
})
