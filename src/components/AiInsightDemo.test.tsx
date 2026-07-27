import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiInsightDemo } from "./AiInsightDemo";

describe("AiInsightDemo", () => {
  it("renders masked raw CSV rows and defaults to the category insight tab", () => {
    render(<AiInsightDemo />);

    expect(screen.getByText("raw_statement.csv")).toBeInTheDocument();
    expect(screen.getAllByText(/\*{4}-\*{4}-\d{4}/).length).toBeGreaterThan(0);

    expect(screen.getByRole("button", { name: "카테고리 톱" })).toHaveClass("bg-[#0052ff]");
    expect(screen.getByText("780,000")).toBeInTheDocument();
  });

  it("switches insight content when another tab is clicked", () => {
    render(<AiInsightDemo />);

    fireEvent.click(screen.getByRole("button", { name: "구독 누수" }));

    expect(screen.getByRole("button", { name: "구독 누수" })).toHaveClass("bg-[#0052ff]");
    expect(screen.getByRole("button", { name: "카테고리 톱" })).not.toHaveClass("bg-[#0052ff]");
    expect(screen.getByText("24,800")).toBeInTheDocument();
  });

  it("never renders a full card/account number", () => {
    const { container } = render(<AiInsightDemo />);

    expect(container.textContent).not.toMatch(/\d{4}-\d{4}-\d{4}-\d{4}/);
  });
});
