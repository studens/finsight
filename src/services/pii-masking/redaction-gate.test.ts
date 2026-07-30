import { describe, expect, expectTypeOf, it } from "vitest"

import { buildStatementLayout } from "../pdf-parser/layout"
import { extractPdfTextItems } from "../pdf-parser/extract-text"
import {
  NH_FIXTURE_PASSWORD,
  readPdfFixture,
} from "../pdf-parser/__fixtures__/load-fixture"
import {
  assertRedacted,
  findPiiPatterns,
  RedactionGateError,
  type RedactionFindingKind,
} from "./redaction-gate"

async function extractNhLayout() {
  const document = await extractPdfTextItems({
    data: readPdfFixture("nh-statement-sample.pdf"),
    password: NH_FIXTURE_PASSWORD,
  })

  return buildStatementLayout(document)
}

function expectBlocked(
  values: string[],
  expectedFindings: RedactionFindingKind[],
): RedactionGateError {
  try {
    assertRedacted(values)
  } catch (error) {
    expect(error).toBeInstanceOf(RedactionGateError)
    const gateError = error as RedactionGateError
    expect(gateError.findings).toEqual(
      expect.arrayContaining(expectedFindings),
    )
    return gateError
  }

  throw new Error("Expected the redaction gate to block the values")
}

describe("findPiiPatterns", () => {
  it.each([
    [
      "소계(M614)(홍길동)바른카드",
      ["subtotal_context", "korean_name"],
    ],
    ["123********99", ["masked_account"]],
    ["1234-5678-9012-3456", ["card_number"]],
    ["1234567890123456", ["card_number"]],
    ["1234 5678 9012 3456", ["card_number"]],
    ["주소04524 서울특별시 중구 세종대로 110", ["postal_address"]],
    ["010-1234-5678", ["phone_number"]],
    ["02-1234-5678", ["phone_number"]],
  ] satisfies [string, RedactionFindingKind[]][])(
    "finds PII kinds in %s",
    (value, findings) => {
      expect(findPiiPatterns(value)).toEqual(findings)
    },
  )

  it.each([
    "06/13테스트마트 강변점4,50053(할인)4,4470",
    "03/20테스트페이_강의140,252922(면제)6/423,375046,750",
    "04/15테스트전자스토어1,200,00012/3100,0000900,000",
    "02/28테스트폰코리아360,00012/530,0000210,000",
    "이용기간 : [일시불/할부] 2026.06.11 ~ 2026.07.10",
    "이용일가맹점이용금액할인금액할부회차이번달청구금액포인트할부잔여",
    "[해외이용]",
    "53(할인)",
    "922(면제)",
    // 오탐 금지 — 괄호 안 한글은 대부분 지점명/혜택명이다. allowlist 열거로는
    // 결코 완성될 수 없고, 하나라도 걸리면 정상 명세서 업로드 전체가 422로 막힌다.
    "06/13스타벅스(강남점)5,5000",
    "06/14올리브영(신촌점)12,3000",
    "06/15쿠팡(즉시할인)9,9000",
    "06/16카카오T(택시)7,2000",
    "06/17GS25(역삼1호점)3,1000",
    // 표 헤더의 '합계'는 소계/합계 행이 아니다(합성어의 일부).
    "이용금액합계",
    "청구금액합계",
    // 지점명에 든 '로'/'동'은 주소가 아니다. 앞의 5자리는 가맹점 코드일 수 있다.
    "06/18CU 12345 동일로점2,5000",
    "06/19테스트마트 12345 신사동점8,8000",
  ])("does not flag a safe statement value: %s", (value) => {
    expect(findPiiPatterns(value)).toEqual([])
  })

  it.each([
    // 실제 명세서의 소계/합계 행은 소계/합계로 시작한다.
    "소계(M614)(홍길동)바른카드866,64690277,200",
    "합계882,64690277,200",
    "합계 소계 합계",
  ])("still flags a real subtotal or total line: %s", (value) => {
    expect(findPiiPatterns(value)).toContain("subtotal_context")
  })

  it("flags a Korean personal name only in a name-bearing context", () => {
    // 소계 행의 괄호 한글은 실명이다 → 차단
    expect(findPiiPatterns("소계(M614)(홍길동)바른카드")).toContain(
      "korean_name",
    )
    expect(findPiiPatterns("예금주(홍길동)")).toContain("korean_name")
    // 가맹점명의 괄호 한글은 지점명이다 → 통과
    expect(findPiiPatterns("스타벅스(강남점)")).not.toContain("korean_name")
  })

  it("flags an address only with an administrative division token", () => {
    // 가명 주소 — 실제 명세서의 `경기도 ○○시 ...` 형태(도/시 토큰)를 재현한다.
    expect(findPiiPatterns("주소11111 경기도 예시시 예시대로 177")).toContain(
      "postal_address",
    )
    expect(findPiiPatterns("06/18CU 12345 동일로점2,5000")).not.toContain(
      "postal_address",
    )
  })

  it("deduplicates repeated findings", () => {
    expect(findPiiPatterns("합계 소계 합계")).toEqual([
      "subtotal_context",
    ])
  })
})

describe("assertRedacted", () => {
  it("has a void signature and throws a typed blocking error", () => {
    expectTypeOf(assertRedacted).returns.toEqualTypeOf<void>()
    expect(assertRedacted(["안전한 거래 조각"])).toBeUndefined()

    const error = expectBlocked(
      ["정상 값", "123********99"],
      ["masked_account"],
    )
    expect(error.code).toBe("REDACTION_GATE_BLOCKED")
  })

  it("allows every transaction line and item from the statement fixture", async () => {
    const layout = await extractNhLayout()
    const values = layout.transactionLines.flatMap((line) => [
      line.text,
      ...line.items.map((item) => item.text),
    ])

    expect(layout.transactionLines).toHaveLength(35)
    expect(() => assertRedacted(values)).not.toThrow()
  })

  it("blocks both subtotal lines without exposing their source values", async () => {
    const layout = await extractNhLayout()
    const subtotals = layout.excludedLines.filter(
      (line) => line.role === "subtotal",
    )

    expect(subtotals).toHaveLength(2)
    for (const line of subtotals) {
      const error = expectBlocked(
        [line.text],
        ["subtotal_context", "korean_name"],
      )
      expect(error.message).not.toContain("홍길동")
      expect(JSON.stringify(error.findings)).not.toContain("홍길동")
    }
  })

  it.each([
    ["성명", "korean_name"],
    ["주소", "postal_address"],
    ["연락처", "phone_number"],
    ["결제계좌", "masked_account"],
  ] satisfies [string, RedactionFindingKind][])(
    "blocks the page-one %s line without exposing its source value",
    async (keyword, expectedFinding) => {
      const layout = await extractNhLayout()
      const line = layout.excludedLines.find(
        (candidate) =>
          candidate.pageNumber === 1 &&
          candidate.text.includes(keyword),
      )

      expect(line).toBeDefined()
      const error = expectBlocked([line!.text], [expectedFinding])
      for (const sourceValue of [
        "홍길동",
        "123********99",
        "세종대로",
        "010-1234-5678",
      ]) {
        expect(error.message).not.toContain(sourceValue)
        expect(JSON.stringify(error.findings)).not.toContain(sourceValue)
      }
    },
  )
})
