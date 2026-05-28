export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/api-auth";
import { logApiError } from "@/lib/api-logger";
import { runCatalogSeed, getSeedState, type SeedTarget } from "@/lib/seed/catalog-seed";
import { importHermesStateFromDisk } from "@/lib/hermes-state-import";
import { getHermesHome } from "@/lib/hermes-home";
import { existsSync } from "fs";

export async function GET() {
  try {
    const state = getSeedState();
    return NextResponse.json({ data: { state } });
  } catch (error) {
    logApiError("GET /api/seed", "state", error);
    return NextResponse.json({ error: "Failed to read seed state" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const target = (body.target as SeedTarget["target"]) ?? "all";
    const mode = (body.mode as SeedTarget["mode"]) ?? "merge";
    const slug = typeof body.slug === "string" ? body.slug : undefined;
    const templateId =
      typeof body.templateId === "string"
        ? body.templateId
        : typeof body.id === "string"
          ? body.id
          : undefined;

    const hermesHome = getHermesHome();
    const imported = existsSync(hermesHome + "/config.yaml")
      ? importHermesStateFromDisk()
      : null;
    const result = runCatalogSeed({ target, mode, slug, templateId });
    return NextResponse.json({ data: { ...result, imported } });
  } catch (error) {
    logApiError("POST /api/seed", "seed", error);
    return NextResponse.json({ error: "Failed to run seed" }, { status: 500 });
  }
}
