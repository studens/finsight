import { render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { HistoryList } from "./HistoryList";

describe("HistoryList", () => {
  it("shows the empty state", () => {
    render(<HistoryList analyses={[]} />);

    expect(
      screen.getByText("아직 업로드한 내역이 없어요 — CSV를 올려 시작해 보세요"),
    ).toBeInTheDocument();
  });

  it("links each dated analysis and formats its total with tabular numerals", () => {
    render(
      <HistoryList
        analyses={[
          {
            id: "analysis-1",
            createdAt: "2026-07-20T03:00:00.000Z",
            totalSpent: 1234567,
            transactionCount: 42,
          },
        ]}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/dashboard/analysis-1");
    expect(within(link).getByText("2026. 7. 20.")).toBeInTheDocument();
    expect(within(link).getByText("1,234,567원")).toHaveClass(
      "font-mono",
      "tabular-nums",
    );
    expect(within(link).getByText("42건")).toBeInTheDocument();
    expect(link).toHaveClass("rounded-2xl", "bg-[#0a0b0d]", "p-5");
  });
});
