import { beforeEach, describe, expect, it, vi } from "vitest"

import type { MaskedRow } from "../../types/pipeline"

const generateAnalysisText = vi.fn()

vi.mock("./provider", () => ({ generateAnalysisText }))

const maskedRows = [
  {
    이용일: "2026-07-01",
    가맹점: "커피숍",
    금액: "5,000",
    카드번호: "****-****-****-1234",
  },
] as unknown as MaskedRow[]

describe("inferColumnMapping", () => {
  beforeEach(() => {
    generateAnalysisText.mockReset()
  })

  it("parses the mapping JSON returned by the mocked AI SDK", async () => {
    generateAnalysisText.mockResolvedValue({
      text: JSON.stringify({
        date: "이용일",
        merchant: "가맹점",
        amount: "금액",
        category: null,
        confidence: 0.91,
      }),
    })
    const { inferColumnMapping } = await import("./column-mapping")

    await expect(
      inferColumnMapping({
        headers: ["이용일", "가맹점", "금액", "카드번호"],
        sampleRows: maskedRows,
      }),
    ).resolves.toEqual({
      date: "이용일",
      merchant: "가맹점",
      amount: "금액",
      category: null,
      confidence: 0.91,
    })
    expect(generateAnalysisText).toHaveBeenCalledOnce()
  })

  it("returns low confidence without throwing", async () => {
    generateAnalysisText.mockResolvedValue({
      text: JSON.stringify({
        date: null,
        merchant: "설명",
        amount: null,
        category: null,
        confidence: 0.2,
      }),
    })
    const { inferColumnMapping } = await import("./column-mapping")

    await expect(
      inferColumnMapping({ headers: ["설명"], sampleRows: [] }),
    ).resolves.toMatchObject({ confidence: 0.2 })
  })

  it("sends only the supplied headers and masked sample rows in the prompt", async () => {
    generateAnalysisText.mockResolvedValue({
      text: JSON.stringify({
        date: null,
        merchant: null,
        amount: null,
        category: null,
        confidence: 0,
      }),
    })
    const { inferColumnMapping } = await import("./column-mapping")

    const extraRows = Array.from({ length: 5 }, (_, index) => ({
      이용일: `2026-07-0${index + 2}`,
      가맹점: `가맹점-${index}`,
      금액: `${index + 1}000`,
      카드번호: "****-****-****-1234",
    })) as unknown as MaskedRow[]

    await inferColumnMapping({
      headers: ["이용일", "가맹점", "금액", "카드번호"],
      sampleRows: [...maskedRows, ...extraRows],
    })

    const request = generateAnalysisText.mock.calls[0][0]
    expect(request.prompt).toContain(JSON.stringify(["이용일", "가맹점", "금액", "카드번호"]))
    expect(request.prompt).toContain("가맹점-3")
    expect(request.prompt).not.toContain("가맹점-4")
    expect(request.prompt).toContain("확신이 없으면 낮은 confidence를 반환")
    expect(request.prompt).toContain("****-****-****-1234")
    expect(request.prompt).not.toContain("1111-2222-3333-1234")
  })
})
