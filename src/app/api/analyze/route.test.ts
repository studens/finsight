import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ConfirmedMapping,
  FreeSummary,
  MaskedDataset,
  MaskedRow,
  ParsedCsv,
} from "../../../types/pipeline"

const {
  generateFreeSummary,
  generateReport,
  getSessionUser,
  insertAnalysis,
  maskPii,
  parseCsv,
} = vi.hoisted(() => ({
  generateFreeSummary: vi.fn(),
  generateReport: vi.fn(),
  getSessionUser: vi.fn(),
  insertAnalysis: vi.fn(),
  maskPii: vi.fn(),
  parseCsv: vi.fn(),
}))

vi.mock("../../../lib/supabase/server", () => ({ getSessionUser }))
vi.mock("../../../services/csv-parser", () => ({ parseCsv }))
vi.mock("../../../services/pii-masking", () => ({ maskPii }))
vi.mock("../../../services/llm/free-summary", () => ({ generateFreeSummary }))
vi.mock("../../../services/llm/reports", () => ({ generateReport }))
vi.mock("../../../services/supabase-admin", () => ({ insertAnalysis }))

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
} = {}): Request {
  const formData = new FormData()
  if (input.file) formData.set("file", input.file)
  if (input.mappingValue !== undefined) {
    formData.set("mapping", input.mappingValue)
  } else if (input.mapping !== undefined) {
    formData.set("mapping", JSON.stringify(input.mapping))
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

describe("POST /api/analyze", () => {
  beforeEach(() => {
    getSessionUser.mockReset().mockResolvedValue({ id: "session-user" })
    parseCsv.mockReset().mockReturnValue(parsed)
    maskPii.mockReset().mockReturnValue(masked)
    generateFreeSummary.mockReset().mockResolvedValue(freeSummary)
    insertAnalysis.mockReset().mockResolvedValue({ id: "analysis-1" })
    generateReport.mockReset()
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
    expect(maskPii).not.toHaveBeenCalled()
    expect(generateFreeSummary).not.toHaveBeenCalled()
    expect(insertAnalysis).not.toHaveBeenCalled()
  })
})
