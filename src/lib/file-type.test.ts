import { describe, expect, it } from "vitest"

import { claimsPdf } from "./file-type"

describe("claimsPdf", () => {
  it.each([
    ["statement.pdf", "text/plain"],
    ["statement.PDF", "text/plain"],
    ["statement.bin", "application/pdf"],
  ])("recognizes PDF claim from %s and %s", (name, type) => {
    expect(claimsPdf(new File(["content"], name, { type }))).toBe(true)
  })

  it("does not treat a CSV file as a PDF claim", () => {
    expect(
      claimsPdf(new File(["content"], "transactions.csv", { type: "text/csv" })),
    ).toBe(false)
  })
})
