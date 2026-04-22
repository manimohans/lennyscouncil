<div align="center">

# Lenny's Council

**An AI expert panel built on Lenny Rachitsky's full podcast and newsletter archive.**

Ask a product question. The system picks the experts who actually spoke on that topic, runs a grounded multi-round discussion, and cites every claim back to the minute they said it.

[![SvelteKit](https://img.shields.io/badge/SvelteKit_2-FF3E00?logo=svelte&logoColor=white)](https://kit.svelte.dev/)
[![Svelte](https://img.shields.io/badge/Svelte_5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![Postgres](https://img.shields.io/badge/Postgres_16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![pgvector](https://img.shields.io/badge/pgvector-hybrid_RRF-4B32C3)](https://github.com/pgvector/pgvector)
[![Ollama](https://img.shields.io/badge/Ollama-local_first-black)](https://ollama.com/)
[![Bun](https://img.shields.io/badge/Bun-1.3+-000000?logo=bun&logoColor=white)](https://bun.sh/)

</div>

---

## Why this exists

Most AI "expert" apps do one of two things. They invent a persona and guess, or they bolt RAG onto a single LLM and call it a day. Neither produces the thing you actually want: a conversation among people who *already disagreed in public* about the exact problem you're working on.

Lenny Rachitsky has spent years getting the best PMs, founders, and operators to say what they actually think, on the record. **295 podcast episodes. 349 newsletter essays. Thousands of hours of transcripts with the speaker of every sentence tagged.** That archive is a product manager's dream corpus, and it's sitting there.

Lenny's Council turns it into a working advisory board. Pick a mode, drop in your question, and the system picks experts who have real receipts on the topic, then runs them against each other for three to five rounds. Every claim is a click away from the chunk where the person said it.

**This is not a roundtable app.** The Roundtable is the hero mode, but there are six different ways to use the same grounded-expert engine — panel review of a PRD, idea validation, a 1:1 career mentor, a strategy advisor, and a gap scanner that mines the corpus for unsolved problems.

## What makes it different

- **Grounded personas, not hallucinated ones.** When April Dunford speaks in a roundtable, she only sees chunks from her own recorded appearances. The system prompt is her voice, built from her corpus. She cannot go off-book because off-book doesn't exist.
- **Speaker-turn chunking.** Podcast transcripts are split on speaker changes, not on arbitrary token boundaries. Every chunk carries the speaker who said it. Attribution is a property of the data, not a guess at inference time.
- **Hybrid retrieval with RRF.** BM25 for keyword intent and pgvector for conceptual match, merged with reciprocal rank fusion. Handles both "*what's the right OKR cadence*" and "*how do I know when my positioning is actually working*" without tuning.
- **Citations you can verify.** The model emits inline `[c:N]` markers. We parse them, validate the chunk exists, and persist a citation row linking the assistant message to the exact source. Every quote opens the transcript, not a summary.
- **Local-first.** Runs end-to-end against native Postgres and a local Ollama daemon. No cloud key required to use it — add `OLLAMA_CLOUD_API_KEY` only if you want live web-search enrichment on expert bios.

## Six modes, one engine

| Mode | What it does |
|---|---|
| **Roundtable** | 3–5 experts auto-selected for the question, 3+ rounds of discussion, then a moderator synthesis. Each turn streams a single grounded paragraph with its thinking available on demand. |
| **Validate idea** | Multi-axis critique of a product idea — problem, wedge, GTM, pricing, moat — from the panel most qualified to weigh in. |
| **PRD review** | Drop in a PRD. The panel finds the gaps, challenges the premises, and proposes the smallest shippable v1. |
| **Career mentor** | 1:1 chat with a leadership-coach persona. Persistent conversation grounded in coaching-heavy episodes. |
| **Strategy advisor** | 1:1 strategy thinking partner. Same pattern, different voice. |
| **Gap scanner** | Point it at a topic. It mines the corpus for recurring unsolved problems — the things guests keep *describing* but not answering. |

A model picker in the top-right reads live from your local Ollama (`/api/tags`) so you can swap the chat model per session.

## See it work

```
You     /roundtable  "We're a B2B workflow tool at $400K ARR with great
                     activation but 18% monthly logo churn. What do we fix?"

System  Selecting experts...
        → Lenny Rachitsky, Elena Verna, April Dunford (ICP fit),
          Kathryn Minshew (retention), Dan Shipper (B2B patterns)

Round 1 — Elena Verna
        Churn at 18% with great activation isn't a retention problem, it's
        a positioning problem masquerading as one. Your activation numbers
        are telling you the product works — but for who, and for how long? [c:412]
        You need to separate two questions...

Round 1 — April Dunford
        I want to push on Elena's point. Before we talk retention, who are
        the 82% that stick? Pull the logos. I bet three different segments
        are hiding in there with three different jobs-to-be-done. [c:187]

Round 2 — Kathryn Minshew
        If this is a segment problem, the data is already in your CRM.
        Cohort by industry, by team size, by the integration they use first...

Synthesis (Lenny)
        The panel converged on a single diagnosis: segmentation, not feature.
        The actions ranked by effort: (1) segment the churners this week,
        (2) rewrite positioning around the sticky segment, (3) reserve net-new
        features until after (2). [5 citations]
```

Every `[c:N]` opens the exact chunk — timestamped, speaker-attributed, a click away from the source transcript.

## Stack

| Layer | Choice | Why |
|---|---|---|
| **UI** | SvelteKit 2, Svelte 5 runes, Tailwind 4 | Runes keep stream state simple; Svelte's SSR story lines up with SSE. |
| **Runtime** | Bun | Native TypeScript, fast script startup (`bun --env-file=.env.local`). |
| **DB** | Postgres 16 + `pgvector` + `pg_trgm` | One datastore for everything — chunks, embeddings, chats, citations. |
| **Retrieval** | BM25 (via `pg_trgm` + SQL fn) + pgvector, fused with RRF | Same index for lexical and semantic, no separate vector service. |
| **LLM / embeddings** | Ollama — `nomic-embed-text` + `kimi-k2.6:cloud` | Local daemon first; cloud fallback is additive, not required. |
| **Streaming** | SSE from server routes | `event: turn_start / content / turn_end / session_complete`. |
| **Auth** | Single-user local shim | Swap for Supabase Auth when going multi-user. |

## Quick start

### Prerequisites

- WSL2 (Ubuntu 24.04) or native Linux / macOS
- Bun `>= 1.3`
- Postgres 16 with `postgresql-16-pgvector`
- Ollama daemon running
  - WSL → Windows host: use the Windows host IP (`ip route show default | awk '{print $3}'`)
  - Native Linux / macOS: `localhost`
- Models pulled:
  ```bash
  ollama pull nomic-embed-text
  ollama pull kimi-k2.6:cloud
  ```
- The corpus — clone [`lennys-newsletterpodcastdata-all`](https://github.com/manimohans/lennys-newsletterpodcastdata-all) as a sibling directory of this repo

### Bring it up

```bash
git clone https://github.com/manimohans/lennyscouncil.git
cd lennyscouncil/app

# 1. Create the database (one-time, needs sudo)
./scripts/bootstrap-db.sh

# 2. Install deps
bun install

# 3. Configure env
cp .env.example .env.local
#    On WSL, set OLLAMA_BASE_URL to your Windows host IP

# 4. Verify the world
bun run preflight            # should print "10 / 10 checks passed"

# 5. Schema
bun run migrate

# 6. Ingest (~17 min for the full 644-file archive)
bun run ingest

# 7. Build expert profiles from chunks
bun run build-experts

# 8. Enrich profiles with bio + frameworks + voice (~20 min, 318 experts)
bun run enrich-experts --no-web   # drop --no-web with OLLAMA_CLOUD_API_KEY set

# 9. Go
bun run dev
# → http://localhost:5173
```

> **Heads up:** Step 6 (ingest) and step 8 (enrich) are the long ones. They're idempotent — safe to re-run. You can start using the UI the moment step 7 finishes, then let enrichment run in the background.

## Architecture

```
              ┌─────────────────────────────────┐
              │   SvelteKit UI (Svelte 5 runes) │
              │  /roundtable  /validate  /prd   │
              │  /mentor      /strategy  /gaps  │
              └────────────────┬────────────────┘
                               │ SSE
                               │ turn_start · content · turn_end · session_complete
              ┌────────────────▼────────────────┐
              │        Orchestrators            │
              │  runRoundtable · runExpertPanel │
              │  runSingleExpertChat · scanGaps │
              └──┬───────────────────────────┬──┘
                 │                           │
   ┌─────────────▼──────────┐      ┌─────────▼──────────────────┐
   │   Expert selector      │◄────►│   Hybrid retrieval         │
   │   rank by match ×      │      │   BM25 + pgvector, RRF     │
   │   authority × recency  │      │   merged per query         │
   └─────────────┬──────────┘      └─────────┬──────────────────┘
                 │                           │
   ┌─────────────▼──────────┐      ┌─────────▼──────────────────┐
   │   Postgres 16          │      │   Ollama daemon            │
   │   chunks · experts     │      │   nomic-embed-text         │
   │   chats  · messages    │      │   kimi-k2.6:cloud          │
   │   citations            │      │                            │
   └────────────────────────┘      └────────────────────────────┘
```

### How a roundtable runs

1. **Embed the question** → `nomic-embed-text` via Ollama.
2. **Retrieve** — BM25 hits (pg_trgm similarity) + pgvector cosine, merged with Reciprocal Rank Fusion. Top-K chunks returned with speakers, episode IDs, and timestamps intact.
3. **Select experts** — rank candidates by *match × corpus authority × recency of appearance*. Pick 3–5.
4. **For each expert, each round:**
   a. Re-retrieve chunks **from that expert's own corpus only**.
   b. Build a persona-prompt from their enriched profile (bio, frameworks, voice).
   c. Stream a single-paragraph turn. Parse inline `[c:N]` markers → persist citation rows.
5. **Moderator synthesis** — Lenny persona reads the full discussion and writes a decisive closing turn.

### Design decisions that actually matter

- **Per-expert grounding beats global grounding.** If everyone sees everyone's chunks, personas collapse into the same voice. Isolating retrieval per expert is what preserves disagreement.
- **One datastore.** Postgres does BM25 (via `pg_trgm`), vectors (via `pgvector`), chat persistence, and citation joins. No Elasticsearch, no Pinecone. The whole app fits in one DSN.
- **Streaming structure over streaming prose.** The SSE protocol carries typed events — `turn_start`, `content`, `turn_end`, `thinking` — so the UI can render per-expert bubbles, thinking disclosures, and citation hydration without parsing the token stream.
- **Thinking off by default.** `kimi-k2.6` is a reasoning model, and reasoning tokens eat the output budget in multi-round sessions. `maxTokens` is capped per orchestrator; flip `think: true` if you want the trace and are willing to raise the cap.

## The corpus

Not in this repo. Pull [`manimohans/lennys-newsletterpodcastdata-all`](https://github.com/manimohans/lennys-newsletterpodcastdata-all) as a sibling directory — `CORPUS_PATH` defaults to `../lennys-newsletterpodcastdata-all`.

After ingestion you'll have:

| What | Count |
|---|---|
| Speaker-attributed chunks | ~45,000 |
| Expert profiles | ~319 (293 named guests + 26 incidental speakers, naturally low-ranked) |
| Host (excluded from expert selection) | Lenny Rachitsky, `is_host=true` |
| Source files ingested | 644 (295 podcasts + 349 newsletters) |

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | SvelteKit dev server |
| `bun run preflight` | Verify Postgres + Ollama reachable, models pulled, corpus present |
| `bun run migrate` | Apply pending SQL migrations |
| `bun run ingest [--limit N] [--source-type podcast\|newsletter]` | Ingest + embed corpus chunks |
| `bun run build-experts` | Aggregate per-expert profile rows from ingested chunks |
| `bun run enrich-experts [--no-web] [--limit N] [--force]` | LLM-generated bio + frameworks + voice for each expert |
| `bun run smoke-roundtable "question"` | Headless end-to-end roundtable test |
| `bun run check` | TypeScript + Svelte type-check |

## Migration path

Local-first today. The backend is already shaped to move cleanly to managed services:

- **Postgres** → Supabase (keep schema, add RLS, swap the single-user shim for Supabase Auth).
- **Ollama** → Ollama Cloud (`OLLAMA_BASE_URL=https://ollama.com` + `Authorization: Bearer ${OLLAMA_CLOUD_API_KEY}`).
- **Hosting** → Vercel / Fly / anywhere that runs SvelteKit with `adapter-auto`.

Full walkthrough: [`app/MIGRATION.md`](./app/MIGRATION.md).

## Troubleshooting

<details>
<summary><strong>Preflight: <code>ollama.embed.dim</code> fails with “input length exceeds context length”</strong></summary>

Some chunks exceed the model's effective context. Lower `MAX_CHUNK_CHARS` in `app/src/lib/server/ingest/chunker.ts`. Empirically `nomic-embed-text` rejects chunks over ~4,500 chars even with `num_ctx: 8192`.
</details>

<details>
<summary><strong>Preflight: <code>ollama.chat.smoketest</code> returns empty content</strong></summary>

`kimi-k2.6` thinking ate the budget. Either bump `maxTokens` (default 4000 in orchestrators) or set `think: false` in the orchestrator call-sites.
</details>

<details>
<summary><strong>Dev server: <code>DATABASE_URL is not set</code></strong></summary>

Use `bun run dev` (which wraps `bun --env-file=.env.local`). Plain `vite dev` doesn't auto-load private env vars.
</details>

<details>
<summary><strong>WSL → Windows Ollama: <code>localhost:11434</code> unreachable</strong></summary>

The Windows daemon doesn't bind to the WSL loopback. Use the Windows host IP:

```bash
ip route show default | awk '{print $3}'
```

Set it as `OLLAMA_BASE_URL` in `.env.local`. The IP changes per WSL boot — regenerate when you reboot.
</details>

## Credits

- The corpus — [Lenny Rachitsky](https://www.lennyspodcast.com) and every guest whose recorded words made this possible.
- Dataset assembly — [`lennys-newsletterpodcastdata-all`](https://github.com/manimohans/lennys-newsletterpodcastdata-all).
- Retrieval fusion — Cormack, Clarke & Büttcher, *Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods* (SIGIR 2009).

---

Built by [@manimohans](https://github.com/manimohans). Fork it, point it at a different archive, make your own council.
