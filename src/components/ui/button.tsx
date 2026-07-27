import React from "react";
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "text";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "inline-flex h-14 items-center justify-center px-8 rounded-full bg-[#0052ff] text-white hover:bg-[#003ecc] font-semibold",
  secondary:
    "inline-flex h-14 items-center justify-center px-8 rounded-full bg-transparent border border-[#33363c] text-white font-semibold",
  text: "inline-flex items-center text-[#a8acb3] hover:text-white",
};

export function Button({ className = "", variant = "primary", ...props }: ButtonProps) {
  return <button className={`${variantClasses[variant]} ${className}`.trim()} {...props} />;
}
