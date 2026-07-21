import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MarketingPage from "../app/(marketing)/page";

describe("MarketingPage", () => {
  it("renders the hero, three-step flow, trust message, and login CTAs", () => {
    const { container } = render(<MarketingPage />);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("CSV 업로드")).toBeInTheDocument();
    expect(screen.getByText("컬럼 자동 매핑 확인")).toBeInTheDocument();
    expect(screen.getByText("인사이트 확인")).toBeInTheDocument();
    expect(container.querySelector(".grid-cols-3")).toBeInTheDocument();
    expect(screen.getByText(/원본 CSV는 저장하지 않아요/)).toBeInTheDocument();

    const ctas = screen.getAllByRole("link", { name: "무료로 시작하기" });
    expect(ctas).toHaveLength(2);
    ctas.forEach((cta) => expect(cta).toHaveAttribute("href", "/login"));
  });

  it("renders the exact Free and Premium feature boundaries", () => {
    render(<MarketingPage />);
    const freeCard = cardContaining("FREE");
    const premiumCard = cardContaining("PREMIUM");

    expect(within(freeCard).getByText("카테고리별 합계")).toBeInTheDocument();
    expect(within(freeCard).getByText("총 지출·거래 건수")).toBeInTheDocument();
    expect(within(freeCard).getByText("가맹점 Top 5")).toBeInTheDocument();

    expect(within(premiumCard).getByText("전월 대비 증감")).toBeInTheDocument();
    expect(
      within(premiumCard).getByText("이상 거래·중복구독 탐지"),
    ).toBeInTheDocument();
    expect(within(premiumCard).getByText("절약 제안")).toBeInTheDocument();
    expect(
      within(premiumCard).getByText("카테고리별 예산 추천"),
    ).toBeInTheDocument();
  });

  it("uses distinct card and badge radii", () => {
    render(<MarketingPage />);

    expect(cardContaining("PREMIUM")).toHaveClass("rounded-[24px]");
    expect(screen.getByText("PREMIUM")).toHaveClass("rounded-full");
  });
});

function cardContaining(label: "FREE" | "PREMIUM") {
  const card = screen.getByText(label).parentElement;

  if (!card) {
    throw new Error(`${label} card was not rendered`);
  }

  return card;
}
