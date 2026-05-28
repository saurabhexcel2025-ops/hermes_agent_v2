// ═══════════════════════════════════════════════════════════════
// mission-dispatch.ts — Shared immediate mission dispatch (API + queue sync)
// ═══════════════════════════════════════════════════════════════

import { getMission, updateMission } from "@/lib/mission-repository";
import { createSession, updateSession } from "@/lib/session-repository";
import { agentBackend } from "@/lib/backends";
import { logApiError } from "@/lib/api-logger";

export interface DispatchMissionNowOverrides {
  profileName?: string;
  modelId?: string;
  provider?: string;
}

export interface DispatchMissionNowResult {
  ok: boolean;
  sessionId?: string;
}

async function pollForSessionId(missionId: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      const sid = await agentBackend.getMissionSessionId?.(missionId);
      if (sid) return sid;
    } catch {
      /* keep polling */
    }
  }
  return undefined;
}

/**
 * Transition a mission to dispatched and spawn the Hermes backend process.
 */
export async function dispatchMissionNow(
  missionId: string,
  overrides: DispatchMissionNowOverrides = {},
): Promise<DispatchMissionNowResult> {
  const mission = getMission(missionId);
  if (!mission) {
    return { ok: false };
  }

  const profileName = overrides.profileName ?? mission.profileName;
  const modelId = overrides.modelId ?? mission.modelId;
  const provider = overrides.provider ?? mission.provider;

  updateMission(missionId, { status: "dispatched", queuedForRun: false });

  let sessionIdFromDb: string | undefined;
  try {
    const session = createSession({
      source: "mission",
      missionId,
      profileName: profileName ?? null,
      modelId: modelId ?? null,
      provider: provider ?? null,
      title: mission.name,
      status: "active",
    });
    sessionIdFromDb = session.id;
  } catch (err) {
    logApiError("dispatchMissionNow", "createSession", err);
  }

  try {
    const dispatched = await agentBackend.dispatchMission({
      missionId,
      name: mission.name,
      prompt: mission.prompt,
      profileId: mission.profileId,
      profileName,
      modelId,
      provider,
    });

    let sessionId: string | undefined = dispatched.sessionId ?? sessionIdFromDb;
    if (!sessionId && sessionIdFromDb) {
      sessionId = sessionIdFromDb;
    } else if (!sessionId) {
      sessionId = await pollForSessionId(missionId);
    }

    updateMission(missionId, {
      sessionId,
      status: "dispatched",
      queuedForRun: false,
    });

    return { ok: true, sessionId };
  } catch (err) {
    logApiError("dispatchMissionNow", "dispatch", err);
    if (sessionIdFromDb) {
      updateSession(sessionIdFromDb, {
        status: "failed",
        endedAt: new Date().toISOString(),
      });
    }
    updateMission(missionId, { status: "failed", queuedForRun: false });
    return { ok: false };
  }
}
