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
    signal: AbortSignal.timeout(timeoutMs),
  });
}
