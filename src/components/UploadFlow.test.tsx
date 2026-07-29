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
const pdfColumnSchema = {
  version: 1,
  columns: [{ cluster: { rightEdge: 412.75 }, semantic: "billedAmount" }],
  opaqueMarker: "schema-must-not-render",
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

    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), { target: { files: [file] } });

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
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), { target: { files: [file] } });
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
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
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
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [new File(["csv"], "transactions.csv")] },
    });
    const form = await screen.findByTestId("mapping-card");
    expect(form).toHaveClass("rounded-[24px]");
    expect(within(form).getByLabelText("날짜 컬럼")).toHaveClass("rounded-xl");
    expect(within(form).getByRole("button", { name: "분석 시작" })).toHaveClass("rounded-full");
  });

  it("accepts CSV and PDF and uploads a PDF without a password on the first attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ mapping, sample }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    const input = screen.getByLabelText("CSV 또는 PDF 파일 선택");
    const file = new File(["%PDF-"], "statement.PDF", { type: "application/pdf" });

    expect(input).toHaveAttribute("accept", ".csv,text/csv,.pdf,application/pdf");
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByTestId("mapping-card");
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect([...body.keys()]).toEqual(["file"]);
    expect(body.get("file")).toBe(file);
  });

  it("round-trips an unencrypted PDF schema to analyze and shows only the billing notice", async () => {
    const pdfMapping = { ...mapping, confidence: 1 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ mapping: pdfMapping, sample, pdfColumnSchema }))
      .mockResolvedValueOnce(jsonResponse({ analysisId: "pdf-analysis", freeSummary }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    const file = new File(["%PDF-plain"], "statement.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [file] },
    });
    await screen.findByTestId("mapping-card");
    expect(document.body).not.toHaveTextContent(pdfColumnSchema.opaqueMarker);

    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    const notice = await screen.findByTestId("pdf-billing-notice");
    const body = fetchMock.mock.calls[1][1].body as FormData;
    expect([...body.keys()]).toEqual(["file", "mapping", "pdfColumnSchema"]);
    expect(body.get("file")).toBe(file);
    expect(body.get("password")).toBeNull();
    expect(JSON.parse(body.get("pdfColumnSchema") as string)).toEqual(pdfColumnSchema);
    expect(notice.tagName).toBe("P");
    expect(notice).toHaveTextContent("이번 달 청구액");
    expect(notice).toHaveTextContent("할부");
    expect(notice).toHaveClass("text-[13px]", "leading-relaxed", "text-[#a8acb3]");
    expect(notice.className).not.toMatch(/rounded-\[24px\]|border-l-4|bg-\[#16181c\]|bg-\[#0a0b0d\]/);
    expect(notice.querySelector("svg")).toBeNull();
    expect(document.body).not.toHaveTextContent(pdfColumnSchema.opaqueMarker);
  });

  it("sends the retained password and opaque schema with the identical encrypted PDF", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "missing" }, 409),
      )
      .mockResolvedValueOnce(jsonResponse({ mapping, sample, pdfColumnSchema }))
      .mockResolvedValueOnce(jsonResponse({ analysisId: "pdf-analysis", freeSummary }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    const file = new File(["%PDF-encrypted"], "statement.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [file] },
    });
    fireEvent.change(await screen.findByLabelText("명세서 비밀번호"), {
      target: { value: "pdf-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 확인" }));
    await screen.findByTestId("mapping-card");
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    await screen.findByTestId("pdf-billing-notice");
    const body = fetchMock.mock.calls[2][1].body as FormData;
    expect([...body.keys()]).toEqual(["file", "mapping", "password", "pdfColumnSchema"]);
    expect(body.get("file")).toBe(file);
    expect(body.get("password")).toBe("pdf-secret");
    expect(JSON.parse(body.get("pdfColumnSchema") as string)).toEqual(pdfColumnSchema);
  });

  it("prompts on analyze 409 and retries analyze with the same confirmed payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ mapping, sample, pdfColumnSchema }))
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "missing" }, 409),
      )
      .mockResolvedValueOnce(jsonResponse({ analysisId: "pdf-analysis", freeSummary }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    const file = new File(["%PDF-late-password"], "statement.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [file] },
    });
    await screen.findByTestId("mapping-card");
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    const prompt = await screen.findByText(
      "이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요.",
    );
    expect(prompt.closest('[data-component="PasswordPrompt"]')).toBeInTheDocument();
    expect(document.querySelector('[data-component="ErrorModal"]')).not.toBeInTheDocument();
    expect(screen.getByTestId("mapping-card")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("명세서 비밀번호"), {
      target: { value: "late-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 확인" }));

    await screen.findByTestId("pdf-billing-notice");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/upload",
      "/api/analyze",
      "/api/analyze",
    ]);
    const firstAnalyze = fetchMock.mock.calls[1][1].body as FormData;
    const retriedAnalyze = fetchMock.mock.calls[2][1].body as FormData;
    expect(retriedAnalyze.get("file")).toBe(file);
    expect(retriedAnalyze.get("mapping")).toBe(firstAnalyze.get("mapping"));
    expect(retriedAnalyze.get("pdfColumnSchema")).toBe(firstAnalyze.get("pdfColumnSchema"));
    expect(retriedAnalyze.get("password")).toBe("late-secret");
  });

  it("uses analyze incorrect reason, clears the field, and never exposes the password", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ mapping, sample, pdfColumnSchema }))
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "incorrect" }, 409),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: {
        files: [new File(["%PDF-"], "statement.pdf", { type: "application/pdf" })],
      },
    });
    await screen.findByTestId("mapping-card");
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    expect(
      await screen.findByText("비밀번호가 맞지 않아요. 다시 입력해 주세요."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("명세서 비밀번호")).toHaveValue("");
    expect(document.querySelector('[data-component="ErrorModal"]')).not.toBeInTheDocument();
  });

  it("clears PDF-only state before a new CSV analysis", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ mapping, sample, pdfColumnSchema }))
      .mockResolvedValueOnce(jsonResponse({ mapping, sample }))
      .mockResolvedValueOnce(jsonResponse({ analysisId: "csv-analysis", freeSummary }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: {
        files: [new File(["%PDF-"], "statement.pdf", { type: "application/pdf" })],
      },
    });
    await screen.findByTestId("mapping-card");
    fireEvent.click(screen.getByRole("button", { name: "다시 올리기" }));

    const csv = new File(["csv"], "transactions.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [csv] },
    });
    await screen.findByTestId("mapping-card");
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    await screen.findByText("1,250,000원");
    const body = fetchMock.mock.calls[2][1].body as FormData;
    expect([...body.keys()]).toEqual(["file", "mapping"]);
    expect(body.get("password")).toBeNull();
    expect(body.get("pdfColumnSchema")).toBeNull();
    expect(screen.queryByTestId("pdf-billing-notice")).toBeNull();
  });

  it("treats password-required as a prompt and retries with the identical File", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "missing" }, 409),
      )
      .mockResolvedValueOnce(jsonResponse({ mapping, sample }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    const file = new File(["%PDF-encrypted"], "statement.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [file] },
    });

    const prompt = await screen.findByText(
      "이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요.",
    );
    expect(prompt.closest('[data-component="PasswordPrompt"]')).toBeInTheDocument();
    expect(document.querySelector('[data-component="ErrorModal"]')).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-card")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("명세서 비밀번호"), {
      target: { value: "pdf-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 확인" }));

    await screen.findByTestId("mapping-card");
    const firstBody = fetchMock.mock.calls[0][1].body as FormData;
    const secondBody = fetchMock.mock.calls[1][1].body as FormData;
    expect(firstBody.get("file")).toBe(file);
    expect([...firstBody.keys()]).toEqual(["file"]);
    expect(secondBody.get("file")).toBe(file);
    expect(secondBody.get("password")).toBe("pdf-secret");
    expect([...secondBody.keys()]).toEqual(["file", "password"]);
  });

  it("uses only the server reason and safely falls back to missing copy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "incorrect" }, 409),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "unexpected" }, 409),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<UploadFlow isSubscribed={false} />);
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [new File(["%PDF-"], "first.pdf", { type: "application/pdf" })] },
    });
    expect(
      await screen.findByText("비밀번호가 맞지 않아요. 다시 입력해 주세요."),
    ).toBeInTheDocument();
    unmount();

    render(<UploadFlow isSubscribed={false} />);
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [new File(["%PDF-"], "second.pdf", { type: "application/pdf" })] },
    });
    expect(
      await screen.findByText(
        "이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the prompt open, clears an incorrect password, and retries the same File", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "missing" }, 409),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "incorrect" }, 409),
      )
      .mockResolvedValueOnce(jsonResponse({ mapping, sample }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    const file = new File(["%PDF-encrypted"], "statement.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [file] },
    });
    await screen.findByLabelText("명세서 비밀번호");
    fireEvent.change(screen.getByLabelText("명세서 비밀번호"), {
      target: { value: "wrong-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 확인" }));

    expect(
      await screen.findByText("비밀번호가 맞지 않아요. 다시 입력해 주세요."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("명세서 비밀번호")).toHaveValue("");
    expect(screen.queryByText("wrong-secret")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("명세서 비밀번호"), {
      target: { value: "right-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 확인" }));

    await screen.findByTestId("mapping-card");
    expect((fetchMock.mock.calls[2][1].body as FormData).get("file")).toBe(file);
  });

  it("keeps passwords out of browser storage, text, cookies, URLs, and fetch URLs", async () => {
    const secret = "only-in-form-data";
    const localStore = new Map<string, string>();
    const sessionStore = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => localStore.get(key) ?? null,
        setItem: (key: string, value: string) => localStore.set(key, value),
      },
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => sessionStore.get(key) ?? null,
        setItem: (key: string, value: string) => sessionStore.set(key, value),
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ code: "PDF_PASSWORD_REQUIRED", reason: "missing" }, 409),
      )
      .mockResolvedValueOnce(jsonResponse({ mapping, sample, pdfColumnSchema }))
      .mockResolvedValueOnce(jsonResponse({ analysisId: "pdf-analysis", freeSummary }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [new File(["%PDF-"], "statement.pdf", { type: "application/pdf" })] },
    });
    fireEvent.change(await screen.findByLabelText("명세서 비밀번호"), {
      target: { value: secret },
    });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 확인" }));
    await screen.findByTestId("mapping-card");
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    await screen.findByTestId("pdf-billing-notice");

    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(localStorage.getItem(secret)).toBeNull();
    expect(sessionStorage.getItem(secret)).toBeNull();
    expect(document.cookie).not.toContain(secret);
    expect(window.location.search).not.toContain(secret);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes(secret))).toBe(true);
    expect((fetchMock.mock.calls[1][1].body as FormData).get("password")).toBe(secret);
    expect((fetchMock.mock.calls[2][1].body as FormData).get("password")).toBe(secret);
  });

  it.each(["upload", "analyze"])(
    "routes unsupported PDFs from %s to the mapped ErrorModal without exposing internals",
    async (stage) => {
    const fetchMock = vi.fn();
    if (stage === "upload") {
      fetchMock.mockResolvedValue(
        jsonResponse({ code: "UNSUPPORTED_PDF_FORMAT" }, 422),
      );
    } else {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ mapping, sample, pdfColumnSchema }))
        .mockResolvedValueOnce(
          jsonResponse({ code: "UNSUPPORTED_PDF_FORMAT" }, 422),
        );
    }
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
      target: { files: [new File(["%PDF-"], "statement.pdf", { type: "application/pdf" })] },
    });
    if (stage === "analyze") {
      await screen.findByTestId("mapping-card");
      fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    }

    const modal = await screen.findByRole("dialog");
    expect(modal).toHaveAttribute("data-component", "ErrorModal");
    expect(modal).toHaveTextContent("이 명세서 형식은 아직 읽을 수 없어요.");
    expect(modal).toHaveTextContent("CSV");
    expect(modal).not.toHaveTextContent("UNSUPPORTED_PDF_FORMAT");
    expect(modal).not.toHaveTextContent("422");
    expect(document.querySelector('[data-component="PasswordPrompt"]')).not.toBeInTheDocument();
  });

  it.each(["select", "drop"])("rejects unsupported files through %s without fetching", async (path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadFlow isSubscribed={false} />);
    const file = new File(["xlsx"], "transactions.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    if (path === "select") {
      fireEvent.change(screen.getByLabelText("CSV 또는 PDF 파일 선택"), {
        target: { files: [file] },
      });
    } else {
      fireEvent.drop(screen.getByTestId("upload-card"), {
        dataTransfer: { files: [file] },
      });
    }

    expect(await screen.findByText("CSV 또는 PDF 파일만 올릴 수 있어요.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
