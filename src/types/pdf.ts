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

export type PdfLineRole =
  | "transaction"
  | "subtotal"
  | "total"
  | "tableHeader"
  | "sectionHeader"
  | "period"
  | "other"

export type PdfSectionKind = "domestic" | "foreign"

export type PdfLine = {
  pageNumber: number
  /** Cluster mean y coordinate. */
  y: number
  /** Items sorted by ascending x coordinate. */
  items: PdfTextItem[]
  /** Concatenated text for line-role keyword checks, never column parsing. */
  text: string
  role: PdfLineRole
  sectionId: string | null
}

export type PdfRightEdgeCluster = {
  rightEdge: number
  rowCount: number
  sampleValues: string[]
}

export type PdfStatementLayout = {
  lines: PdfLine[]
  transactionLines: PdfLine[]
  excludedLines: PdfLine[]
  sections: {
    sectionId: string
    kind: PdfSectionKind
    headerText: string
  }[]
  statementPeriod: { start: string; end: string } | null
  numericColumns: PdfRightEdgeCluster[]
  headerLabels: { text: string; rightEdge: number }[]
}

export type PdfColumnRole =
  | "usageAmount"
  | "discount"
  | "billedAmount"
  | "points"
  | "remainingBalance"
  | "foreignBilledAmount"
  | "unknown"

export type PdfColumnAssignment = {
  /** step 1이 발견한 클러스터의 right-edge */
  rightEdge: number
  role: PdfColumnRole
  /** 판정 근거가 된 표 헤더 라벨. 없으면 null. PII 아님 */
  headerLabel: string | null
}

export type PdfColumnSchema = {
  version: 1
  /** 추정 카드사 라벨. 확신 없으면 null */
  issuer: string | null
  columns: PdfColumnAssignment[]
  /** role === "billedAmount" 인 컬럼의 rightEdge. 적용 시 이 컬럼만 계상한다 */
  billedAmountRightEdge: number
  /** 적용 시 right-edge 허용오차 */
  rightEdgeTolerance: number
  /** 0~1 */
  confidence: number
}
