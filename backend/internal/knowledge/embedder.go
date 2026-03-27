package knowledge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"
)

// Embedder generates vector embeddings via an OpenAI-compatible API.
// It includes a circuit breaker: after 3 permanent failures (4xx) it
// disables itself for the process lifetime and logs exactly once.
type Embedder struct {
	baseURL    string // e.g. "http://127.0.0.1:4000/v1"
	apiKey     string
	model      string // e.g. "text-embedding-3-small"
	httpClient *http.Client

	mu        sync.Mutex
	failCount int
	disabled  bool
}

func NewEmbedder(baseURL, apiKey, model string) *Embedder {
	if model == "" {
		model = "text-embedding-3-small"
	}
	return &Embedder{
		baseURL: baseURL,
		apiKey:  apiKey,
		model:   model,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type embeddingRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type embeddingResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Usage struct {
		PromptTokens int `json:"prompt_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

// Available returns false if the circuit breaker has tripped (permanent config error).
func (e *Embedder) Available() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return !e.disabled
}

// EmbedStatus is the result of a live probe against the embedding endpoint.
type EmbedStatus struct {
	OK         bool   `json:"ok"`
	Endpoint   string `json:"endpoint"`
	Model      string `json:"model"`
	Dimensions int    `json:"dimensions,omitempty"`
	Error      string `json:"error,omitempty"`
}

// Probe sends a minimal test embedding and returns the live status.
// It does NOT affect the circuit breaker state.
func (e *Embedder) Probe(ctx context.Context) EmbedStatus {
	status := EmbedStatus{Endpoint: e.baseURL, Model: e.model}

	body, _ := json.Marshal(embeddingRequest{Model: e.model, Input: "ping"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		status.Error = "failed to build request: " + err.Error()
		return status
	}
	req.Header.Set("Content-Type", "application/json")
	if e.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.apiKey)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		status.Error = "unreachable: " + err.Error()
		return status
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		status.Error = fmt.Sprintf("authentication failed (HTTP %d) — check EMBEDDING_API_KEY", resp.StatusCode)
		return status
	}
	if resp.StatusCode == http.StatusNotFound {
		status.Error = "embeddings endpoint not found (HTTP 404) — this provider may not support embeddings (e.g. OpenRouter)"
		return status
	}
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		status.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))
		return status
	}

	var embResp embeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&embResp); err != nil || len(embResp.Data) == 0 {
		status.Error = "invalid response from embedding endpoint"
		return status
	}

	status.OK = true
	status.Dimensions = len(embResp.Data[0].Embedding)
	return status
}

// Embed generates an embedding vector for the given text.
func (e *Embedder) Embed(ctx context.Context, text string) ([]float32, error) {
	e.mu.Lock()
	if e.disabled {
		e.mu.Unlock()
		return nil, fmt.Errorf("embeddings disabled (model not available)")
	}
	e.mu.Unlock()

	body, err := json.Marshal(embeddingRequest{
		Model: e.model,
		Input: text,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal embedding request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if e.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.apiKey)
	}

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embeddings API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		errMsg := fmt.Errorf("embeddings API status %d: %s", resp.StatusCode, string(respBody))
		// Only count permanent failures (model not found, bad config) toward the circuit breaker.
		// 429 (rate limit) and 5xx (transient server errors) should not permanently disable embeddings.
		isPermanent := resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests
		if isPermanent {
			e.mu.Lock()
			e.failCount++
			if e.failCount >= 3 && !e.disabled {
				e.disabled = true
				log.Printf("knowledge: embeddings disabled — model '%s' is not available on this endpoint. Configure EMBEDDING_MODEL or add the model to LiteLLM.", e.model)
			}
			e.mu.Unlock()
		}
		return nil, errMsg
	}
	// Successful response — reset fail counter so transient errors don't permanently disable
	e.mu.Lock()
	if e.failCount > 0 {
		e.failCount = 0
	}
	e.mu.Unlock()

	var embResp embeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&embResp); err != nil {
		return nil, fmt.Errorf("decode embedding response: %w", err)
	}

	if len(embResp.Data) == 0 {
		return nil, fmt.Errorf("no embedding data returned")
	}

	return embResp.Data[0].Embedding, nil
}

// EmbedBatch generates embeddings for multiple texts. Falls back to serial calls.
func (e *Embedder) EmbedBatch(ctx context.Context, texts []string) ([][]float32, error) {
	results := make([][]float32, len(texts))
	for i, text := range texts {
		emb, err := e.Embed(ctx, text)
		if err != nil {
			return nil, fmt.Errorf("embed text %d: %w", i, err)
		}
		results[i] = emb
	}
	return results, nil
}
