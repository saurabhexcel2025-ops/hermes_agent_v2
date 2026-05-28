import { NextRequest, NextResponse } from "next/server";
import {
  verifyAccessToken,
  verifyRefreshToken,
  signAccessToken,
  setAuthCookies,
  clearAuthCookies,
  getTokensFromRequest,
} from "@/lib/auth";

const PUBLIC_PAGES = new Set(["/login", "/signup"]);

// Paths that bypass auth entirely
function isBypassPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/favicon.ico" ||
    // static file extensions
    /\.[a-z0-9]+$/i.test(pathname)
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isBypassPath(pathname)) {
    return addPathnameHeader(NextResponse.next(), pathname);
  }

  const { accessToken, refreshToken } = getTokensFromRequest(request);

  // --- Valid access token ---
  if (accessToken) {
    const payload = await verifyAccessToken(accessToken);
    if (payload) {
      // Redirect away from auth pages when already logged in
      if (PUBLIC_PAGES.has(pathname)) {
        return NextResponse.redirect(new URL("/", request.url));
      }
      return addPathnameHeader(NextResponse.next(), pathname);
    }
  }

  // --- Access token missing / expired → try refresh ---
  if (refreshToken) {
    const payload = await verifyRefreshToken(refreshToken);
    if (payload) {
      const newAccess = await signAccessToken({ userId: payload.userId, email: payload.email });
      if (PUBLIC_PAGES.has(pathname)) {
        const res = NextResponse.redirect(new URL("/", request.url));
        setAuthCookies(res, newAccess, refreshToken);
        return res;
      }
      const res = addPathnameHeader(NextResponse.next(), pathname);
      setAuthCookies(res, newAccess, refreshToken);
      return res;
    }
  }

  // --- No valid tokens ---
  if (PUBLIC_PAGES.has(pathname)) {
    return addPathnameHeader(NextResponse.next(), pathname);
  }

  const res = NextResponse.redirect(new URL("/login", request.url));
  clearAuthCookies(res);
  return res;
}

function addPathnameHeader(response: NextResponse, pathname: string): NextResponse {
  response.headers.set("x-pathname", pathname);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
