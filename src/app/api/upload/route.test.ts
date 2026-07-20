import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ColumnMapping,
  MaskedDataset,
  MaskedRow,
  ParsedCsv,
} from "../../../types/pipeline"

const { getSessionUser, inferColumnMapping, maskPii, parseCsv } = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  inferColumnMapping: vi.fn(),
  maskPii: vi.fn(),
  parseCsv: vi.fn(),
}))

vi.mock("../../../lib/supabase/server", () => ({ getSessionUser }))
vi.mock("../../../services/csv-parser", () => ({ parseCsv }))
vi.mock("../../../services/pii-masking", () => ({ maskPii }))
vi.mock("../../../services/llm/column-mapping", () => ({ inferColumnMapping }))

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

function uploadRequest(file?: File): Request {
  const formData = new FormData()
  if (file) formData.set("file", file)

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
  })
})
