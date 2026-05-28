export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════

// GET /api/fs/git/branches — list branches + current ref for a repo

// ═══════════════════════════════════════════════════════════════



import { NextRequest, NextResponse } from "next/server";



import { logApiError } from "@/lib/api-logger";

import { resolveAllowedWorkspacePath } from "@/lib/path-security";

import { readGitBranchMetadataForWorkspacePath } from "@/lib/git-workspace-branches";



export async function GET(request: NextRequest) {

  try {

    const pathParam = request.nextUrl.searchParams.get("path")?.trim();

    if (!pathParam) {

      return NextResponse.json({ error: "path is required" }, { status: 400 });

    }

    const resolved = resolveAllowedWorkspacePath(pathParam);

    if (!resolved.ok) {

      return NextResponse.json({ error: resolved.error }, { status: 400 });

    }

    const abs = resolved.absolute;



    const data = await readGitBranchMetadataForWorkspacePath(abs);



    return NextResponse.json({ data });

  } catch (error) {

    logApiError("GET /api/fs/git/branches", "git info", error);

    return NextResponse.json({ error: "Failed to read git branches" }, { status: 500 });

  }

}

