export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════
// /api/models/[id] — get + update + delete a single model
// ═══════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from "next/server";

import { getModel, updateModel, deleteModel } from "@/lib/models-repository";
import { logApiError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api-auth";
import { appendAuditLine } from "@/lib/audit-log";
import { zodErrorResponse, modelPutSchema } from "@/lib/api-schemas";
import { syncDefaultsToHermesConfig } from "@/lib/hermes-config-sync";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const model = getModel(id);
    if (!model) return NextResponse.json({ error: "Model not found" }, { status: 404 });
    return NextResponse.json({ data: { model } });
  } catch (error) {
    logApiError("GET /api/models/[id]", `id=${id}`, error);
    return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const auth = requireAuth(request);
  if (auth) return auth;

  const { id } = await ctx.params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = modelPutSchema.safeParse(raw);
  if (!parsed.success) return zodErrorResponse(parsed.error);

  try {
    const updated = updateModel(id, parsed.data);
    if (!updated) return NextResponse.json({ error: "Model not found" }, { status: 404 });
    // Re-sync config.yaml whenever fields that propagate to Hermes change
    // or when default slots move.
    syncDefaultsToHermesConfig();
    appendAuditLine({ action: "model.update", resource: id, ok: true });
    return NextResponse.json({ data: { model: updated } });
  } catch (error) {
    logApiError("PUT /api/models/[id]", `id=${id}`, error);
    return NextResponse.json({ error: "Failed to update model" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = requireAuth(request);
  if (auth) return auth;

  const { id } = await ctx.params;
  try {
    const ok = deleteModel(id);
    if (!ok) return NextResponse.json({ error: "Model not found" }, { status: 404 });
    syncDefaultsToHermesConfig();
    appendAuditLine({ action: "model.delete", resource: id, ok: true });
    return NextResponse.json({ data: { deleted: id } });
  } catch (error) {
    logApiError("DELETE /api/models/[id]", `id=${id}`, error);
    return NextResponse.json({ error: "Failed to delete model" }, { status: 500 });
  }
}
