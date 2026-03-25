package api

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/aitheros/backend/internal/auth"
	"github.com/aitheros/backend/internal/eventbus"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS handled by middleware
	},
}

type WebSocketHandler struct {
	eventBus *eventbus.EventBus
	jwt      *auth.JWTManager
}

func NewWebSocketHandler(eb *eventbus.EventBus, jwt *auth.JWTManager) *WebSocketHandler {
	return &WebSocketHandler{eventBus: eb, jwt: jwt}
}

// ServeWS handles WebSocket connections for streaming execution events.
// GET /ws/executions/{execID}?token=<jwt>
// Token is optional in beta mode; if provided it must be valid.
func (h *WebSocketHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	execIDStr := r.PathValue("execID")
	execID, err := uuid.Parse(execIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid execution id")
		return
	}

	// Validate JWT when present (query param or Authorization header)
	if h.jwt != nil {
		tokenStr := r.URL.Query().Get("token")
		if tokenStr == "" {
			if hdr := r.Header.Get("Authorization"); strings.HasPrefix(hdr, "Bearer ") {
				tokenStr = hdr[7:]
			}
		}
		if tokenStr != "" {
			if _, err := h.jwt.VerifyToken(tokenStr); err != nil {
				writeError(w, http.StatusUnauthorized, "invalid or expired token")
				return
			}
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade: %v", err)
		return
	}
	defer conn.Close()

	sub := h.eventBus.Subscribe(execID)
	defer h.eventBus.Unsubscribe(execID, sub)

	// Read pump — detect client disconnect
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	for {
		select {
		case event, ok := <-sub:
			if !ok {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteJSON(event); err != nil {
				log.Printf("websocket write: %v", err)
				return
			}
		case <-done:
			return
		}
	}
}
