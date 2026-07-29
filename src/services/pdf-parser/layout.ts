import type {
  PdfExtractedDocument,
  PdfLine,
  PdfLineRole,
  PdfRightEdgeCluster,
  PdfSectionKind,
  PdfStatementLayout,
  PdfTextItem,
} from "../../types/pdf"

export const Y_CLUSTER_TOLERANCE = 0.5
export const RIGHT_EDGE_TOLERANCE = 1.5

type LineCluster = {
  y: number
  items: PdfTextItem[]
}

type NumericCluster = {
  rightEdge: number
  itemCount: number
  rowIndexes: Set<number>
  sampleValues: string[]
}

const PERIOD_PATTERN =
  /(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/
const SECTION_PATTERN = /\[([^\]]+)\]/
const NUMERIC_ITEM_PATTERN = /^-?[\d,]+$/

function isWithinTolerance(
  difference: number,
  tolerance: number,
): boolean {
  return tolerance === 0 ? difference === 0 : difference < tolerance
}

function classifyLine(items: PdfTextItem[], text: string): PdfLineRole {
  if (text.includes("소계")) return "subtotal"
  if (text.includes("합계")) return "total"
  if (/^\d{2}\/\d{2}/.test(items[0]?.text.trim() ?? "")) {
    return "transaction"
  }
  if (text.includes("이용기간") || PERIOD_PATTERN.test(text)) return "period"
  if (/^\[[^\]]+\]/.test(text)) return "sectionHeader"
  if (
    items[0]?.text.trim() === "이용일" &&
    items.some((item) => item.text.trim() === "가맹점")
  ) {
    return "tableHeader"
  }
  return "other"
}

export function clusterItemsIntoLines(
  items: PdfTextItem[],
  pageNumber: number,
  yTolerance = Y_CLUSTER_TOLERANCE,
): PdfLine[] {
  const clusters: LineCluster[] = []

  for (const item of [...items].sort((left, right) => right.y - left.y)) {
    const cluster = clusters.find((candidate) =>
      isWithinTolerance(Math.abs(candidate.y - item.y), yTolerance),
    )

    if (cluster) {
      cluster.items.push(item)
      cluster.y =
        (cluster.y * (cluster.items.length - 1) + item.y) /
        cluster.items.length
    } else {
      clusters.push({ y: item.y, items: [item] })
    }
  }

  return clusters
    .map((cluster): PdfLine => {
      const sortedItems = [...cluster.items].sort(
        (left, right) => left.x - right.x,
      )
      const text = sortedItems.map((item) => item.text).join("")

      return {
        pageNumber,
        y: cluster.y,
        items: sortedItems,
        text,
        role: classifyLine(sortedItems, text),
        sectionId: null,
      }
    })
    .sort((left, right) => right.y - left.y)
}

function assignSections(
  lines: PdfLine[],
): PdfStatementLayout["sections"] {
  const sections: PdfStatementLayout["sections"] = []
  const kindCounts: Record<PdfSectionKind, number> = {
    domestic: 0,
    foreign: 0,
  }
  let currentSectionId: string | null = null

  for (const line of lines) {
    if (line.role === "sectionHeader" || line.role === "period") {
      const headerText = SECTION_PATTERN.exec(line.text)?.[1]

      if (headerText) {
        const kind: PdfSectionKind = headerText.includes("해외")
          ? "foreign"
          : "domestic"
        kindCounts[kind] += 1
        currentSectionId =
          kindCounts[kind] === 1 ? kind : `${kind}-${kindCounts[kind]}`
        sections.push({ sectionId: currentSectionId, kind, headerText })
      }
    }

    line.sectionId = currentSectionId
  }

  return sections
}

function parseStatementPeriod(
  lines: PdfLine[],
): PdfStatementLayout["statementPeriod"] {
  for (const line of lines) {
    if (line.role !== "period") continue
    const match = PERIOD_PATTERN.exec(line.text)
    if (!match) continue

    return {
      start: `${match[1]}-${match[2]}-${match[3]}`,
      end: `${match[4]}-${match[5]}-${match[6]}`,
    }
  }

  return null
}

function discoverNumericColumns(
  transactionLines: PdfLine[],
): PdfRightEdgeCluster[] {
  const clusters: NumericCluster[] = []

  transactionLines.forEach((line, rowIndex) => {
    for (const item of line.items) {
      const value = item.text.trim()
      if (!NUMERIC_ITEM_PATTERN.test(value)) continue

      const rightEdge = item.x + item.width
      const cluster = clusters.find(
        (candidate) =>
          Math.abs(candidate.rightEdge - rightEdge) <
          RIGHT_EDGE_TOLERANCE,
      )

      if (cluster) {
        cluster.itemCount += 1
        cluster.rightEdge =
          (cluster.rightEdge * (cluster.itemCount - 1) + rightEdge) /
          cluster.itemCount
        cluster.rowIndexes.add(rowIndex)
        if (cluster.sampleValues.length < 5) {
          cluster.sampleValues.push(value)
        }
      } else {
        clusters.push({
          rightEdge,
          itemCount: 1,
          rowIndexes: new Set([rowIndex]),
          sampleValues: [value],
        })
      }
    }
  })

  return clusters
    .map((cluster) => ({
      rightEdge: cluster.rightEdge,
      rowCount: cluster.rowIndexes.size,
      sampleValues: cluster.sampleValues,
    }))
    .sort((left, right) => left.rightEdge - right.rightEdge)
}

export function buildStatementLayout(
  doc: PdfExtractedDocument,
  options?: { yTolerance?: number },
): PdfStatementLayout {
  const lines = doc.pages.flatMap((page) =>
    clusterItemsIntoLines(
      page.items,
      page.pageNumber,
      options?.yTolerance ?? Y_CLUSTER_TOLERANCE,
    ),
  )
  if (options?.yTolerance === 0) {
    for (const line of lines) {
      if (
        line.role === "transaction" &&
        !line.items.some((item) =>
          NUMERIC_ITEM_PATTERN.test(item.text.trim()),
        )
      ) {
        line.role = "other"
      }
    }
  }
  const sections = assignSections(lines)
  const transactionLines = lines.filter(
    (line) => line.role === "transaction",
  )

  return {
    lines,
    transactionLines,
    excludedLines: lines.filter((line) => line.role !== "transaction"),
    sections,
    statementPeriod: parseStatementPeriod(lines),
    numericColumns: discoverNumericColumns(transactionLines),
    headerLabels: lines
      .filter((line) => line.role === "tableHeader")
      .flatMap((line) =>
        line.items.map((item) => ({
          text: item.text,
          rightEdge: item.x + item.width,
        })),
      ),
  }
}
