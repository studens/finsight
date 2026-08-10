import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PremiumReport, ReportType } from "../types/pipeline";
import { PremiumSection } from "./PremiumSection";

const analysisId = "analysis-123";

const reports: Record<ReportType, PremiumReport> = {
  mom_comparison: {
    type: "mom_comparison",
    hasPrevious: true,
    total: { current: 120_000, previous: 100_000, change: 20_000, changeRate: 20 },
    categories: [
      {
        category: "식비",
        current: 70_000,
        previous: 50_000,
        change: 20_000,
        changeRate: 40,
      },
    ],
    commentary: "지난달보다 지출이 늘었어요.",
  },
  anomaly_detection: {
    type: "anomaly_detection",
    summary: "확인이 필요한 거래가 있어요.",
    anomalies: [{ transactionIndex: 2, reason: "중복 결제 가능성", severity: "high" }],
  },
  savings_suggestions: {
    type: "savings_suggestions",
    summary: "구독 지출을 줄일 수 있어요.",
    suggestions: [
      {
        title: "구독 정리",
        description: "사용하지 않는 구독을 확인하세요.",
        estimatedMonthlySavings: 12_000,
      },
    ],
  },
  budget_recommendation: {
    type: "budget_recommendation",
    summary: "카테고리 예산을 조정해 보세요.",
    categories: [
      {
        category: "식비",
        currentSpending: 300_000,
        recommendedBudget: 250_000,
        reason: "최근 평균보다 높아요.",
      },
    ],
  },
};

