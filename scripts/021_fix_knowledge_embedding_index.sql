-- Migration 021: Fix HNSW index on knowledge_entries.embedding
-- The previous index (017) used a bare vector column without a dimension cast,
-- which pgvector could not build reliably. This migration drops the invalid index
-- and recreates it with an explicit cast to vector(768) — matching nomic-embed-text output.
-- All three vector search queries also now cast to vector(768) to hit this index.

DROP INDEX IF EXISTS idx_knowledge_embedding_hnsw;

CREATE INDEX idx_knowledge_embedding_hnsw
    ON knowledge_entries
    USING hnsw ((embedding::vector(768)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
