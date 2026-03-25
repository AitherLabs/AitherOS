package engine

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/aitheros/backend/internal/models"
)

// openAICompatConnector is a generic connector for any OpenAI-API-compatible provider.
// Works with: OpenAI, OpenRouter, LiteLLM, Ollama (/v1), and any custom OpenAI-compat endpoint.
type openAICompatConnector struct {
	providerName string
	baseURL      string
	apiKey       string
	httpClient   *http.Client
}

func (c *openAICompatConnector) Name() string {
	return c.providerName
}

func (c *openAICompatConnector) HealthCheck(ctx context.Context) error {
	// Try /v1/models as a health probe (most OpenAI-compat APIs support this)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/models", nil)
	if err != nil {
		return fmt.Errorf("%s health: %w", c.providerName, err)
	}
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%s health: %w", c.providerName, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s health: status %d: %s", c.providerName, resp.StatusCode, string(body))
	}
	return nil
}

type oaiToolFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type oaiTool struct {
	Type     string          `json:"type"`
	Function oaiToolFunction `json:"function"`
}

type oaiRequest struct {
	Model    string   `json:"model"`
	Messages []oaiMsg `json:"messages"`
	Stream   bool     `json:"stream"`
	Tools    []oaiTool `json:"tools,omitempty"`
}

type oaiToolCallMsg struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type oaiMsg struct {
	Role       string           `json:"role"`
	Content    string           `json:"content"`
	ToolCalls  []oaiToolCallMsg `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
}

type oaiResponse struct {
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

type oaiStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content,omitempty"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		TotalTokens int64 `json:"total_tokens"`
	} `json:"usage,omitempty"`
}

func (c *openAICompatConnector) Submit(ctx context.Context, req TaskRequest) (*TaskResponse, error) {
	start := time.Now()
	messages := buildOAIMessages(req)

	oaiReq := oaiRequest{
		Model:    req.Model,
		Messages: messages,
		Stream:   false,
		Tools:    buildOAITools(req.ToolDefs),
	}

	body, err := json.Marshal(oaiReq)
	if err != nil {
		return nil, fmt.Errorf("%s submit: marshal: %w", c.providerName, err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%s submit: %w", c.providerName, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%s submit: %w", c.providerName, err)
	}
	defer resp.Body.Close()
	latencyMs := time.Since(start).Milliseconds()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("%s submit: status %d: %s", c.providerName, resp.StatusCode, string(respBody))
	}

	var oaiResp oaiResponse
	if err := json.NewDecoder(resp.Body).Decode(&oaiResp); err != nil {
		return nil, fmt.Errorf("%s submit: decode: %w", c.providerName, err)
	}

	result := &TaskResponse{
		TokensUsed: oaiResp.Usage.TotalTokens,
		TokensIn:   oaiResp.Usage.PromptTokens,
		TokensOut:  oaiResp.Usage.CompletionTokens,
		Model:      oaiResp.Model,
		LatencyMs:  latencyMs,
		Done:       true,
	}

	if len(oaiResp.Choices) > 0 {
		choice := oaiResp.Choices[0]
		result.Content = choice.Message.Content
		result.FinishReason = choice.FinishReason
		for _, tc := range choice.Message.ToolCalls {
			var args map[string]any
			json.Unmarshal([]byte(tc.Function.Arguments), &args)
			result.ToolCalls = append(result.ToolCalls, ToolCallInfo{
				ID:   tc.ID,
				Name: tc.Function.Name,
				Args: args,
			})
		}
	}

	return result, nil
}

func (c *openAICompatConnector) SubmitStream(ctx context.Context, req TaskRequest) (<-chan StreamEvent, error) {
	messages := buildOAIMessages(req)

	oaiReq := oaiRequest{
		Model:    req.Model,
		Messages: messages,
		Stream:   true,
		Tools:    buildOAITools(req.ToolDefs),
	}

	body, err := json.Marshal(oaiReq)
	if err != nil {
		return nil, fmt.Errorf("%s stream: marshal: %w", c.providerName, err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%s stream: %w", c.providerName, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if c.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%s stream: %w", c.providerName, err)
	}

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("%s stream: status %d: %s", c.providerName, resp.StatusCode, string(respBody))
	}

	ch := make(chan StreamEvent, 64)

	go func() {
		defer close(ch)
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if line == "" || line == "data: [DONE]" {
				if line == "data: [DONE]" {
					ch <- StreamEvent{
						Type:    models.EventTypeAgentCompleted,
						Content: "",
					}
				}
				continue
			}

			if len(line) > 6 && line[:6] == "data: " {
				data := line[6:]
				var chunk oaiStreamChunk
				if err := json.Unmarshal([]byte(data), &chunk); err != nil {
					continue
				}

				if len(chunk.Choices) > 0 {
					delta := chunk.Choices[0].Delta
					if delta.Content != "" {
						ch <- StreamEvent{
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

func buildOAITools(defs []ToolDefinition) []oaiTool {
	if len(defs) == 0 {
		return nil
	}
	tools := make([]oaiTool, 0, len(defs))
	for _, d := range defs {
		params := d.Parameters
		if params == nil {
			params = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		tools = append(tools, oaiTool{
			Type: "function",
			Function: oaiToolFunction{
				Name:        d.Name,
				Description: d.Description,
				Parameters:  params,
			},
		})
	}
	return tools
}

func buildOAIMessages(req TaskRequest) []oaiMsg {
	// If History is provided, use it directly (multi-turn tool conversation)
	if len(req.History) > 0 {
		msgs := make([]oaiMsg, 0, len(req.History))
		for _, m := range req.History {
			msg := oaiMsg{
				Role:       m.Role,
				Content:    m.Content,
				ToolCallID: m.ToolCallID,
			}
			// Convert engine ToolCallInfo → oaiToolCallMsg for assistant messages
			for _, tc := range m.ToolCalls {
				argsJSON, _ := json.Marshal(tc.Args)
				msg.ToolCalls = append(msg.ToolCalls, oaiToolCallMsg{
					ID:   tc.ID,
					Type: "function",
					Function: struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					}{
						Name:      tc.Name,
						Arguments: string(argsJSON),
					},
				})
			}
			msgs = append(msgs, msg)
		}
		return msgs
	}

	// Default: build from SystemPrompt + Message
	var msgs []oaiMsg

	if req.SystemPrompt != "" {
		systemContent := req.SystemPrompt
		if req.Instructions != "" {
			systemContent += "\n\n## Instructions\n" + req.Instructions
		}
		msgs = append(msgs, oaiMsg{Role: "system", Content: systemContent})
	}

	msgs = append(msgs, oaiMsg{Role: "user", Content: req.Message})

	return msgs
}
