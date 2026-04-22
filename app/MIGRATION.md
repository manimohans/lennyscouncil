# Migration: Local → Supabase + Ollama Cloud

When you're ready to take this from local-only to multi-user hosted, you'll change two things and leave the application code largely untouched.

## What changes

| Layer | Local (now) | Production (target) |
|---|---|---|
| Database | Native Postgres + pgvector in WSL | Supabase Postgres (also pgvector) |
| Auth | Single auto-created `local@…` user | Supabase Auth (email/OAuth) |
| Embeddings | Local Ollama `nomic-embed-text` | Same Ollama instance OR a managed embeddings API |
| Chat models | Local Ollama proxy (`kimi-k2.6:cloud`) | Direct Ollama Cloud (`kimi-k2.6`) |
| Hosting | `bun run dev` on WSL | Vercel / Fly.io / Render |

## Step-by-step

### 1. Create the Supabase project
- supabase.com → New Project → save the DB password
- Settings → API: copy `Project URL`, `anon` key, `service_role` key

### 2. Push your schema to Supabase
The migrations are pure SQL; they apply to Supabase Postgres unchanged. Easiest path:

```bash
# Install the Supabase CLI
bun add -g supabase

# Link
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Push existing migrations (SvelteKit dev DB → Supabase)
DATABASE_URL=postgresql://postgres:YOUR_DB_PW@db.YOUR_PROJECT_REF.supabase.co:5432/postgres bun run migrate
```

Verify in Supabase Studio that all 9 tables exist and `vector` + `pg_trgm` extensions are enabled.

### 3. (Optional) Move the data
If you want to skip re-ingesting 45k chunks, dump and restore:

```bash
PGPASSWORD=roundtable_dev pg_dump -h localhost -U lr_app -d lennys_roundtable \
  --data-only --table=chunks --table=experts \
  --no-owner --no-privileges \
  > /tmp/lr-data.sql

PGPASSWORD=YOUR_DB_PW psql -h db.YOUR_PROJECT_REF.supabase.co -U postgres -d postgres \
  < /tmp/lr-data.sql
```

Otherwise just run `bun run ingest` against the new `DATABASE_URL`.

### 4. Swap the auth shim for Supabase Auth

The single-user shim is in `src/lib/server/current-user.ts` and `src/hooks.server.ts`. Replace with Supabase SSR:

```ts
// src/hooks.server.ts (new version)
import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
        cookies: { /* SvelteKit cookie adapter */ }
    });
    const { data: { user } } = await event.locals.supabase.auth.getUser();
    event.locals.user = user;
    return resolve(event);
};
```

Then add a real login/signup page (the auth/* routes I built earlier and removed are a useful starting point — see git history).

The `users` table mapping: Supabase Auth uses `auth.users` (managed). Your app data references it by `auth.uid()`. The current `users` table can be dropped or repurposed as a public profile table FK'd to `auth.users(id)`.

### 5. Add Row Level Security
The `chats`, `messages`, `citations`, `favorites` tables need RLS turned on so users only see their own data:

```sql
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY chats_owner ON chats FOR ALL
    USING (user_id = auth.uid());

-- Repeat the same shape for messages (via JOIN to chats), citations (via JOIN to messages),
-- and favorites (user_id = auth.uid()).

-- chunks and experts stay readable to all authenticated users:
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY chunks_read ON chunks FOR SELECT
    TO authenticated USING (true);

ALTER TABLE experts ENABLE ROW LEVEL SECURITY;
CREATE POLICY experts_read ON experts FOR SELECT
    TO authenticated USING (true);
```

### 6. Switch to Ollama Cloud directly

Currently `OLLAMA_BASE_URL=http://172.23.224.1:11434` proxies `kimi-k2.6:cloud` through your local Ollama daemon to Ollama Cloud. In production, talk to Ollama Cloud directly:

```bash
# .env (production)
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_CLOUD_API_KEY=sk-...
OLLAMA_CHAT_MODEL=kimi-k2.6      # drop the :cloud suffix
```

Update `src/lib/server/ollama.ts` to add the `Authorization: Bearer ${apiKey}` header when `OLLAMA_CLOUD_API_KEY` is set:

```ts
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (process.env.OLLAMA_CLOUD_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OLLAMA_CLOUD_API_KEY}`;
}
```

Embeddings are tricker — Ollama Cloud doesn't expose `nomic-embed-text` (chat models only). Options:
- Keep a local Ollama on the deploy server for embeddings
- Use a hosted embeddings API (OpenAI `text-embedding-3-small`, Voyage, Cohere) — wrap in `OllamaClient.embed`'s shape

### 7. Deploy
Add a SvelteKit adapter for your platform of choice (Vercel/Fly/Node), set the production env vars, push.

For Vercel:
```bash
bun add -d @sveltejs/adapter-vercel
# Update svelte.config.js to use the Vercel adapter
# Set DATABASE_URL, OLLAMA_BASE_URL, OLLAMA_CLOUD_API_KEY, etc. in Vercel project settings
```

**Streaming caveat:** Vercel Hobby caps function duration at 10s; Pro at 300s. A full Roundtable (5 experts × 2 rounds + synthesis) can exceed 300s. Use Vercel Pro with Node runtime (not Edge), or deploy to Fly.io which doesn't cap.

### 8. Backfill expert bios
Currently `experts.bio` and `experts.frameworks` are empty (deterministic-only profile builder). Add an enrich script that calls kimi-k2.6 once per expert to generate a 3-sentence bio + framework list. ~30 minutes of LLM time for 293 experts.

## Migration cost summary

- **Code rewrite:** auth (~50 lines) + Ollama Cloud header (~5 lines) = ~1 hour
- **Data migration:** schema is identical, optional data dump = 10 minutes
- **Setup:** Supabase project + Vercel deploy = 30 minutes

Total: ~2 hours for the migration.
