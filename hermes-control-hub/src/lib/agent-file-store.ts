// Maps behaviour file keys ↔ SQLite (agent_profiles / agent_root)

import { getAgentRoot, updateAgentRoot } from "./agent-root-repository";
import { getProfile, updateProfileContent } from "./profiles-repository";

export type ManagedFileKey =
  | "soul"
  | "agent"
  | "user"
  | "memory"
  | "config"
  | "hermes";

export function readManagedFileContent(
  profileSlug: string,
  key: ManagedFileKey,
): { content: string; updatedAt: string } | null {
  if (profileSlug === "default") {
    const row = getAgentRoot();
    const map: Record<ManagedFileKey, { content: string }> = {
      soul: { content: row.soulMd },
      agent: { content: row.agentsMd },
      user: { content: row.userMd },
      memory: { content: row.memoryMd },
      config: { content: row.configYaml },
      hermes: { content: row.hermesMd },
    };
    const entry = map[key];
    if (!entry) return null;
    return { content: entry.content, updatedAt: row.updatedAt };
  }

  const row = getProfile(profileSlug);
  if (!row) return null;
  const map: Record<string, { content: string }> = {
    soul: { content: row.soulMd },
    agent: { content: row.agentsMd },
    user: { content: row.userMd },
    memory: { content: row.memoryMd },
    config: { content: row.configYaml },
  };
  const entry = map[key];
  if (!entry) return null;
  return { content: entry.content, updatedAt: row.updatedAt };
}

export function writeManagedFileContent(
  profileSlug: string,
  key: ManagedFileKey,
  content: string,
): boolean {
  if (profileSlug === "default") {
    const patch: Parameters<typeof updateAgentRoot>[0] = {};
    if (key === "soul") patch.soulMd = content;
    else if (key === "agent") patch.agentsMd = content;
    else if (key === "user") patch.userMd = content;
    else if (key === "memory") patch.memoryMd = content;
    else if (key === "config") patch.configYaml = content;
    else if (key === "hermes") patch.hermesMd = content;
    else return false;
    updateAgentRoot(patch);
    return true;
  }

  const patch: Parameters<typeof updateProfileContent>[1] = {};
  if (key === "soul") patch.soulMd = content;
  else if (key === "agent") patch.agentsMd = content;
  else if (key === "user") patch.userMd = content;
  else if (key === "memory") patch.memoryMd = content;
  else if (key === "config") patch.configYaml = content;
  else return false;
  return updateProfileContent(profileSlug, patch) !== null;
}
