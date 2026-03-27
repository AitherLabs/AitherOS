-- Migration 011: drop the provider_type check constraint.
-- The field is a display label; restricting its values in the DB adds no value
-- and requires a migration every time a new provider is added.
ALTER TABLE model_providers
    DROP CONSTRAINT IF EXISTS model_providers_provider_type_check;
