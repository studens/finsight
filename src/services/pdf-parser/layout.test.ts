import { describe, expect, it } from "vitest"

import type { PdfRightEdgeCluster } from "../../types/pdf"
import {
  buildStatementLayout,
  RIGHT_EDGE_TOLERANCE,
} from "./layout"
import { extractPdfTextItems } from "./extract-text"
import {
  NH_FIXTURE_PASSWORD,
  readPdfFixture,
} from "./__fixtures__/load-fixture"

const NUMERIC_ITEM_PATTERN = /^-?[\d,]+$/

function columnNear(
  columns: PdfRightEdgeCluster[],
  rightEdge: number,
  rowCount: number,
): PdfRightEdgeCluster | undefined {
  return columns.find(
    (column) =>
      column.rowCount === rowCount &&
      Math.abs(column.rightEdge - rightEdge) <= RIGHT_EDGE_TOLERANCE,
  )
}

function sumSamplesFromColumn(
  layout: ReturnType<typeof buildStatementLayout>,
  column: PdfRightEdgeCluster,
): number {
  return layout.transactionLines
    .flatMap((line) =>
      line.items.filter(
        (item) =>
          /^-?[\d,]+$/.test(item.text.trim()) &&
          Math.abs(item.x + item.width - column.rightEdge) <=
            RIGHT_EDGE_TOLERANCE,
      ),
    )
    .reduce(
      (sum, item) => sum + Number(item.text.trim().replaceAll(",", "")),
      0,
    )
}

async function extractNhStatement() {
  return extractPdfTextItems({
    data: readPdfFixture("nh-statement-sample.pdf"),
    password: NH_FIXTURE_PASSWORD,
  })
}

describe("buildStatementLayout", () => {
  it("finds all transaction candidates while excluding totals, subtotals, and page-one PII", async () => {
    const layout = buildStatementLayout(await extractNhStatement())

    expect(layout.transactionLines).toHaveLength(35)
    expect(
      layout.transactionLines.filter((line) => /소계|합계/.test(line.text)),
    ).toHaveLength(0)

    const subtotals = layout.excludedLines.filter(
      (line) => line.role === "subtotal",
    )
    expect(subtotals).toHaveLength(2)
    expect(subtotals.some((line) => line.text.includes("홍길동"))).toBe(true)
    expect(
      layout.excludedLines.filter((line) => line.role === "total"),
    ).toHaveLength(1)

    for (const keyword of ["성명", "주소", "결제계좌"]) {
      expect(
        layout.excludedLines.some((line) => line.text.includes(keyword)),
      ).toBe(true)
      expect(
        layout.transactionLines.some((line) => line.text.includes(keyword)),
      ).toBe(false)
    }
  })

  it("prevents the silent missing-amount regression with fuzzy y clustering", async () => {
    const doc = await extractNhStatement()
    const fuzzyLayout = buildStatementLayout(doc)
    const billedColumn = columnNear(fuzzyLayout.numericColumns, 407, 34)

    expect(fuzzyLayout.transactionLines).toHaveLength(35)
    expect(billedColumn).toBeDefined()
    expect(sumSamplesFromColumn(fuzzyLayout, billedColumn!)).toBe(882_646)

    const exactLayout = buildStatementLayout(doc, { yTolerance: 0 })
    const exactBilledColumn = exactLayout.numericColumns.find(
      (column) => Math.abs(column.rightEdge - 407) <= RIGHT_EDGE_TOLERANCE,
    )

    expect(exactLayout.transactionLines.length).toBeLessThan(35)
    expect(
      exactBilledColumn
        ? sumSamplesFromColumn(exactLayout, exactBilledColumn)
        : 0,
    ).not.toBe(882_646)
  })

  it("discovers numeric columns dynamically by right edge and ignores numeric-looking non-integers", async () => {
    const layout = buildStatementLayout(await extractNhStatement())
    const billedColumn = columnNear(layout.numericColumns, 407, 34)

    expect(layout.numericColumns).toHaveLength(5)
    expect(columnNear(layout.numericColumns, 275.5, 32)).toBeDefined()
    expect(billedColumn).toBeDefined()
    expect(columnNear(layout.numericColumns, 445.5, 34)).toBeDefined()
    expect(columnNear(layout.numericColumns, 558.5, 4)).toBeDefined()
    expect(columnNear(layout.numericColumns, 520, 1)).toBeDefined()

    const billedEdges = layout.transactionLines.flatMap((line) =>
      line.items
        .filter(
          (item) =>
            NUMERIC_ITEM_PATTERN.test(item.text.trim()) &&
            Math.abs(item.x + item.width - billedColumn!.rightEdge) <=
              RIGHT_EDGE_TOLERANCE,
        )
        .map((item) => item.x + item.width),
    )
    for (const jitteredEdge of [407.4, 406.6, 407.3]) {
      expect(
        billedEdges.some(
          (rightEdge) => Math.abs(rightEdge - jitteredEdge) < 0.01,
        ),
      ).toBe(true)
    }

    const samples = layout.numericColumns.flatMap(
      (column) => column.sampleValues,
    )
    for (const excluded of [
      "53(할인)",
      "922(면제)",
      "6/4",
      "USD",
      "23.39",
      "1,554.60",
    ]) {
      expect(samples).not.toContain(excluded)
    }
  })

  it("keeps the foreign detail as a transaction candidate in its own section and column", async () => {
    const layout = buildStatementLayout(await extractNhStatement())
    const foreignSection = layout.sections.find(
      (section) => section.kind === "foreign",
    )
    const foreignLine = layout.transactionLines.find((line) =>
      line.text.includes("USD"),
    )
    const billedColumn = columnNear(layout.numericColumns, 407, 34)

    expect(
      layout.sections.filter((section) => section.kind === "domestic"),
    ).toHaveLength(1)
    expect(
      layout.sections.filter((section) => section.kind === "foreign"),
    ).toHaveLength(1)
    expect(foreignLine?.sectionId).toBe(foreignSection?.sectionId)
    expect(
      foreignLine?.items.filter(
        (item) =>
          /^-?[\d,]+$/.test(item.text.trim()) &&
          Math.abs(item.x + item.width - billedColumn!.rightEdge) <=
            RIGHT_EDGE_TOLERANCE,
      ),
    ).toHaveLength(0)
  })

  it("extracts statement periods including a year boundary", async () => {
    const layout = buildStatementLayout(await extractNhStatement())
    expect(layout.statementPeriod).toEqual({
      start: "2026-06-11",
      end: "2026-07-10",
    })

    const boundaryDoc = await extractPdfTextItems({
      data: readPdfFixture("year-boundary-sample.pdf"),
    })
    const boundaryLayout = buildStatementLayout(boundaryDoc)
    expect(boundaryLayout.statementPeriod).toEqual({
      start: "2025-12-11",
      end: "2026-01-10",
    })
    expect(boundaryLayout.transactionLines).toHaveLength(3)
  })

  it("aligns the billed header label with the discovered billed column", async () => {
    const layout = buildStatementLayout(await extractNhStatement())
    const billedColumn = columnNear(layout.numericColumns, 407, 34)
    const billedLabel = layout.headerLabels.find(
      (label) => label.text === "이번달청구금액",
    )

    expect(billedLabel).toBeDefined()
    expect(
      Math.abs(billedLabel!.rightEdge - billedColumn!.rightEdge),
    ).toBeLessThanOrEqual(RIGHT_EDGE_TOLERANCE)
  })
})
