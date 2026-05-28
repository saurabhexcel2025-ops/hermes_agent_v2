"use client";

import { useCallback } from "react";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Centralized fetch helpers for the Missions page (keeps route strings in one place).
 */
export function useMissionsApi() {
  const fetchMissions = useCallback(async () => {
    const d = await apiFetch("/api/missions");
    return d.data?.missions ?? [];
  }, []);

  const fetchTemplates = useCallback(async () => {
    const d = await apiFetch("/api/templates");
    return d.data?.templates ?? [];
  }, []);

  const fetchMissionDetail = useCallback(async (id: string) => {
    const d = await apiFetch("/api/missions?id=" + encodeURIComponent(id));
    return d.data ?? null;
  }, []);

  const fetchCategories = useCallback(async () => {
    const d = await apiFetch("/api/mission-categories");
    return d.data?.categories ?? [];
  }, []);

  const createCategory = useCallback(async (name: string, color?: string) => {
    const d = await apiFetch("/api/mission-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    return d.data?.category ?? null;
  }, []);

  const updateCategory = useCallback(
    async (
      id: string,
      patch: { name?: string; color?: string; sortOrder?: number },
    ) => {
      await apiFetch("/api/mission-categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
    },
    [],
  );

  const deleteCategory = useCallback(
    async (id: string, reassignToId: string | null) => {
      const params = new URLSearchParams({ id });
      if (reassignToId) params.set("reassignToId", reassignToId);
      await apiFetch(`/api/mission-categories?${params.toString()}`, {
        method: "DELETE",
      });
    },
    [],
  );

  return {
    fetchMissions,
    fetchTemplates,
    fetchMissionDetail,
    fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
  };
}
