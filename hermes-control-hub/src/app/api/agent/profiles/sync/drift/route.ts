export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/api-auth";
import { logApiError } from "@/lib/api-logger";
import { ensureDb } from "@/lib/db";
import { detectFullDrift } from "@/lib/hermes-profile-sync";

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth) return auth;

  try {
    ensureDb();
    const drift = detectFullDrift();
    return NextResponse.json({ data: drift });
  }
  catch (error) {
    logApiError("GET /api/agent/profiles/sync/drift", "detecting drift", error);
    return NextResponse.json({ error: "Failed to detect drift" }, { status: 500 });
  }
}
