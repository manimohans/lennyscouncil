-- 0004: Citation UX overhaul + retrieval correctness + quality fixes.
-- Adds:
--   - chunks.source_url (youtube_url for podcasts, post_url for newsletters)
--   - chunks.speaker_id (FK to experts; eliminates speaker-name string-match drift)
--   - citations.source_url + citations.title + citations.speaker + citations.date
--     (denormalized so the UI can render a link without extra joins)
--   - messages.expert_id index (missing, flagged in audit)
--   - auth_sessions.expires_at index (for cleanup queries)
--   - hybrid_search: accepts optional speaker_ids filter + returns source_url
--   - rank_experts_for_query: joins on speaker_id FK; blends recency into score
--
-- (migrate.ts wraps each migration file in a transaction, so no explicit BEGIN/COMMIT.)

-- 1. schema -----------------------------------------------------------------

ALTER TABLE chunks
    ADD COLUMN IF NOT EXISTS source_url text,
    ADD COLUMN IF NOT EXISTS speaker_id uuid REFERENCES experts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chunks_speaker_id_idx ON chunks(speaker_id);

ALTER TABLE citations
    ADD COLUMN IF NOT EXISTS source_url text,
    ADD COLUMN IF NOT EXISTS speaker text,
    ADD COLUMN IF NOT EXISTS title text,
    ADD COLUMN IF NOT EXISTS cited_date date;

CREATE INDEX IF NOT EXISTS messages_expert_idx
    ON messages(expert_id)
    WHERE expert_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx
    ON auth_sessions(expires_at);

-- 2. backfill speaker_id from existing speaker name -------------------------
--    safe to re-run; only fills nulls

UPDATE chunks c
   SET speaker_id = e.id
  FROM experts e
 WHERE c.speaker_id IS NULL
   AND e.name = c.speaker;

-- 3. backfill citations.source_url + metadata from existing chunks ----------
--    (source_url itself will be NULL until chunks are re-ingested; that's fine)

UPDATE citations ci
   SET source_url = c.source_url,
       speaker    = COALESCE(ci.speaker, c.speaker),
       title      = COALESCE(ci.title, c.title),
       cited_date = COALESCE(ci.cited_date, c.date)
  FROM chunks c
 WHERE c.id = ci.chunk_id
   AND (ci.source_url IS NULL OR ci.speaker IS NULL OR ci.title IS NULL OR ci.cited_date IS NULL);

-- 4. updated hybrid_search --------------------------------------------------
--    - accepts optional speaker_ids for SQL-level per-expert grounding
--    - returns source_url so callers can render article links
--    - guards against rrf_k <= 0 (divide-by-zero)

DROP FUNCTION IF EXISTS hybrid_search(text, vector, int, int);
DROP FUNCTION IF EXISTS hybrid_search(text, vector, int, int, uuid[]);

CREATE OR REPLACE FUNCTION hybrid_search(
    query_text       text,
    query_embedding  vector(768),
    match_count      int     DEFAULT 30,
    rrf_k            int     DEFAULT 60,
    speaker_ids      uuid[]  DEFAULT NULL
)
RETURNS TABLE (
    id              bigint,
    speaker         text,
    speaker_id      uuid,
    title           text,
    date            date,
    text            text,
    tags            text[],
    source_type     text,
    source_file     text,
    source_url      text,
    timestamp_str   text,
    score           float
) AS $$
WITH bm25 AS (
    SELECT
        c.id,
        ROW_NUMBER() OVER (
            ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('english', query_text)) DESC
        ) AS rn
    FROM chunks c
    WHERE c.tsv @@ websearch_to_tsquery('english', query_text)
      AND (speaker_ids IS NULL OR c.speaker_id = ANY(speaker_ids))
    LIMIT match_count * 4
),
vec AS (
    SELECT
        c.id,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rn
    FROM chunks c
    WHERE speaker_ids IS NULL OR c.speaker_id = ANY(speaker_ids)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 4
),
merged AS (
    SELECT
        COALESCE(bm25.id, vec.id) AS id,
        COALESCE(1.0 / (GREATEST(rrf_k, 1) + bm25.rn), 0)
          + COALESCE(1.0 / (GREATEST(rrf_k, 1) + vec.rn), 0) AS score
    FROM bm25
    FULL OUTER JOIN vec USING (id)
)
SELECT
    c.id,
    c.speaker,
    c.speaker_id,
    c.title,
    c.date,
    c.text,
    c.tags,
    c.source_type,
    c.source_file,
    c.source_url,
    c.timestamp_str,
    m.score
FROM merged m
JOIN chunks c ON c.id = m.id
ORDER BY m.score DESC
LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- 5. updated rank_experts_for_query -----------------------------------------
--    - joins via speaker_id FK instead of free-text name match (eliminates
--      silent drops when speaker strings drift)
--    - blends recency into score: +15% boost for content from the last ~3 yrs

DROP FUNCTION IF EXISTS rank_experts_for_query(text, vector, int, int, boolean);

CREATE OR REPLACE FUNCTION rank_experts_for_query(
    query_text       text,
    query_embedding  vector(768),
    top_k            int     DEFAULT 5,
    chunk_pool       int     DEFAULT 80,
    exclude_hosts    boolean DEFAULT true
)
RETURNS TABLE (
    expert_id           uuid,
    name                text,
    slug                text,
    domains             text[],
    avatar_url          text,
    matching_chunks     int,
    avg_score           float,
    most_recent         date,
    representative_chunk_ids bigint[]
) AS $$
WITH search AS (
    SELECT * FROM hybrid_search(query_text, query_embedding, chunk_pool)
),
agg AS (
    SELECT
        s.speaker_id AS eid,
        COUNT(*)::int AS matching_chunks,
        AVG(s.score)::float AS avg_score,
        MAX(s.date) AS most_recent,
        (ARRAY_AGG(s.id ORDER BY s.score DESC))[1:5] AS rep_ids
    FROM search s
    WHERE s.speaker_id IS NOT NULL
    GROUP BY s.speaker_id
)
SELECT
    e.id,
    e.name,
    e.slug,
    e.domains,
    e.avatar_url,
    a.matching_chunks,
    a.avg_score,
    a.most_recent,
    a.rep_ids
FROM agg a
JOIN experts e ON e.id = a.eid
WHERE NOT exclude_hosts OR e.is_host = false
ORDER BY (
    a.avg_score
    * LOG(a.matching_chunks + 1)
    * (
        1.0
        + 0.15 * GREATEST(
            0.0,
            1.0 - (CURRENT_DATE - COALESCE(a.most_recent, CURRENT_DATE - INTERVAL '5 years')::date) / 365.25 / 3.0
        )
    )
) DESC, a.most_recent DESC
LIMIT top_k;
$$ LANGUAGE sql STABLE;

