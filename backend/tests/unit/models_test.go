package unit

import (
	"testing"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

func TestAgentStatusConstants(t *testing.T) {
	tests := []struct {
		status models.AgentStatus
		want   string
	}{
		{models.AgentStatusActive, "active"},
		{models.AgentStatusInactive, "inactive"},
		{models.AgentStatusArchived, "archived"},
	}

	for _, tt := range tests {
		if string(tt.status) != tt.want {
			t.Errorf("AgentStatus = %q, want %q", tt.status, tt.want)
		}
	}
}

func TestWorkForceStatusConstants(t *testing.T) {
	tests := []struct {
		status models.WorkForceStatus
		want   string
	}{
		{models.WorkForceStatusDraft, "draft"},
		{models.WorkForceStatusPlanning, "planning"},
		{models.WorkForceStatusAwaitingApproval, "awaiting_approval"},
		{models.WorkForceStatusExecuting, "executing"},
		{models.WorkForceStatusCompleted, "completed"},
		{models.WorkForceStatusFailed, "failed"},
		{models.WorkForceStatusHalted, "halted"},
	}

	for _, tt := range tests {
		if string(tt.status) != tt.want {
			t.Errorf("WorkForceStatus = %q, want %q", tt.status, tt.want)
		}
	}
}

func TestExecutionStatusConstants(t *testing.T) {
	tests := []struct {
		status models.ExecutionStatus
		want   string
	}{
		{models.ExecutionStatusPending, "pending"},
		{models.ExecutionStatusPlanning, "planning"},
		{models.ExecutionStatusAwaitingApproval, "awaiting_approval"},
		{models.ExecutionStatusRunning, "running"},
		{models.ExecutionStatusCompleted, "completed"},
		{models.ExecutionStatusFailed, "failed"},
		{models.ExecutionStatusHalted, "halted"},
	}

	for _, tt := range tests {
		if string(tt.status) != tt.want {
			t.Errorf("ExecutionStatus = %q, want %q", tt.status, tt.want)
		}
	}
}

func TestEventTypeConstants(t *testing.T) {
	tests := []struct {
		eventType models.EventType
		want      string
	}{
		{models.EventTypeAgentThinking, "agent_thinking"},
		{models.EventTypeAgentActing, "agent_acting"},
		{models.EventTypeAgentCompleted, "agent_completed"},
		{models.EventTypeAgentError, "agent_error"},
		{models.EventTypeToolCall, "tool_call"},
		{models.EventTypeToolResult, "tool_result"},
		{models.EventTypeInterAgentMsg, "inter_agent_message"},
		{models.EventTypePlanProposed, "plan_proposed"},
		{models.EventTypePlanApproved, "plan_approved"},
		{models.EventTypePlanRejected, "plan_rejected"},
		{models.EventTypeExecutionStarted, "execution_started"},
		{models.EventTypeExecutionDone, "execution_done"},
		{models.EventTypeExecutionHalted, "execution_halted"},
		{models.EventTypeHumanRequired, "human_required"},
		{models.EventTypeIterationDone, "iteration_done"},
		{models.EventTypeSystem, "system"},
	}

	for _, tt := range tests {
		if string(tt.eventType) != tt.want {
			t.Errorf("EventType = %q, want %q", tt.eventType, tt.want)
		}
	}
}

func TestNewEvent(t *testing.T) {
	execID := uuid.New()
	agentID := uuid.New()
	agentName := "TestAgent"
	data := map[string]any{"key": "value"}

	event := models.NewEvent(execID, &agentID, agentName, models.EventTypeAgentThinking, "thinking...", data)

	if event.ID == uuid.Nil {
		t.Error("Event ID should not be nil")
	}
	if event.ExecutionID != execID {
		t.Errorf("ExecutionID = %v, want %v", event.ExecutionID, execID)
	}
	if event.AgentID == nil || *event.AgentID != agentID {
		t.Errorf("AgentID = %v, want %v", event.AgentID, agentID)
	}
	if event.AgentName != agentName {
		t.Errorf("AgentName = %q, want %q", event.AgentName, agentName)
	}
	if event.Type != models.EventTypeAgentThinking {
		t.Errorf("Type = %q, want %q", event.Type, models.EventTypeAgentThinking)
	}
	if event.Message != "thinking..." {
		t.Errorf("Message = %q, want %q", event.Message, "thinking...")
	}
	if event.Data["key"] != "value" {
		t.Errorf("Data[key] = %v, want %q", event.Data["key"], "value")
	}
	if event.Timestamp.IsZero() {
		t.Error("Timestamp should not be zero")
	}
	if time.Since(event.Timestamp) > time.Second {
		t.Error("Timestamp should be recent")
	}
}

func TestNewEventNilAgent(t *testing.T) {
	execID := uuid.New()
	event := models.NewEvent(execID, nil, "", models.EventTypeSystem, "system msg", nil)

	if event.AgentID != nil {
		t.Errorf("AgentID = %v, want nil", event.AgentID)
	}
	if event.AgentName != "" {
		t.Errorf("AgentName = %q, want empty", event.AgentName)
	}
	if event.Data != nil {
		t.Errorf("Data = %v, want nil", event.Data)
	}
}

func TestCreateAgentRequestFields(t *testing.T) {
	req := models.CreateAgentRequest{
		Name:         "Scout",
		Description:  "Recon agent",
		SystemPrompt: "You are a scout.",
		Instructions: "Search the web",
		EngineType:   "picoclaw",
		EngineConfig: map[string]string{"url": "http://localhost:55000"},
		Tools:        []string{"web_search"},
		Model:        "gpt-5.4-mini",
	}

	if req.Name != "Scout" {
		t.Errorf("Name = %q, want %q", req.Name, "Scout")
	}
	if req.EngineType != "picoclaw" {
		t.Errorf("EngineType = %q, want %q", req.EngineType, "picoclaw")
	}
	if len(req.Tools) != 1 || req.Tools[0] != "web_search" {
		t.Errorf("Tools = %v, want [web_search]", req.Tools)
	}
}

func TestUpdateAgentRequestPartial(t *testing.T) {
	name := "NewName"
	req := models.UpdateAgentRequest{
		Name: &name,
	}

	if req.Name == nil || *req.Name != "NewName" {
		t.Error("Name should be set to NewName")
	}
	if req.Description != nil {
		t.Error("Description should be nil (not updated)")
	}
	if req.SystemPrompt != nil {
		t.Error("SystemPrompt should be nil (not updated)")
	}
}

func TestCreateWorkForceRequestFields(t *testing.T) {
	req := models.CreateWorkForceRequest{
		Name:         "Alpha Team",
		Description:  "The first team",
		Objective:    "Complete the mission",
		BudgetTokens: 500000,
		BudgetTimeS:  3600,
		AgentIDs:     []string{uuid.New().String(), uuid.New().String()},
	}

	if req.Name != "Alpha Team" {
		t.Errorf("Name = %q, want %q", req.Name, "Alpha Team")
	}
	if len(req.AgentIDs) != 2 {
		t.Errorf("AgentIDs length = %d, want 2", len(req.AgentIDs))
	}
	if req.BudgetTokens != 500000 {
		t.Errorf("BudgetTokens = %d, want 500000", req.BudgetTokens)
	}
}
