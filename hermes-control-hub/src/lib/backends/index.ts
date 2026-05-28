// ═══════════════════════════════════════════════════════════════
// backends/index.ts — Hermes agent backend singleton
// ═══════════════════════════════════════════════════════════════

import { HermesAgentBackend } from "./hermes";

export const agentBackend = new HermesAgentBackend();
export { HermesAgentBackend } from "./hermes";
