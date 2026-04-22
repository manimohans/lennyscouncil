-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users (Lucia-style; portable to Supabase auth.users on migration)
CREATE TABLE IF NOT EXISTS users (
    id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           text        UNIQUE NOT NULL,
    display_name    text,
    password_hash   text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auth sessions (cookie-backed)
CREATE TABLE IF NOT EXISTS auth_sessions (
    id          text        PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);

-- Corpus: every chunk is one speaker turn (podcast) or one heading section (newsletter)
CREATE TABLE IF NOT EXISTS chunks (
    id              bigserial   PRIMARY KEY,
    source_file     text        NOT NULL,
    source_type     text        NOT NULL CHECK (source_type IN ('podcast','newsletter')),
    speaker         text        NOT NULL,
    title           text        NOT NULL,
    date            date        NOT NULL,
    tags            text[]      NOT NULL DEFAULT '{}',
    text            text        NOT NULL,
    tsv             tsvector,
    embedding       vector(768) NOT NULL,
    token_count     int         NOT NULL,
    content_hash    text        NOT NULL UNIQUE,
    timestamp_str   text,
    heading_trail   text,
    metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION chunks_tsv_trigger() RETURNS trigger AS $$
BEGIN
    NEW.tsv := to_tsvector('english', NEW.text);
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunks_tsv_update ON chunks;
CREATE TRIGGER chunks_tsv_update
    BEFORE INSERT OR UPDATE OF text ON chunks
    FOR EACH ROW EXECUTE FUNCTION chunks_tsv_trigger();

-- Experts (one per unique speaker, host marked separately)
CREATE TABLE IF NOT EXISTS experts (
    id                  uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug                text        UNIQUE NOT NULL,
    name                text        NOT NULL,
    bio                 text,
    domains             text[]      NOT NULL DEFAULT '{}',
    signature_quotes    jsonb       NOT NULL DEFAULT '[]'::jsonb,
    frameworks          text[]      NOT NULL DEFAULT '{}',
    voice_summary       text,
    appearance_count    int         NOT NULL DEFAULT 0,
    total_words         int         NOT NULL DEFAULT 0,
    first_seen          date,
    last_seen           date,
    avatar_url          text,
    is_host             boolean     NOT NULL DEFAULT false,
    profile_input_hash  text,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Conversation sessions (Roundtable / Idea Validation / etc.)
CREATE TABLE IF NOT EXISTS chats (
    id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode            text        NOT NULL,
    title           text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_active_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chats_user_idx ON chats(user_id, last_active_at DESC);

-- Messages within a chat (one expert turn = one message)
CREATE TABLE IF NOT EXISTS messages (
    id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id         uuid        NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role            text        NOT NULL CHECK (role IN ('user','expert','moderator','synthesis')),
    expert_id       uuid                 REFERENCES experts(id) ON DELETE SET NULL,
    content         text        NOT NULL,
    thinking        text,
    round           int         NOT NULL DEFAULT 0,
    turn_number     int         NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(chat_id, turn_number);

-- Citations link a message claim to a corpus chunk
CREATE TABLE IF NOT EXISTS citations (
    id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id      uuid        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    chunk_id        bigint      NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    quote           text        NOT NULL,
    timestamp_str   text
);
CREATE INDEX IF NOT EXISTS citations_message_idx ON citations(message_id);

-- Favorites
CREATE TABLE IF NOT EXISTS favorites (
    user_id     uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expert_id   uuid    NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, expert_id)
);

-- Indexes for retrieval (created last so the table is populated before HNSW kicks in)
CREATE INDEX IF NOT EXISTS chunks_speaker_idx ON chunks(speaker);
CREATE INDEX IF NOT EXISTS chunks_date_idx ON chunks(date DESC);
CREATE INDEX IF NOT EXISTS chunks_tags_idx ON chunks USING gin(tags);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin(tsv);
-- HNSW index for cosine similarity. Created with low default m/ef; can tune later.
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);