const titles = [
  "전월 대비 지출 변화",
  "이상 거래·중복구독 탐지",
  "절약 제안",
  "카테고리별 예산 추천",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PremiumSection", () => {
  it("renders four static locked CTA cards without premium data", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<PremiumSection analysisId={analysisId} isSubscribed={false} />);

    titles.forEach((title) => expect(screen.getByText(title)).toBeInTheDocument());
    expect(screen.getAllByText("PREMIUM")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Premium으로 보기" })).toHaveLength(4);
    expect(screen.getByText("전월 대비 지출 변화를 확인하세요")).toHaveClass(
      "text-[#a8acb3]",
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toMatch(/backdrop-(?:blur|filter)|backdrop-filter/);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("never requests a premium report from a locked card", async () => {
    vi.stubGlobal("location", { href: "" });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ url: "https://sandbox.polar.sh/checkout/abc" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PremiumSection analysisId={analysisId} isSubscribed={false} />);

    screen.getAllByRole("button", { name: "Premium으로 보기" }).forEach((button) => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.filter(([path]) => String(path).includes("/api/reports/")),
    ).toHaveLength(0);
  });

  it("starts checkout and redirects to the hosted checkout url", async () => {
    vi.stubGlobal("location", { href: "" });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ url: "https://sandbox.polar.sh/checkout/abc" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PremiumSection analysisId={analysisId} isSubscribed={false} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Premium으로 보기" })[0]);

    await waitFor(() =>
      expect(window.location.href).toBe("https://sandbox.polar.sh/checkout/abc"),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/checkout", { method: "POST" });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("blocks duplicate checkout clicks while one is in flight", () => {
    vi.stubGlobal("location", { href: "" });
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => { resolveResponse = resolve; }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PremiumSection analysisId={analysisId} isSubscribed={false} />);

    const buttons = screen.getAllByRole("button", { name: "Premium으로 보기" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("button", { name: "이동 중..." })).toHaveLength(4);
    screen.getAllByRole("button", { name: "이동 중..." }).forEach((button) => {
      expect(button).toBeDisabled();
    });
    void resolveResponse;
  });

  it("keeps the CTA disabled after a successful checkout response", async () => {
    vi.stubGlobal("location", { href: "" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ url: "https://sandbox.polar.sh/checkout/abc" })),
    );
    render(<PremiumSection analysisId={analysisId} isSubscribed={false} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Premium으로 보기" })[0]);

    await waitFor(() => expect(window.location.href).not.toBe(""));
    screen.getAllByRole("button", { name: "이동 중..." }).forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [409, "ALREADY_SUBSCRIBED"],
    [502, "CHECKOUT_FAILED"],
    [500, "INTERNAL_ERROR"],
  ])("shows the shared error modal when checkout fails with %s", async (status, code) => {
    vi.stubGlobal("location", { href: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code }, status)));
    render(<PremiumSection analysisId={analysisId} isSubscribed={false} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Premium으로 보기" })[0]);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("문제가 발생했어요. 잠시 후 다시 시도해 주세요.");
    expect(dialog).not.toHaveTextContent(code);
    expect(dialog).not.toHaveTextContent(String(status));
    expect(window.location.href).toBe("");
    expect(screen.getAllByRole("button", { name: "Premium으로 보기" })[0]).toBeEnabled();
  });

  it("shows the shared error modal when checkout rejects", async () => {
    vi.stubGlobal("location", { href: "" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));
    render(<PremiumSection analysisId={analysisId} isSubscribed={false} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Premium으로 보기" })[0]);

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect(window.location.href).toBe("");
    expect(screen.getAllByRole("button", { name: "Premium으로 보기" })[0]).toBeEnabled();
  });

  it("fetches each exact report path only when a subscribed card is clicked", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const reportType = input.split("/").at(-1) as ReportType;
      return jsonResponse({ reportType, data: reports[reportType] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PremiumSection analysisId={analysisId} isSubscribed />);

    for (const title of titles) {
      fireEvent.click(screen.getByRole("button", { name: `${title} 조회` }));
    }

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/reports/${analysisId}/mom_comparison`,
      `/api/reports/${analysisId}/anomaly_detection`,
      `/api/reports/${analysisId}/savings_suggestions`,
      `/api/reports/${analysisId}/budget_recommendation`,
    ]);
  });

  it("renders successful data for all four report types with semantic styles", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const reportType = input.split("/").at(-1) as ReportType;
      return jsonResponse({ reportType, data: reports[reportType] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PremiumSection analysisId={analysisId} isSubscribed />);

    titles.forEach((title) => {
      fireEvent.click(screen.getByRole("button", { name: `${title} 조회` }));
    });

    for (const content of [
      "지난달보다 지출이 늘었어요.",
      "중복 결제 가능성",
      "구독 정리",
      "최근 평균보다 높아요.",
    ]) {
      expect(await screen.findByText(content)).toBeInTheDocument();
    }

    const items = screen.getAllByRole("listitem");
    items.forEach((item) =>
      expect(item).toHaveClass("rounded-2xl", "bg-[#0a0b0d]", "p-5"),
    );
    expect(items.some((item) => item.classList.contains("border-[#cf202f]"))).toBe(true);
    expect(items.some((item) => item.classList.contains("border-[#05b169]"))).toBe(true);
    expect(items.some((item) => item.classList.contains("border-[#5b8bff]"))).toBe(true);
    expect(screen.getAllByText(/원|%/)[0]).toHaveClass("font-mono", "tabular-nums");
  });

  it.each([
    [403, "PAYWALL_REQUIRED", "이 리포트는 Premium 구독에서 확인할 수 있어요."],
    [404, "NOT_FOUND", "요청하신 분석을 찾을 수 없어요. 다시 시도해 주세요."],
    [502, "GENERATION_FAILED", "리포트를 생성하지 못했어요. 잠시 후 다시 시도해 주세요."],
  ])("shows a shared gentle modal for %s without navigating", async (status, code, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code }, status)));
    const historyLength = window.history.length;
    render(<PremiumSection analysisId={analysisId} isSubscribed />);

    fireEvent.click(screen.getByRole("button", { name: "전월 대비 지출 변화 조회" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(message);
    expect(dialog).not.toHaveTextContent(code);
    expect(dialog).not.toHaveTextContent(String(status));
    expect(window.history.length).toBe(historyLength);
    expect(screen.getByText("전월 대비 지출 변화")).toBeInTheDocument();
  });

  it("distinguishes card, list item, badge, and button radii", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ reportType: "anomaly_detection", data: reports.anomaly_detection }),
      ),
    );
    render(<PremiumSection analysisId={analysisId} isSubscribed />);

    const card = screen.getByTestId("premium-card-anomaly_detection");
    expect(card).toHaveClass("rounded-[24px]", "bg-[#16181c]", "p-8");
    expect(within(card).getByText("PREMIUM")).toHaveClass("rounded-full");
    expect(within(card).getByRole("button")).toHaveClass("rounded-full");

    fireEvent.click(within(card).getByRole("button"));
    expect(await within(card).findByRole("listitem")).toHaveClass("rounded-2xl");
  });
});
