import React from "react";
import type { HTMLAttributes } from "react";

type IconBadgeTone = "risk" | "opportunity" | "hygiene" | "brand";

export interface IconBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: IconBadgeTone;
}

const toneClasses: Record<IconBadgeTone, string> = {
  risk: "bg-[rgba(207,32,47,0.15)] text-[#cf202f]",
  opportunity: "bg-[rgba(5,177,105,0.15)] text-[#05b169]",
  hygiene: "bg-[rgba(91,139,255,0.15)] text-[#5b8bff]",
  brand: "bg-[rgba(0,82,255,0.15)] text-[#0052ff]",
};

export function IconBadge({ className = "", tone, ...props }: IconBadgeProps) {
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClasses[tone]} ${className}`.trim()}
      {...props}
    />
  );
}
