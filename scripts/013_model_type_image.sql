-- Migration 013: add image, video, audio to provider_models model_type check constraint
ALTER TABLE provider_models
    DROP CONSTRAINT IF EXISTS provider_models_model_type_check;

ALTER TABLE provider_models
    ADD CONSTRAINT provider_models_model_type_check
    CHECK (model_type IN ('llm', 'embedding', 'rerank', 'tts', 'stt', 'image', 'video', 'audio'));
