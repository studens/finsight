import React from "react";
import type { HTMLAttributes } from "react";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-[24px] bg-[#16181c] p-8 ${className}`.trim()}
      {...props}
    />
  );
}
