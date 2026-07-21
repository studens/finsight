import React from "react";
import type { HTMLAttributes } from "react";

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

export function Badge({ className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex px-4 py-2 rounded-full bg-[#16181c] text-[13px] font-semibold tracking-[0.08em] text-[#a8acb3] ${className}`.trim()}
      {...props}
    />
  );
}
