import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useApiError } from "../hooks/useApiError";
import { ErrorModal } from "./ErrorModal";

function response(code: string, status: number) {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function responseWithReason(code: string, reason: string, status: number) {
  return new Response(JSON.stringify({ code, reason }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Harness({ apiResponse }: { apiResponse: Response }) {
  const { error, isOpen, handleResponse, close } = useApiError();

  return (
    <div>
      <span>현재 화면</span>
      <button type="button" onClick={() => void handleResponse(apiResponse)}>
        요청
      </button>
      <ErrorModal isOpen={isOpen} message={error?.message} onClose={close} />
    </div>
  );
}

describe("ErrorModal with useApiError", () => {
  it.each([
    [
      "PAYWALL_REQUIRED",
      403,
      "이 리포트는 Premium 구독에서 확인할 수 있어요.",
    ],
    ["NOT_FOUND", 404, "요청하신 분석을 찾을 수 없어요. 다시 시도해 주세요."],
    [
      "GENERATION_FAILED",
      502,
      "리포트를 생성하지 못했어요. 잠시 후 다시 시도해 주세요.",
    ],
  ])("maps %s to a gentle message in the same modal", async (code, status, message) => {
    render(<Harness apiResponse={response(code, status)} />);

    fireEvent.click(screen.getByRole("button", { name: "요청" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(message);
    expect(dialog).not.toHaveTextContent(code);
    expect(dialog).not.toHaveTextContent(String(status));
    expect(dialog).toHaveAttribute("data-component", "ErrorModal");
  });

  it("falls back when the error code is unknown", async () => {
    render(<Harness apiResponse={response("UNKNOWN", 500)} />);
    fireEvent.click(screen.getByRole("button", { name: "요청" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("maps unsupported PDF formats to a safe CSV alternative without exposing internals", async () => {
    render(<Harness apiResponse={response("UNSUPPORTED_PDF_FORMAT", 422)} />);
    fireEvent.click(screen.getByRole("button", { name: "요청" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("이 명세서 형식은 아직 읽을 수 없어요.");
    expect(dialog).toHaveTextContent("CSV");
    expect(dialog).not.toHaveTextContent("UNSUPPORTED_PDF_FORMAT");
    expect(dialog).not.toHaveTextContent("422");
  });

  it("uses a recovery message for a missing PDF schema", async () => {
    render(
      <Harness
        apiResponse={responseWithReason("BAD_REQUEST", "pdf_schema_missing", 400)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "요청" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("분석 정보가 만료됐어요. 파일을 다시 올려주세요.");
    expect(dialog).not.toHaveTextContent("파일 형식을 확인");
    expect(dialog).not.toHaveTextContent("pdf_schema_missing");
    expect(dialog).not.toHaveTextContent("BAD_REQUEST");
    expect(dialog).not.toHaveTextContent("400");
  });

  it.each([
    [response("BAD_REQUEST", 400), "파일을 읽지 못했어요. 파일 형식을 확인해 주세요."],
    [
      responseWithReason("BAD_REQUEST", "unknown_reason", 400),
      "파일을 읽지 못했어요. 파일 형식을 확인해 주세요.",
    ],
  ])("preserves code-only fallback behavior for missing or unknown reasons", async (apiResponse, message) => {
    render(<Harness apiResponse={apiResponse} />);
    fireEvent.click(screen.getByRole("button", { name: "요청" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(message);
  });

  it("falls back when parsing the response body fails", async () => {
    const invalidResponse = new Response("not-json", { status: 500 });
    render(<Harness apiResponse={invalidResponse} />);
    fireEvent.click(screen.getByRole("button", { name: "요청" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("keeps the current screen and closes only when requested", async () => {
    const historyLength = window.history.length;
    render(<Harness apiResponse={response("NOT_FOUND", 404)} />);
    fireEvent.click(screen.getByRole("button", { name: "요청" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("현재 화면")).toBeInTheDocument();
    expect(window.history.length).toBe(historyLength);

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("현재 화면")).toBeInTheDocument();
    expect(window.history.length).toBe(historyLength);
  });

  it("uses the required modal tokens without backdrop blur", () => {
    render(
      <ErrorModal
        isOpen
        message="문제가 발생했어요. 잠시 후 다시 시도해 주세요."
        onClose={vi.fn()}
      />,
    );

    const overlay = screen.getByTestId("error-modal-overlay");
    const panel = screen.getByRole("dialog");
    expect(overlay).toHaveClass("bg-black/60", "animate-fade-in");
    expect(panel).toHaveClass("rounded-[24px]", "bg-[#16181c]", "p-8");
    expect(`${overlay.className} ${panel.className}`).not.toMatch(
      /backdrop-(?:blur|filter)/,
    );
  });
});
