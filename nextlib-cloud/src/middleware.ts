import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Next.js Edge Middleware — HTTPS Enforcement & Route Protection
 */
export function middleware(request: NextRequest) {
  // 1. Enforce HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    const proto = request.headers.get('x-forwarded-proto')
    const url = request.nextUrl
    const isHttps = proto ? proto === 'https' : url.protocol === 'https:'

    if (!isHttps) {
      const httpsUrl = url.clone()
      httpsUrl.protocol = 'https:'
      return NextResponse.redirect(httpsUrl, 301)
    }
  }

  const pathname = request.nextUrl.pathname;
  const sessionCookie = request.cookies.get('nextlib_session')?.value;

  // Define protected pages
  const isProtectedPath = 
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/whatsapp") ||
    pathname.startsWith("/tenants") ||
    pathname.startsWith("/koneksi") ||
    pathname.startsWith("/settings");

  const isLoginPage = pathname === "/login";

  // Redirect to login if trying to access a protected path without a session cookie
  if (isProtectedPath && !sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect to dashboard if logged-in user tries to access the login page
  if (isLoginPage && sessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next()
}

/**
 * Match all routes except Next.js internals and static assets.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
