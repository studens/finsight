import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  PdfColumnRole,
  PdfStatementLayout,
} from "../../types/pdf"
import { extractPdfTextItems } from "./extract-text"
import { buildStatementLayout } from "./layout"
import { UnsupportedPdfFormatError } from "./errors"
import {
  NH_FIXTURE_PASSWORD,
  readPdfFixture,
} from "./__fixtures__/load-fixture"

const generateAnalysisText = vi.fn()

vi.mock("../llm/provider", () => ({ generateAnalysisText }))

async function fixtureLayout(): Promise<PdfStatementLayout> {
  const doc = await extractPdfTextItems({
    data: readPdfFixture("nh-statement-sample.pdf"),
    password: NH_FIXTURE_PASSWORD,
  })
  return buildStatementLayout(doc)
}

function mockedSchema(
  layout: PdfStatementLayout,
  options?: {
    billedCount?: number
    confidence?: number
  },
) {
  const billedColumn = layout.numericColumns.find(
    (column) => column.rowCount === 34,
  )
  if (!billedColumn) throw new Error("fixture billed column missing")
  const billedCount = options?.billedCount ?? 1

  return {
    issuer: "NH농협카드",
    columns: layout.numericColumns.map((column, index) => ({
      rightEdge: column.rightEdge,
      role: (
        billedCount === 1 && column === billedColumn
            ? "billedAmount"
            : billedCount > 1 && index < billedCount
              ? "billedAmount"
              : "unknown"
      ) as PdfColumnRole,
      headerLabel:
        column === billedColumn ? "이번달청구금액" : null,
    })),
    billedAmountRightEdge: billedColumn.rightEdge,
    confidence: options?.confidence ?? 0.9,
  }
}

async function expectUnsupported(
  promise: Promise<unknown>,
  reason: string,
) {
  try {
    await promise
    throw new Error("Expected UnsupportedPdfFormatError")
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedPdfFormatError)
    expect((error as UnsupportedPdfFormatError).reason).toBe(reason)
  }
}

