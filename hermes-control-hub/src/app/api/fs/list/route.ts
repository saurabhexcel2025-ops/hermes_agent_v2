// ═══════════════════════════════════════════════════════════════
// GET /api/fs/list — list one directory level under allowed roots
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { readdirSync, statSync, existsSync } from "fs";
import { homedir } from "os";
import { resolve as pathResolve } from "path";

import { logApiError } from "@/lib/api-logger";
import { resolveAllowedWorkspacePath } from "@/lib/path-security";

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const pathParam = url.searchParams.get("path")?.trim();
    const showHidden = url.searchParams.get("showHidden") === "1";

    const rootInput = pathParam && pathParam.length > 0 ? pathParam : homedir();
    const resolved = resolveAllowedWorkspacePath(rootInput);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const abs = resolved.absolute;

    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const entries: { name: string; isDir: boolean; isFile: boolean }[] = [];
    for (const name of readdirSync(abs)) {
      if (!showHidden && name.startsWith(".")) continue;
      const full = pathResolve(abs, name);
      try {
        const st = statSync(full);
        entries.push({
          name,
          isDir: st.isDirectory(),
          isFile: st.isFile(),
        });
      } catch {
        // Skip unreadable entries
      }
    }
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    let parent: string | null = null;
    const parentResolved = resolveAllowedWorkspacePath(pathResolve(abs, ".."));
    if (parentResolved.ok && parentResolved.absolute !== abs) {
      parent = parentResolved.absolute;
    }

    return NextResponse.json({
      data: { path: abs, parent, entries },
    });
  } catch (error) {
    logApiError("GET /api/fs/list", "listing path", error);
    return NextResponse.json({ error: "Failed to list directory" }, { status: 500 });
  }
}
