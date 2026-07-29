/** 비밀번호 미제공(PasswordException code 1) / 불일치(code 2)를 구분해 보존한다. 둘 다 HTTP 409. */
export type PdfPasswordCase = "missing" | "incorrect"

export class PdfPasswordRequiredError extends Error {
  readonly code = "PDF_PASSWORD_REQUIRED" as const
  readonly passwordCase: PdfPasswordCase

  constructor(passwordCase: PdfPasswordCase) {
    super("PDF password is required")
    this.name = "PdfPasswordRequiredError"
    this.passwordCase = passwordCase
  }
}

export class UnsupportedPdfFormatError extends Error {
  readonly code = "UNSUPPORTED_PDF_FORMAT" as const
  /** 진단용 짧은 라벨. 원본 텍스트·비밀번호·파일명을 담지 않는다. */
  readonly reason: string

  constructor(reason: string) {
    super("PDF format is unsupported")
    this.name = "UnsupportedPdfFormatError"
    this.reason = reason
  }
}
