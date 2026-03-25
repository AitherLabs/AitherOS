package unit

import (
	"sync"
	"testing"
	"time"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
)

// mockEventBus tests the in-process subscribe/unsubscribe logic without Redis.
// We test the channel fan-out pattern directly.
func TestEventBusInProcessFanout(t *testing.T) {
	execID := uuid.New()
	agentID := uuid.New()

	// Simulate the subscriber map
	subscribers := make(map[uuid.UUID][]chan models.Event)
	var mu sync.RWMutex

	subscribe := func(id uuid.UUID) chan models.Event {
		ch := make(chan models.Event, 128)
		mu.Lock()
		subscribers[id] = append(subscribers[id], ch)
		mu.Unlock()
		return ch
	}

	publish := func(event models.Event) {
		mu.RLock()
		subs := subscribers[event.ExecutionID]
		mu.RUnlock()
		for _, ch := range subs {
			select {
			case ch <- event:
			default:
			}
		}
	}

	unsubscribe := func(id uuid.UUID, ch chan models.Event) {
		mu.Lock()
		defer mu.Unlock()
		subs := subscribers[id]
		for i, sub := range subs {
			if sub == ch {
				subscribers[id] = append(subs[:i], subs[i+1:]...)
				close(ch)
				break
			}
		}
	}

	// Subscribe two listeners
	ch1 := subscribe(execID)
	ch2 := subscribe(execID)

	// Publish an event
	event := models.NewEvent(execID, &agentID, "TestAgent", models.EventTypeAgentThinking, "thinking...", nil)
	publish(event)

	// Both should receive it
	select {
	case e := <-ch1:
		if e.Message != "thinking..." {
			t.Errorf("ch1 message = %q, want %q", e.Message, "thinking...")
		}
	case <-time.After(time.Second):
		t.Error("ch1 timed out waiting for event")
	}

	select {
	case e := <-ch2:
		if e.Message != "thinking..." {
			t.Errorf("ch2 message = %q, want %q", e.Message, "thinking...")
		}
	case <-time.After(time.Second):
		t.Error("ch2 timed out waiting for event")
	}

	// Unsubscribe ch1
	unsubscribe(execID, ch1)

	// Publish another event
	event2 := models.NewEvent(execID, nil, "", models.EventTypeSystem, "system event", nil)
	publish(event2)

	// Only ch2 should receive it
	select {
	case e := <-ch2:
		if e.Message != "system event" {
			t.Errorf("ch2 message = %q, want %q", e.Message, "system event")
		}
	case <-time.After(time.Second):
		t.Error("ch2 timed out waiting for event")
	}

	// ch1 is closed, reading should return zero value
	_, ok := <-ch1
	if ok {
		t.Error("ch1 should be closed")
	}

	unsubscribe(execID, ch2)
}

func TestEventBusNoSubscribers(t *testing.T) {
	subscribers := make(map[uuid.UUID][]chan models.Event)
	var mu sync.RWMutex

	execID := uuid.New()
	event := models.NewEvent(execID, nil, "", models.EventTypeSystem, "no one listening", nil)

	// Publishing to no subscribers should not panic
	mu.RLock()
	subs := subscribers[event.ExecutionID]
	mu.RUnlock()
	for _, ch := range subs {
		select {
		case ch <- event:
		default:
		}
	}

	if len(subs) != 0 {
		t.Errorf("expected 0 subscribers, got %d", len(subs))
	}
}

func TestEventBusSlowSubscriber(t *testing.T) {
	execID := uuid.New()

	// Create a channel with buffer of 1
	ch := make(chan models.Event, 1)

	// Fill the buffer
	ch <- models.NewEvent(execID, nil, "", models.EventTypeSystem, "first", nil)

	// This should drop (non-blocking send)
	event := models.NewEvent(execID, nil, "", models.EventTypeSystem, "second", nil)
	select {
	case ch <- event:
		// sent
	default:
		// dropped - expected behavior for slow subscriber
	}

	// Only first event should be in the channel
	e := <-ch
	if e.Message != "first" {
		t.Errorf("message = %q, want %q", e.Message, "first")
	}

	// Channel should be empty now
	select {
	case <-ch:
		t.Error("channel should be empty - slow subscriber event should have been dropped")
	default:
		// expected
	}
}

func TestEventBusMultipleExecutions(t *testing.T) {
	subscribers := make(map[uuid.UUID][]chan models.Event)
	var mu sync.RWMutex

	exec1 := uuid.New()
	exec2 := uuid.New()

	ch1 := make(chan models.Event, 128)
	ch2 := make(chan models.Event, 128)

	mu.Lock()
	subscribers[exec1] = append(subscribers[exec1], ch1)
	subscribers[exec2] = append(subscribers[exec2], ch2)
	mu.Unlock()

	// Publish to exec1 only
	event := models.NewEvent(exec1, nil, "", models.EventTypeSystem, "for exec1", nil)
	mu.RLock()
	for _, ch := range subscribers[event.ExecutionID] {
		ch <- event
	}
	mu.RUnlock()

	select {
	case e := <-ch1:
		if e.Message != "for exec1" {
			t.Errorf("ch1 message = %q", e.Message)
		}
	case <-time.After(time.Second):
		t.Error("ch1 should have received event")
	}

	// ch2 should NOT have received anything
	select {
	case <-ch2:
		t.Error("ch2 should NOT have received an event for exec1")
	case <-time.After(100 * time.Millisecond):
		// expected
	}
}
