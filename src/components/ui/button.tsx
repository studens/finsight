import React from "react";
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "text";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "h-14 px-8 rounded-full bg-[#0052ff] text-white hover:bg-[#003ecc] font-semibold",
  secondary:
    "h-14 px-8 rounded-full bg-transparent border border-[#33363c] text-white font-semibold",
  text: "text-[#a8acb3] hover:text-white",
};

export function Button({ className = "", variant = "primary", ...props }: ButtonProps) {
  return <button className={`${variantClasses[variant]} ${className}`.trim()} {...props} />;
}
