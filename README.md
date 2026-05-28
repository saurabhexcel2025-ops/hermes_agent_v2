# Hermes AI Agent Platform

Self-hosted AI agent platform with persistent memory, powered by Ollama Cloud.

## Stack

| Service | Description | Port |
|---|---|---|
| **hermes_postgres** | pgvector — vector storage for mem0 | 5432 |
| **hermes_neo4j** | Neo4j — entity graph for mem0 | 7474 / 7687 |
| **hermes_mem0** | Self-hosted mem0 memory server | 8888 |
| **hermes_control_hub** | Mission Control dashboard (Next.js) | 42069 |

## One-line Deploy

```bash
# 1. Clone
git clone https://github.com/saurabhexcel2025-ops/hermes_agent_v2.git hermes
cd hermes

# 2. Configure
cp .env.example .env
# Edit .env — add your OLLAMA_API_KEY

# 3. Deploy
docker compose up --build -d
```

Done. Visit `http://your-server-ip:42069` for the Control Hub.

## Requirements

- Docker + Docker Compose v2
- 4 GB RAM minimum (Neo4j + sentence-transformers)
- Outbound internet access (Ollama Cloud API + HuggingFace model download on first start)

## Hermes Agent (Gateway)

The Hermes agent CLI runs outside Docker. Install it on the server:

```bash
# Install hermes CLI (see hermes docs)
# Then configure it:
hermes setup  # select: ollama-cloud provider, glm-5 model
```

Set these in `~/.hermes/.env`:
```
OLLAMA_API_KEY=your_key
MEM0_BASE_URL=http://localhost:8888
MEM0_USER_ID=hermes-user
MEM0_AGENT_ID=hermes
```

Start the gateway:
```bash
hermes gateway run
```

## Available Models (Ollama Cloud)

- `glm-5` — default, fast reasoning model
- `kimi-k2.6` — strong coding model
- `qwen3.5` — multilingual model

Switch model: edit `OLLAMA_LLM_MODEL` in `.env` and `model.default` in `~/.hermes/cli-config.yaml`.
