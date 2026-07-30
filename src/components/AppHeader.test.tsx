import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import AppLayout from "../app/(app)/layout";
import { SignOutButton } from "./SignOutButton";

describe("SignOutButton", () => {
  it("submits a POST request to the sign-out endpoint with the text button style", () => {
    render(<SignOutButton />);

    const button = screen.getByRole("button", { name: "로그아웃" });
    const form = button.closest("form");

    expect(form).toHaveAttribute("action", "/api/auth/signout");
    expect(form).toHaveAttribute("method", "post");
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("text-[#a8acb3]");
  });
});

describe("AppLayout", () => {
  it("renders the dashboard wordmark, sign-out form, and children", () => {
    render(
      <AppLayout>
        <main>대시보드 콘텐츠</main>
      </AppLayout>,
    );

    expect(screen.getByRole("link", { name: "finsight" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("button", { name: "로그아웃" }).closest("form")).toHaveAttribute(
      "action",
      "/api/auth/signout",
    );
    expect(screen.getByText("대시보드 콘텐츠")).toBeInTheDocument();
  });
});
