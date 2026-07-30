import { NextResponse } from "next/server"

import { createClient } from "../../../lib/supabase/server"

/**
 * 열린 리다이렉트 방지: 같은 오리진 내부의 절대 경로만 허용한다.
 * `//evil.test`, `/\evil.test`처럼 브라우저가 외부 호스트로 해석하는 형태는 거부한다.
 */
function safeNextPath(value: string | null): string {
  if (!value) return "/dashboard"
  if (!value.startsWith("/")) return "/dashboard"
  if (value.startsWith("//") || value.startsWith("/\\")) return "/dashboard"

  return value
}

export async function GET(request: Request): Promise<NextResponse> {
  const { origin, searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const providerError = searchParams.get("error")

  if (providerError || !code) {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  return NextResponse.redirect(`${origin}${safeNextPath(searchParams.get("next"))}`)
}
