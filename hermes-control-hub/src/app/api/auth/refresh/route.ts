import { NextRequest, NextResponse } from "next/server";
import {
  verifyRefreshToken,
  signAccessToken,
  signRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  REFRESH_COOKIE,
} from "@/lib/auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) {
    const response = NextResponse.json({ error: "Invalid or expired refresh token" }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  const [newAccessToken, newRefreshToken] = await Promise.all([
    signAccessToken({ userId: payload.userId, email: payload.email }),
    signRefreshToken({ userId: payload.userId, email: payload.email }),
  ]);

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, newAccessToken, newRefreshToken);
  return response;
}
