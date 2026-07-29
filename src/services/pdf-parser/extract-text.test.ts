import { describe, expect, it } from "vitest"

import type { PdfPageText, PdfTextItem } from "../../types/pdf"
import {
  extractPdfTextItems,
  isPdfBuffer,
  PdfPasswordRequiredError,
  UnsupportedPdfFormatError,
} from "."
import {
  NH_FIXTURE_PASSWORD,
  readPdfFixture,
} from "./__fixtures__/load-fixture"

type TextRow = { items: PdfTextItem[] }

function groupRows(page: PdfPageText, tolerance = 0.5): TextRow[] {
  const rows: Array<TextRow & { y: number }> = []

  for (const item of [...page.items].sort((a, b) => b.y - a.y)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) < tolerance)

    if (row) {
      row.items.push(item)
      row.y =
        (row.y * (row.items.length - 1) + item.y) / row.items.length
    } else {
      rows.push({ y: item.y, items: [item] })
    }
  }

  return rows.map(({ items }) => ({
    items: items.sort((a, b) => a.x - b.x),
  }))
}

function isNumeric(text: string): boolean {
  return /^-?[\d,]+$/.test(text.trim())
}

function numericValue(text: string): number {
  return Number(text.replaceAll(",", ""))
}

function itemsAtRightEdge(row: TextRow, edge: number): PdfTextItem[] {
  return row.items.filter(
    (item) =>
      Math.abs(item.x + item.width - edge) < 1.5 && isNumeric(item.text),
  )
}

describe("isPdfBuffer", () => {
  it("detects the PDF magic bytes without treating CSV as PDF", () => {
    expect(isPdfBuffer(Buffer.from("%PDF-1.4\n"))).toBe(true)
    expect(isPdfBuffer(Buffer.from("date,merchant,amount\n"))).toBe(false)
  })
})

