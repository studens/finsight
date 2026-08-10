import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAnalysisById,
  getSessionUser,
  getSubscriptionStatus,
  listUserAnalyses,
  notFound,
} = vi.hoisted(() => ({
  getAnalysisById: vi.fn(),
  getSessionUser: vi.fn(),
  getSubscriptionStatus: vi.fn(),
  listUserAnalyses: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../lib/supabase/server", () => ({
  getAnalysisById,
  getSessionUser,
  getSubscriptionStatus,
  listUserAnalyses,
}));
vi.mock("./UploadFlow", () => ({
  UploadFlow: ({ isSubscribed }: { isSubscribed: boolean }) => (
    <div data-testid="upload-flow">{String(isSubscribed)}</div>
  ),
}));
vi.mock("./PremiumSection", () => ({
  PremiumSection: (props: { analysisId: string; isSubscribed: boolean }) => (
    <div data-analysis-id={props.analysisId} data-testid="premium-section">
      {String(props.isSubscribed)}
    </div>
  ),
}));

import DashboardPage from "../app/(app)/dashboard/page";
import AnalysisPage from "../app/(app)/dashboard/[analysisId]/page";

const summary = {
  totalSpent: 120000,
  transactionCount: 3,
  categoryTotals: { 식비: 120000 },
  topMerchants: [{ merchant: "식당", amount: 120000 }],
};

describe("dashboard server pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUser.mockResolvedValue({ id: "user-1" });
    getSubscriptionStatus.mockResolvedValue("active");
  });

  it("maps RLS history summaries and passes subscription state to UploadFlow", async () => {
    listUserAnalyses.mockResolvedValue([
      { id: "analysis-1", createdAt: "2026-07-20T03:00:00.000Z", freeSummary: summary },
    ]);

    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect(getSubscriptionStatus).toHaveBeenCalledWith("user-1");
    expect(screen.getByTestId("upload-flow")).toHaveTextContent("true");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/dashboard/analysis-1");
    expect(screen.getAllByText("120,000원")).not.toHaveLength(0);
    expect(screen.getByText("3건")).toBeInTheDocument();
    expect(screen.queryByTestId("checkout-success-banner")).not.toBeInTheDocument();
  });

  it("renders a checkout success banner only for the success query", async () => {
    listUserAnalyses.mockResolvedValue([]);
    getSubscriptionStatus.mockResolvedValueOnce("inactive");
    const { unmount } = render(
      await DashboardPage({ searchParams: Promise.resolve({ checkout: "success" }) }),
    );
    expect(screen.getByTestId("checkout-success-banner")).toHaveTextContent(
      "구독 반영까지 몇 초 걸릴 수 있어요.",
    );
    unmount();

    getSubscriptionStatus.mockResolvedValueOnce("active");
    const active = render(
      await DashboardPage({ searchParams: Promise.resolve({ checkout: "success" }) }),
    );
    expect(screen.getByTestId("checkout-success-banner")).toHaveTextContent(
      "아래 업로드 이력에서 분석을 열면 Premium 리포트를 확인할 수 있어요.",
    );
    active.unmount();

    render(
      await DashboardPage({ searchParams: Promise.resolve({ checkout: "cancelled" }) }),
    );
    expect(screen.queryByTestId("checkout-success-banner")).not.toBeInTheDocument();
  });

  it("renders saved Free data and consistent subscription state on detail", async () => {
    getAnalysisById.mockResolvedValue({ id: "analysis-1", free_summary: summary });

    render(await AnalysisPage({ params: Promise.resolve({ analysisId: "analysis-1" }) }));

    expect(getAnalysisById).toHaveBeenCalledWith("analysis-1");
    expect(screen.getAllByText("120,000원")).not.toHaveLength(0);
    expect(screen.getByTestId("premium-section")).toHaveAttribute(
      "data-analysis-id",
      "analysis-1",
    );
    expect(screen.getByTestId("premium-section")).toHaveTextContent("true");
  });

  it("uses notFound when RLS does not expose the requested analysis", async () => {
    getAnalysisById.mockResolvedValue(null);

    await expect(
      AnalysisPage({ params: Promise.resolve({ analysisId: "other-user-analysis" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
    expect(getSubscriptionStatus).not.toHaveBeenCalled();
  });
});
