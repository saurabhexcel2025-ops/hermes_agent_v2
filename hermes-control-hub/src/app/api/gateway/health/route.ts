export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════
// Gateway Health Check — Proxied through CH to avoid CORS issues
// ═══════════════════════════════════════════════════════════════
// GET /api/gateway/health
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { logApiError } from "@/lib/api-logger";
import { fetchGateway } from "@/lib/gateway-client";

/** GET /api/gateway/health — Check if Hermes Gateway is reachable. */
export async function GET() {
  try {
    const res = await fetchGateway("/v1/models", { method: "GET" });
    if (res.ok) {
      return NextResponse.json({ data: { online: true } });
    }
    return NextResponse.json({ data: { online: false } });
  } catch (error) {
    logApiError("GET /api/gateway/health", "gateway probe", error);
    return NextResponse.json({ data: { online: false } });
  }
}
