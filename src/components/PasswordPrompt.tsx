"use client";

import React, { useState } from "react";

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

  // 입력값을 비우는 두 경로. effect를 쓰지 않는 이유:
  //  (1) effect는 렌더 후에 실행되므로 틀린 비밀번호가 한 커밋 동안 DOM에 남는다
  //      (테스트가 간헐적으로 실패하는 원인이었다).
  //  (2) 의존성이 `reason` 값이면 연속 오답("incorrect" → "incorrect")처럼
  //      값이 그대로인 경우 초기화가 아예 실행되지 않는다.
  //
  // 경로 A: 제출 즉시 비운다 — 연속 오답과 경쟁을 함께 해소한다(onSubmit 핸들러).
  // 경로 B: 프롬프트 정체성(reason/isOpen)이 바뀌면 렌더 중에 비운다 — 제출 없이
  //         입력만 하고 취소한 뒤 다른 파일로 다시 열었을 때 이전 값이 남지 않게 한다.
  const identity = `${reason}:${isOpen}`;
  const [prevIdentity, setPrevIdentity] = useState(identity);
  if (prevIdentity !== identity) {
    setPrevIdentity(identity);
    setInput("");
  }

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
              const submitted = input;
              setInput("");
              onSubmit(submitted);
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
