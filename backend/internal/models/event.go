package models

import (
	"time"

	"github.com/google/uuid"
)

type EventType string

const (
	EventTypeAgentThinking    EventType = "agent_thinking"
	EventTypeAgentActing      EventType = "agent_acting"
	EventTypeAgentCompleted   EventType = "agent_completed"
	EventTypeAgentError       EventType = "agent_error"
	EventTypeToolCall         EventType = "tool_call"
	EventTypeToolResult       EventType = "tool_result"
	EventTypeInterAgentMsg    EventType = "inter_agent_message"
	EventTypePlanProposed     EventType = "plan_proposed"
	EventTypePlanApproved     EventType = "plan_approved"
	EventTypePlanRejected     EventType = "plan_rejected"
	EventTypeExecutionStarted EventType = "execution_started"
	EventTypeExecutionDone    EventType = "execution_done"
	EventTypeExecutionHalted  EventType = "execution_halted"
	EventTypeHumanRequired    EventType = "human_required"
	EventTypeHumanIntervened  EventType = "human_intervened"
	EventTypeIterationDone    EventType = "iteration_done"
	EventTypeSubtaskStarted   EventType = "subtask_started"
	EventTypeSubtaskDone      EventType = "subtask_done"
	EventTypeAgentHandoff     EventType = "agent_handoff"
	EventTypeSystem           EventType = "system"
)

type Event struct {
	ID          uuid.UUID         `json:"id"`
	ExecutionID uuid.UUID         `json:"execution_id"`
	AgentID     *uuid.UUID        `json:"agent_id,omitempty"`
	AgentName   string            `json:"agent_name,omitempty"`
	Type        EventType         `json:"type"`
	Message     string            `json:"message"`
	Data        map[string]any    `json:"data,omitempty"`
	Timestamp   time.Time         `json:"timestamp"`
}

func NewEvent(executionID uuid.UUID, agentID *uuid.UUID, agentName string, eventType EventType, message string, data map[string]any) Event {
	return Event{
		ID:          uuid.New(),
		ExecutionID: executionID,
		AgentID:     agentID,
		AgentName:   agentName,
		Type:        eventType,
		Message:     message,
		Data:        data,
		Timestamp:   time.Now(),
	}
}
