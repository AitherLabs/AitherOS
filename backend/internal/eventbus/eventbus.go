package eventbus

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/aitheros/backend/internal/models"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const channelPrefix = "aitheros:events:"

type EventBus struct {
	rdb         *redis.Client
	subscribers map[uuid.UUID][]chan models.Event // executionID -> subscribers
	mu          sync.RWMutex
}

func New(redisURL string) (*EventBus, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}

	rdb := redis.NewClient(opts)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}

	return &EventBus{
		rdb:         rdb,
		subscribers: make(map[uuid.UUID][]chan models.Event),
	}, nil
}

func (eb *EventBus) Close() {
	eb.rdb.Close()
}

func (eb *EventBus) Publish(ctx context.Context, event models.Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	channel := channelPrefix + event.ExecutionID.String()
	if err := eb.rdb.Publish(ctx, channel, data).Err(); err != nil {
		return fmt.Errorf("publish event: %w", err)
	}

	// Fan out to in-process subscribers
	eb.mu.RLock()
	subs := eb.subscribers[event.ExecutionID]
	eb.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- event:
		default:
			// Drop if subscriber is slow
		}
	}

	return nil
}

// Subscribe returns a channel that receives events for the given execution.
// Call Unsubscribe when done.
func (eb *EventBus) Subscribe(executionID uuid.UUID) chan models.Event {
	ch := make(chan models.Event, 128)

	eb.mu.Lock()
	eb.subscribers[executionID] = append(eb.subscribers[executionID], ch)
	eb.mu.Unlock()

	return ch
}

func (eb *EventBus) Unsubscribe(executionID uuid.UUID, ch chan models.Event) {
	eb.mu.Lock()
	defer eb.mu.Unlock()

	subs := eb.subscribers[executionID]
	for i, sub := range subs {
		if sub == ch {
			eb.subscribers[executionID] = append(subs[:i], subs[i+1:]...)
			close(ch)
			break
		}
	}

	if len(eb.subscribers[executionID]) == 0 {
		delete(eb.subscribers, executionID)
	}
}

// SubscribeRedis subscribes to events via Redis pub/sub (for cross-process fanout).
func (eb *EventBus) SubscribeRedis(ctx context.Context, executionID uuid.UUID) (<-chan models.Event, func()) {
	channel := channelPrefix + executionID.String()
	pubsub := eb.rdb.Subscribe(ctx, channel)

	ch := make(chan models.Event, 128)

	go func() {
		defer close(ch)
		msgCh := pubsub.Channel()
		for msg := range msgCh {
			var event models.Event
			if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
				log.Printf("eventbus: unmarshal redis event: %v", err)
				continue
			}
			select {
			case ch <- event:
			case <-ctx.Done():
				return
			}
		}
	}()

	cancel := func() {
		pubsub.Close()
	}

	return ch, cancel
}

// PublishSystem publishes a system-level event (no agent associated).
func (eb *EventBus) PublishSystem(ctx context.Context, executionID uuid.UUID, message string) error {
	event := models.NewEvent(executionID, nil, "", models.EventTypeSystem, message, nil)
	return eb.Publish(ctx, event)
}
