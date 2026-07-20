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

  if (user && pathname === "/") {
    return redirectWithSessionCookies(new URL("/dashboard", request.url), response)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff|woff2|ttf|eot)$).*)",
  ],
}
