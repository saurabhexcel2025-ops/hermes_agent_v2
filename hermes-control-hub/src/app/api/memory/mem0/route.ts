export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { logApiError } from "@/lib/api-logger";
import type { ApiResponse } from "@/types/hermes";

const MEM0_BASE_URL = process.env.MEM0_BASE_URL ?? "http://localhost:8888";
const DEFAULT_USER_ID = process.env.MEM0_USER_ID ?? "hermes-user";
const TIMEOUT_MS = 15_000;

async function mem0Fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${MEM0_BASE_URL}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`mem0 ${init?.method ?? "GET"} ${path}: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface Mem0Memory {
  id: string;
  memory: string;
  categories?: string[];
  tags?: string[];
  score?: number;
  created_at?: string;
  updated_at?: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action") ?? "list";
  const query = searchParams.get("query") ?? "";
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  try {
    if (action === "health") {
      const result = await mem0Fetch<{ status: string }>("/health");
      return NextResponse.json<ApiResponse<{ available: boolean; status: string }>>({
        data: { available: result.status === "ok", status: result.status },
      });
    }

    if (action === "search" && query) {
      const params = new URLSearchParams({ user_id: DEFAULT_USER_ID, query, limit: String(limit) });
      const result = await mem0Fetch<{ results?: Mem0Memory[]; total?: number }>(
        `/v1/memories/search?${params}`,
      );
      return NextResponse.json<ApiResponse<{ memories: Mem0Memory[]; total: number }>>({
        data: { memories: result.results ?? [], total: result.total ?? 0 },
      });
    }

    // Default: list
    const params = new URLSearchParams({ user_id: DEFAULT_USER_ID, limit: String(limit) });
    const result = await mem0Fetch<{ results?: Mem0Memory[]; total?: number }>(
      `/v1/memories?${params}`,
    );
    return NextResponse.json<ApiResponse<{ memories: Mem0Memory[]; total: number }>>({
      data: { memories: result.results ?? [], total: result.total ?? 0 },
    });
  } catch (error) {
    logApiError("GET /api/memory/mem0", `action=${action}`, error);
    const msg = error instanceof Error ? error.message : "mem0 error";
    const isDown = msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("connect");
    return NextResponse.json(
      { data: { memories: [], total: 0, available: false, error: msg } },
      { status: isDown ? 503 : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json() as { id?: string };
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await mem0Fetch(`/v1/memories/${id}`, { method: "DELETE" });
    return NextResponse.json<ApiResponse<{ success: boolean; id: string }>>({
      data: { success: true, id },
    });
  } catch (error) {
    logApiError("DELETE /api/memory/mem0", "delete", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 },
    );
  }
}
