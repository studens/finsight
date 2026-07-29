/**
 * pdfjs가 추출한 텍스트 아이템. 원본 값이므로 그대로 LLM에 보내면 안 된다.
 * width가 필수인 이유: 금액 컬럼은 오른쪽 정렬이라 컬럼 식별에 right-edge(x + width)를 쓴다.
 */
export type PdfTextItem = {
  text: string
  x: number
  y: number
  width: number
}

export type PdfPageText = {
  pageNumber: number
  items: PdfTextItem[]
}

export type PdfExtractedDocument = {
  pages: PdfPageText[]
}
