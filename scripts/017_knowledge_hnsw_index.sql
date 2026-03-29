-- Migration 017: Add HNSW vector index on knowledge_entries for fast cosine similarity search.
-- HNSW (Hierarchical Navigable Small World) is the recommended pgvector index for most workloads:
-- faster query time than IVFFlat and no need to pre-specify list count.
--
-- m=16 / ef_construction=64 are pgvector defaults and work well for up to ~1M vectors.
-- The index is built CONCURRENTLY so it doesn't lock the table.
--
-- Requires: pgvector >= 0.5.0 (ships with postgresql-16-pgvector on Debian/Ubuntu)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_embedding_hnsw
    ON knowledge_entries
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
