package unit

import (
	"testing"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/models"
)

func TestInterpolatePromptBasic(t *testing.T) {
	template := "You are scanning {{target}} with scope {{technical_scope}}."
	vars := []models.AgentVariable{
		{Name: "target", Label: "Target", Type: models.VariableTypeText, Required: true},
		{Name: "technical_scope", Label: "Scope", Type: models.VariableTypeText, Required: true},
	}
	inputs := map[string]string{
		"target":          "192.168.1.0/24",
		"technical_scope": "full port scan",
	}

	result, err := engine.InterpolatePrompt(template, vars, inputs)
	if err != nil {
		t.Fatalf("InterpolatePrompt() error = %v", err)
	}

	expected := "You are scanning 192.168.1.0/24 with scope full port scan."
	if result != expected {
		t.Errorf("result = %q, want %q", result, expected)
	}
}

func TestInterpolatePromptMissingRequired(t *testing.T) {
	template := "Target: {{target}}"
	vars := []models.AgentVariable{
		{Name: "target", Label: "Target", Type: models.VariableTypeText, Required: true},
	}
	inputs := map[string]string{}

	_, err := engine.InterpolatePrompt(template, vars, inputs)
	if err == nil {
		t.Error("expected error for missing required variable")
	}
}

func TestInterpolatePromptDefaultValue(t *testing.T) {
	template := "Model: {{preference}}"
	vars := []models.AgentVariable{
		{Name: "preference", Label: "Preference", Type: models.VariableTypeText, Required: true, Default: "balanced"},
	}
	inputs := map[string]string{}

	result, err := engine.InterpolatePrompt(template, vars, inputs)
	if err != nil {
		t.Fatalf("InterpolatePrompt() error = %v", err)
	}

	if result != "Model: balanced" {
		t.Errorf("result = %q, want %q", result, "Model: balanced")
	}
}

func TestInterpolatePromptOptionalMissing(t *testing.T) {
	template := "Target: {{target}}, Notes: {{notes}}"
	vars := []models.AgentVariable{
		{Name: "target", Label: "Target", Type: models.VariableTypeText, Required: true},
		{Name: "notes", Label: "Notes", Type: models.VariableTypeParagraph, Required: false},
	}
	inputs := map[string]string{
		"target": "example.com",
	}

	result, err := engine.InterpolatePrompt(template, vars, inputs)
	if err != nil {
		t.Fatalf("InterpolatePrompt() error = %v", err)
	}

	// notes has no default and is optional, so the placeholder stays
	expected := "Target: example.com, Notes: {{notes}}"
	if result != expected {
		t.Errorf("result = %q, want %q", result, expected)
	}
}

func TestInterpolatePromptOptionalWithDefault(t *testing.T) {
	template := "Mode: {{mode}}"
	vars := []models.AgentVariable{
		{Name: "mode", Label: "Mode", Type: models.VariableTypeSelect, Required: false, Default: "stealth"},
	}
	inputs := map[string]string{}

	result, err := engine.InterpolatePrompt(template, vars, inputs)
	if err != nil {
		t.Fatalf("InterpolatePrompt() error = %v", err)
	}

	if result != "Mode: stealth" {
		t.Errorf("result = %q, want %q", result, "Mode: stealth")
	}
}

func TestInterpolatePromptNoVariables(t *testing.T) {
	template := "You are a helpful assistant."
	result, err := engine.InterpolatePrompt(template, nil, nil)
	if err != nil {
		t.Fatalf("error = %v", err)
	}
	if result != template {
		t.Errorf("result = %q, want %q", result, template)
	}
}

func TestInterpolatePromptMultipleOccurrences(t *testing.T) {
	template := "Scan {{target}} then report on {{target}} findings."
	vars := []models.AgentVariable{
		{Name: "target", Label: "Target", Type: models.VariableTypeText, Required: true},
	}
	inputs := map[string]string{"target": "10.0.0.1"}

	result, err := engine.InterpolatePrompt(template, vars, inputs)
	if err != nil {
		t.Fatalf("error = %v", err)
	}

	expected := "Scan 10.0.0.1 then report on 10.0.0.1 findings."
	if result != expected {
		t.Errorf("result = %q, want %q", result, expected)
	}
}

func TestExtractVariableNames(t *testing.T) {
	template := "Hello {{name}}, you are in {{location}}. Welcome {{name}}!"
	names := engine.ExtractVariableNames(template)

	if len(names) != 2 {
		t.Fatalf("expected 2 unique names, got %d: %v", len(names), names)
	}
	if names[0] != "name" {
		t.Errorf("names[0] = %q, want %q", names[0], "name")
	}
	if names[1] != "location" {
		t.Errorf("names[1] = %q, want %q", names[1], "location")
	}
}

