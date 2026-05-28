// ═══════════════════════════════════════════════════════════════
// mem0.ts — Self-hosted mem0 memory provider
// Calls the mem0-server at MEM0_BASE_URL (default: localhost:8888)
// ═══════════════════════════════════════════════════════════════

import { logApiError } from "@/lib/api-logger";
import type {
  MemoryProvider,
  MemoryProviderHealth,
  MemoryReadResult,
  MemoryAddResult,
  MemoryUpdateResult,
  MemoryDeleteResult,
  FactInput,
  FactUpdateInput,
} from "./index";

const MEM0_BASE_URL = process.env.MEM0_BASE_URL ?? "http://localhost:8888";
const DEFAULT_USER_ID = process.env.MEM0_USER_ID ?? "hermes-user";
const TIMEOUT_MS = 15_000;

async function mem0Fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${MEM0_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`mem0 ${init?.method ?? "GET"} ${path}: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const mem0Provider: MemoryProvider = {
  type: "mem0" as const,

  async healthCheck(): Promise<MemoryProviderHealth> {
    try {
      const result = await mem0Fetch<{ status: string }>("/health", { method: "GET" });
      return {
        available: result.status === "ok",
        provider: "mem0" as const,
        message: result.status === "ok" ? "mem0 self-hosted server is healthy" : "mem0 initializing",
      };
    } catch (e) {
      return {
        available: false,
        provider: "mem0" as const,
        message: `mem0 server unreachable at ${MEM0_BASE_URL}: ${e instanceof Error ? e.message : "Unknown error"}`,
      };
    }
  },

  async readFacts(options): Promise<MemoryReadResult> {
    try {
      const params = new URLSearchParams({ user_id: DEFAULT_USER_ID });
      if (options?.search) params.set("search", options.search);
      if (options?.limit) params.set("limit", String(options.limit));

      const result = await mem0Fetch<{ results: Array<Record<string, unknown>>; total: number }>(
        `/v1/memories?${params}`
      );

      const facts = (result.results ?? []).map((item, idx) => ({
        id: typeof item.id === "number" ? item.id : idx,
        content: String(item.memory ?? item.content ?? ""),
        category: String(item.categories ?? item.category ?? "general"),
        tags: Array.isArray(item.tags) ? (item.tags as string[]).join(",") : String(item.tags ?? ""),
        trust: typeof item.score === "number" ? (item.score as number) : 0.7,
        createdAt: String(item.created_at ?? new Date().toISOString()),
        updatedAt: String(item.updated_at ?? item.created_at ?? new Date().toISOString()),
      }));

      return {
        facts,
        total: result.total ?? facts.length,
        dbSize: 0,
        available: true,
        provider: "mem0" as const,
      };
    } catch (e) {
      logApiError("mem0Provider.readFacts", "reading facts", e);
      return {
        facts: [],
        total: 0,
        dbSize: 0,
        available: false,
        provider: "mem0" as const,
        message: `Failed to read from mem0: ${e instanceof Error ? e.message : "Unknown error"}`,
      };
    }
  },

  async addFact(input: FactInput): Promise<MemoryAddResult> {
    try {
      await mem0Fetch("/v1/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: input.content }],
          user_id: DEFAULT_USER_ID,
          infer: false,
        }),
      });
      const now = new Date().toISOString();
      return {
        success: true,
        fact: {
          id: Date.now(),
          content: input.content,
          category: input.category ?? "general",
          tags: input.tags ?? "",
          trust: input.trust_score ?? 0.7,
          createdAt: now,
          updatedAt: now,
        },
      };
    } catch (e) {
      logApiError("mem0Provider.addFact", "adding fact", e);
      return { success: false, error: `Failed to add: ${e instanceof Error ? e.message : "Unknown error"}` };
    }
  },

  async updateFact(input: FactUpdateInput): Promise<MemoryUpdateResult> {
    try {
      if (!input.content) return { success: false, error: "content is required for update" };
      await mem0Fetch(`/v1/memories/${input.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: input.content }),
      });
      return { success: true, id: input.id };
    } catch (e) {
      logApiError("mem0Provider.updateFact", "updating fact", e);
      return { success: false, error: `Failed to update: ${e instanceof Error ? e.message : "Unknown error"}` };
    }
  },

  async deleteFact(id: number): Promise<MemoryDeleteResult> {
    try {
      await mem0Fetch(`/v1/memories/${id}`, { method: "DELETE" });
      return { success: true, id };
    } catch (e) {
      logApiError("mem0Provider.deleteFact", "deleting fact", e);
      return { success: false, error: `Failed to delete: ${e instanceof Error ? e.message : "Unknown error"}` };
    }
  },
};