describe("buildColumnSchemaExcerpt", () => {
  it("builds a bounded, PII-free header and transaction sample", async () => {
    const { buildColumnSchemaExcerpt } = await import("./column-schema")
    const excerpt = buildColumnSchemaExcerpt(await fixtureLayout())
    const serialized = JSON.stringify(excerpt)

    for (const forbidden of [
      "홍길동",
      "123********99",
      "세종대로",
      "010-1234-5678",
      "소계",
      "합계",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(excerpt.sampleRows.length).toBeLessThanOrEqual(8)
    expect(excerpt.sampleRows.length).toBeLessThan(34)
    expect(
      excerpt.numericColumns.some((column) => column.rowCount === 34),
    ).toBe(true)
    expect(excerpt.headerLabels).toContainEqual(
      expect.objectContaining({ text: "이번달청구금액" }),
    )
    expect(excerpt.sampleRows[0]).toMatchObject({
      date: expect.any(String),
      merchant: expect.any(String),
      values: expect.any(Array),
    })
    expect(excerpt.sampleRows[0].date).not.toBe("")
    expect(excerpt.sampleRows[0].merchant).not.toBe("")
    expect(excerpt.sampleRows[0].values.length).toBeGreaterThan(0)
  })
})

describe("determinePdfColumnSchema", () => {
  beforeEach(() => {
    generateAnalysisText.mockReset()
  })

  it("returns the golden billed column and survives a JSON round trip", async () => {
    const layout = await fixtureLayout()
    generateAnalysisText.mockResolvedValue({
      text: JSON.stringify(mockedSchema(layout)),
    })
    const {
      determinePdfColumnSchema,
      parsePdfColumnSchema,
    } = await import("./column-schema")

    const schema = await determinePdfColumnSchema(layout)

    expect(schema.version).toBe(1)
    expect(Math.abs(schema.billedAmountRightEdge - 407)).toBeLessThanOrEqual(
      1.5,
    )
    expect(
      schema.columns.filter((column) => column.role === "billedAmount"),
    ).toHaveLength(1)
    expect(schema.confidence).toBeGreaterThanOrEqual(0.5)
    expect(
      parsePdfColumnSchema(JSON.parse(JSON.stringify(schema))),
    ).toEqual(schema)
  })

  it("blocks redaction findings before any LLM call without leaking findings", async () => {
    const layout = await fixtureLayout()
    layout.headerLabels.push({ text: "소계 홍길동", rightEdge: 1 })
    const { determinePdfColumnSchema } = await import("./column-schema")

    await expectUnsupported(
      determinePdfColumnSchema(layout),
      "redaction_gate_blocked",
    )
    expect(generateAnalysisText).not.toHaveBeenCalled()
  })

  it("rejects an empty numeric-column layout before any LLM call", async () => {
    const layout = await fixtureLayout()
    layout.numericColumns = []
    const { determinePdfColumnSchema } = await import("./column-schema")

    await expectUnsupported(
      determinePdfColumnSchema(layout),
      "no_numeric_columns",
    )
    expect(generateAnalysisText).not.toHaveBeenCalled()
  })

  it("maps invalid JSON to column_schema_invalid", async () => {
    generateAnalysisText.mockResolvedValue({ text: "not json" })
    const { determinePdfColumnSchema } = await import("./column-schema")

    await expectUnsupported(
      determinePdfColumnSchema(await fixtureLayout()),
      "column_schema_invalid",
    )
  })

  it.each([0, 2])(
    "rejects %i billedAmount columns",
    async (billedCount) => {
      const layout = await fixtureLayout()
      generateAnalysisText.mockResolvedValue({
        text: JSON.stringify(mockedSchema(layout, { billedCount })),
      })
      const { determinePdfColumnSchema } = await import("./column-schema")

      await expectUnsupported(
        determinePdfColumnSchema(layout),
        "billed_column_not_identified",
      )
    },
  )

  it("rejects low confidence", async () => {
    const layout = await fixtureLayout()
    generateAnalysisText.mockResolvedValue({
      text: JSON.stringify(mockedSchema(layout, { confidence: 0.3 })),
    })
    const { determinePdfColumnSchema } = await import("./column-schema")

    await expectUnsupported(
      determinePdfColumnSchema(layout),
      "column_schema_low_confidence",
    )
  })

  it("propagates provider errors unchanged", async () => {
    const networkError = new Error("network")
    generateAnalysisText.mockRejectedValue(networkError)
    const { determinePdfColumnSchema } = await import("./column-schema")

    await expect(
      determinePdfColumnSchema(await fixtureLayout()),
    ).rejects.toBe(networkError)
  })
})

describe("parsePdfColumnSchema", () => {
  const valid = {
    version: 1,
    issuer: null,
    columns: [
      { rightEdge: 200, role: "billedAmount", headerLabel: null },
    ],
    billedAmountRightEdge: 200,
    rightEdgeTolerance: 1.5,
    confidence: 0.8,
  }

  it.each([
    null,
    { ...valid, version: 2 },
    { ...valid, columns: {} },
    {
      ...valid,
      columns: [{ rightEdge: 200, role: "invalid", headerLabel: null }],
    },
    { ...valid, columns: [] },
    { ...valid, billedAmountRightEdge: 201 },
    { ...valid, confidence: 1.5 },
    { ...valid, rightEdgeTolerance: 0 },
  ])("rejects untrusted invalid input", async (input) => {
    const { parsePdfColumnSchema } = await import("./column-schema")
    expect(() => parsePdfColumnSchema(input)).toThrow(TypeError)
  })

  it("copies only whitelisted fields without prototype pollution", async () => {
    const { parsePdfColumnSchema } = await import("./column-schema")
    const input = JSON.parse(
      `{"version":1,"issuer":null,"columns":[{"rightEdge":200,"role":"billedAmount","headerLabel":null}],"billedAmountRightEdge":200,"rightEdgeTolerance":1.5,"confidence":0.8,"__proto__":{"polluted":true}}`,
    )

    const parsed = parsePdfColumnSchema(input)

    expect(parsed).toEqual(valid)
    expect("polluted" in parsed).toBe(false)
    expect(Object.keys(parsed)).toEqual([
      "version",
      "issuer",
      "columns",
      "billedAmountRightEdge",
      "rightEdgeTolerance",
      "confidence",
    ])
  })
})
