import {
  PdfPasswordRequiredError,
  UnsupportedPdfFormatError,
} from "../services/pdf-parser"

export type PdfErrorPayload =
  | {
      status: 409
      body: {
        code: "PDF_PASSWORD_REQUIRED"
        reason: "missing" | "incorrect"
      }
    }
  | {
      status: 422
      body: {
        code: "UNSUPPORTED_PDF_FORMAT"
      }
    }

function errorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }
  return error.code
}

export function toPdfErrorPayload(
  error: unknown,
  hadPassword: boolean,
): PdfErrorPayload | null {
  if (
    error instanceof PdfPasswordRequiredError ||
    errorCode(error) === "PDF_PASSWORD_REQUIRED"
  ) {
    const passwordCase =
      typeof error === "object" && error !== null && "passwordCase" in error
        ? error.passwordCase
        : undefined
    const reason =
      passwordCase === "missing" || passwordCase === "incorrect"
        ? passwordCase
        : hadPassword
          ? "incorrect"
          : "missing"

    return {
      status: 409,
      body: { code: "PDF_PASSWORD_REQUIRED", reason },
    }
  }

  if (
    error instanceof UnsupportedPdfFormatError ||
    errorCode(error) === "UNSUPPORTED_PDF_FORMAT"
  ) {
    return {
      status: 422,
      body: { code: "UNSUPPORTED_PDF_FORMAT" },
    }
  }

  return null
}
