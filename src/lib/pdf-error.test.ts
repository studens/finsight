import { describe, expect, it } from "vitest"

import {
  PdfPasswordRequiredError,
  UnsupportedPdfFormatError,
} from "../services/pdf-parser"
import { toPdfErrorPayload } from "./pdf-error"

describe("toPdfErrorPayload", () => {
  it("maps a missing PDF password", () => {
    expect(
      toPdfErrorPayload(new PdfPasswordRequiredError("missing"), false),
    ).toEqual({
      status: 409,
      body: { code: "PDF_PASSWORD_REQUIRED", reason: "missing" },
    })
  })

  it("maps an incorrect PDF password", () => {
    expect(
      toPdfErrorPayload(new PdfPasswordRequiredError("incorrect"), true),
    ).toEqual({
      status: 409,
      body: { code: "PDF_PASSWORD_REQUIRED", reason: "incorrect" },
    })
  })

  it.each([
    [undefined, false, "missing"],
    ["unexpected", true, "incorrect"],
  ] as const)(
    "falls back to request password presence for passwordCase %s",
    (passwordCase, hadPassword, reason) => {
      const error = new PdfPasswordRequiredError("missing")
      Object.defineProperty(error, "passwordCase", { value: passwordCase })

      expect(toPdfErrorPayload(error, hadPassword)).toEqual({
        status: 409,
        body: { code: "PDF_PASSWORD_REQUIRED", reason },
      })
    },
  )

  it("maps unsupported PDF errors without exposing their diagnostic reason", () => {
    const payload = toPdfErrorPayload(
      new UnsupportedPdfFormatError("pdf_open_failed"),
      false,
    )

    expect(payload).toEqual({
      status: 422,
      body: { code: "UNSUPPORTED_PDF_FORMAT" },
    })
    expect(JSON.stringify(payload)).not.toContain("pdf_open_failed")
  })

  it("returns null for unrelated errors", () => {
    expect(toPdfErrorPayload(new Error("boom"), false)).toBeNull()
  })
})
