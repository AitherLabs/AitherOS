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
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
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
