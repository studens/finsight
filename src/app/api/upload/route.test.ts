import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ColumnMapping,
  MaskedDataset,
  MaskedRow,
  ParsedCsv,
} from "../../../types/pipeline"
import type { PdfColumnSchema } from "../../../types/pdf"

const {
  getSessionUser,
  inferColumnMapping,
  maskPii,
  parseCsv,
  parsePdfStatement,
} = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  inferColumnMapping: vi.fn(),
  maskPii: vi.fn(),
  parseCsv: vi.fn(),
  parsePdfStatement: vi.fn(),
}))

vi.mock("../../../lib/supabase/server", () => ({ getSessionUser }))
vi.mock("../../../services/csv-parser", () => ({ parseCsv }))
vi.mock("../../../services/pii-masking", () => ({ maskPii }))
vi.mock("../../../services/llm/column-mapping", () => ({ inferColumnMapping }))
vi.mock("../../../services/pdf-parser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/pdf-parser")>()),
  parsePdfStatement,
}))

import {
  PDF_COLUMN_MAPPING,
  PdfPasswordRequiredError,
  UnsupportedPdfFormatError,
} from "../../../services/pdf-parser"
import { POST } from "./route"

const parsed: ParsedCsv = {
  headers: ["이름", "이용일", "가맹점", "금액", "카드번호"],
  rows: [
    {
      이름: "홍길동",
      이용일: "2026-07-01",
      가맹점: "커피숍",
      금액: "5000",
      카드번호: "1111-2222-3333-1234",
    },
  ],
  rowCount: 1,
}

const maskedRows = Array.from({ length: 6 }, (_, index) => ({
  이용일: `2026-07-0${index + 1}`,
  가맹점: `가맹점-${index + 1}`,
  금액: `${(index + 1) * 1000}`,
  카드번호: "****-****-****-1234",
})) as unknown as MaskedRow[]

const masked: MaskedDataset = {
  headers: ["이용일", "가맹점", "금액", "카드번호"],
  rows: maskedRows,
  excludedColumns: ["이름"],
  maskedColumns: ["카드번호"],
}

const mapping: ColumnMapping = {
  date: "이용일",
  merchant: "가맹점",
  amount: "금액",
  category: null,
  confidence: 0.97,
}

const pdfParsed: ParsedCsv = {
  headers: ["이용일", "가맹점", "청구금액", "구분"],
  rows: Array.from({ length: 6 }, (_, index) => ({
    이용일: `2026-06-${String(index + 1).padStart(2, "0")}`,
    가맹점: `PDF 가맹점-${index + 1}`,
    청구금액: `${(index + 1) * 1000}`,
    구분: "일시불",
  })),
  rowCount: 6,
}

const pdfSchema: PdfColumnSchema = {
  version: 1,
  issuer: "테스트카드",
  columns: [
    { rightEdge: 445.5, role: "billedAmount", headerLabel: "청구금액" },
  ],
  billedAmountRightEdge: 445.5,
  rightEdgeTolerance: 1.5,
  confidence: 0.99,
}

const pdfMasked: MaskedDataset = {
  headers: pdfParsed.headers,
  rows: pdfParsed.rows as MaskedRow[],
  excludedColumns: [],
  maskedColumns: [],
}

