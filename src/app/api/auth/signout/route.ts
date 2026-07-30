import { NextResponse } from "next/server"

import { signOut } from "../../../../lib/supabase/server"

export async function POST(request: Request): Promise<NextResponse> {
  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get("origin")

  if (origin !== null && origin !== requestOrigin) {
    return new NextResponse(null, { status: 403 })
  }

  try {
    await signOut()
  } catch {
    // Redirect even when Supabase cannot invalidate the session.
  }

  return NextResponse.redirect(new URL("/login", request.url), 303)
}
