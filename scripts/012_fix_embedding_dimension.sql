-- Fix embedding column: remove fixed-dimension constraint so any model's
-- output (768, 1024, 1536, etc.) can be stored.
-- Existing 1536-dim rows are preserved; they remain queryable but will return
-- meaningless similarity scores against 768-dim queries from a different model.
-- To start fresh, run: DELETE FROM knowledge_entries WHERE embedding IS NOT NULL;

ALTER TABLE knowledge_entries
    ALTER COLUMN embedding TYPE vector
    USING embedding::vector;
