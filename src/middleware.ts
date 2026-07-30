import { NextResponse, type NextRequest } from "next/server"
import { updateSession } from "./lib/supabase/middleware"

function redirectWithSessionCookies(destination: URL, response: NextResponse) {
  const redirect = NextResponse.redirect(destination)
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  return redirect
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request)
  const pathname = request.nextUrl.pathname

  if (!user && (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))) {
    return redirectWithSessionCookies(new URL("/login", request.url), response)
  }

  // 로그인된 사용자에게 랜딩·로그인 화면을 보여줄 이유가 없다.
  // `/auth/callback`은 제외한다 — 세션이 이미 있어도 PKCE 코드 교환은 실행돼야 한다.
  if (user && (pathname === "/" || pathname === "/login")) {
    return redirectWithSessionCookies(new URL("/dashboard", request.url), response)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff|woff2|ttf|eot)$).*)",
  ],
}
