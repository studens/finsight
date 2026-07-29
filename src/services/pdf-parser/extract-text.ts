import type {
  PdfExtractedDocument,
  PdfTextItem,
} from "../../types/pdf"
import {
  PdfPasswordRequiredError,
  UnsupportedPdfFormatError,
} from "./errors"

type PdfJsError = {
  name?: unknown
  code?: unknown
}

function isPasswordException(error: unknown): error is PdfJsError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "PasswordException"
  )
}

function passwordCase(
  error: PdfJsError,
  suppliedPassword: string | undefined,
): "missing" | "incorrect" {
  if (error.code === 1) return "missing"
  if (error.code === 2) return "incorrect"
  return suppliedPassword ? "incorrect" : "missing"
}

export function isPdfBuffer(input: Buffer | Uint8Array): boolean {
  const magicBytes = [0x25, 0x50, 0x44, 0x46, 0x2d]

  return (
    input.byteLength >= magicBytes.length &&
    magicBytes.every((byte, index) => input[index] === byte)
  )
}

export async function extractPdfTextItems(input: {
  data: Buffer | Uint8Array
  password?: string
}): Promise<PdfExtractedDocument> {
  let document:
    | Awaited<
        ReturnType<
          typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]
        >["promise"]
      >
    | undefined

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(input.data),
      ...(input.password ? { password: input.password } : {}),
      isEvalSupported: false,
      useSystemFonts: false,
    })
    document = await loadingTask.promise
    const pages = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items: PdfTextItem[] = content.items.flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return []

        return [
          {
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
          },
        ]
      })

      pages.push({ pageNumber, items })
    }

    return { pages }
  } catch (error) {
    if (isPasswordException(error)) {
      throw new PdfPasswordRequiredError(
        passwordCase(error, input.password),
      )
    }

    throw new UnsupportedPdfFormatError("pdf_open_failed")
  } finally {
    await document?.destroy()
  }
}
