package unit

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// MockConnector implements engine.Connector for testing orchestrator logic.
type MockConnector struct {
	name        string
	healthErr   error
	submitFunc  func(ctx context.Context, req engine.TaskRequest) (*engine.TaskResponse, error)
	streamFunc  func(ctx context.Context, req engine.TaskRequest) (<-chan engine.StreamEvent, error)
	submitCalls []engine.TaskRequest
	mu          sync.Mutex
}

func NewMockConnector(name string) *MockConnector {
	return &MockConnector{
		name: name,
		submitFunc: func(ctx context.Context, req engine.TaskRequest) (*engine.TaskResponse, error) {
			return &engine.TaskResponse{
				Content:    "mock response",
				TokensUsed: 100,
				Done:       true,
			}, nil
		},
	}
}

func (m *MockConnector) Name() string { return m.name }

func (m *MockConnector) HealthCheck(ctx context.Context) error { return m.healthErr }

func (m *MockConnector) Submit(ctx context.Context, req engine.TaskRequest) (*engine.TaskResponse, error) {
	m.mu.Lock()
	m.submitCalls = append(m.submitCalls, req)
	m.mu.Unlock()
	return m.submitFunc(ctx, req)
}

func (m *MockConnector) SubmitStream(ctx context.Context, req engine.TaskRequest) (<-chan engine.StreamEvent, error) {
	if m.streamFunc != nil {
		return m.streamFunc(ctx, req)
	}
	ch := make(chan engine.StreamEvent, 1)
	ch <- engine.StreamEvent{Type: models.EventTypeAgentCompleted, Content: "done"}
	close(ch)
	return ch, nil
}

func (m *MockConnector) GetSubmitCalls() []engine.TaskRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]engine.TaskRequest{}, m.submitCalls...)
}

func TestMockConnectorInterface(t *testing.T) {
	// Verify MockConnector satisfies the Connector interface
	var _ engine.Connector = (*MockConnector)(nil)
}

func TestMockConnectorName(t *testing.T) {
	m := NewMockConnector("picoclaw")
	if m.Name() != "picoclaw" {
		t.Errorf("Name() = %q, want %q", m.Name(), "picoclaw")
	}
}

func TestMockConnectorHealthCheck(t *testing.T) {
	m := NewMockConnector("test")
	if err := m.HealthCheck(context.Background()); err != nil {
		t.Errorf("HealthCheck() error = %v", err)
	}

	m.healthErr = fmt.Errorf("connection refused")
	if err := m.HealthCheck(context.Background()); err == nil {
		t.Error("HealthCheck() should fail")
	}
}

func TestMockConnectorSubmit(t *testing.T) {
	m := NewMockConnector("test")
	m.submitFunc = func(ctx context.Context, req engine.TaskRequest) (*engine.TaskResponse, error) {
		return &engine.TaskResponse{
			Content:    "custom response for " + req.AgentName,
			TokensUsed: 250,
			Done:       true,
		}, nil
	}

	resp, err := m.Submit(context.Background(), engine.TaskRequest{
		AgentID:   uuid.New(),
		AgentName: "Scout",
		Message:   "find info",
		Model:     "gpt-5.4-mini",
	})

	if err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	if resp.Content != "custom response for Scout" {
		t.Errorf("Content = %q", resp.Content)
	}
	if resp.TokensUsed != 250 {
		t.Errorf("TokensUsed = %d, want 250", resp.TokensUsed)
	}
}

func TestMockConnectorSubmitTracking(t *testing.T) {
	m := NewMockConnector("test")

	agentID := uuid.New()
	m.Submit(context.Background(), engine.TaskRequest{
		AgentID:   agentID,
		AgentName: "Agent1",
		Message:   "task 1",
		Model:     "gpt-5.4-mini",
	})
	m.Submit(context.Background(), engine.TaskRequest{
		AgentID:   agentID,
		AgentName: "Agent2",
		Message:   "task 2",
		Model:     "gpt-5.4-mini",
	})

	calls := m.GetSubmitCalls()
	if len(calls) != 2 {
		t.Fatalf("submit calls = %d, want 2", len(calls))
	}
	if calls[0].AgentName != "Agent1" {
		t.Errorf("calls[0].AgentName = %q", calls[0].AgentName)
	}
	if calls[1].AgentName != "Agent2" {
		t.Errorf("calls[1].AgentName = %q", calls[1].AgentName)
	}
}

func TestMockConnectorSubmitError(t *testing.T) {
	m := NewMockConnector("test")
	m.submitFunc = func(ctx context.Context, req engine.TaskRequest) (*engine.TaskResponse, error) {
		return nil, fmt.Errorf("engine overloaded")
	}

	_, err := m.Submit(context.Background(), engine.TaskRequest{
		AgentID: uuid.New(),
		Message: "test",
		Model:   "gpt-5.4-mini",
	})

	if err == nil {
		t.Error("Submit() should return error")
	}
	if err.Error() != "engine overloaded" {
		t.Errorf("error = %q, want %q", err.Error(), "engine overloaded")
	}
}

func TestMockConnectorSubmitContextCancelled(t *testing.T) {
	m := NewMockConnector("test")
	m.submitFunc = func(ctx context.Context, req engine.TaskRequest) (*engine.TaskResponse, error) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
			return &engine.TaskResponse{Content: "ok", Done: true}, nil
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := m.Submit(ctx, engine.TaskRequest{
		AgentID: uuid.New(),
		Message: "test",
		Model:   "gpt-5.4-mini",
	})

	if err == nil {
		t.Error("Submit() should fail on cancelled context")
	}
}

