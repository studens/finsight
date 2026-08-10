import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CheckoutSuccessBanner } from "./CheckoutSuccessBanner";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("CheckoutSuccessBanner", () => {
  it.each([
    [true, "아래 업로드 이력에서 분석을 열면 Premium 리포트를 확인할 수 있어요.", "border-[#05b169]"],
    [false, "구독 반영까지 몇 초 걸릴 수 있어요. Premium 리포트가 아직 잠겨 있다면 잠시 후 페이지를 새로고침해 주세요.", "border-[#5b8bff]"],
  ])("renders the checkout result for subscribed=%s", (isSubscribed, message, border) => {
    render(<CheckoutSuccessBanner isSubscribed={isSubscribed} />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("결제가 완료됐어요");
    expect(banner).toHaveTextContent(message);
    expect(banner).toHaveClass("rounded-[24px]", "bg-[#16181c]", "p-8", border);
  });

  it("removes the checkout query without adding history and remains visible", () => {
    window.history.replaceState(null, "", "/dashboard?checkout=success");
    const historyLength = window.history.length;

    render(<CheckoutSuccessBanner isSubscribed={false} />);

    expect(window.location.search).toBe("");
    expect(window.history.length).toBe(historyLength);
    expect(screen.getByTestId("checkout-success-banner")).toBeInTheDocument();
  });
});
