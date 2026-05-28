// ═══════════════════════════════════════════════════════════════
// useGatewayHealth — Unified gateway connectivity + agent model status
// ═══════════════════════════════════════════════════════════════
// Consolidates three separate useEffect patterns from the chat page:
//   1. Gateway online check (polls every 30s)
//   2. Agent default model set check
//   3. Registry + gateway model list
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
import { CHAT_DEFAULT_MODEL } from "@/types/chat";

const GATEWAY_HEALTH_URL = "/api/gateway/health";
const GATEWAY_MODELS_URL = "/api/gateway/models";
const MODELS_REGISTRY_URL = "/api/models";
const MODELS_DEFAULTS_URL = "/api/models/defaults";
const CONFIG_URL = "/api/config";

export interface GatewayHealth {
  /** Whether the Hermes Gateway is reachable */
  online: boolean | null;
  /** Whether both registry and disk have an agent default model set */
  agentDefaultModelSet: boolean | null;
  /** Model IDs from the registry catalog */
  registryModelIds: string[];
  /** Human-readable name map for registry models */
  modelLabels: Record<string, string>;
  /** Model IDs available from the gateway */
  gatewayModelIds: string[];
  /** Whether model list loading encountered an error */
  modelsError: string | null;
  /** Whether the model list is currently being fetched */
  modelsLoading: boolean;
}

interface GatewayModelsResponse {
  data?: { models?: string[] };
}

/**
 * Fetch gateway health, model lists, and agent default status.
 *
 * Returns `online: null` during initial load, `false` if unreachable,
 * `true` if the gateway health endpoint responds 2xx.
 *
 * Returns `agentDefaultModelSet: null` during initial load, `false` if
 * either registry or disk config lacks an agent default, `true` if both are set.
 */
export function useGatewayHealth(): GatewayHealth & {
  refetchHealth: () => void;
  refetchModels: () => Promise<void>;
} {
  const [online, setOnline] = useState<boolean | null>(null);
  const [agentDefaultModelSet, setAgentDefaultModelSet] = useState<boolean | null>(null);
  const [registryModelIds, setRegistryModelIds] = useState<string[]>([]);
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({});
  const [gatewayModelIds, setGatewayModelIds] = useState<string[]>([CHAT_DEFAULT_MODEL]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

  // ── Check gateway connectivity ───────────────────────────────
  const checkOnline = useCallback(async () => {
    try {
      const res = await fetch(GATEWAY_HEALTH_URL, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const json = await res.json();
        setOnline(json.data?.online === true);
      } else {
        setOnline(false);
      }
    } catch {
      setOnline(false);
    }
  }, []);

  // ── Check agent default model setup ─────────────────────────
  const checkAgentModel = useCallback(async () => {
    try {
      const [defaultsRes, configRes] = await Promise.all([
        fetch(MODELS_DEFAULTS_URL, { signal: AbortSignal.timeout(5000) }),
        fetch(CONFIG_URL, { signal: AbortSignal.timeout(5000) }),
      ]);
      let registryOk = false;
      if (defaultsRes.ok) {
        const defaultsJson = (await defaultsRes.json()) as {
          data?: { defaults?: { agent?: string } };
        };
        registryOk = Boolean(defaultsJson.data?.defaults?.agent?.trim());
      }
      let diskOk = false;
      if (configRes.ok) {
        const cfgJson = (await configRes.json()) as {
          data?: { model?: { default?: string } | string };
        };
        const modelCfg = cfgJson.data?.model;
        if (typeof modelCfg === "string") {
          diskOk = modelCfg.trim().length > 0;
        } else if (modelCfg && typeof modelCfg === "object") {
          diskOk = Boolean(String((modelCfg as Record<string, unknown>).default ?? "").trim());
        }
      }
      setAgentDefaultModelSet(registryOk && diskOk);
    } catch {
      setAgentDefaultModelSet(null);
    }
  }, []);

  // ── Fetch model lists ───────────────────────────────────────
  const fetchModels = useCallback(async () => {
    setModelsError(null);
    setModelsLoading(true);
    const labels: Record<string, string> = {};
    let registryIds: string[] = [];
    let gateway: string[] = [CHAT_DEFAULT_MODEL];

    try {
      const [registryRes, gatewayRes] = await Promise.all([
        fetch(MODELS_REGISTRY_URL),
        fetch(GATEWAY_MODELS_URL, { signal: AbortSignal.timeout(5000) }),
      ]);

      if (registryRes.ok) {
        const registryJson = await registryRes.json();
        const records = registryJson.data?.models as Array<{
          modelId: string;
          name: string;
        }> | undefined;
        if (Array.isArray(records)) {
          registryIds = records
            .map((m) => m.modelId)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
          for (const m of records) {
            if (m.modelId) labels[m.modelId] = m.name;
          }
        }
      }

      if (gatewayRes.ok) {
        const gatewayJson = (await gatewayRes.json()) as GatewayModelsResponse;
        const ids: string[] = gatewayJson.data?.models || [];
        if (ids.length > 0) gateway = ids;
      } else {
        setModelsError("Gateway models unavailable");
      }
    } catch {
      setModelsError("Failed to load models");
    } finally {
      setRegistryModelIds(registryIds);
      setGatewayModelIds(gateway);
      setModelLabels(labels);
      setModelsLoading(false);
    }
  }, []);

  // ── Initial load ────────────────────────────────────────────
  useEffect(() => {
    void checkOnline();
    void checkAgentModel();
    void fetchModels();
  }, [checkOnline, checkAgentModel, fetchModels]);

  // ── Poll gateway health every 30s ───────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      void checkOnline();
    }, 30_000);
    return () => clearInterval(id);
  }, [checkOnline]);

  return {
    online,
    agentDefaultModelSet,
    registryModelIds,
    modelLabels,
    gatewayModelIds,
    modelsError,
    modelsLoading,
    refetchHealth: checkOnline,
    refetchModels: fetchModels,
  };
}
