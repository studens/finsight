import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PdfColumnSchemaRequest } from "./pdf-column-schema"

const generateAnalysisText = vi.fn()

vi.mock("./provider", () => ({ generateAnalysisText }))

const request: PdfColumnSchemaRequest = {
  sections: [{ sectionId: "domestic", kind: "domestic" }],
  headerLabels: [
    { text: "이용금액", rightEdge: 100 },
    { text: "이번달청구금액", rightEdge: 200 },
  ],
  numericColumns: [
    { rightEdge: 100, rowCount: 2, sampleValues: ["10,000"] },
    { rightEdge: 200, rowCount: 2, sampleValues: ["5,000"] },
  ],
  sampleRows: [
    {
      sectionId: "domestic",
      date: "07/01",
      merchant: "테스트상점",
      values: [
        { rightEdge: 100, text: "10,000" },
        { rightEdge: 200, text: "5,000" },
      ],
    },
  ],
}

describe("inferPdfColumnSchema", () => {
  beforeEach(() => {
    generateAnalysisText.mockReset()
  })

  it("parses and validates the mocked LLM JSON while adding code-owned fields", async () => {
    generateAnalysisText.mockResolvedValue({
      text: JSON.stringify({
        issuer: "테스트카드",
        columns: [
          { rightEdge: 100, role: "usageAmount", headerLabel: "이용금액" },
          {
            rightEdge: 200,
            role: "billedAmount",
            headerLabel: "이번달청구금액",
          },
        ],
        billedAmountRightEdge: 200,
        confidence: 0.9,
      }),
    })
    const { inferPdfColumnSchema } = await import("./pdf-column-schema")

    await expect(inferPdfColumnSchema(request)).resolves.toEqual({
      version: 1,
      issuer: "테스트카드",
      columns: [
        { rightEdge: 100, role: "usageAmount", headerLabel: "이용금액" },
        {
          rightEdge: 200,
          role: "billedAmount",
          headerLabel: "이번달청구금액",
        },
      ],
      billedAmountRightEdge: 200,
      rightEdgeTolerance: 1.5,
      confidence: 0.9,
    })
  })

  it("includes the required role, uncertainty, and billed-versus-usage instructions", async () => {
    generateAnalysisText.mockResolvedValue({
      text: JSON.stringify({
        issuer: null,
        columns: [
          { rightEdge: 100, role: "unknown", headerLabel: "이용금액" },
          {
            rightEdge: 200,
            role: "billedAmount",
            headerLabel: "이번달청구금액",
          },
        ],
        billedAmountRightEdge: 200,
        confidence: 0.6,
      }),
    })
    const { inferPdfColumnSchema } = await import("./pdf-column-schema")

    await inferPdfColumnSchema(request)

    const prompt = generateAnalysisText.mock.calls[0][0].prompt as string
    expect(prompt).toContain("각 numericColumns 항목의 rightEdge")
    expect(prompt).toContain("PdfColumnRole")
    expect(prompt).toContain("확신이 없으면")
    expect(prompt).toContain("billedAmount")
    expect(prompt).toMatch(/이용금액.*혼동하지 마라/)
    expect(prompt).toContain("설명·마크다운 없이 JSON 객체만")
  })

  it.each([
    ["not json"],
    [JSON.stringify({ issuer: null, columns: "invalid", confidence: 0.8 })],
    [
      JSON.stringify({
        issuer: null,
        columns: [
          { rightEdge: 200, role: "madeUp", headerLabel: null },
        ],
        billedAmountRightEdge: 200,
        confidence: 0.8,
      }),
    ],
  ])("throws TypeError for invalid LLM output", async (text) => {
    generateAnalysisText.mockResolvedValue({ text })
    const { inferPdfColumnSchema } = await import("./pdf-column-schema")

    await expect(inferPdfColumnSchema(request)).rejects.toBeInstanceOf(
      TypeError,
    )
  })
})
