# Lenny's Council

A multi-mode AI workspace built on Lenny Rachitsky's full podcast + newsletter archive (295 podcasts, 349 newsletters, 45,000+ speaker-attributed chunks). Ask a question and the system picks experts who actually said something on the topic, then runs a grounded multi-round discussion with verbatim citations.

## Modes

| Mode | What it does |
|---|---|
| **Roundtable** | 3–5 experts auto-selected, 3+ rounds of discussion + synthesis. Each turn = single paragraph, with thinking visible on demand. |
| **Validate idea** | Multi-axis critique (problem, wedge, GTM, pricing, moat) of a product idea |
| **PRD review** | Expert panel reviews a PRD, surfaces gaps, recommends a v1 |
| **Career mentor** | 1:1 chat with a leadership coach persona, persistent conversation |
| **Strategy advisor** | 1:1 strategy thinking partner |
| **Gap scanner** | Mines the corpus for unsolved problems in a topic area |

Top-right has a **model picker** that reads from your local Ollama (`/api/tags`) — switch models per session.

## Stack

- **Frontend:** SvelteKit 2 + Svelte 5 + Tailwind 4 + TypeScript
- **Backend:** SvelteKit server routes (Bun runtime)
- **DB:** PostgreSQL 16 + pgvector + pg_trgm (local; migration target Supabase)
- **LLM/embeddings:** Ollama (`nomic-embed-text` for embeddings, `kimi-k2.6:cloud` for chat)
- **Auth:** Single local user shim (multi-user via Supabase Auth on migration)

## Prerequisites

- WSL2 (Ubuntu 24.04) or Linux/macOS
- Bun ≥ 1.3
- PostgreSQL 16 with `postgresql-16-pgvector` package
- Ollama daemon running (Windows app on WSL → use Windows host IP, otherwise `localhost`)
- Models pulled: `ollama pull nomic-embed-text` and `ollama pull kimi-k2.6:cloud`

## First-time setup

```bash
# 1. Create the database (one-time, requires sudo)
./scripts/bootstrap-db.sh

# 2. Install dependencies
bun install

# 3. Copy env template and adjust if needed
cp .env.example .env.local
#    For WSL → Windows Ollama: set OLLAMA_BASE_URL to the Windows host IP
#    discover with: ip route show default | awk '{print $3}'

# 4. Verify everything is reachable
bun run preflight     # should print "10 / 10 checks passed"

# 5. Apply database migrations
bun run migrate

# 6. Ingest the corpus (~17 minutes for the full 644-file archive)
bun run ingest

# 7. Build expert profiles from the ingested chunks
bun run build-experts

# 8. Enrich profiles with bios + frameworks + voice (~20 minutes for ~318 experts)
#    Defaults to corpus-only; pass --no-web to skip web search if you don't have a cloud key.
#    With OLLAMA_CLOUD_API_KEY set, it also pulls live web context for each expert.
bun run enrich-experts --no-web

# 9. Start the dev server
bun run dev
# → http://localhost:5173
```

## Serving on the LAN (WSL)

`bun run dev` and `bun run preview` already bind to `0.0.0.0`, so the SvelteKit
server listens on every interface inside WSL. Getting those requests to arrive
from other devices on the network needs one of the following:

**Option A — port forward from Windows (per-boot, admin UAC).**
A ready-to-run script lives at `C:\Users\Mani\setup-lr-network.ps1`. It:
1. Looks up the current WSL IP.
2. `netsh portproxy`s Windows:5173 → WSL:5173.
3. Opens a firewall rule for inbound TCP 5173.

Right-click the `.ps1` → *Run with PowerShell* → accept UAC. It prints the LAN
URLs when done. Re-run after every Windows reboot (or wrap it in a scheduled
task triggered by *At startup*).

**Option B — mirrored networking (one-time, then forever).**
`C:\Users\Mani\.wslconfig` is already set up for this. Run `wsl --shutdown`
once in PowerShell; WSL restarts with mirrored networking, and ports bound
inside WSL appear directly on the Windows LAN IP. No port-forward, no admin.
Caveat: `OLLAMA_BASE_URL` must switch from `172.23.224.1` to `localhost` in
`.env.local` because mirrored mode collapses the WSL gateway into loopback.

**Option C — Tailscale.** Zero-config, encrypted, identity-gated. Install in
WSL, `tailscale up`, share the node. Best for sharing with someone not on
your physical network.

