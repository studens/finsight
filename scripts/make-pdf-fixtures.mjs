import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import PDFDocument from "pdfkit"

const PAGE_H = 841.89
const ROW_GAP = 12.76
const RIGHT = {
  used: 275.5,
  discount: 309.6,
  billed: 407,
  point: 445.5,
  remain: 558.5,
  currency: 460,
  foreignUsed: 480,
  exchangeRate: 500,
  foreignBilled: 520,
}
const DEFAULT_FONT =
  "/System/Library/Fonts/Supplemental/AppleGothic.ttf"
const fixtureFont = process.env.FIXTURE_FONT ?? DEFAULT_FONT
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = path.resolve(
  scriptDirectory,
  "../src/services/pdf-parser/__fixtures__",
)

const transactions = [
  ["06/12", "스타벅스 서면점", 5600, null, null, 5600, 0, null, true],
  ["06/12", "GS25 부산역점", 3200, null, null, 3200, 0, null, true],
  ["06/13", "테스트마트 강변점", 4500, "53(할인)", null, 4447, 0, null, false],
  ["06/14", "배달의민족", 18500, null, null, 18500, 0, null, true],
  ["06/15", "쿠팡", 32400, null, null, 32400, 0, null, true],
  ["06/15", "CU 초량점", 2900, null, null, 2900, 0, null, true],
  ["06/16", "넷플릭스", 17000, null, null, 17000, 0, null, true],
  ["06/17", "올리브영", 24300, null, null, 24300, 0, null, true],
  ["06/18", "다이소", 7800, null, null, 7800, 0, null, true],
  ["06/18", "카카오T", 11200, null, null, 11200, 0, null, true],
  ["06/19", "메가커피", 4500, null, null, 4500, 0, null, true],
  ["06/20", "롯데마트", 45900, null, null, 45900, 0, null, true],
  ["06/22", "유니클로", 39900, null, null, 39900, 0, null, true],
  ["06/23", "기본연회비-바른카드", 6000, null, null, 6000, 0, null, false],
  ["06/24", "아파트관리비", 246090, null, null, 246090, 0, null, false],
  ["06/26", "도미노피자", 27900, null, null, 27900, 0, null, false],
  ["06/27", "교보문고", 16200, null, null, 16200, 0, null, false],
  ["06/29", "CGV 서면", 14000, null, null, 14000, 0, null, false],
  ["07/02", "약국", 6700, null, null, 6700, 0, null, false],
  ["06/21", "세븐일레븐", 3500, null, null, 3500, 0, null, false],
  ["06/25", "파리바게뜨", 8900, null, null, 8900, 0, null, false],
  ["06/28", "지하철교통카드", 20000, null, null, 20000, 0, null, false],
  ["06/30", "세탁소", 3000, null, null, 3000, 0, null, false],
  ["07/01", "문구점", 4000, null, null, 4000, 0, null, false],
  ["07/02", "카페베네", 3915, null, null, 3915, 0, null, false],
  ["06/01", "포인트결제", null, null, null, -300, 0, null, false],
  ["06/05", "카드론상환", null, null, null, -1000, 0, null, false],
  ["03/20", "테스트페이_강의", 140252, "922(면제)", "6/4", 23375, 0, 46750, false],
  ["04/15", "테스트전자스토어", 1200000, null, "12/3", 100000, 0, 900000, false],
  ["05/02", "테스트항공", 600000, null, "6/2", 100000, 0, 400000, false],
  ["02/28", "테스트폰코리아", 360000, null, "12/5", 30000, 0, 210000, false],
  ["07/03", "WWW.ALIEXPRESS.COM", 36719, null, null, 36719, 0, null, false],
  ["06/18", "하이패스통행료", 8000, null, null, 8000, 0, null, false],
  ["06/28", "하이패스통행료", 8000, null, null, 8000, 0, null, false],
]

function format(value) {
  return typeof value === "number"
    ? value.toLocaleString("en-US")
    : String(value)
}

function textAt(doc, text, x, y) {
  doc.text(String(text), x, PAGE_H - y, { lineBreak: false })
}

function rightAt(doc, value, edge, y, topOffset = 0) {
  if (value === null || value === undefined) return
  const text = format(value)
  const top = PAGE_H - y + topOffset
  doc.text(text, edge - doc.widthOfString(text), top, { lineBreak: false })
}

function drawHeader(doc, y) {
  textAt(doc, "이용일", 36.3, y)
  textAt(doc, "가맹점", 60, y)
  rightAt(doc, "이용금액", RIGHT.used, y)
  rightAt(doc, "할인금액", RIGHT.discount, y)
  textAt(doc, "할부회차", 331.7, y)
  rightAt(doc, "이번달청구금액", RIGHT.billed, y)
  rightAt(doc, "포인트", RIGHT.point, y)
  rightAt(doc, "할부잔여", RIGHT.remain, y)
}

function drawTransaction(doc, transaction, index, y) {
  const [date, merchant, used, discount, installment, billed, point, remain, ySplit] =
    transaction
  const numericOffset = ySplit ? 0.07 : 0
  const billedEdges = new Map([
    [3, 407.4],
    [15, 406.6],
    [32, 407.3],
  ])

  textAt(doc, date, 36.3, y)
  textAt(doc, merchant, 60, y)
  rightAt(doc, used, RIGHT.used, y, numericOffset)
  rightAt(doc, discount, RIGHT.discount, y, numericOffset)
  if (installment) textAt(doc, installment, 331.7, y)
  rightAt(doc, billed, billedEdges.get(index) ?? RIGHT.billed, y, numericOffset)
  rightAt(doc, point, RIGHT.point, y, numericOffset)
  rightAt(doc, remain, RIGHT.remain, y, numericOffset)
}

