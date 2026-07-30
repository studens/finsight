import Link from "next/link";
import type { ReactNode } from "react";
import React from "react";

import { SignOutButton } from "../../components/SignOutButton";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0b0d]">
      <header className="border-b border-[#33363c]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link
            className="text-lg font-normal tracking-tight text-white"
            href="/dashboard"
          >
            finsight
          </Link>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
