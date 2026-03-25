package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/aitheros/backend/internal/api"
	"github.com/aitheros/backend/internal/eventbus"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/orchestrator"
	"github.com/aitheros/backend/internal/store"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// setupWSTestEnv starts a real HTTP server (not httptest) so that
// http.Hijacker is available for WebSocket upgrades.
func setupWSTestEnv(t *testing.T) (*testEnv, string) {
	t.Helper()

	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://aitheros:aitheros@127.0.0.1:5432/aitheros_test?sslmode=disable"
	}

	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://127.0.0.1:6379/1"
	}

	s, err := store.New(dbURL)
	if err != nil {
		t.Skipf("Skipping integration test: cannot connect to database: %v", err)
	}

	eb, err := eventbus.New(redisURL)
	if err != nil {
		s.Close()
		t.Skipf("Skipping integration test: cannot connect to redis: %v", err)
	}

	orch := orchestrator.New(s, eb, orchestrator.LLMConfig{
		APIBase: "http://127.0.0.1:4000/v1",
		APIKey:  "dummy_token",
		Model:   "gpt-5.4-mini",
	})

	router := api.NewRouter(s, orch, eb, nil, nil, nil, nil, "*")

	// Use a real TCP listener so http.Hijacker works
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}

	srv := &http.Server{Handler: router}
	go srv.Serve(ln)

	baseURL := fmt.Sprintf("http://%s", ln.Addr().String())

	env := &testEnv{store: s, eventBus: eb, orch: orch, router: router}

	t.Cleanup(func() {
		srv.Shutdown(context.Background())
		ln.Close()
		pool := s.Pool()
		pool.Exec(t.Context(), "DELETE FROM events")
		pool.Exec(t.Context(), "DELETE FROM executions")
		pool.Exec(t.Context(), "DELETE FROM workforce_agents")
		pool.Exec(t.Context(), "DELETE FROM workforces")
		pool.Exec(t.Context(), "DELETE FROM agents")
		eb.Close()
		s.Close()
	})

	return env, baseURL
}

func TestWebSocketConnection(t *testing.T) {
	env, baseURL := setupWSTestEnv(t)
	_ = env

	execID := uuid.New()

	// Connect to WebSocket
	wsURL := "ws" + baseURL[4:] + "/ws/executions/" + execID.String()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect WebSocket: %v", err)
	}
	defer conn.Close()

	// Publish an event via the event bus
	event := models.NewEvent(execID, nil, "", models.EventTypeSystem, "hello from test", nil)
	if err := env.eventBus.Publish(t.Context(), event); err != nil {
		t.Fatalf("failed to publish event: %v", err)
	}

	// Read from WebSocket
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, message, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read WebSocket message: %v", err)
	}

	var received models.Event
	if err := json.Unmarshal(message, &received); err != nil {
		t.Fatalf("failed to unmarshal event: %v", err)
	}

	if received.Message != "hello from test" {
		t.Errorf("message = %q, want %q", received.Message, "hello from test")
	}
	if received.Type != models.EventTypeSystem {
		t.Errorf("type = %q, want %q", received.Type, models.EventTypeSystem)
	}
}

func TestWebSocketMultipleEvents(t *testing.T) {
	env, baseURL := setupWSTestEnv(t)

	execID := uuid.New()

	wsURL := "ws" + baseURL[4:] + "/ws/executions/" + execID.String()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect WebSocket: %v", err)
	}
	defer conn.Close()

	// Publish multiple events
	messages := []string{"event 1", "event 2", "event 3"}
	for _, msg := range messages {
		event := models.NewEvent(execID, nil, "", models.EventTypeSystem, msg, nil)
		env.eventBus.Publish(t.Context(), event)
	}

	// Read all events
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var received []string
	for i := 0; i < len(messages); i++ {
		_, message, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("failed to read message %d: %v", i, err)
		}
		var e models.Event
		json.Unmarshal(message, &e)
		received = append(received, e.Message)
	}

	for i, msg := range messages {
		if received[i] != msg {
			t.Errorf("received[%d] = %q, want %q", i, received[i], msg)
		}
	}
}

func TestWebSocketIsolation(t *testing.T) {
	env, baseURL := setupWSTestEnv(t)

	exec1 := uuid.New()
	exec2 := uuid.New()

	// Connect to exec1
	wsURL1 := "ws" + baseURL[4:] + "/ws/executions/" + exec1.String()
	conn1, _, err := websocket.DefaultDialer.Dial(wsURL1, nil)
	if err != nil {
		t.Fatalf("failed to connect ws1: %v", err)
	}
	defer conn1.Close()

	// Connect to exec2
	wsURL2 := "ws" + baseURL[4:] + "/ws/executions/" + exec2.String()
	conn2, _, err := websocket.DefaultDialer.Dial(wsURL2, nil)
	if err != nil {
		t.Fatalf("failed to connect ws2: %v", err)
	}
	defer conn2.Close()

	// Publish to exec1 only
	event := models.NewEvent(exec1, nil, "", models.EventTypeSystem, "only for exec1", nil)
	env.eventBus.Publish(t.Context(), event)

	// conn1 should receive it
	conn1.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg, err := conn1.ReadMessage()
	if err != nil {
		t.Fatalf("conn1 read: %v", err)
	}
	var e models.Event
	json.Unmarshal(msg, &e)
	if e.Message != "only for exec1" {
		t.Errorf("conn1 message = %q", e.Message)
	}

	// conn2 should NOT receive it (timeout expected)
	conn2.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, _, err = conn2.ReadMessage()
	if err == nil {
		t.Error("conn2 should NOT have received an event for exec1")
	}
}

func TestWebSocketInvalidExecID(t *testing.T) {
	_, baseURL := setupWSTestEnv(t)

	wsURL := "ws" + baseURL[4:] + "/ws/executions/not-a-uuid"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Error("should fail to connect with invalid exec ID")
	}
	if resp != nil && resp.StatusCode != 400 {
		// WebSocket upgrade failure may or may not give us a status code
		t.Logf("status = %d (may vary by implementation)", resp.StatusCode)
	}
}
