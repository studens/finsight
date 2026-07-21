"use client";

import React from "react";

import { createClient } from "../lib/supabase/client";
import { Button } from "./ui";

export function GoogleSignInButton() {
  const handleSignIn = () => {
    const supabase = createClient();

    void supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
  };

  return (
    <Button className="w-full gap-3" onClick={handleSignIn} type="button">
      <GoogleGlyph />
      Google로 계속하기
    </Button>
  );
}

function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20.6 12.2c0-.7-.1-1.4-.2-2H12v3.7h4.8a4.1 4.1 0 0 1-1.8 2.7v2.5h3.1c1.7-1.7 2.5-4 2.5-6.9Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M12 21c2.4 0 4.5-.8 6.1-2.1L15 16.5c-.8.6-1.9.9-3 .9a5.4 5.4 0 0 1-5.1-3.7H3.7v2.5A9.2 9.2 0 0 0 12 21Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M6.9 13.7a5.4 5.4 0 0 1 0-3.4V7.8H3.7a9.1 9.1 0 0 0 0 8.4l3.2-2.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M12 6.6c1.3 0 2.5.5 3.4 1.3L18.2 5A8.6 8.6 0 0 0 12 3a9.2 9.2 0 0 0-8.3 4.8l3.2 2.5A5.4 5.4 0 0 1 12 6.6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
