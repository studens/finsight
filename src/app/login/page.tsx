import React from "react";

import { GoogleSignInButton } from "../../components/GoogleSignInButton";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0b0d] px-6 py-16">
      <section className="w-full max-w-md animate-fade-in rounded-[24px] bg-[#16181c] p-8 text-center shadow-[0_30px_70px_-30px_rgba(0,0,0,0.8)] ring-1 ring-[#22252b]">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(0,82,255,0.15)] text-[#0052ff]">
          <BrandGlyph />
        </span>
        <h1 className="mt-6 text-3xl font-normal tracking-tight text-white">finsight</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#a8acb3]">
          거래내역을 올리고, 새는 돈을 한눈에 확인하세요.
        </p>
        <div className="mt-8">
          <GoogleSignInButton />
        </div>
      </section>
    </main>
  );
}

function BrandGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 16.5 9.5 11l3.5 3.5L20 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M15 7h5v5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
