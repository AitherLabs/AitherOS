-- Migration 014: drop the dimension-locked IVFFlat index on knowledge_entries.
-- The IVFFlat index was built at 1536 dims and rejects inserts from models
-- that produce 768-dim vectors. The table is empty so no data is lost.
-- A new vector index can be added once the embedding dimension is stable.
DROP INDEX IF EXISTS idx_knowledge_embedding;
