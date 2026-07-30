import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PasswordPrompt } from "./PasswordPrompt";

describe("PasswordPrompt", () => {
  it("renders the secure form contract and submits with Enter", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <PasswordPrompt
        isOpen
        isWorking={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        reason="missing"
      />,
    );

    expect(
      screen.getByText("이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요."),
    ).toBeInTheDocument();
    const input = screen.getByLabelText("명세서 비밀번호");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    fireEvent.change(input, { target: { value: "safe-secret" } });
    fireEvent.submit(container.querySelector("form")!);

    expect(onSubmit).toHaveBeenCalledWith("safe-secret");
    const form = container.querySelector("form");
    expect(form).not.toHaveAttribute("action");
    expect(form).not.toHaveAttribute("method");
  });

  it("clears the field and shows risk copy when the reason becomes incorrect", () => {
    const props = {
      isOpen: true,
      isWorking: false,
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
    };
    const { rerender } = render(<PasswordPrompt {...props} reason="missing" />);
    fireEvent.change(screen.getByLabelText("명세서 비밀번호"), {
      target: { value: "wrong-secret" },
    });

    rerender(<PasswordPrompt {...props} reason="incorrect" />);

    expect(screen.getByText("비밀번호가 맞지 않아요. 다시 입력해 주세요.")).toHaveClass(
      "text-[#cf202f]",
    );
    expect(screen.getByLabelText("명세서 비밀번호")).toHaveValue("");
    expect(screen.queryByText("wrong-secret")).not.toBeInTheDocument();
  });

  it("clears the field on consecutive incorrect attempts, when reason never changes", () => {
    const onSubmit = vi.fn();
    const props = {
      isOpen: true,
      isWorking: false,
      onCancel: vi.fn(),
      onSubmit,
      reason: "incorrect" as const,
    };
    const { container, rerender } = render(<PasswordPrompt {...props} />);

    // 1차 오답
    fireEvent.change(screen.getByLabelText("명세서 비밀번호"), {
      target: { value: "wrong-1" },
    });
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).toHaveBeenLastCalledWith("wrong-1");
    expect(screen.getByLabelText("명세서 비밀번호")).toHaveValue("");

    // 서버가 또 incorrect를 돌려주므로 reason이 변하지 않는다.
    // 값 변화에 의존해 초기화하면 이 경로에서 틀린 비밀번호가 화면에 남는다.
    rerender(<PasswordPrompt {...props} />);
    fireEvent.change(screen.getByLabelText("명세서 비밀번호"), {
      target: { value: "wrong-2" },
    });
    fireEvent.submit(container.querySelector("form")!);

    expect(onSubmit).toHaveBeenLastCalledWith("wrong-2");
    expect(screen.getByLabelText("명세서 비밀번호")).toHaveValue("");
    expect(screen.queryByText("wrong-2")).not.toBeInTheDocument();
  });

  it("does not carry a typed password into the next prompt after cancelling", () => {
    const props = {
      isWorking: false,
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
      reason: "missing" as const,
    };
    const { rerender } = render(<PasswordPrompt {...props} isOpen />);

    // 제출하지 않고 입력만 한 뒤 닫는다("다시 올리기").
    fireEvent.change(screen.getByLabelText("명세서 비밀번호"), {
      target: { value: "pw-for-file-a" },
    });
    rerender(<PasswordPrompt {...props} isOpen={false} />);

    // 다른 파일로 다시 열면 빈 상태여야 한다.
    rerender(<PasswordPrompt {...props} isOpen />);
    expect(screen.getByLabelText("명세서 비밀번호")).toHaveValue("");
    expect(screen.queryByText("pw-for-file-a")).not.toBeInTheDocument();
  });

  it("shows a coin loader with the given label while working", () => {
    render(
      <PasswordPrompt
        isOpen
        isWorking
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        reason="missing"
        workingLabel="파일을 분석하고 있어요..."
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("파일을 분석하고 있어요...");
    expect(document.querySelector(".animate-coin-flip")).toBeInTheDocument();
  });

  it("hides the loader when not working", () => {
    render(
      <PasswordPrompt
        isOpen
        isWorking={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        reason="missing"
        workingLabel="파일을 분석하고 있어요..."
      />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses the prescribed dark modal tokens without blur effects", () => {
    render(
      <PasswordPrompt
        isOpen
        isWorking={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        reason="missing"
      />,
    );

    const panel = document.querySelector('[data-component="PasswordPrompt"]')!;
    const overlay = panel.parentElement!;
    const input = screen.getByLabelText("명세서 비밀번호");
    expect(panel).toHaveClass("rounded-[24px]", "bg-[#16181c]", "p-8");
    expect(overlay).toHaveClass("bg-black/60", "animate-fade-in");
    expect(input).toHaveClass("rounded-xl", "border-[#2a2d33]");
    expect(screen.getByRole("button", { name: "비밀번호 확인" })).toHaveClass(
      "rounded-full",
      "bg-[#0052ff]",
    );
    expect(`${overlay.className} ${panel.className} ${input.className}`).not.toMatch(
      /backdrop-(?:blur|filter)/,
    );
  });
});
