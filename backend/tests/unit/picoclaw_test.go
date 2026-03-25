package unit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/engine/picoclaw"
	"github.com/google/uuid"
)

func TestPicoClawName(t *testing.T) {
	adapter := picoclaw.New("http://localhost:55000", 30*time.Second)
	if adapter.Name() != "picoclaw" {
		t.Errorf("Name() = %q, want %q", adapter.Name(), "picoclaw")
	}
}

func TestPicoClawHealthCheck(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Errorf("unexpected method: %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	adapter := picoclaw.New(server.URL, 10*time.Second)
	err := adapter.HealthCheck(context.Background())
	if err != nil {
		t.Errorf("HealthCheck() error = %v", err)
	}
}

func TestPicoClawHealthCheckFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(`{"error":"not ready"}`))
	}))
	defer server.Close()

	adapter := picoclaw.New(server.URL, 10*time.Second)
	err := adapter.HealthCheck(context.Background())
	if err == nil {
		t.Error("HealthCheck() should fail on 503")
	}
}

func TestPicoClawHealthCheckUnreachable(t *testing.T) {
	adapter := picoclaw.New("http://127.0.0.1:1", 1*time.Second)
	err := adapter.HealthCheck(context.Background())
	if err == nil {
		t.Error("HealthCheck() should fail on unreachable server")
	}
}

func TestPicoClawSubmit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected content type: %s", r.Header.Get("Content-Type"))
		}

		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)

		if body["model"] != "gpt-5.4-mini" {
			t.Errorf("model = %v, want gpt-5.4-mini", body["model"])
		}
		if body["stream"] != false {
			t.Errorf("stream = %v, want false", body["stream"])
		}

		messages := body["messages"].([]any)
		if len(messages) < 2 {
			t.Errorf("expected at least 2 messages (system + user), got %d", len(messages))
		}

		resp := map[string]any{
			"id": "chatcmpl-test123",
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"role":    "assistant",
						"content": "I found 3 open ports: 80, 443, 8080",
					},
					"finish_reason": "stop",
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     150,
				"completion_tokens": 50,
				"total_tokens":      200,
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	adapter := picoclaw.New(server.URL, 10*time.Second)
	resp, err := adapter.Submit(context.Background(), engine.TaskRequest{
		AgentID:      uuid.New(),
		AgentName:    "Scanner",
		SystemPrompt: "You are a port scanner.",
		Instructions: "Scan the target",
		Message:      "Scan 192.168.1.1",
		Model:        "gpt-5.4-mini",
		Tools:        []string{"nmap"},
	})

	if err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	if resp.Content != "I found 3 open ports: 80, 443, 8080" {
		t.Errorf("Content = %q, want expected output", resp.Content)
	}
	if resp.TokensUsed != 200 {
		t.Errorf("TokensUsed = %d, want 200", resp.TokensUsed)
	}
	if !resp.Done {
		t.Error("Done should be true")
	}
}

func TestPicoClawSubmitWithToolCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]any{
			"id": "chatcmpl-tools",
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"role":    "assistant",
						"content": "",
						"tool_calls": []map[string]any{
							{
								"id":   "call_1",
								"type": "function",
								"function": map[string]any{
									"name":      "web_search",
									"arguments": `{"query":"open ports 192.168.1.1"}`,
								},
							},
						},
					},
					"finish_reason": "tool_calls",
				},
			},
			"usage": map[string]any{
				"total_tokens": 100,
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	adapter := picoclaw.New(server.URL, 10*time.Second)
	resp, err := adapter.Submit(context.Background(), engine.TaskRequest{
		AgentID:      uuid.New(),
		AgentName:    "Scout",
		SystemPrompt: "You are a scout.",
		Message:      "Search for info",
		Model:        "gpt-5.4-mini",
	})

	if err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("ToolCalls length = %d, want 1", len(resp.ToolCalls))
	}
	if resp.ToolCalls[0].Name != "web_search" {
		t.Errorf("ToolCalls[0].Name = %q, want %q", resp.ToolCalls[0].Name, "web_search")
	}
	if resp.ToolCalls[0].Args["query"] != "open ports 192.168.1.1" {
		t.Errorf("ToolCalls[0].Args = %v", resp.ToolCalls[0].Args)
	}
}

func TestPicoClawSubmitServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal server error"}`))
	}))
	defer server.Close()

	adapter := picoclaw.New(server.URL, 10*time.Second)
	_, err := adapter.Submit(context.Background(), engine.TaskRequest{
		AgentID: uuid.New(),
		Message: "test",
		Model:   "gpt-5.4-mini",
	})

	if err == nil {
		t.Error("Submit() should fail on 500")
	}
}

func TestPicoClawSubmitContextCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
	}))
	defer server.Close()

	adapter := picoclaw.New(server.URL, 10*time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := adapter.Submit(ctx, engine.TaskRequest{
		AgentID: uuid.New(),
		Message: "test",
		Model:   "gpt-5.4-mini",
	})

	if err == nil {
		t.Error("Submit() should fail on context timeout")
	}
}

func TestPicoClawSubmitStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("Accept header = %q, want text/event-stream", r.Header.Get("Accept"))
		}

		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["stream"] != true {
			t.Errorf("stream = %v, want true", body["stream"])
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected http.Flusher")
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)

		chunks := []string{
			`{"choices":[{"delta":{"role":"assistant","content":"Hello"}}]}`,
			`{"choices":[{"delta":{"content":" world"}}]}`,
			`{"choices":[{"delta":{"content":"!"}}]}`,
		}

		for _, chunk := range chunks {
			w.Write([]byte("data: " + chunk + "\n\n"))
			flusher.Flush()
		}
		w.Write([]byte("data: [DONE]\n\n"))
		flusher.Flush()
	}))
	defer server.Close()

	adapter := picoclaw.New(server.URL, 10*time.Second)
	ch, err := adapter.SubmitStream(context.Background(), engine.TaskRequest{
		AgentID:      uuid.New(),
		AgentName:    "Writer",
		SystemPrompt: "You are a writer.",
		Message:      "Say hello",
		Model:        "gpt-5.4-mini",
	})

	if err != nil {
		t.Fatalf("SubmitStream() error = %v", err)
	}

	var events []engine.StreamEvent
	for event := range ch {
		events = append(events, event)
	}

	// Should have content events + a completion event
	if len(events) < 3 {
		t.Errorf("expected at least 3 events, got %d", len(events))
	}

	// Check first content event
	foundContent := false
	for _, e := range events {
		if e.Content == "Hello" {
			foundContent = true
			break
		}
	}
	if !foundContent {
		t.Error("expected to find 'Hello' in stream events")
	}
}

func TestPicoClawSubmitStreamServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"bad request"}`))
	}))
	defer server.Close()

	adapter := picoclaw.New(server.URL, 10*time.Second)
	_, err := adapter.SubmitStream(context.Background(), engine.TaskRequest{
		AgentID: uuid.New(),
		Message: "test",
		Model:   "gpt-5.4-mini",
	})

	if err == nil {
		t.Error("SubmitStream() should fail on 400")
	}
}
