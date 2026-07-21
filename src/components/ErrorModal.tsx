"use client";

import React from "react";

import { Button } from "./ui/button";

export interface ErrorModalProps {
  isOpen: boolean;
  message?: string;
  onClose: () => void;
}

export function ErrorModal({ isOpen, message, onClose }: ErrorModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in"
      data-testid="error-modal-overlay"
    >
      <section
        aria-labelledby="error-modal-title"
        aria-modal="true"
        className="w-full max-w-md rounded-[24px] bg-[#16181c] p-8"
        data-component="ErrorModal"
        role="dialog"
      >
        <h2 id="error-modal-title" className="text-xl font-semibold text-white">
          안내
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[#a8acb3]">{message}</p>
        <div className="mt-8 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            닫기
          </Button>
        </div>
      </section>
    </div>
  );
}
