// ═══════════════════════════════════════════════════════════════
// gateway-client.ts — Shared Hermes gateway HTTP helpers
// ═══════════════════════════════════════════════════════════════

import { getAgentLlmEndpoints } from "./hermes-agent-runtime";

/**
 * Build a full URL under the configured Hermes gateway base.
 */
export function gatewayUrl(path: string): string {
  const { gatewayBase } = getAgentLlmEndpoints();
  const base = gatewayBase.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Build Authorization headers for the gateway when API_SERVER_KEY is set.
 */
export function gatewayAuthHeaders(): Record<string, string> {
  const key = process.env.HERMES_GATEWAY_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/**
 * Fetch JSON from the gateway with a timeout.
 */
export async function fetchGateway(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? 3000;
  const { timeoutMs: _drop, ...rest } = init ?? {};
  return fetch(gatewayUrl(path), {
    ...rest,
    headers: { ...gatewayAuthHeaders(), ...(rest.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