func TestMockConnectorStream(t *testing.T) {
	m := NewMockConnector("test")

	ch, err := m.SubmitStream(context.Background(), engine.TaskRequest{
		AgentID: uuid.New(),
		Message: "test",
		Model:   "gpt-5.4-mini",
	})

	if err != nil {
		t.Fatalf("SubmitStream() error = %v", err)
	}

	events := make([]engine.StreamEvent, 0)
	for e := range ch {
		events = append(events, e)
	}

	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].Content != "done" {
		t.Errorf("events[0].Content = %q, want %q", events[0].Content, "done")
	}
}

func TestTaskRequestFields(t *testing.T) {
	agentID := uuid.New()
	req := engine.TaskRequest{
		AgentID:      agentID,
		AgentName:    "Scout",
		SystemPrompt: "You are a scout.",
		Instructions: "Be thorough.",
		Message:      "Scan the perimeter",
		Model:        "gpt-5.4-mini",
		Tools:        []string{"nmap", "web_search"},
	}

	if req.AgentID != agentID {
		t.Error("AgentID mismatch")
	}
	if req.AgentName != "Scout" {
		t.Errorf("AgentName = %q", req.AgentName)
	}
	if len(req.Tools) != 2 {
		t.Errorf("Tools length = %d, want 2", len(req.Tools))
	}
}

func TestTaskResponseFields(t *testing.T) {
	resp := engine.TaskResponse{
		Content:    "Found 3 targets",
		Reasoning:  "I scanned the network first",
		TokensUsed: 500,
		TokensIn:   350,
		TokensOut:  150,
		Model:      "gpt-5.4-mini",
		LatencyMs:  1234,
		ToolCalls: []engine.ToolCallInfo{
			{Name: "nmap", Args: map[string]any{"target": "192.168.1.0/24"}, Result: "3 hosts up"},
		},
		Done: true,
	}

	if resp.Content != "Found 3 targets" {
		t.Errorf("Content = %q", resp.Content)
	}
	if resp.Reasoning != "I scanned the network first" {
		t.Errorf("Reasoning = %q", resp.Reasoning)
	}
	if resp.TokensUsed != 500 {
		t.Errorf("TokensUsed = %d", resp.TokensUsed)
	}
	if resp.TokensIn != 350 {
		t.Errorf("TokensIn = %d, want 350", resp.TokensIn)
	}
	if resp.TokensOut != 150 {
		t.Errorf("TokensOut = %d, want 150", resp.TokensOut)
	}
	if resp.Model != "gpt-5.4-mini" {
		t.Errorf("Model = %q", resp.Model)
	}
	if resp.LatencyMs != 1234 {
		t.Errorf("LatencyMs = %d, want 1234", resp.LatencyMs)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("ToolCalls = %d, want 1", len(resp.ToolCalls))
	}
	if resp.ToolCalls[0].Name != "nmap" {
		t.Errorf("ToolCalls[0].Name = %q", resp.ToolCalls[0].Name)
	}
}

func TestMessageModel(t *testing.T) {
	execID := uuid.New()
	agentID := uuid.New()
	msg := models.Message{
		ID:          uuid.New(),
		ExecutionID: execID,
		AgentID:     &agentID,
		AgentName:   "Aither",
		Iteration:   3,
		Role:        models.MessageRoleAssistant,
		Content:     "Found a vulnerability in port 443",
		TokensIn:    200,
		TokensOut:   50,
		Model:       "gpt-5.4-mini",
		LatencyMs:   890,
		ToolCalls: []models.ToolCallJSON{
			{Name: "nmap", Args: map[string]any{"target": "10.0.0.1"}, Result: "port 443 open"},
		},
	}

	if msg.ExecutionID != execID {
		t.Error("ExecutionID mismatch")
	}
	if msg.Role != models.MessageRoleAssistant {
		t.Errorf("Role = %q, want assistant", msg.Role)
	}
	if msg.Iteration != 3 {
		t.Errorf("Iteration = %d, want 3", msg.Iteration)
	}
	if len(msg.ToolCalls) != 1 {
		t.Fatalf("ToolCalls len = %d, want 1", len(msg.ToolCalls))
	}
}

func TestMessageRoleConstants(t *testing.T) {
	if models.MessageRoleSystem != "system" {
		t.Error("MessageRoleSystem wrong")
	}
	if models.MessageRoleUser != "user" {
		t.Error("MessageRoleUser wrong")
	}
	if models.MessageRoleAssistant != "assistant" {
		t.Error("MessageRoleAssistant wrong")
	}
	if models.MessageRoleTool != "tool" {
		t.Error("MessageRoleTool wrong")
	}
}

func TestMarshalToolCalls(t *testing.T) {
	// nil input
	b := models.MarshalToolCalls(nil)
	if string(b) != "[]" {
		t.Errorf("nil marshal = %q, want []", string(b))
	}

	// with data
	tc := []models.ToolCallJSON{
		{Name: "web_search", Args: map[string]any{"query": "test"}, Result: "found"},
	}
	b = models.MarshalToolCalls(tc)
	if len(b) == 0 {
		t.Error("empty marshal for non-nil input")
	}
}