func TestExtractVariableNamesEmpty(t *testing.T) {
	names := engine.ExtractVariableNames("No variables here.")
	if len(names) != 0 {
		t.Errorf("expected 0 names, got %d", len(names))
	}
}

func TestAgentStrategyConstants(t *testing.T) {
	tests := []struct {
		s    models.AgentStrategy
		want string
	}{
		{models.AgentStrategySimple, "simple"},
		{models.AgentStrategyFunctionCall, "function_call"},
		{models.AgentStrategyReAct, "react"},
	}
	for _, tt := range tests {
		if string(tt.s) != tt.want {
			t.Errorf("AgentStrategy = %q, want %q", tt.s, tt.want)
		}
	}
}

func TestVariableTypeConstants(t *testing.T) {
	tests := []struct {
		vt   models.VariableType
		want string
	}{
		{models.VariableTypeText, "text"},
		{models.VariableTypeParagraph, "paragraph"},
		{models.VariableTypeNumber, "number"},
		{models.VariableTypeSelect, "select"},
		{models.VariableTypeCheckbox, "checkbox"},
	}
	for _, tt := range tests {
		if string(tt.vt) != tt.want {
			t.Errorf("VariableType = %q, want %q", tt.vt, tt.want)
		}
	}
}

func TestProviderTypeConstants(t *testing.T) {
	tests := []struct {
		pt   models.ProviderType
		want string
	}{
		{models.ProviderTypeOpenAI, "openai"},
		{models.ProviderTypeOpenAICompat, "openai_compatible"},
		{models.ProviderTypeOllama, "ollama"},
		{models.ProviderTypeOpenRouter, "openrouter"},
		{models.ProviderTypeLiteLLM, "litellm"},
		{models.ProviderTypePicoClaw, "picoclaw"},
		{models.ProviderTypeOpenClaw, "openclaw"},
	}
	for _, tt := range tests {
		if string(tt.pt) != tt.want {
			t.Errorf("ProviderType = %q, want %q", tt.pt, tt.want)
		}
	}
}

func TestModelTypeConstants(t *testing.T) {
	tests := []struct {
		mt   models.ModelType
		want string
	}{
		{models.ModelTypeLLM, "llm"},
		{models.ModelTypeEmbedding, "embedding"},
		{models.ModelTypeRerank, "rerank"},
		{models.ModelTypeTTS, "tts"},
		{models.ModelTypeSTT, "stt"},
	}
	for _, tt := range tests {
		if string(tt.mt) != tt.want {
			t.Errorf("ModelType = %q, want %q", tt.mt, tt.want)
		}
	}
}

func TestCredentialSchemas(t *testing.T) {
	schemas := engine.GetCredentialSchemas()

	if len(schemas) != 7 {
		t.Fatalf("expected 7 credential schemas, got %d", len(schemas))
	}

	// Check OpenAI schema
	var openaiSchema *models.CredentialSchema
	for i := range schemas {
		if schemas[i].ProviderType == models.ProviderTypeOpenAI {
			openaiSchema = &schemas[i]
			break
		}
	}
	if openaiSchema == nil {
		t.Fatal("OpenAI schema not found")
	}
	if len(openaiSchema.Fields) != 1 {
		t.Errorf("OpenAI fields count = %d, want 1", len(openaiSchema.Fields))
	}
	if openaiSchema.Fields[0].Name != "api_key" {
		t.Errorf("OpenAI field name = %q, want %q", openaiSchema.Fields[0].Name, "api_key")
	}
	if openaiSchema.Fields[0].Type != "secret" {
		t.Errorf("OpenAI field type = %q, want %q", openaiSchema.Fields[0].Type, "secret")
	}

	// Check Ollama schema has base_url
	var ollamaSchema *models.CredentialSchema
	for i := range schemas {
		if schemas[i].ProviderType == models.ProviderTypeOllama {
			ollamaSchema = &schemas[i]
			break
		}
	}
	if ollamaSchema == nil {
		t.Fatal("Ollama schema not found")
	}
	if ollamaSchema.Fields[0].Name != "base_url" {
		t.Errorf("Ollama field = %q, want %q", ollamaSchema.Fields[0].Name, "base_url")
	}
	if ollamaSchema.Fields[0].Default != "http://127.0.0.1:11434" {
		t.Errorf("Ollama default = %q", ollamaSchema.Fields[0].Default)
	}
}