> **Auth caveat:** the app currently uses a single-user shim. Anyone who
> reaches the URL *is* the user. Fine for a trusted LAN demo; put Caddy /
> nginx basic-auth (or Supabase auth — tracked for the migration) in front
> before a public-exposed deployment.

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Start the SvelteKit dev server |
| `bun run preflight` | Verify Postgres + Ollama are reachable, models pulled |
| `bun run migrate` | Apply pending SQL migrations |
| `bun run ingest [--limit N] [--source-type podcast\|newsletter]` | Ingest corpus chunks |
| `bun run build-experts` | Aggregate per-expert profile rows from chunks |
| `bun run enrich-experts [--no-web] [--limit N] [--force]` | Generate bio + frameworks + voice via LLM (corpus + optional web search) |
| `bun run smoke-roundtable "question"` | Headless Roundtable end-to-end test |
| `bun run check` | TypeScript + Svelte type-check |

## Architecture

```
┌──────────────┐
│ SvelteKit UI │  ── /roundtable, /validate, /prd, /mentor, /strategy, /gaps
└──────┬───────┘
       │ SSE stream (event: turn_start | content | turn_end | session_complete)
┌──────▼───────────────────────────────────────────────────────┐
│ Orchestration                                                │
│  • runRoundtable     • runExpertPanel  • runSingleExpertChat │
│  • scanGaps                                                  │
└──────┬───────────────────────────────────────────────────────┘
       │
┌──────▼──────────┐    ┌──────────────────┐
│ Expert selector │ ←→ │ Hybrid retrieval │
│ (rank by match  │    │ (BM25 + pgvector │
│  × authority    │    │  RRF merge)      │
│  × recency)     │    └──────────────────┘
└──────┬──────────┘
       │
┌──────▼─────────┐    ┌─────────────────┐
│ Postgres       │    │ Ollama daemon   │
│  • chunks      │    │  • nomic-embed  │
│  • experts     │    │  • kimi-k2.6    │
│  • chats       │    └─────────────────┘
│  • messages    │
│  • citations   │
└────────────────┘
```

### Key design choices

- **Speaker-turn chunking** for podcasts preserves attribution — every chunk carries the speaker who said it, so personas can be grounded in their own words.
- **Hybrid retrieval (RRF merge of BM25 + pgvector)** balances lexical and semantic match — handles both keyword-y queries and conceptual ones.
- **Per-expert grounding** — when an expert speaks in a roundtable, they only see chunks from THEIR own corpus, which keeps personas authentic.
- **Citations as `[c:N]`** — the LLM emits these inline; we parse them out, validate the chunk exists, and persist a citation row linking the message to the source.
- **Thinking disabled (for now)** — kimi-k2.6's reasoning trace eats the token budget. Re-enable with bigger budget in `src/lib/server/orchestration/*.ts` to surface "expert is reasoning…" UX.

## Data

The corpus (not in this repo) lives at `../lennys-newsletterpodcastdata-all/`. After ingestion you'll have:
- ~45,000 chunks
- ~319 expert profiles (293 named guests + ~26 incidental speakers, naturally low-ranked)
- 1 host (Lenny Rachitsky) marked `is_host=true` and excluded from expert selection by default

## Migration to Supabase + Ollama Cloud

See [`MIGRATION.md`](./MIGRATION.md).

## Troubleshooting

**Preflight: `ollama.embed.dim` fails with `the input length exceeds the context length`**
- Some chunks exceed the model's effective context. Lower the `MAX_CHUNK_CHARS` cap in `src/lib/server/ingest/chunker.ts` — empirically nomic-embed-text rejects chunks > ~4500 chars even with `num_ctx: 8192`.

**Preflight: `ollama.chat.smoketest` returns empty content**
- `kimi-k2.6` thinking ate the budget. Either bump `maxTokens` (default 4000 in orchestrators) or set `think: false`.

**Dev server: `DATABASE_URL is not set`**
- Run via `bun run dev` (which uses `bun --env-file=.env.local`). Plain `vite dev` doesn't auto-load private env vars.

**WSL → Windows Ollama: `localhost:11434` unreachable**
- Use the Windows host IP: `ip route show default | awk '{print $3}'`. Set as `OLLAMA_BASE_URL` in `.env.local`. The IP changes per WSL boot.
