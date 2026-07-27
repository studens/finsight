import React from "react";
import type { HTMLAttributes } from "react";

export type CardProps = HTMLAttributes<HTMLDivElement> & { tone?: "dark" | "light" };

const toneClasses: Record<"dark" | "light", string> = {
  dark: "bg-[#16181c]",
  light: "bg-white border border-[#dee1e6]",
};

export function Card({ className = "", tone = "dark", ...props }: CardProps) {
  return (
    <div
      className={`rounded-[24px] p-8 ${toneClasses[tone]} ${className}`.trim()}
      {...props}
    />
  );
}
