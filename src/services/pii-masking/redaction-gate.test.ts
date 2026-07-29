import { describe, expect, expectTypeOf, it } from "vitest"

import { buildStatementLayout } from "../pdf-parser/layout"
import { extractPdfTextItems } from "../pdf-parser/extract-text"
import {
  NH_FIXTURE_PASSWORD,
  readPdfFixture,
} from "../pdf-parser/__fixtures__/load-fixture"
import {
  assertRedacted,
  findPiiPatterns,
  RedactionGateError,
  type RedactionFindingKind,
} from "./redaction-gate"

async function extractNhLayout() {
  const document = await extractPdfTextItems({
    data: readPdfFixture("nh-statement-sample.pdf"),
    password: NH_FIXTURE_PASSWORD,
  })

  return buildStatementLayout(document)
}

function expectBlocked(
  values: string[],
  expectedFindings: RedactionFindingKind[],
): RedactionGateError {
  try {
    assertRedacted(values)
  } catch (error) {
    expect(error).toBeInstanceOf(RedactionGateError)
    const gateError = error as RedactionGateError
    expect(gateError.findings).toEqual(
      expect.arrayContaining(expectedFindings),
    )
    return gateError
  }

  throw new Error("Expected the redaction gate to block the values")
}

describe("findPiiPatterns", () => {
  it.each([
    [
      "소계(M614)(홍길동)바른카드",
      ["subtotal_context", "korean_name"],
    ],
    ["123********99", ["masked_account"]],
    ["1234-5678-9012-3456", ["card_number"]],
    ["1234567890123456", ["card_number"]],
    ["1234 5678 9012 3456", ["card_number"]],
    ["주소04524 서울특별시 중구 세종대로 110", ["postal_address"]],
    ["010-1234-5678", ["phone_number"]],
    ["02-1234-5678", ["phone_number"]],
  ] satisfies [string, RedactionFindingKind[]][])(
    "finds PII kinds in %s",
    (value, findings) => {
      expect(findPiiPatterns(value)).toEqual(findings)
    },
  )

  it.each([
    "06/13테스트마트 강변점4,50053(할인)4,4470",
    "03/20테스트페이_강의140,252922(면제)6/423,375046,750",
    "04/15테스트전자스토어1,200,00012/3100,0000900,000",
    "02/28테스트폰코리아360,00012/530,0000210,000",
    "이용기간 : [일시불/할부] 2026.06.11 ~ 2026.07.10",
    "이용일가맹점이용금액할인금액할부회차이번달청구금액포인트할부잔여",
    "[해외이용]",
    "53(할인)",
    "922(면제)",
  ])("does not flag a safe statement value: %s", (value) => {
    expect(findPiiPatterns(value)).toEqual([])
  })

  it("deduplicates repeated findings", () => {
    expect(findPiiPatterns("합계 소계 합계")).toEqual([
      "subtotal_context",
    ])
  })
})

describe("assertRedacted", () => {
  it("has a void signature and throws a typed blocking error", () => {
    expectTypeOf(assertRedacted).returns.toEqualTypeOf<void>()
    expect(assertRedacted(["안전한 거래 조각"])).toBeUndefined()

    const error = expectBlocked(
      ["정상 값", "123********99"],
      ["masked_account"],
    )
    expect(error.code).toBe("REDACTION_GATE_BLOCKED")
  })

  it("allows every transaction line and item from the statement fixture", async () => {
    const layout = await extractNhLayout()
    const values = layout.transactionLines.flatMap((line) => [
      line.text,
      ...line.items.map((item) => item.text),
    ])

    expect(layout.transactionLines).toHaveLength(35)
    expect(() => assertRedacted(values)).not.toThrow()
  })

  it("blocks both subtotal lines without exposing their source values", async () => {
    const layout = await extractNhLayout()
    const subtotals = layout.excludedLines.filter(
      (line) => line.role === "subtotal",
    )

    expect(subtotals).toHaveLength(2)
    for (const line of subtotals) {
      const error = expectBlocked(
        [line.text],
        ["subtotal_context", "korean_name"],
      )
      expect(error.message).not.toContain("홍길동")
      expect(JSON.stringify(error.findings)).not.toContain("홍길동")
    }
  })

  it.each([
    ["성명", "korean_name"],
    ["주소", "postal_address"],
    ["연락처", "phone_number"],
    ["결제계좌", "masked_account"],
  ] satisfies [string, RedactionFindingKind][])(
    "blocks the page-one %s line without exposing its source value",
    async (keyword, expectedFinding) => {
      const layout = await extractNhLayout()
      const line = layout.excludedLines.find(
        (candidate) =>
          candidate.pageNumber === 1 &&
          candidate.text.includes(keyword),
      )

      expect(line).toBeDefined()
      const error = expectBlocked([line!.text], [expectedFinding])
      for (const sourceValue of [
        "홍길동",
        "123********99",
        "세종대로",
        "010-1234-5678",
      ]) {
        expect(error.message).not.toContain(sourceValue)
        expect(JSON.stringify(error.findings)).not.toContain(sourceValue)
      }
    },
  )
})
