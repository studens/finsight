import { describe, expect, it } from "vitest"

import type {
  PdfColumnRole,
  PdfColumnSchema,
  PdfStatementLayout,
} from "../../types/pdf"
import { extractPdfTextItems } from "./extract-text"
import { UnsupportedPdfFormatError } from "./errors"
import { buildStatementLayout, RIGHT_EDGE_TOLERANCE } from "./layout"
import {
  NH_FIXTURE_PASSWORD,
  readPdfFixture,
} from "./__fixtures__/load-fixture"
import {
  applyPdfColumnSchema,
  PDF_COLUMN_MAPPING,
  PDF_HEADERS,
} from "./to-parsed-csv"

function fixtureSchema(layout: PdfStatementLayout): PdfColumnSchema {
  const billedLabel = layout.headerLabels.find((label) =>
    label.text.includes("이번달청구금액"),
  )
  if (!billedLabel) throw new Error("billed label missing")
  const billedColumn = layout.numericColumns.find(
    (column) =>
      Math.abs(column.rightEdge - billedLabel.rightEdge) <=
      RIGHT_EDGE_TOLERANCE,
  )
  if (!billedColumn) throw new Error("billed column missing")

  return {
    version: 1,
    issuer: "NH농협카드",
    columns: layout.numericColumns.map((column) => ({
      rightEdge: column.rightEdge,
      role: (
        column === billedColumn
          ? "billedAmount"
          : column.rowCount === 4
            ? "remainingBalance"
            : "unknown"
      ) as PdfColumnRole,
      headerLabel: column === billedColumn ? billedLabel.text : null,
    })),
    billedAmountRightEdge: billedColumn.rightEdge,
    rightEdgeTolerance: RIGHT_EDGE_TOLERANCE,
    confidence: 0.99,
  }
}

async function nhInput() {
  const doc = await extractPdfTextItems({
    data: readPdfFixture("nh-statement-sample.pdf"),
    password: NH_FIXTURE_PASSWORD,
  })
  const layout = buildStatementLayout(doc)
  return { layout, schema: fixtureSchema(layout) }
}

