import type { FallbackConfigPutInput } from "@/lib/fallback-config-schema";

interface HermesAgentYaml {
  api_max_retries?: number;
  restore_primary_on_fallback?: boolean;
  fallback_notification?: boolean;
}

/**
 * Parse fallback behaviour fields from a Hermes config.yaml `agent` section.
 */
export function parseFallbackAgentSettingsFromYaml(
  agent: unknown,
): FallbackConfigPutInput {
  if (!agent || typeof agent !== "object") {
    return {};
  }
  const a = agent as HermesAgentYaml;
  const out: FallbackConfigPutInput = {};
  if (typeof a.api_max_retries === "number" && Number.isFinite(a.api_max_retries)) {
    out.apiMaxRetries = Math.min(10, Math.max(0, Math.trunc(a.api_max_retries)));
  }
  if (typeof a.restore_primary_on_fallback === "boolean") {
    out.restorePrimaryOnFallback = a.restore_primary_on_fallback;
  }
  if (typeof a.fallback_notification === "boolean") {
    out.fallbackNotification = a.fallback_notification;
  }
  return out;
}
