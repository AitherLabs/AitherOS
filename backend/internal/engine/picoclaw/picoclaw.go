package picoclaw

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/models"
)

type Adapter struct {
	baseURL    string
	httpClient *http.Client
}

func New(baseURL string, timeout time.Duration) *Adapter {
	return &Adapter{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

func (a *Adapter) Name() string {
	return "picoclaw"
}

func (a *Adapter) HealthCheck(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.baseURL+"/health", nil)
	if err != nil {
		return fmt.Errorf("picoclaw health: create request: %w", err)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("picoclaw health: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("picoclaw health: status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

type picoClawRequest struct {
	Model        string           `json:"model"`
	Messages     []picoClawMsg    `json:"messages"`
	Stream       bool             `json:"stream"`
	Tools        []string         `json:"tools,omitempty"`
}

type picoClawMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type picoClawResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			Role      string `json:"role"`
			Content   string `json:"content"`
			ToolCalls []struct {
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls,omitempty"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
		TotalTokens      int64 `json:"total_tokens"`
	} `json:"usage"`
}

type picoClawStreamChunk struct {
	Choices []struct {
		Delta struct {
			Role    string `json:"role,omitempty"`
			Content string `json:"content,omitempty"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		TotalTokens int64 `json:"total_tokens"`
	} `json:"usage,omitempty"`
}

func (a *Adapter) Submit(ctx context.Context, req engine.TaskRequest) (*engine.TaskResponse, error) {
	start := time.Now()
	messages := buildMessages(req)

	picoReq := picoClawRequest{
		Model:    req.Model,
		Messages: messages,
		Stream:   false,
		Tools:    req.Tools,
	}

	body, err := json.Marshal(picoReq)
	if err != nil {
		return nil, fmt.Errorf("picoclaw submit: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("picoclaw submit: create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("picoclaw submit: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("picoclaw submit: status %d: %s", resp.StatusCode, string(respBody))
	}

	latencyMs := time.Since(start).Milliseconds()

	var picoResp picoClawResponse
	if err := json.NewDecoder(resp.Body).Decode(&picoResp); err != nil {
		return nil, fmt.Errorf("picoclaw submit: decode: %w", err)
	}

	result := &engine.TaskResponse{
		TokensUsed: picoResp.Usage.TotalTokens,
		TokensIn:   picoResp.Usage.PromptTokens,
		TokensOut:  picoResp.Usage.CompletionTokens,
		Model:      picoResp.Model,
		LatencyMs:  latencyMs,
		Done:       true,
	}

	if len(picoResp.Choices) > 0 {
		choice := picoResp.Choices[0]
		result.Content = choice.Message.Content
		for _, tc := range choice.Message.ToolCalls {
			var args map[string]any
			json.Unmarshal([]byte(tc.Function.Arguments), &args)
			result.ToolCalls = append(result.ToolCalls, engine.ToolCallInfo{
				Name: tc.Function.Name,
				Args: args,
			})
		}
	}

	return result, nil
}

func (a *Adapter) SubmitStream(ctx context.Context, req engine.TaskRequest) (<-chan engine.StreamEvent, error) {
	messages := buildMessages(req)

	picoReq := picoClawRequest{
		Model:    req.Model,
		Messages: messages,
		Stream:   true,
		Tools:    req.Tools,
	}

	body, err := json.Marshal(picoReq)
	if err != nil {
		return nil, fmt.Errorf("picoclaw stream: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("picoclaw stream: create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("picoclaw stream: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("picoclaw stream: status %d: %s", resp.StatusCode, string(respBody))
	}

	ch := make(chan engine.StreamEvent, 64)

	go func() {
		defer close(ch)
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if line == "" || line == "data: [DONE]" {
				if line == "data: [DONE]" {
					ch <- engine.StreamEvent{
						Type:    models.EventTypeAgentCompleted,
						Content: "",
					}
				}
				continue
			}

			if len(line) > 6 && line[:6] == "data: " {
				data := line[6:]
				var chunk picoClawStreamChunk
				if err := json.Unmarshal([]byte(data), &chunk); err != nil {
					continue
				}

				if len(chunk.Choices) > 0 {
					delta := chunk.Choices[0].Delta
					if delta.Content != "" {
						ch <- engine.StreamEvent{
							Type:    models.EventTypeAgentActing,
							Content: delta.Content,
						}
					}
				}
			}
		}
	}()

	return ch, nil
}

func buildMessages(req engine.TaskRequest) []picoClawMsg {
	var msgs []picoClawMsg

	if req.SystemPrompt != "" {
		systemContent := req.SystemPrompt
		if req.Instructions != "" {
			systemContent += "\n\n## Instructions\n" + req.Instructions
		}
		msgs = append(msgs, picoClawMsg{Role: "system", Content: systemContent})
	}

	msgs = append(msgs, picoClawMsg{Role: "user", Content: req.Message})

	return msgs
}