function uploadRequest(file?: File, password?: FormDataEntryValue): Request {
  const formData = new FormData()
  if (file) formData.set("file", file)
  if (password !== undefined) formData.set("password", password)

  return new Request("https://finsight.test/api/upload", {
    method: "POST",
    body: formData,
  })
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    getSessionUser.mockReset().mockResolvedValue({ id: "user-1" })
    parseCsv.mockReset().mockReturnValue(parsed)
    maskPii.mockReset().mockReturnValue(masked)
    inferColumnMapping.mockReset().mockResolvedValue(mapping)
    parsePdfStatement.mockReset().mockResolvedValue({
      parsed: pdfParsed,
      pdfColumnSchema: pdfSchema,
    })
  })

  it("returns a column mapping and a masked five-row preview", async () => {
    const file = new File(["이름,이용일,가맹점,금액,카드번호\n홍길동,2026-07-01,커피숍,5000,1111-2222-3333-1234"], "transactions.csv", {
      type: "text/csv",
    })

    const response = await POST(uploadRequest(file))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      mapping,
      sample: {
        headers: masked.headers,
        rows: maskedRows.slice(0, 5),
        excludedColumns: masked.excludedColumns,
        maskedColumns: masked.maskedColumns,
      },
    })
    expect(mapping).toEqual({
      date: expect.any(String),
      merchant: expect.any(String),
      amount: expect.any(String),
      category: null,
      confidence: expect.any(Number),
    })
    expect(parseCsv).toHaveBeenCalledWith(expect.any(Buffer))
    expect(maskPii).toHaveBeenCalledWith(parsed)
    expect(inferColumnMapping).toHaveBeenCalledWith({
      headers: masked.headers,
      sampleRows: maskedRows.slice(0, 5),
    })
    expect(inferColumnMapping.mock.calls[0][0].sampleRows[0]).toBe(maskedRows[0])
    expect(inferColumnMapping.mock.calls[0][0].sampleRows).not.toBe(parsed.rows)
    expect(parsePdfStatement).not.toHaveBeenCalled()
  })

  it("returns immediately when there is no authenticated session", async () => {
    getSessionUser.mockResolvedValue(null)
    const request = uploadRequest(new File(["secret"], "transactions.csv"))
    const formData = vi.spyOn(request, "formData")

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ code: "UNAUTHORIZED" })
    expect(formData).not.toHaveBeenCalled()
    expect(parseCsv).not.toHaveBeenCalled()
    expect(maskPii).not.toHaveBeenCalled()
    expect(inferColumnMapping).not.toHaveBeenCalled()
    expect(parsePdfStatement).not.toHaveBeenCalled()
  })

  it.each([
    ["missing file", undefined],
    ["empty file", new File([], "empty.csv", { type: "text/csv" })],
  ])("returns BAD_REQUEST for a %s", async (_case, file) => {
    const response = await POST(uploadRequest(file))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ code: "BAD_REQUEST" })
    expect(parseCsv).not.toHaveBeenCalled()
    expect(maskPii).not.toHaveBeenCalled()
    expect(inferColumnMapping).not.toHaveBeenCalled()
    expect(parsePdfStatement).not.toHaveBeenCalled()
  })

  it.each([
    ["statement.csv", "text/csv"],
    ["statement.pdf", "application/pdf"],
  ])(
    "uses PDF magic bytes as the primary signal for %s",
    async (name, type) => {
      maskPii.mockReturnValue(pdfMasked)
      const file = new File(["%PDF-1.7\nmock"], name, { type })

      const response = await POST(uploadRequest(file))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        mapping: PDF_COLUMN_MAPPING,
        sample: {
          headers: pdfMasked.headers,
          rows: pdfMasked.rows.slice(0, 5),
          excludedColumns: [],
          maskedColumns: [],
        },
        pdfColumnSchema: pdfSchema,
      })
      expect(parseCsv).not.toHaveBeenCalled()
      expect(parsePdfStatement).toHaveBeenCalledWith({
        data: expect.any(Buffer),
        password: undefined,
      })
      expect(maskPii).toHaveBeenCalledWith(pdfParsed)
      expect(inferColumnMapping).not.toHaveBeenCalled()
    },
  )

  it("rejects a claimed PDF without PDF magic bytes before CSV parsing", async () => {
    const response = await POST(
      uploadRequest(
        new File(["not a pdf"], "statement.pdf", { type: "application/pdf" }),
      ),
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      code: "UNSUPPORTED_PDF_FORMAT",
    })
    expect(parseCsv).not.toHaveBeenCalled()
    expect(parsePdfStatement).not.toHaveBeenCalled()
  })

  it.each([
    ["provided", "s3cret-pw-1234", "s3cret-pw-1234"],
    ["missing", undefined, undefined],
    ["empty", "", undefined],
  ])(
    "passes a %s password to the PDF parser",
    async (_case, password, expected) => {
      maskPii.mockReturnValue(pdfMasked)

      await POST(
        uploadRequest(
          new File(["%PDF-1.7"], "statement.pdf", {
            type: "application/pdf",
          }),
          password,
        ),
      )

      expect(parsePdfStatement).toHaveBeenCalledWith({
        data: expect.any(Buffer),
        password: expected,
      })
    },
  )

  it("ignores password fields on the CSV path without changing its response", async () => {
    const response = await POST(
      uploadRequest(
        new File(["date,amount"], "transactions.csv", { type: "text/csv" }),
        "s3cret-pw-1234",
      ),
    )

    await expect(response.json()).resolves.toEqual({
      mapping,
      sample: {
        headers: masked.headers,
        rows: maskedRows.slice(0, 5),
        excludedColumns: masked.excludedColumns,
        maskedColumns: masked.maskedColumns,
      },
    })
    expect(parsePdfStatement).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", undefined],
    ["incorrect", "s3cret-pw-1234"],
  ] as const)(
    "returns a JSON 409 for a %s PDF password",
    async (passwordCase, password) => {
      const error = new PdfPasswordRequiredError(passwordCase)
      if (password) error.message = `malicious ${password}`
      parsePdfStatement.mockRejectedValue(error)

      const response = await POST(
        uploadRequest(
          new File(["%PDF-1.7"], "statement.pdf", {
            type: "application/pdf",
          }),
          password,
        ),
      )
      const body = await response.clone().json()

      expect(response.status).toBe(409)
      expect(response.headers.get("content-type")).toContain("application/json")
      expect(body).toEqual({
        code: "PDF_PASSWORD_REQUIRED",
        reason: passwordCase,
      })
      expect(Object.keys(body).sort()).toEqual(["code", "reason"])
      expect(JSON.stringify(body)).not.toContain(password ?? "never-present")
    },
  )

  it.each([
    [undefined, undefined, "missing"],
    ["unknown", "s3cret-pw-1234", "incorrect"],
  ] as const)(
    "falls back to password presence for passwordCase %s",
    async (passwordCase, password, reason) => {
      const error = new PdfPasswordRequiredError("missing")
      Object.defineProperty(error, "passwordCase", { value: passwordCase })
      parsePdfStatement.mockRejectedValue(error)

      const response = await POST(
        uploadRequest(
          new File(["%PDF-1.7"], "statement.pdf", {
            type: "application/pdf",
          }),
          password,
        ),
      )

      await expect(response.json()).resolves.toEqual({
        code: "PDF_PASSWORD_REQUIRED",
        reason,
      })
    },
  )

  it.each(["pdf_open_failed", "no_transaction_rows"])(
    "returns a minimal 422 for unsupported PDF reason %s",
    async (reason) => {
      parsePdfStatement.mockRejectedValue(new UnsupportedPdfFormatError(reason))

      const response = await POST(
        uploadRequest(
          new File(["%PDF-1.7"], "statement.pdf", {
            type: "application/pdf",
          }),
          "s3cret-pw-1234",
        ),
      )
      const body = await response.json()

      expect(response.status).toBe(422)
      expect(body).toEqual({ code: "UNSUPPORTED_PDF_FORMAT" })
      expect(Object.keys(body)).toEqual(["code"])
      expect(JSON.stringify(body)).not.toContain(reason)
      expect(JSON.stringify(body)).not.toContain("s3cret-pw-1234")
    },
  )

  it("rethrows unrelated PDF parser errors", async () => {
    const error = new Error("boom")
    parsePdfStatement.mockRejectedValue(error)

    await expect(
      POST(
        uploadRequest(
          new File(["%PDF-1.7"], "statement.pdf", {
            type: "application/pdf",
          }),
        ),
      ),
    ).rejects.toBe(error)
  })

  it.each([
    ["success", null],
    ["password error", new PdfPasswordRequiredError("incorrect")],
    ["unsupported error", new UnsupportedPdfFormatError("pdf_open_failed")],
  ])("never logs a PDF password on %s", async (_case, error) => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
    ]
    maskPii.mockReturnValue(pdfMasked)
    if (error) {
      error.message = "malicious s3cret-pw-1234"
      parsePdfStatement.mockRejectedValue(error)
    }

    const response = await POST(
      uploadRequest(
        new File(["%PDF-1.7"], "statement.pdf", {
          type: "application/pdf",
        }),
        "s3cret-pw-1234",
      ),
    )
    const body = await response.json()

    expect(JSON.stringify(body)).not.toContain("s3cret-pw-1234")
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
