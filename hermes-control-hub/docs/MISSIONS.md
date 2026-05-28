# Missions

How missions are stored, dispatched, and cancelled. Missions live in SQLite (`missions` table) with optional JSON overlays under `CH_DATA_DIR/missions/`.

## Prompt model

- The UI sends **raw** fields (`instruction`, `context`, `goals`, `outputFormat`, `constraints`, dirs, refs, skills, suggested toolsets) on dispatch/update.
- The API builds the stored `prompt` via `buildMissionPrompt()` in `src/lib/build-mission-prompt.ts` — XML under `<hermes_mission>` (agent payload).
- The composer preview can toggle **Human** (form mirror) vs **AI** (stored agent prompt).
- Editing uses `parseMissionPrompt()` for instruction/context/output/constraints; goals, dirs, refs, skills, and suggested toolsets load from DB columns.
- **Recommended toolsets** are prompt hints only (`<recommended_toolsets>`); runtime tools still come from the mission profile's `platform_toolsets`. The composer lists only toolsets enabled on the selected profile. See [TOOLS_AND_MISSIONS.md](TOOLS_AND_MISSIONS.md).
- `output_format` and `constraints` columns (baseline schema) persist those fields for edit round-trip.
- Missions saved before the XML format may need re-save after deploy.

## Dispatch modes

`POST /api/missions` with `action: "dispatch"` accepts `dispatchMode`:

| Mode | Behavior |
|------|----------|
| `save` | Persists a **draft** (`status=queued`, `queued_for_run=0`). Does not spawn Hermes. Shown in the **Drafts** board column. |
| `queue` | Persists as **queued for run** (`queued_for_run=1`). `MissionQueueSync` dispatches the oldest queued mission when no mission is `dispatched` (single-flight, ~15s tick). |
| `now` | Creates the mission and dispatches immediately via `dispatchMissionNow()`. |
| `cron` | Creates a linked `cron_jobs` row, pushes to Hermes, and runs the **first** execution immediately; later runs follow the schedule. |

### Model resolution at dispatch

`resolveMissionModel()` in `src/lib/backends/hermes.ts`:

- If both `modelId` and `provider` are sent → used as-is.
- If only `modelId` is sent → provider (and API key when configured) are resolved from the models registry (`findModelByModelId`).
- If neither is sent → the registry **agent** default from `model_defaults` is used.

The composer pre-fills the agent default model from `GET /api/models/defaults` when opening a new mission.

### Board columns vs status

- **Drafts:** `status=queued` and `queued_for_run=0` (save).
- **Queued:** `status=queued` and `queued_for_run=1` (queue, waiting for the worker).
- **Dispatched / Completed / Failed:** same as `status` enum.

Dashboard **active** count includes `dispatched` missions and queued-for-run missions, not drafts.

## Editing drafts and promoting queued missions

- **Draft** (`status=queued`, `queued_for_run=0`): edit in the composer, choose a dispatch mode, and submit. The UI calls `POST /api/missions` with `action: "promote"` (not `update`).
- **Queued for run** (`status=queued`, `queued_for_run=1`): same promote path — you can update fields, move back to drafts (`dispatchMode: save`), keep in queue (`queue`), or run immediately (`now`).
- **Running** (`status=dispatched`): `action: "update"` only — fields and linked cron sync; no duplicate mission.
- **Completed / failed**: re-dispatch creates a **new** mission id with `action: "dispatch"` and `dispatchMode: now`.

`promote` accepts the same payload fields as dispatch (instruction, profile, model, schedule, etc.). Queue promote triggers an immediate `runMissionQueueTick()` when nothing is already dispatched.

### Sync bootstrap on missions API

`GET` and `POST /api/missions` call `ensureSyncLayer()` so `MissionQueueSync` runs even when the operator stays on Orchestration → Missions without opening the dashboard (which polls `/api/monitor`).

## Categories

- User-managed categories live in `mission_categories` (SQLite).
- Missions use `category_id` (nullable). Templates store `categoryId` in custom JSON.
- APIs: `GET/POST/PUT/DELETE /api/mission-categories`.
- Default categories are seeded via `src/lib/db/seeds/001_mission_categories.sql` and **`npm run db:seed`** (8 categories with `seed_key`).

### Database migrations (operator)

Runtime database path: `CH_DATA_DIR/control-hub.db` (default `~/control-hub/data/control-hub.db`).

1. After deploying new code, **restart** the Control Hub process so `getDb()` runs pending migrations.
2. `npm run build` alone does **not** migrate your live DB (prebuild only touches `repo/data/`).
3. If the UI shows “No categories loaded”, on the host run:

   ```bash
   npm run db:migrate
   ```

   Ensure `CH_DATA_DIR` in `.env.local` matches where the server stores data, then restart.

4. Create categories from **Manage categories** (missions page) or the category combobox in the composer.

## Recurring missions

- Recurring missions link to `cron_jobs` via `cron_job_id`.
- Updates to prompt, schedule, profile, or model sync through `src/lib/mission-cron-sync.ts` (`syncMissionToCronJob`).
- Cancel pauses cron; delete removes the linked cron job.

## Cancellation

When you cancel a **running** mission from the mission board:

1. **SQLite** — status becomes `failed` with result `Cancelled by user`.
2. **Process** — `HermesAgentBackend.cancelMission()` reads `CH_DATA_DIR/missions/<id>.pid.json`, sends `SIGTERM` to the bash wrapper process group, then `SIGKILL` after a short grace period. Fallback: `pkill -f CH_MISSION_ID=<uuid>`.
3. **Status file** — `missions/<id>.status.json` is written so `MissionSync` matches the UI.
4. **Session** — linked session row is ended with `failed` when `sessionId` is set.
5. **Cron** — linked recurring job is paused (same as before).

Missions use non-interactive `hermes chat -q` (not an interactive TTY), so slash commands like `/stop` do not apply. Stopping the parent OS process matches [Hermes delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation): interrupting the parent run stops delegated subagents.

**Platforms:** process kill is implemented for **Linux and macOS** only (same as bootstrap scripts). If kill fails, the DB and cron pause still apply; check server logs and `~/.hermes/logs` for details.

## UI

- **Compose:** right-side Sheet (`MissionCreateForm`) with category combobox and prompt preview.
- **View:** inline `MissionEditorPanel` on the mission board (no sheet scroll).
