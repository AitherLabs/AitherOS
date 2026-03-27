-- Migration 010: add 'gemini' to the model_providers provider_type check constraint
ALTER TABLE model_providers
    DROP CONSTRAINT IF EXISTS model_providers_provider_type_check;

ALTER TABLE model_providers
    ADD CONSTRAINT model_providers_provider_type_check
    CHECK (provider_type IN (
        'openai', 'openai_compatible', 'ollama', 'openrouter',
        'litellm', 'picoclaw', 'openclaw', 'gemini'
    ));
