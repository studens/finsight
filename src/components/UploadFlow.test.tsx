import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UploadFlow } from "./UploadFlow";

const mapping = {
  date: "거래일시",
  merchant: "가맹점명",
  amount: "이용금액",
  category: "업종",
  confidence: 0.65,
};
const sample = {
  headers: ["거래일시", "가맹점명", "이용금액", "업종", "카드번호"],
  rows: [
    {
      거래일시: "2026-06-01",
      가맹점명: "스타벅스",
      이용금액: "5500",
      업종: "카페",
      카드번호: "************3456",
    },
  ],
  excludedColumns: ["이름", "전화번호"],
  maskedColumns: ["카드번호"],
};
const freeSummary = {
  totalSpent: 1_250_000,
  transactionCount: 84,
  categoryTotals: { 카페: 45_000 },
  topMerchants: [{ merchant: "스타벅스", amount: 45_000 }],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("UploadFlow", () => {
  it("uploads a selected CSV and renders the masked mapping confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ mapping, sample }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    const file = new File(["raw-card-number"], "transactions.csv", { type: "text/csv" });

    fireEvent.change(screen.getByLabelText("CSV 파일 선택"), { target: { files: [file] } });

    await screen.findByRole("heading", { name: "컬럼 매핑 확인" });
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/upload");
    expect(options.method).toBe("POST");
    expect((options.body as FormData).get("file")).toBe(file);
    expect(screen.getByText("************3456")).toBeInTheDocument();
    expect(screen.getByText("이름·전화번호는 전송되지 않았어요")).toBeInTheDocument();
    expect(screen.getByText("카드번호는 뒤 4자리만 남겼어요")).toBeInTheDocument();
    expect(screen.getByText(/매핑 결과를 한 번 더 확인/)).toBeInTheDocument();
  });

  it("sends the identical original File and only confirmed mapping to analyze", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ mapping, sample }))
      .mockResolvedValueOnce(jsonResponse({ analysisId: "analysis-uuid", freeSummary }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed />);
    const file = new File(["unmasked-original"], "transactions.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("CSV 파일 선택"), { target: { files: [file] } });
    await screen.findByRole("heading", { name: "컬럼 매핑 확인" });

    fireEvent.change(screen.getByLabelText("카테고리 컬럼"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [path, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = options.body as FormData;
    expect(path).toBe("/api/analyze");
    expect(options.method).toBe("POST");
    expect(body.get("file")).toBe(file);
    expect(JSON.parse(body.get("mapping") as string)).toEqual({
      date: "거래일시",
      merchant: "가맹점명",
      amount: "이용금액",
      category: null,
    });
    expect([...body.keys()]).toEqual(["file", "mapping"]);
    expect(body.get("sample")).toBeNull();

    expect(await screen.findByText("1,250,000원")).toBeInTheDocument();
    expect(screen.getByText("84건")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "전월 대비 지출 변화 조회" })).toHaveLength(1);
  });

  it.each(["upload", "analyze"])("shows the shared modal without exposing codes when %s fails", async (stage) => {
    const fetchMock = vi.fn();
    if (stage === "upload") {
      fetchMock.mockResolvedValue(jsonResponse({ code: "BAD_REQUEST" }, 400));
    } else {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ mapping, sample }))
        .mockResolvedValueOnce(jsonResponse({ code: "BAD_REQUEST" }, 400));
    }
    vi.stubGlobal("fetch", fetchMock);
    const historyLength = window.history.length;
    render(<UploadFlow isSubscribed={false} />);
    fireEvent.change(screen.getByLabelText("CSV 파일 선택"), {
      target: { files: [new File(["csv"], "transactions.csv", { type: "text/csv" })] },
    });
    if (stage === "analyze") {
      await screen.findByRole("heading", { name: "컬럼 매핑 확인" });
      fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    }

    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveTextContent("BAD_REQUEST");
    expect(dialog).not.toHaveTextContent("400");
    expect(window.history.length).toBe(historyLength);
  });

  it("uses distinct radii for cards, fields, and buttons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ mapping, sample })));
    render(<UploadFlow isSubscribed={false} />);
    const idleCard = screen.getByTestId("upload-card");
    expect(idleCard).toHaveClass("rounded-[24px]");
    expect(within(idleCard).getByText("파일 선택")).toHaveClass("rounded-full");
    fireEvent.change(screen.getByLabelText("CSV 파일 선택"), {
      target: { files: [new File(["csv"], "transactions.csv")] },
    });
    const form = await screen.findByTestId("mapping-card");
    expect(form).toHaveClass("rounded-[24px]");
    expect(within(form).getByLabelText("날짜 컬럼")).toHaveClass("rounded-xl");
    expect(within(form).getByRole("button", { name: "분석 시작" })).toHaveClass("rounded-full");
  });
});
