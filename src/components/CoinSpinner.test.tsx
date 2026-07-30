import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { CoinSpinner } from "./CoinSpinner";

describe("CoinSpinner", () => {
  it("announces the loading label to assistive tech", () => {
    render(<CoinSpinner label="파일을 확인하고 있어요..." />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("파일을 확인하고 있어요...");
  });

  it("renders a spinning won coin that screen readers ignore", () => {
    const { container } = render(<CoinSpinner label="파일을 확인하고 있어요..." />);

    const coin = container.querySelector("[aria-hidden='true']");
    expect(coin).toHaveTextContent("₩");
    expect(coin).toHaveClass("animate-coin-flip", "rounded-full");
  });

  it("uses the brand color rather than a decorative glow or gradient", () => {
    const { container } = render(<CoinSpinner label="로딩" />);

    const coin = container.querySelector("[aria-hidden='true']");
    expect(coin).toHaveClass("text-[#0052ff]");
    expect(container.innerHTML).not.toMatch(
      /blur|bg-clip-text|purple|indigo|violet|shadow-\[/,
    );
  });
});
