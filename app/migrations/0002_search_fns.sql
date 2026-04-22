-- Hybrid retrieval: BM25 + vector cosine, RRF-merged
CREATE OR REPLACE FUNCTION hybrid_search(
    query_text       text,
    query_embedding  vector(768),
    match_count      int     DEFAULT 30,
    rrf_k            int     DEFAULT 60
)
RETURNS TABLE (
    id              bigint,
    speaker         text,
    title           text,
    date            date,
    text            text,
    tags            text[],
    source_type     text,
    source_file     text,
    timestamp_str   text,
    score           float
) AS $$
WITH bm25 AS (
    SELECT
        c.id,
        ts_rank_cd(c.tsv, websearch_to_tsquery('english', query_text)) AS rank,
        ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('english', query_text)) DESC) AS rn
    FROM chunks c
    WHERE c.tsv @@ websearch_to_tsquery('english', query_text)
    LIMIT match_count * 4
),
vec AS (
    SELECT
        c.id,
        1 - (c.embedding <=> query_embedding) AS sim,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS rn
    FROM chunks c
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 4
),
merged AS (
    SELECT
        COALESCE(bm25.id, vec.id) AS id,
        COALESCE(1.0 / (rrf_k + bm25.rn), 0) + COALESCE(1.0 / (rrf_k + vec.rn), 0) AS score
    FROM bm25
    FULL OUTER JOIN vec USING (id)
)
SELECT
    c.id,
    c.speaker,
    c.title,
    c.date,
    c.text,
    c.tags,
    c.source_type,
    c.source_file,
    c.timestamp_str,
    m.score
FROM merged m
JOIN chunks c ON c.id = m.id
ORDER BY m.score DESC
LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- Rank experts for a query: aggregate matching chunks per speaker
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
        c.speaker,
        COUNT(*)::int AS matching_chunks,
        AVG(s.score)::float AS avg_score,
        MAX(c.date) AS most_recent,
        (ARRAY_AGG(c.id ORDER BY s.score DESC))[1:5] AS rep_ids
    FROM search s
    JOIN chunks c ON c.id = s.id
    GROUP BY c.speaker
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
JOIN experts e ON e.name = a.speaker
WHERE NOT exclude_hosts OR e.is_host = false
ORDER BY (a.avg_score * LOG(a.matching_chunks + 1)) DESC,
         a.most_recent DESC
LIMIT top_k;
$$ LANGUAGE sql STABLE;
