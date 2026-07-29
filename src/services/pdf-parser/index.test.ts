import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  PdfColumnRole,
  PdfStatementLayout,
} from "../../types/pdf"
import { generateFreeSummary } from "../llm/free-summary"
import { maskPii } from "../pii-masking"
import { parsePdfColumnSchema } from "./column-schema"
import {
  PdfPasswordRequiredError,
  UnsupportedPdfFormatError,
} from "./errors"
import { extractPdfTextItems } from "./extract-text"
import { buildStatementLayout, RIGHT_EDGE_TOLERANCE } from "./layout"
import {
  NH_FIXTURE_PASSWORD,
  readPdfFixture,
} from "./__fixtures__/load-fixture"

const { generateAnalysisText } = vi.hoisted(() => ({
  generateAnalysisText: vi.fn(),
}))

vi.mock("../llm/provider", () => ({ generateAnalysisText }))

function mockedSchema(layout: PdfStatementLayout) {
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
    confidence: 0.99,
  }
}

async function nhLlmResponse() {
  const doc = await extractPdfTextItems({
    data: readPdfFixture("nh-statement-sample.pdf"),
    password: NH_FIXTURE_PASSWORD,
  })
  return { text: JSON.stringify(mockedSchema(buildStatementLayout(doc))) }
}

describe("PDF statement orchestrators", () => {
  beforeEach(() => {
    generateAnalysisText.mockReset()
  })

  it("parses once, reapplies a returned or JSON-round-tripped schema without another LLM call", async () => {
    generateAnalysisText.mockResolvedValue(await nhLlmResponse())
    const { parsePdfStatement, parsePdfStatementWithSchema } =
      await import("./index")
    const input = {
      data: readPdfFixture("nh-statement-sample.pdf"),
      password: NH_FIXTURE_PASSWORD,
    }
    const uploaded = await parsePdfStatement(input)

    expect(uploaded.parsed.rowCount).toBe(34)
    expect(generateAnalysisText).toHaveBeenCalledTimes(1)

    generateAnalysisText.mockClear()
    expect(
      await parsePdfStatementWithSchema({
        ...input,
        schema: uploaded.pdfColumnSchema,
      }),
    ).toEqual(uploaded.parsed)
    expect(generateAnalysisText).not.toHaveBeenCalled()

    const roundTripped = parsePdfColumnSchema(
      JSON.parse(JSON.stringify(uploaded.pdfColumnSchema)),
    )
    expect(
      await parsePdfStatementWithSchema({
        ...input,
        schema: roundTripped,
      }),
    ).toEqual(uploaded.parsed)
    expect(generateAnalysisText).not.toHaveBeenCalled()
  })

  it("feeds the existing masking and free-summary pipeline unchanged", async () => {
    generateAnalysisText.mockResolvedValue(await nhLlmResponse())
    const { parsePdfStatement } = await import("./index")
    const { parsed } = await parsePdfStatement({
      data: readPdfFixture("nh-statement-sample.pdf"),
      password: NH_FIXTURE_PASSWORD,
    })
    const masked = maskPii(parsed)

    expect(masked.excludedColumns).toEqual([])
    expect(masked.maskedColumns).toEqual([])
    expect(masked.headers).toEqual([
      "이용일",
      "가맹점",
      "청구금액",
      "구분",
    ])

    generateAnalysisText.mockClear()
    const summary = await generateFreeSummary({
      rows: masked.rows,
      mapping: {
        date: "이용일",
        merchant: "가맹점",
        amount: "청구금액",
        category: "구분",
      },
    })
    expect(summary.totalSpent).toBe(882_646)
    expect(summary.transactionCount).toBe(34)
    expect(generateAnalysisText).not.toHaveBeenCalled()
  })

  it("rejects a document with no transaction rows before calling the LLM", async () => {
    const { parsePdfStatement } = await import("./index")

    await expect(
      parsePdfStatement({
        data: readPdfFixture("no-transactions-sample.pdf"),
      }),
    ).rejects.toMatchObject({
      reason: "no_transaction_rows",
    } satisfies Partial<UnsupportedPdfFormatError>)
    expect(generateAnalysisText).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, "missing"],
    ["wrong-password", "incorrect"],
  ] as const)(
    "preserves the %s password failure without calling the LLM",
    async (password, passwordCase) => {
      const { parsePdfStatement } = await import("./index")

      await expect(
        parsePdfStatement({
          data: readPdfFixture("nh-statement-sample.pdf"),
          ...(password ? { password } : {}),
        }),
      ).rejects.toMatchObject({
        passwordCase,
      } satisfies Partial<PdfPasswordRequiredError>)
      expect(generateAnalysisText).not.toHaveBeenCalled()
    },
  )
})
