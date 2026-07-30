import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "../app/login/page";
import { GoogleSignInButton } from "./GoogleSignInButton";

const signInWithOAuth = vi.fn();

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth } }),
}));

describe("GoogleSignInButton", () => {
  beforeEach(() => {
    signInWithOAuth.mockReset();
  });

  it("starts Google OAuth and returns through the session exchange callback", () => {
    render(<GoogleSignInButton />);

    fireEvent.click(screen.getByRole("button", { name: "Google로 계속하기" }));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback" },
    });
  });

  it("uses the shared pill-shaped primary button style", () => {
    render(<GoogleSignInButton />);

    expect(screen.getByRole("button", { name: "Google로 계속하기" })).toHaveClass(
      "rounded-full",
      "bg-[#0052ff]",
    );
  });
});

describe("LoginPage", () => {
  it("renders the product copy and login card", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: "finsight" })).toBeInTheDocument();
    expect(screen.getByText(/거래내역을 올리고/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Google로 계속하기" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "finsight" }).closest("section")).toHaveClass(
      "rounded-[24px]",
      "bg-[#16181c]",
    );
  });
});