function createDocument(options = {}) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    pdfVersion: "1.6",
    ...options,
  })
  doc.registerFont("ko", fixtureFont)
  doc.font("ko").fontSize(7.8)
  return doc
}

function writeDocument(fileName, build) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(fixtureDirectory, fileName)
    const doc = build()
    const output = fs.createWriteStream(outputPath)

    output.on("finish", resolve)
    output.on("error", reject)
    doc.on("error", reject)
    doc.pipe(output)
    doc.end()
  })
}

function buildNhStatement() {
  const doc = createDocument({
    userPassword: "000000",
    ownerPassword: "owner-secret-test",
  })
  let y = 780

  textAt(doc, "카드이용대금 명세서", 40, y)
  y -= ROW_GAP
  for (const [label, value] of [
    ["성명", "홍길동"],
    ["주소", "04524 서울특별시 중구 세종대로 110"],
    ["연락처", "010-1234-5678"],
    ["결제계좌", "123********99"],
    ["결제일", "2026.07.28"],
    ["청구금액", "882,646"],
  ]) {
    textAt(doc, label, 40, y)
    textAt(doc, value, 100, y)
    y -= ROW_GAP
  }

  doc.addPage()
  y = 771.28
  textAt(doc, "이용기간 : [일시불/할부] 2026.06.11 ~ 2026.07.10", 202.8, y)
  y -= ROW_GAP
  drawHeader(doc, y)
  y -= ROW_GAP
  transactions.forEach((transaction, index) => {
    drawTransaction(doc, transaction, index + 1, y)
    y -= ROW_GAP
  })

  for (const [label, billed, point, remain] of [
    ["소계(M614)(홍길동)바른카드", 866646, 90, 277200],
    ["소계(L069)(홍길동)뉴후불하이패스", 16000, 0, null],
    ["합계", 882646, 90, 277200],
  ]) {
    textAt(doc, label, 60, y)
    rightAt(doc, billed, RIGHT.billed, y, 0.07)
    rightAt(doc, point, RIGHT.point, y, 0.07)
    rightAt(doc, remain, RIGHT.remain, y, 0.07)
    y -= ROW_GAP
  }

  textAt(doc, "[해외이용]", 60, y)
  y -= ROW_GAP
  textAt(doc, "이용일", 36.3, y)
  textAt(doc, "가맹점", 60, y)
  rightAt(doc, "통화", RIGHT.currency, y)
  rightAt(doc, "이용금액", RIGHT.foreignUsed, y)
  rightAt(doc, "환율", RIGHT.exchangeRate, y)
  rightAt(doc, "원화청구금액", RIGHT.foreignBilled, y)
  y -= ROW_GAP
  textAt(doc, "07/03", 36.3, y)
  textAt(doc, "M614 WWW.ALIEXPRES 룩셈부르크", 60, y)
  rightAt(doc, "USD", RIGHT.currency, y)
  rightAt(doc, "23.39", RIGHT.foreignUsed, y)
  rightAt(doc, "1,554.60", RIGHT.exchangeRate, y)
  rightAt(doc, "36,719", RIGHT.foreignBilled, y)

  doc.addPage()
  textAt(doc, "NH테스트카드", 40, 780)
  textAt(doc, "고객센터 02-1234-5678", 100, 780)
  textAt(doc, "발행일 2026.07.15", 240, 780)
  textAt(doc, "www.example-card.test", 40, 767.24)
  textAt(doc, "본 명세서는 안내용입니다", 240, 767.24)
  textAt(doc, "3/3", 40, 754.48)

  return doc
}

function buildYearBoundary() {
  const doc = createDocument()
  let y = 771.28

  textAt(doc, "이용기간 : [일시불/할부] 2025.12.11 ~ 2026.01.10", 202.8, y)
  y -= ROW_GAP
  drawHeader(doc, y)
  y -= ROW_GAP
  for (const transaction of [
    ["12/15", "연말선물가게", 10000, null, null, 10000, 0, null, false],
    ["01/05", "신년마트", 20000, null, null, 20000, 0, null, false],
    ["11/20", "가전할부", 600000, null, "12/2", 50000, 0, 550000, false],
  ]) {
    drawTransaction(doc, transaction, 0, y)
    y -= ROW_GAP
  }
  textAt(doc, "합계", 60, y)
  rightAt(doc, 80000, RIGHT.billed, y)

  return doc
}

function buildNoTransactions() {
  const doc = createDocument()
  textAt(doc, "본 페이지는 안내문입니다", 40, 780)
  textAt(doc, "www.example-card.test", 40, 767.24)
  return doc
}

async function main() {
  if (!fs.existsSync(fixtureFont)) {
    throw new Error(
      `Fixture font not found: ${fixtureFont}. Set FIXTURE_FONT to an available Korean font file.`,
    )
  }

  fs.mkdirSync(fixtureDirectory, { recursive: true })
  await writeDocument("nh-statement-sample.pdf", buildNhStatement)
  await writeDocument("year-boundary-sample.pdf", buildYearBoundary)
  await writeDocument("no-transactions-sample.pdf", buildNoTransactions)
}

main().catch((error) => {
  process.stderr.write(`Failed to generate PDF fixtures: ${error.message}\n`)
  process.exitCode = 1
})
