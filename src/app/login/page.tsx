import React from "react";

import { GoogleSignInButton } from "../../components/GoogleSignInButton";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0b0d] px-6 py-16">
      <section className="w-full max-w-md rounded-[24px] bg-[#16181c] p-8 text-center">
        <h1 className="text-3xl font-normal tracking-tight text-white">finsight</h1>
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
