import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FreeSummary } from "../types/pipeline";
import { FreeSummaryCards } from "./FreeSummaryCards";

const summary: FreeSummary = {
  totalSpent: 1_234_567,
  transactionCount: 42,
  categoryTotals: {
    카페: 45_000,
    식비: 320_000,
    교통: 87_500,
  },
  topMerchants: [
    { merchant: "스타벅스", amount: 45_000 },
    { merchant: "한빛마트", amount: 38_900 },
    { merchant: "서울교통", amount: 24_000 },
  ],
};

describe("FreeSummaryCards", () => {
  it("renders the summary, every category, and every top merchant", () => {
    render(<FreeSummaryCards summary={summary} />);

    expect(screen.getByText("총 지출")).toBeInTheDocument();
    expect(screen.getByText("거래 건수")).toBeInTheDocument();
    expect(screen.getByText("1,234,567원")).toBeInTheDocument();
    expect(screen.getByText("42건")).toBeInTheDocument();

    Object.keys(summary.categoryTotals).forEach((category) => {
      expect(screen.getByText(category)).toBeInTheDocument();
    });
    summary.topMerchants.forEach(({ merchant }) => {
      expect(screen.getByText(merchant)).toBeInTheDocument();
    });
  });

  it("uses monospaced tabular numerals and formats every amount", () => {
    render(<FreeSummaryCards summary={summary} />);

    ["1,234,567원", "42건", "320,000원", "45,000원", "38,900원"].forEach(
      (value) => {
        expect(screen.getAllByText(value)[0]).toHaveClass(
          "font-mono",
          "tabular-nums",
        );
      },
    );
  });

  it("sorts category totals by amount in descending order", () => {
    render(<FreeSummaryCards summary={summary} />);

    const list = screen.getByRole("list", { name: "카테고리별 합계" });
    const items = within(list).getAllByRole("listitem");

    expect(items.map((item) => item.textContent)).toEqual([
      "식비320,000원",
      "교통87,500원",
      "카페45,000원",
    ]);
  });

  it("distinguishes card and nested list-item radii", () => {
    render(<FreeSummaryCards summary={summary} />);

    expect(screen.getByTestId("category-card")).toHaveClass("rounded-[24px]");
    within(screen.getByRole("list", { name: "카테고리별 합계" }))
      .getAllByRole("listitem")
      .forEach((item) => expect(item).toHaveClass("rounded-2xl"));
  });
});
