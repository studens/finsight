import React from "react";

import { Button } from "./ui";

export function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="post">
      <Button variant="text" type="submit">
        로그아웃
      </Button>
    </form>
  );
}
