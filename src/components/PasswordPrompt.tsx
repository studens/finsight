"use client";

import React, { useEffect, useState } from "react";

import { Button } from "./ui/button";

export interface PasswordPromptProps {
  isOpen: boolean;
  reason: "missing" | "incorrect";
  isWorking: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPrompt({
  isOpen,
  reason,
  isWorking,
  onSubmit,
  onCancel,
}: PasswordPromptProps) {
  const [input, setInput] = useState("");

  useEffect(() => {
    setInput("");
  }, [reason]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in">
      <section
        aria-labelledby="password-prompt-title"
        aria-modal="true"
        className="w-full max-w-md rounded-[24px] bg-[#16181c] p-8"
        data-component="PasswordPrompt"
        role="dialog"
      >
        <h2 className="text-xl font-semibold text-white" id="password-prompt-title">
          PDF 비밀번호 입력
        </h2>
        <p
          className={`mt-3 text-sm leading-relaxed ${
            reason === "incorrect" ? "text-[#cf202f]" : "text-[#a8acb3]"
          }`}
        >
          {reason === "incorrect"
            ? "비밀번호가 맞지 않아요. 다시 입력해 주세요."
            : "이 PDF는 비밀번호로 보호되어 있어요. 명세서 비밀번호를 입력해 주세요."}
        </p>
        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (input !== "") {
              onSubmit(input);
            }
          }}
        >
          <input
            aria-label="명세서 비밀번호"
            autoComplete="off"
            className="w-full rounded-xl border border-[#2a2d33] bg-[#16181c] px-4 py-3 text-white"
            disabled={isWorking}
            onChange={(event) => setInput(event.target.value)}
            type="password"
            value={input}
          />
          <div className="mt-8 flex flex-wrap gap-3">
            <Button disabled={isWorking || input === ""} type="submit">
              비밀번호 확인
            </Button>
            <Button disabled={isWorking} onClick={onCancel} type="button" variant="secondary">
              다시 올리기
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
