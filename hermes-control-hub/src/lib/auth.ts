import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

export interface AuthPayload extends JWTPayload {
  userId: string;
  email: string;
}

function secret(envKey: string): Uint8Array {
  const val = process.env[envKey];
  if (!val) throw new Error(`Missing env var: ${envKey}`);
  return new TextEncoder().encode(val);
}

export async function signAccessToken(data: Pick<AuthPayload, "userId" | "email">): Promise<string> {
  return new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret("JWT_ACCESS_SECRET"));
}

export async function signRefreshToken(data: Pick<AuthPayload, "userId" | "email">): Promise<string> {
  return new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret("JWT_REFRESH_SECRET"));
}

export async function verifyAccessToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret("JWT_ACCESS_SECRET"));
    return payload as AuthPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret("JWT_REFRESH_SECRET"));
    return payload as AuthPayload;
  } catch {
    return null;
  }
}

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

function isSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setAuthCookies(response: NextResponse, accessToken: string, refreshToken: string): void {
  response.cookies.set(ACCESS_COOKIE, accessToken, {
    ...COOKIE_BASE,
    secure: isSecure(),
    maxAge: 60 * 15,
  });
  response.cookies.set(REFRESH_COOKIE, refreshToken, {
    ...COOKIE_BASE,
    secure: isSecure(),
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 });
}

export function getTokensFromRequest(request: NextRequest): {
  accessToken: string | undefined;
  refreshToken: string | undefined;
} {
  return {
    accessToken: request.cookies.get(ACCESS_COOKIE)?.value,
    refreshToken: request.cookies.get(REFRESH_COOKIE)?.value,
  };
}

/** Read & verify the access token from the current server component cookie store. */
export async function getSession(): Promise<AuthPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}
