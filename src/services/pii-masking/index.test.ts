import { describe, expect, expectTypeOf, it } from "vitest"

import type {
  MaskedDataset,
  MaskedRow,
  ParsedCsv,
  RawRow,
} from "../../types/pipeline"
import { maskPii } from "."

function parsed(headers: string[], rows: RawRow[]): ParsedCsv {
  return { headers, rows, rowCount: rows.length }
}

describe("maskPii", () => {
  it("masks card numbers with and without separators, preserving only the last four digits", () => {
    const result = maskPii(
      parsed(
        ["카드번호", "card"],
        [{ 카드번호: "1234-5678-9012-3456", card: "1234567890123456" }],
      ),
    )

    expect(result.rows[0]).toMatchObject({
      카드번호: "****-****-****-3456",
      card: "************3456",
    })
    expect(result.maskedColumns).toEqual(["카드번호", "card"])
  })

  it("masks account numbers with and without separators", () => {
    const result = maskPii(
      parsed(
        ["계좌번호", "account"],
        [{ 계좌번호: "123-456-789012", account: "123456789012" }],
      ),
    )

    expect(result.rows[0]).toMatchObject({
      계좌번호: "***-***-**9012",
      account: "********9012",
    })
    expect(result.maskedColumns).toEqual(["계좌번호", "account"])
  })

  it("removes identity columns rather than masking their values", () => {
    const result = maskPii(
      parsed(
        ["이름", "연락처", "금액"],
        [{ 이름: "홍길동", 연락처: "010-1234-5678", 금액: "15000" }],
      ),
    )

    expect("이름" in result.rows[0]).toBe(false)
    expect("연락처" in result.rows[0]).toBe(false)
    expect(result.headers).toEqual(["금액"])
    expect(result.excludedColumns).toEqual(["이름", "연락처"])
    expect(result.rows[0]).toEqual({ 금액: "15000" })
  })

  it("keeps short, null-like, and empty cells safe while masking every sensitive column", () => {
    const result = maskPii(
      parsed(
        ["카드", "계좌", "card_number", "메모"],
        [
          {
            카드: "1234",
            계좌: null,
            card_number: "",
            메모: "첫 행",
          } as unknown as RawRow,
          {
            카드: "1111-2222-3333-4444",
            계좌: "123-456-789012",
            card_number: "5555666677778888",
            메모: "둘째 행",
          },
        ],
      ),
    )

    expect(result.rows).toEqual([
      { 카드: "1234", 계좌: "", card_number: "", 메모: "첫 행" },
      {
        카드: "****-****-****-4444",
        계좌: "***-***-**9012",
        card_number: "************8888",
        메모: "둘째 행",
      },
    ])
    expect(result.maskedColumns).toEqual(["카드", "계좌", "card_number"])
  })

  it("masks an obvious 13-to-16 digit number in an ambiguous column", () => {
    const result = maskPii(
      parsed(
        ["식별값", "설명"],
        [{ 식별값: "1234 5678 9012 3456", 설명: "정상 거래" }],
      ),
    )

    expect(result.rows[0]).toEqual({
      식별값: "**** **** **** 3456",
      설명: "정상 거래",
    })
    expect(result.maskedColumns).toEqual(["식별값"])
  })

  it("returns only branded masked rows without changing the input rows", () => {
    const input = parsed(["card", "amount"], [{ card: "1234567890123456", amount: "10" }])
    const result = maskPii(input)

    expectTypeOf(result).toEqualTypeOf<MaskedDataset>()
    expectTypeOf(result.rows).toEqualTypeOf<MaskedRow[]>()
    expectTypeOf(input.rows).toEqualTypeOf<RawRow[]>()
    expectTypeOf(input.rows).not.toEqualTypeOf<MaskedRow[]>()
    expect(input.rows[0].card).toBe("1234567890123456")
    expect(result.rows[0]).not.toBe(input.rows[0])
  })
})
