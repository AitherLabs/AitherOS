package models

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type EventType string

const (
	EventTypeAgentThinking    EventType = "agent_thinking"
	EventTypeAgentActing      EventType = "agent_acting"
	EventTypeAgentToken       EventType = "agent_token"
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

	// Discussion phase events (P1)
	EventTypeDiscussionStarted   EventType = "discussion_started"
	EventTypeDiscussionTurn      EventType = "discussion_turn"
	EventTypeDiscussionConsensus EventType = "discussion_consensus"

	// Peer consultation events (P2)
	EventTypePeerConsultation EventType = "peer_consultation"

	// Review phase events (P3)
	EventTypeReviewStarted  EventType = "review_started"
	EventTypeReviewComplete EventType = "review_complete"

	// Auto-generated title assigned during planning
	EventTypeExecutionTitled EventType = "execution_titled"
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
		Data:        normalizeEventData(eventType, message, data),
		Timestamp:   time.Now(),
	}
}

func normalizeEventData(eventType EventType, message string, data map[string]any) map[string]any {
	normalized := make(map[string]any, len(data)+5)
	for k, v := range data {
		normalized[k] = v
	}

	reason := firstNonEmptyString(
		toString(normalized["reason"]),
		toString(normalized["error"]),
		toString(normalized["err"]),
	)
	if reason == "" && shouldDefaultReasonFromMessage(eventType) {
		reason = strings.TrimSpace(message)
	}
	normalized["reason"] = reason

	subtaskID := firstNonEmptyString(
		toString(normalized["subtask_id"]),
		toString(normalized["to_subtask"]),
		toString(normalized["from_subtask"]),
	)
	normalized["subtask_id"] = subtaskID

	if step, ok := firstInt(normalized["step"], normalized["iteration"]); ok {
		normalized["step"] = step
	} else if subtaskStep, err := strconv.Atoi(subtaskID); err == nil {
		normalized["step"] = subtaskStep
	} else {
		normalized["step"] = nil
	}

	if round, ok := firstInt(normalized["round"], normalized["tool_round"], normalized["peer_round"]); ok {
		normalized["round"] = round
	} else {
		normalized["round"] = nil
	}

	actionHint := strings.TrimSpace(toString(normalized["action_hint"]))
	if actionHint == "" {
		actionHint = defaultActionHint(eventType)
	}
	normalized["action_hint"] = actionHint

	return normalized
}

func shouldDefaultReasonFromMessage(eventType EventType) bool {
	switch eventType {
	case EventTypeAgentError,
		EventTypeHumanRequired,
		EventTypeExecutionHalted,
		EventTypePlanRejected:
		return true
	default:
		return false
	}
}

func defaultActionHint(eventType EventType) string {
	switch eventType {
	case EventTypePlanProposed:
		return "Review the plan and approve or reject with feedback."
	case EventTypePlanApproved:
		return "Monitor flow events as the plan executes."
	case EventTypePlanRejected:
		return "Provide clearer constraints so the team can re-plan effectively."
	case EventTypeExecutionStarted:
		return "Watch subtask progress and intervene only if needed."
	case EventTypeExecutionDone:
		return "Review the final result and outputs for quality."
	case EventTypeExecutionHalted:
		return "Check the halt reason, then resume or rerun after adjustments."
	case EventTypeHumanRequired:
		return "Send guidance or inject missing credentials to unblock this step."
	case EventTypeHumanIntervened:
		return "Confirm the injected instruction resolved the blocker."
	case EventTypeSubtaskStarted:
		return "Track this subtask until completion or a help request."
	case EventTypeSubtaskDone:
		return "Review output and ensure downstream dependencies can proceed."
	case EventTypeToolCall:
		return "Inspect tool arguments/results when behavior looks off."
	case EventTypeAgentError:
		return "Inspect the error and intervene with corrected instructions."
	case EventTypeAgentHandoff:
		return "Ensure downstream agent received sufficient context."
	case EventTypeDiscussionStarted, EventTypeDiscussionTurn, EventTypeDiscussionConsensus:
		return "Review discussion details to validate planning quality."
	case EventTypePeerConsultation:
		return "Verify peer advice is reflected in the next agent action."
	case EventTypeReviewStarted, EventTypeReviewComplete:
		return "Use review findings to decide whether follow-up work is needed."
	case EventTypeExecutionTitled:
		return "Verify title clarity for searchability and reporting."
	default:
		return "Review event message and metadata for context."
	}
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func toString(v any) string {
	switch val := v.(type) {
	case nil:
		return ""
	case string:
		return val
	case []byte:
		return string(val)
	case fmt.Stringer:
		return val.String()
	default:
		return fmt.Sprintf("%v", val)
	}
}

func firstInt(values ...any) (int, bool) {
	for _, v := range values {
		if n, ok := toInt(v); ok {
			return n, true
		}
	}
	return 0, false
}

func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int8:
		return int(n), true
	case int16:
		return int(n), true
	case int32:
		return int(n), true
	case int64:
		return int(n), true
	case uint:
		return int(n), true
	case uint8:
		return int(n), true
	case uint16:
		return int(n), true
	case uint32:
		return int(n), true
	case uint64:
		return int(n), true
	case float32:
		return int(n), true
	case float64:
		return int(n), true
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(n))
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}