func TestOpenAICompatConnectorName(t *testing.T) {
	// The openAICompatConnector is unexported, but we can test it via the registry
	// by checking the credential schemas cover all provider types
	schemas := engine.GetCredentialSchemas()
	providerTypes := make(map[models.ProviderType]bool)
	for _, s := range schemas {
		providerTypes[s.ProviderType] = true
	}

	expected := []models.ProviderType{
		models.ProviderTypeOpenAI,
		models.ProviderTypeOpenAICompat,
		models.ProviderTypeOllama,
		models.ProviderTypeOpenRouter,
		models.ProviderTypeLiteLLM,
		models.ProviderTypePicoClaw,
		models.ProviderTypeOpenClaw,
	}

	for _, pt := range expected {
		if !providerTypes[pt] {
			t.Errorf("missing credential schema for provider type %q", pt)
		}
	}
}

func TestAgentVariableStruct(t *testing.T) {
	v := models.AgentVariable{
		Name:        "target",
		Label:       "Target Host",
		Type:        models.VariableTypeText,
		Description: "The IP or hostname to scan",
		Required:    true,
		Default:     "",
		MaxLength:   255,
	}

	if v.Name != "target" {
		t.Errorf("Name = %q", v.Name)
	}
	if v.Type != models.VariableTypeText {
		t.Errorf("Type = %q", v.Type)
	}
	if !v.Required {
		t.Error("Required should be true")
	}
}

func TestAgentVariableSelectOptions(t *testing.T) {
	v := models.AgentVariable{
		Name:    "scan_type",
		Label:   "Scan Type",
		Type:    models.VariableTypeSelect,
		Options: []string{"quick", "full", "stealth"},
		Default: "quick",
	}

	if len(v.Options) != 3 {
		t.Errorf("Options len = %d, want 3", len(v.Options))
	}
	if v.Default != "quick" {
		t.Errorf("Default = %q", v.Default)
	}
}

func TestDebugAgentRequestFields(t *testing.T) {
	provID := "some-uuid"
	req := models.DebugAgentRequest{
		Inputs:         map[string]string{"target": "10.0.0.1"},
		Message:        "Scan this target",
		ProviderIDOver: &provID,
		ModelOverride:  "gpt-4o",
		Stream:         true,
	}

	if req.Message != "Scan this target" {
		t.Errorf("Message = %q", req.Message)
	}
	if req.Inputs["target"] != "10.0.0.1" {
		t.Errorf("Inputs[target] = %q", req.Inputs["target"])
	}
	if !req.Stream {
		t.Error("Stream should be true")
	}
	if req.ProviderIDOver == nil || *req.ProviderIDOver != "some-uuid" {
		t.Error("ProviderIDOver mismatch")
	}
}

func TestModelProviderStruct(t *testing.T) {
	p := models.ModelProvider{
		Name:         "My OpenAI",
		ProviderType: models.ProviderTypeOpenAI,
		BaseURL:      "https://api.openai.com",
		APIKey:       "sk-test123",
		IsEnabled:    true,
		IsDefault:    true,
		Config:       map[string]any{"org_id": "org-abc"},
	}

	if p.Name != "My OpenAI" {
		t.Errorf("Name = %q", p.Name)
	}
	if p.ProviderType != models.ProviderTypeOpenAI {
		t.Errorf("ProviderType = %q", p.ProviderType)
	}
	if !p.IsDefault {
		t.Error("IsDefault should be true")
	}
	if p.Config["org_id"] != "org-abc" {
		t.Errorf("Config = %v", p.Config)
	}
}

func TestProviderModelStruct(t *testing.T) {
	m := models.ProviderModel{
		ModelName: "gpt-4o",
		ModelType: models.ModelTypeLLM,
		IsEnabled: true,
		Config:    map[string]any{"max_tokens": 4096},
	}

	if m.ModelName != "gpt-4o" {
		t.Errorf("ModelName = %q", m.ModelName)
	}
	if m.ModelType != models.ModelTypeLLM {
		t.Errorf("ModelType = %q", m.ModelType)
	}
}

func TestCreateProviderRequestFields(t *testing.T) {
	req := models.CreateProviderRequest{
		Name:         "Local Ollama",
		ProviderType: models.ProviderTypeOllama,
		BaseURL:      "http://127.0.0.1:11434",
		IsDefault:    false,
	}

	if req.ProviderType != models.ProviderTypeOllama {
		t.Errorf("ProviderType = %q", req.ProviderType)
	}
}
