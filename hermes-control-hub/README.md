# SpaceArmour Mission Control

A web-based mission control dashboard for managing AI agents, built for [SpaceArmour](https://spacearmour.io). Powered by [Hermes Agent](https://hermes-agent.nousresearch.com) and Ollama for local LLM inference.

Dispatch missions, manage cron jobs, browse sessions, monitor your agent, and control everything from one dashboard — without living in the terminal.

---

## Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS, Jost font |
| **Backend** | Next.js API routes, better-sqlite3 (app data) |
| **Auth** | PostgreSQL (Docker), bcrypt, JWT (access 15m + refresh 7d) |
| **AI Agent** | Hermes Agent (NousResearch) |
| **LLM** | Ollama via Docker (llama3.2:3b or any Ollama model) |
| **Messaging** | Native Slack bot support (Socket Mode) |

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| **macOS or Linux** | Bootstrap scripts use bash |
| **Node.js 20+** | |
| **Docker** | For Ollama (LLM) and PostgreSQL (auth) |
| **Hermes Agent** | Install at `~/.hermes/` — [guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation) |

---

## Quick Start

### 1. Start Docker services

```bash
docker compose up -d
```

This starts:
- **Ollama** on port `11434` (LLM inference)
- **PostgreSQL** on port `5432` (auth database)

### 2. Pull a model into Ollama

```bash
docker exec -it ollama ollama pull llama3.2:3b
```

### 3. Configure environment

Copy `.env.example` to `.env.local` and fill in:

```bash
# PostgreSQL
DATABASE_URL=postgresql://hermes:hermes_pass@localhost:5432/hermes_auth

# JWT secrets — generate with: openssl rand -hex 32
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
```

### 4. Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000` — you'll be redirected to `/login` on first visit.

---

## Authentication

- Sign up at `/signup` with email + password
- Credentials stored in PostgreSQL (bcrypt, 12 rounds)
- JWT access token (15 min) + refresh token (7 days) in HTTP-only cookies
- Middleware auto-refreshes the access token from the refresh token on every request
- Sign out via the sidebar button

---

## Hermes Agent Setup

Install Hermes and configure it to use Ollama:

```bash
# Install Hermes
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

# Configure ~/.hermes/config.yaml
model:
  default: "llama3.2:3b"
  provider: "ollama"
  base_url: "http://127.0.0.1:11434/v1"
```

Add to `~/.hermes/hermes-agent/.env`:

```env
API_SERVER_ENABLED=true
API_SERVER_PORT=8642
API_SERVER_HOST=127.0.0.1
GATEWAY_ALLOW_ALL_USERS=true
```

Start the gateway:

```bash
hermes gateway start
```

The dashboard connects to the gateway at `http://127.0.0.1:8642`.

---

## Slack Bot

Hermes has native Slack support via Socket Mode (no public URL required).

Add to `~/.hermes/hermes-agent/.env`:

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

Then restart: `hermes gateway restart`

**Required Slack app scopes:** `chat:write`, `app_mentions:read`, `im:history`, `im:read`, `im:write`
**Required events:** `app_mention`, `message.im`

---

## Dashboard Sections

| Section | What it does |
|---------|-------------|
| **Dashboard** | Live health, active missions, sync status |
| **Orchestration → Missions** | Compose, dispatch, and schedule missions |
| **Orchestration → Cron** | Scheduled agent cron jobs |
| **Orchestration → Chat** | Gateway-backed chat interface |
| **Sessions / Memory** | Browse transcripts and memory stores |
| **Operations → Agents / Skills / Tools** | Agent configuration |
| **Config → Models / YAML** | Models registry, Hermes config editor |

---

## Development

```bash
npm run dev          # hot reload
npm run build        # production build
npm test             # unit tests
```

---

## Data Locations

| Location | Holds |
|----------|-------|
| `~/.hermes` | Hermes config, profiles, sessions, cron jobs |
| `~/control-hub/data` | Dashboard SQLite DB, missions, templates |
| PostgreSQL | User accounts and auth tokens |

