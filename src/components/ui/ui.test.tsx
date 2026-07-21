import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";
import { Button } from "./button";
import { Card } from "./card";
import { IconBadge } from "./icon-badge";

describe("UI primitives", () => {
  it.each(["primary", "secondary", "text"] as const)(
    "renders the %s button variant",
    (variant) => {
      render(<Button variant={variant}>{variant}</Button>);

      expect(screen.getByRole("button", { name: variant })).toBeInTheDocument();
    },
  );

  it("applies the primary button tokens", () => {
    render(<Button>Continue</Button>);

    expect(screen.getByRole("button", { name: "Continue" })).toHaveClass(
      "bg-[#0052ff]",
      "rounded-full",
    );
  });

  it("renders a pill badge", () => {
    render(<Badge>Premium</Badge>);

    expect(screen.getByText("Premium")).toHaveClass("rounded-full");
  });

  it("renders a borderless panel card with the card radius", () => {
    render(<Card>Summary</Card>);

    expect(screen.getByText("Summary")).toHaveClass(
      "rounded-[24px]",
      "bg-[#16181c]",
    );
    expect(screen.getByText("Summary")).not.toHaveClass("border");
  });

  it.each(["risk", "opportunity", "hygiene", "brand"] as const)(
    "renders the %s icon badge tone",
    (tone) => {
      render(<IconBadge tone={tone}>!</IconBadge>);

      expect(screen.getByText("!")).toHaveClass("h-9", "w-9", "rounded-full");
    },
  );
});
