import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ConfirmedMapping,
  FreeSummary,
  MaskedDataset,
  MaskedRow,
  ParsedCsv,
} from "../../../types/pipeline"
import type { PdfColumnSchema } from "../../../types/pdf"

const {
  determinePdfColumnSchema,
  generateAnalysisText,
  generateFreeSummary,
  generateReport,
  getSessionUser,
  insertAnalysis,
  maskPii,
  parseCsv,
  parsePdfStatementWithSchema,
} = vi.hoisted(() => ({
  determinePdfColumnSchema: vi.fn(),
  generateAnalysisText: vi.fn(),
  generateFreeSummary: vi.fn(),
  generateReport: vi.fn(),
  getSessionUser: vi.fn(),
  insertAnalysis: vi.fn(),
  maskPii: vi.fn(),
  parseCsv: vi.fn(),
  parsePdfStatementWithSchema: vi.fn(),
}))

vi.mock("../../../lib/supabase/server", () => ({ getSessionUser }))
vi.mock("../../../services/csv-parser", () => ({ parseCsv }))
vi.mock("../../../services/pii-masking", () => ({ maskPii }))
vi.mock("../../../services/llm/free-summary", () => ({ generateFreeSummary }))
vi.mock("../../../services/llm/provider", () => ({ generateAnalysisText }))
vi.mock("../../../services/llm/reports", () => ({ generateReport }))
vi.mock("../../../services/supabase-admin", () => ({ insertAnalysis }))
vi.mock("../../../services/pdf-parser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/pdf-parser")>()),
  determinePdfColumnSchema,
  parsePdfStatementWithSchema,
}))

import {
  PdfPasswordRequiredError,
  UnsupportedPdfFormatError,
} from "../../../services/pdf-parser"
import { POST } from "./route"

const mapping: ConfirmedMapping = {
  date: "이용일",
  merchant: "가맹점",
  amount: "금액",
  category: "카테고리",
}

const parsed: ParsedCsv = {
  headers: ["이용일", "가맹점", "금액", "카테고리", "연락수단X", "카드번호"],
  rows: [
    {
      이용일: "2026-07-01",
      가맹점: "커피숍",
      금액: "5000",
      카테고리: "식비",
      연락수단X: "010-1234-5678",
      카드번호: "1111-2222-3333-1234",
    },
  ],
  rowCount: 1,
}

const maskedRows = [
  {
    이용일: "2026-07-01",
    가맹점: "커피숍",
    금액: "5000",
    카테고리: "식비",
    연락수단X: "010-1234-5678",
    카드번호: "****-****-****-1234",
  },
] as unknown as MaskedRow[]

const masked: MaskedDataset = {
  headers: parsed.headers,
  rows: maskedRows,
  excludedColumns: [],
  maskedColumns: ["카드번호"],
}

const freeSummary: FreeSummary = {
  totalSpent: 5000,
  transactionCount: 1,
  categoryTotals: { 식비: 5000 },
  topMerchants: [{ merchant: "커피숍", amount: 5000 }],
}

function analyzeRequest(input: {
  file?: File
  mapping?: unknown
  mappingValue?: FormDataEntryValue
  password?: FormDataEntryValue
  pdfColumnSchema?: unknown
  pdfColumnSchemaValue?: FormDataEntryValue
} = {}): Request {
  const formData = new FormData()
  if (input.file) formData.set("file", input.file)
  if (input.mappingValue !== undefined) {
    formData.set("mapping", input.mappingValue)
  } else if (input.mapping !== undefined) {
    formData.set("mapping", JSON.stringify(input.mapping))
  }
  if (input.password !== undefined) formData.set("password", input.password)
  if (input.pdfColumnSchemaValue !== undefined) {
    formData.set("pdfColumnSchema", input.pdfColumnSchemaValue)
  } else if (input.pdfColumnSchema !== undefined) {
    formData.set("pdfColumnSchema", JSON.stringify(input.pdfColumnSchema))
  }

  return new Request("https://finsight.test/api/analyze", {
    method: "POST",
    body: formData,
  })
}

const csvFile = () =>
  new File(
    ["이용일,가맹점,금액,카테고리,연락수단X,카드번호\n2026-07-01,커피숍,5000,식비,010-1234-5678,1111-2222-3333-1234"],
    "transactions.csv",
    { type: "text/csv" },
  )

