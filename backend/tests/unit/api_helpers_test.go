package unit

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aitheros/backend/internal/api"
)

func TestCORSMiddleware(t *testing.T) {
	handler := api.CORSMiddleware("http://localhost:3000,https://aither.systems")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	tests := []struct {
		name       string
		origin     string
		wantOrigin string
	}{
		{"allowed origin localhost", "http://localhost:3000", "http://localhost:3000"},
		{"allowed origin production", "https://aither.systems", "https://aither.systems"},
		{"disallowed origin", "http://evil.com", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			req.Header.Set("Origin", tt.origin)
			w := httptest.NewRecorder()

			handler.ServeHTTP(w, req)

			got := w.Header().Get("Access-Control-Allow-Origin")
			if got != tt.wantOrigin {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, tt.wantOrigin)
			}
		})
	}
}

func TestCORSMiddlewarePreflight(t *testing.T) {
	handler := api.CORSMiddleware("http://localhost:3000")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("handler should not be called for OPTIONS preflight")
		}),
	)

	req := httptest.NewRequest(http.MethodOptions, "/test", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", w.Code, http.StatusNoContent)
	}

	methods := w.Header().Get("Access-Control-Allow-Methods")
	if methods == "" {
		t.Error("Access-Control-Allow-Methods should be set")
	}
}

func TestLoggingMiddleware(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	handler := api.LoggingMiddleware(inner)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestNewRouterHealth(t *testing.T) {
	router := api.NewRouter(nil, nil, nil, nil, nil, nil, nil, "*")

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)

	if resp["success"] != true {
		t.Errorf("success = %v, want true", resp["success"])
	}

	data := resp["data"].(map[string]any)
	if data["status"] != "ok" {
		t.Errorf("data.status = %v, want ok", data["status"])
	}
}

func TestNewRouterAgentsValidation(t *testing.T) {
	// Test that agent creation validates required fields
	// Note: store is nil so this tests validation BEFORE the store is called
	router := api.NewRouter(nil, nil, nil, nil, nil, nil, nil, "*")

	body := bytes.NewBufferString(`{}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d for empty body", w.Code, http.StatusBadRequest)
	}

	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["success"] != false {
		t.Error("success should be false for validation error")
	}
}

func TestNewRouterWorkForcesValidation(t *testing.T) {
	router := api.NewRouter(nil, nil, nil, nil, nil, nil, nil, "*")

	body := bytes.NewBufferString(`{"name":"test"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workforces", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d for missing objective", w.Code, http.StatusBadRequest)
	}
}

func TestNewRouterInvalidUUID(t *testing.T) {
	router := api.NewRouter(nil, nil, nil, nil, nil, nil, nil, "*")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/agents/not-a-uuid", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d for invalid uuid", w.Code, http.StatusBadRequest)
	}
}