describe("applyPdfColumnSchema", () => {
  it("emits the fixed ParsedCsv contract and exactly matches the statement total", async () => {
    const { layout, schema } = await nhInput()
    const parsed = applyPdfColumnSchema({ layout, schema })
    const billedTotal = parsed.rows.reduce(
      (sum, row) => sum + Number(row["청구금액"]),
      0,
    )
    const totalLine = layout.excludedLines.find(
      (line) => line.role === "total",
    )
    const statementTotal = Number(
      totalLine?.items
        .find(
          (item) =>
            /^-?[\d,]+$/.test(item.text.trim()) &&
            Math.abs(
              item.x + item.width - schema.billedAmountRightEdge,
            ) < schema.rightEdgeTolerance,
        )
        ?.text.replaceAll(",", ""),
    )

    expect(PDF_HEADERS).toEqual(["이용일", "가맹점", "청구금액", "구분"])
    expect(PDF_COLUMN_MAPPING).toEqual({
      date: "이용일",
      merchant: "가맹점",
      amount: "청구금액",
      category: "구분",
      confidence: 1,
    })
    expect(parsed).toMatchObject({
      headers: [...PDF_HEADERS],
      rowCount: 34,
    })
    expect(billedTotal).toBe(882_646)
    expect(statementTotal).toBe(882_646)
    expect(billedTotal).toBe(statementTotal)
  })

  it("handles installment billing, foreign detail exclusion, and every golden row shape", async () => {
    const parsed = applyPdfColumnSchema(await nhInput())
    const find = (predicate: (row: (typeof parsed.rows)[number]) => boolean) =>
      parsed.rows.filter(predicate)

    expect(
      find((row) => row["이용일"] === "2026-03-20"),
    ).toEqual([
      expect.objectContaining({
        가맹점: expect.stringContaining("테스트페이_강의"),
        청구금액: "23375",
        구분: "할부",
      }),
    ])
    expect(find((row) => row["청구금액"] === "140252")).toHaveLength(0)

    expect(find((row) => row["청구금액"] === "36719")).toEqual([
      expect.objectContaining({ 이용일: "2026-07-03" }),
    ])
    expect(
      find((row) => row["가맹점"].includes("룩셈부르크")),
    ).toHaveLength(0)

    expect(find((row) => row["이용일"] === "2026-06-13")).toContainEqual(
      expect.objectContaining({ 청구금액: "4447", 구분: "일시불" }),
    )
    expect(
      find(
        (row) =>
          row["이용일"] === "2026-06-24" &&
          row["가맹점"] === "아파트관리비",
      ),
    ).toContainEqual(expect.objectContaining({ 청구금액: "246090" }))
    expect(
      find((row) => row["가맹점"].includes("기본연회비")),
    ).toContainEqual(
      expect.objectContaining({ 청구금액: "6000", 구분: "연회비" }),
    )
    expect(find((row) => row["가맹점"] === "포인트결제")).toEqual([
      expect.objectContaining({ 청구금액: "-300", 구분: "일시불" }),
    ])
    expect(find((row) => row["가맹점"] === "카드론상환")).toEqual([
      expect.objectContaining({ 청구금액: "-1000", 구분: "일시불" }),
    ])

    expect(
      find((row) => /소계|합계/.test(row["가맹점"])),
    ).toHaveLength(0)
    for (const total of ["866646", "882646", "16000"]) {
      expect(find((row) => row["청구금액"] === total)).toHaveLength(0)
    }
  })

  it("classifies only the five transaction kinds without treating dates as installment rounds", async () => {
    const parsed = applyPdfColumnSchema(await nhInput())
    const counts = parsed.rows.reduce<Record<string, number>>(
      (result, row) => ({
        ...result,
        [row["구분"]]: (result[row["구분"]] ?? 0) + 1,
      }),
      {},
    )

    expect(counts).toEqual({ 일시불: 29, 할부: 4, 연회비: 1 })
    expect(
      new Set(parsed.rows.map((row) => row["구분"])),
    ).toEqual(new Set(["일시불", "할부", "연회비"]))
    expect(
      parsed.rows.find((row) => row["이용일"] === "2026-06-13")?.[
        "구분"
      ],
    ).toBe("일시불")
  })

  it("infers years across December and January and keeps an older installment", async () => {
    const doc = await extractPdfTextItems({
      data: readPdfFixture("year-boundary-sample.pdf"),
    })
    const layout = buildStatementLayout(doc)
    const parsed = applyPdfColumnSchema({
      layout,
      schema: fixtureSchema(layout),
    })

    expect(parsed.rowCount).toBe(3)
    expect(parsed.rows.map((row) => row["이용일"])).toEqual([
      "2025-12-15",
      "2026-01-05",
      "2025-11-20",
    ])
    expect(
      parsed.rows.reduce(
        (sum, row) => sum + Number(row["청구금액"]),
        0,
      ),
    ).toBe(80_000)
    expect(parsed.rows[2]["구분"]).toBe("할부")

    const nhParsed = applyPdfColumnSchema(await nhInput())
    for (const date of [
      "2026-03-20",
      "2026-02-28",
      "2026-04-15",
      "2026-05-02",
      "2026-06-01",
      "2026-06-05",
    ]) {
      expect(
        nhParsed.rows.some((row) => row["이용일"] === date),
      ).toBe(true)
    }
  })

  it("rejects a missing statement period and an empty billed result", async () => {
    const input = await nhInput()

    expect(() =>
      applyPdfColumnSchema({
        ...input,
        layout: { ...input.layout, statementPeriod: null },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<UnsupportedPdfFormatError>>({
        reason: "statement_period_missing",
      }),
    )
    expect(() =>
      applyPdfColumnSchema({
        ...input,
        schema: { ...input.schema, billedAmountRightEdge: -1 },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<UnsupportedPdfFormatError>>({
        reason: "no_billed_rows",
      }),
    )
  })
})