const pdfFile = (name = "statement.pdf", type = "application/pdf") =>
  new File(["%PDF-1.7\nmock"], name, { type })

const pdfMapping: ConfirmedMapping = {
  date: "이용일",
  merchant: "가맹점",
  amount: "청구금액",
  category: "구분",
}

const pdfSchema: PdfColumnSchema = {
  version: 1,
  issuer: "테스트카드",
  columns: [
    { rightEdge: 407, role: "billedAmount", headerLabel: "청구금액" },
  ],
  billedAmountRightEdge: 407,
  rightEdgeTolerance: 1.5,
  confidence: 0.99,
}

const pdfParsed: ParsedCsv = {
  headers: ["이용일", "가맹점", "청구금액", "구분"],
  rows: [
    {
      이용일: "2026-07-01",
      가맹점: "아파트관리비",
      청구금액: "246090",
      구분: "일시불",
    },
  ],
  rowCount: 1,
}

const pdfMasked: MaskedDataset = {
  headers: pdfParsed.headers,
  rows: pdfParsed.rows as MaskedRow[],
  excludedColumns: [],
  maskedColumns: [],
}

describe("POST /api/analyze", () => {
  beforeEach(() => {
    getSessionUser.mockReset().mockResolvedValue({ id: "session-user" })
    parseCsv.mockReset().mockReturnValue(parsed)
    maskPii.mockReset().mockReturnValue(masked)
    generateFreeSummary.mockReset().mockResolvedValue(freeSummary)
    insertAnalysis.mockReset().mockResolvedValue({ id: "analysis-1" })
    generateReport.mockReset()
    generateAnalysisText.mockReset()
    determinePdfColumnSchema.mockReset()
    parsePdfStatementWithSchema.mockReset().mockResolvedValue(pdfParsed)
  })

  it("generates and stores only a Free summary from allowlisted masked columns", async () => {
    const response = await POST(
      analyzeRequest({
        file: csvFile(),
        mapping,
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      analysisId: "analysis-1",
      freeSummary,
    })
    expect(parseCsv).toHaveBeenCalledWith(expect.any(Buffer))
    expect(maskPii).toHaveBeenCalledWith(parsed)

    const projectedRows = generateFreeSummary.mock.calls[0][0].rows
    expect(projectedRows).toEqual([
      {
        이용일: "2026-07-01",
        가맹점: "커피숍",
        금액: "5000",
        카테고리: "식비",
      },
    ])
    expect(projectedRows).not.toBe(maskedRows)
    expect(projectedRows[0]).not.toBe(maskedRows[0])
    expect(generateFreeSummary).toHaveBeenCalledWith({ rows: projectedRows, mapping })
    expect(insertAnalysis).toHaveBeenCalledWith({
      userId: "session-user",
      maskedTransactions: projectedRows,
      freeSummary,
    })
    expect(generateFreeSummary.mock.invocationCallOrder[0]).toBeLessThan(
      insertAnalysis.mock.invocationCallOrder[0],
    )
    expect(generateReport).not.toHaveBeenCalled()
  })

  it("returns immediately when there is no authenticated session", async () => {
    getSessionUser.mockResolvedValue(null)
    const request = analyzeRequest({ file: csvFile(), mapping })
    const formData = vi.spyOn(request, "formData")

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ code: "UNAUTHORIZED" })
    expect(formData).not.toHaveBeenCalled()
    expect(parseCsv).not.toHaveBeenCalled()
    expect(parsePdfStatementWithSchema).not.toHaveBeenCalled()
    expect(determinePdfColumnSchema).not.toHaveBeenCalled()
    expect(maskPii).not.toHaveBeenCalled()
    expect(generateFreeSummary).not.toHaveBeenCalled()
    expect(insertAnalysis).not.toHaveBeenCalled()
  })

  it.each([
    ["missing file", { mapping }],
    ["empty file", { file: new File([], "empty.csv"), mapping }],
    ["missing mapping", { file: csvFile() }],
    ["non-string mapping", { file: csvFile(), mappingValue: new File(["{}"], "mapping.json") }],
    ["invalid JSON", { file: csvFile(), mappingValue: "{" }],
    ["non-object mapping", { file: csvFile(), mapping: [] }],
    ["missing required field", { file: csvFile(), mapping: { ...mapping, amount: undefined } }],
    ["invalid category", { file: csvFile(), mapping: { ...mapping, category: 1 } }],
  ])("returns BAD_REQUEST for %s", async (_case, input) => {
    const response = await POST(analyzeRequest(input))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ code: "BAD_REQUEST" })
    expect(parseCsv).not.toHaveBeenCalled()
    expect(parsePdfStatementWithSchema).not.toHaveBeenCalled()
    expect(determinePdfColumnSchema).not.toHaveBeenCalled()
    expect(maskPii).not.toHaveBeenCalled()
    expect(generateFreeSummary).not.toHaveBeenCalled()
    expect(insertAnalysis).not.toHaveBeenCalled()
  })

  it("applies the returned PDF schema without performing LLM column redetermination", async () => {
    maskPii.mockReturnValue(pdfMasked)
    const response = await POST(analyzeRequest({
      file: pdfFile("statement.csv", "text/csv"),
      mapping: pdfMapping,
      pdfColumnSchema: pdfSchema,
      password: "s3cret-pw-1234",
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      analysisId: "analysis-1",
      freeSummary,
    })
    expect(parsePdfStatementWithSchema).toHaveBeenCalledWith({
      data: expect.any(Buffer),
      password: "s3cret-pw-1234",
      schema: pdfSchema,
    })
    expect(determinePdfColumnSchema).toHaveBeenCalledTimes(0)
    expect(generateAnalysisText).toHaveBeenCalledTimes(0)
    expect(parseCsv).not.toHaveBeenCalled()
    expect(maskPii).toHaveBeenCalledWith(pdfParsed)

    const projectedRows = generateFreeSummary.mock.calls[0][0].rows
    expect(projectedRows).toEqual(pdfParsed.rows)
    expect(insertAnalysis).toHaveBeenCalledWith({
      userId: "session-user",
      maskedTransactions: projectedRows,
      freeSummary,
    })
    expect(JSON.stringify(insertAnalysis.mock.calls[0][0])).not.toContain("s3cret-pw-1234")
    expect(JSON.stringify(insertAnalysis.mock.calls[0][0])).not.toContain("pdfColumnSchema")
    expect(generateFreeSummary.mock.invocationCallOrder[0]).toBeLessThan(
      insertAnalysis.mock.invocationCallOrder[0],
    )
  })

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("passes %s PDF password as undefined", async (_case, password) => {
    maskPii.mockReturnValue(pdfMasked)
    await POST(analyzeRequest({
      file: pdfFile(),
      mapping: pdfMapping,
      pdfColumnSchema: pdfSchema,
      password,
    }))

    expect(parsePdfStatementWithSchema).toHaveBeenCalledWith({
      data: expect.any(Buffer),
      password: undefined,
      schema: pdfSchema,
    })
  })

  it.each([
    ["missing", {}],
    ["empty", { pdfColumnSchemaValue: "" }],
    ["invalid JSON", { pdfColumnSchemaValue: "{" }],
    ["array", { pdfColumnSchemaValue: "[]" }],
    ["null", { pdfColumnSchemaValue: "null" }],
    ["non-string", { pdfColumnSchemaValue: new File(["{}"], "schema.json") }],
  ])("rejects a %s PDF schema before any processing", async (_case, schemaInput) => {
    const response = await POST(analyzeRequest({
      file: pdfFile(),
      mapping: pdfMapping,
      ...schemaInput,
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ code: "BAD_REQUEST", reason: "pdf_schema_missing" })
    expect(Object.keys(body).sort()).toEqual(["code", "reason"])
    expect(parsePdfStatementWithSchema).not.toHaveBeenCalled()
    expect(determinePdfColumnSchema).not.toHaveBeenCalled()
    expect(parseCsv).not.toHaveBeenCalled()
    expect(maskPii).not.toHaveBeenCalled()
    expect(generateFreeSummary).not.toHaveBeenCalled()
    expect(insertAnalysis).not.toHaveBeenCalled()
  })

  it("rejects a claimed PDF without magic bytes using the shared file classifier", async () => {
    const response = await POST(analyzeRequest({
      file: new File(["not-pdf"], "statement.pdf", { type: "application/pdf" }),
      mapping: pdfMapping,
      pdfColumnSchema: pdfSchema,
    }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toEqual({ code: "UNSUPPORTED_PDF_FORMAT" })
    expect(Object.keys(body)).toEqual(["code"])
    expect(parseCsv).not.toHaveBeenCalled()
    expect(parsePdfStatementWithSchema).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", undefined, "missing"],
    ["incorrect", "s3cret-pw-1234", "incorrect"],
  ])("maps a %s PDF password error to a JSON 409", async (_case, password, reason) => {
    const error = new PdfPasswordRequiredError(reason as "missing" | "incorrect")
    if (password) error.message = `bad password: ${password}`
    parsePdfStatementWithSchema.mockRejectedValue(error)

    const response = await POST(analyzeRequest({
      file: pdfFile(),
      mapping: pdfMapping,
      pdfColumnSchema: pdfSchema,
      password,
    }))
    const clonedBody = await response.clone().json()

    expect(response.status).toBe(409)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(clonedBody).toEqual({ code: "PDF_PASSWORD_REQUIRED", reason })
    expect(Object.keys(clonedBody).sort()).toEqual(["code", "reason"])
    expect(JSON.stringify(clonedBody)).not.toContain("s3cret-pw-1234")
    expect(insertAnalysis).not.toHaveBeenCalled()
  })

  it.each(["pdf_open_failed", "no_transaction_rows"])(
    "maps unsupported PDF reason %s to a code-only 422",
    async (reason) => {
      parsePdfStatementWithSchema.mockRejectedValue(
        new UnsupportedPdfFormatError(reason),
      )
      const response = await POST(analyzeRequest({
        file: pdfFile(),
        mapping: pdfMapping,
        pdfColumnSchema: pdfSchema,
        password: "s3cret-pw-1234",
      }))
      const body = await response.json()

      expect(response.status).toBe(422)
      expect(body).toEqual({ code: "UNSUPPORTED_PDF_FORMAT" })
      expect(Object.keys(body)).toEqual(["code"])
      expect(JSON.stringify(body)).not.toContain(reason)
      expect(JSON.stringify(body)).not.toContain("s3cret-pw-1234")
      expect(insertAnalysis).not.toHaveBeenCalled()
    },
  )

  it("rethrows unknown PDF failures", async () => {
    const failure = new Error("unknown")
    parsePdfStatementWithSchema.mockRejectedValue(failure)
    await expect(POST(analyzeRequest({
      file: pdfFile(),
      mapping: pdfMapping,
      pdfColumnSchema: pdfSchema,
    }))).rejects.toBe(failure)
  })

  it("never logs or exposes a PDF password across success and mapped failures", async () => {
    const password = "s3cret-pw-1234"
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ]

    try {
      maskPii.mockReturnValue(pdfMasked)
      const outcomes = [
        { result: pdfParsed },
        {
          error: Object.assign(
            new PdfPasswordRequiredError("incorrect"),
            { message: `bad password: ${password}` },
          ),
        },
        { error: new UnsupportedPdfFormatError("pdf_open_failed") },
      ]

      for (const outcome of outcomes) {
        parsePdfStatementWithSchema.mockReset()
        if ("error" in outcome) {
          parsePdfStatementWithSchema.mockRejectedValue(outcome.error)
        } else {
          parsePdfStatementWithSchema.mockResolvedValue(outcome.result)
        }

        const response = await POST(analyzeRequest({
          file: pdfFile(),
          mapping: pdfMapping,
          password,
          pdfColumnSchema: pdfSchema,
        }))
        expect(JSON.stringify(await response.json())).not.toContain(password)
      }

      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of consoleSpies) spy.mockRestore()
    }
  })

  it("ignores PDF-only fields on the CSV path", async () => {
    const response = await POST(analyzeRequest({
      file: csvFile(),
      mapping,
      password: "s3cret-pw-1234",
      pdfColumnSchema: pdfSchema,
    }))

    await expect(response.json()).resolves.toEqual({
      analysisId: "analysis-1",
      freeSummary,
    })
    expect(parseCsv).toHaveBeenCalled()
    expect(parsePdfStatementWithSchema).not.toHaveBeenCalled()
    expect(determinePdfColumnSchema).not.toHaveBeenCalled()
  })
})