describe("extractPdfTextItems", () => {
  it("distinguishes a missing password without exposing password values", async () => {
    const promise = extractPdfTextItems({
      data: readPdfFixture("nh-statement-sample.pdf"),
    })

    await expect(promise).rejects.toMatchObject({
      name: "PdfPasswordRequiredError",
      code: "PDF_PASSWORD_REQUIRED",
      passwordCase: "missing",
    })
    await expect(promise).rejects.toBeInstanceOf(PdfPasswordRequiredError)
  })

  it("distinguishes an incorrect password without exposing password values", async () => {
    let caught: unknown

    try {
      await extractPdfTextItems({
        data: readPdfFixture("nh-statement-sample.pdf"),
        password: "wrong-pw",
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(PdfPasswordRequiredError)
    expect(caught).toMatchObject({
      code: "PDF_PASSWORD_REQUIRED",
      passwordCase: "incorrect",
    })
    expect((caught as Error).message).not.toContain("wrong-pw")
    expect((caught as Error).message).not.toContain(NH_FIXTURE_PASSWORD)
  })

  it("extracts every page and preserves raw coordinates and width", async () => {
    const result = await extractPdfTextItems({
      data: readPdfFixture("nh-statement-sample.pdf"),
      password: NH_FIXTURE_PASSWORD,
    })

    expect(result.pages).toHaveLength(3)
    expect(result.pages[2]).toMatchObject({ pageNumber: 3 })
    expect(result.pages[2].items).toHaveLength(6)
    expect(result.pages[1].items.every((item) => Number.isFinite(item.width))).toBe(
      true,
    )
  })

  it("converts a corrupt PDF into a sanitized unsupported-format error", async () => {
    let caught: unknown

    try {
      await extractPdfTextItems({
        data: Buffer.from("%PDF-1.4\nthis is not a valid PDF"),
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(UnsupportedPdfFormatError)
    expect(caught).toMatchObject({
      name: "UnsupportedPdfFormatError",
      code: "UNSUPPORTED_PDF_FORMAT",
      reason: "pdf_open_failed",
    })
    expect((caught as Error).message).not.toContain("Invalid PDF")
    expect((caught as Error).message).not.toContain("this is not a valid PDF")
  })

  it("does not reject a document merely because it has no transaction rows", async () => {
    const result = await extractPdfTextItems({
      data: readPdfFixture("no-transactions-sample.pdf"),
    })

    expect(result.pages).toHaveLength(1)
    expect(
      result.pages[0].items.filter((item) => /^\d{2}\/\d{2}/.test(item.text)),
    ).toHaveLength(0)
  })

  it("reproduces the statement golden totals and right-edge columns", async () => {
    const result = await extractPdfTextItems({
      data: readPdfFixture("nh-statement-sample.pdf"),
      password: NH_FIXTURE_PASSWORD,
    })
    const rows = groupRows(result.pages[1])
    const transactionRows = rows.filter((row) =>
      /^\d{2}\/\d{2}/.test(row.items[0]?.text.trim() ?? ""),
    )
    const domesticRows = transactionRows.filter(
      (row) => itemsAtRightEdge(row, 407).length === 1,
    )
    const billedItems = domesticRows.flatMap((row) =>
      itemsAtRightEdge(row, 407),
    )

    expect(billedItems).toHaveLength(34)
    expect(billedItems.reduce((sum, item) => sum + numericValue(item.text), 0)).toBe(
      882_646,
    )
    expect(
      billedItems.every(
        (item) => Math.abs(item.x + item.width - 407) < 1.5,
      ),
    ).toBe(true)
    expect(
      domesticRows.flatMap((row) => itemsAtRightEdge(row, 275.5)),
    ).toHaveLength(32)
    expect(
      domesticRows.flatMap((row) => itemsAtRightEdge(row, 445.5)),
    ).toHaveLength(34)
    expect(
      domesticRows.flatMap((row) => itemsAtRightEdge(row, 558.5)),
    ).toHaveLength(4)

    const totalRow = rows.find(
      (row) => row.items.map((item) => item.text).join("") === "합계882,64690277,200",
    )
    expect(totalRow).toBeDefined()
    expect(itemsAtRightEdge(totalRow!, 407).map((item) => numericValue(item.text))).toEqual([
      882_646,
    ])
  })

  it("preserves the sub-point y splits on all twelve designated rows", async () => {
    const result = await extractPdfTextItems({
      data: readPdfFixture("nh-statement-sample.pdf"),
      password: NH_FIXTURE_PASSWORD,
    })
    const splitDates = [
      "06/12",
      "06/12",
      "06/14",
      "06/15",
      "06/15",
      "06/16",
      "06/17",
      "06/18",
      "06/18",
      "06/19",
      "06/20",
      "06/22",
    ]
    const splitRows = groupRows(result.pages[1]).filter((row) => {
      const first = row.items[0]?.text.trim()
      const index = splitDates.indexOf(first)
      if (index === -1) return false
      splitDates.splice(index, 1)
      return true
    })

    expect(splitRows).toHaveLength(12)
    expect(splitDates).toHaveLength(0)
    for (const row of splitRows) {
      const yValues = row.items.map((item) => item.y)
      const difference = Math.max(...yValues) - Math.min(...yValues)
      expect(difference).toBeGreaterThan(0)
      expect(difference).toBeLessThan(0.5)
    }
  })

  it("opens the year-boundary fixture and exposes its three transaction rows", async () => {
    const result = await extractPdfTextItems({
      data: readPdfFixture("year-boundary-sample.pdf"),
    })
    const rows = groupRows(result.pages[0]).filter((row) =>
      /^\d{2}\/\d{2}/.test(row.items[0]?.text.trim() ?? ""),
    )

    expect(rows).toHaveLength(3)
    expect(
      rows.flatMap((row) => itemsAtRightEdge(row, 407)).reduce(
        (sum, item) => sum + numericValue(item.text),
        0,
      ),
    ).toBe(80_000)
  })
})
