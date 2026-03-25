package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/aitheros/backend/internal/api"
	"github.com/aitheros/backend/internal/eventbus"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/orchestrator"
	"github.com/aitheros/backend/internal/store"
)

// testEnv holds the shared test environment.
type testEnv struct {
	store   *store.Store
	eventBus *eventbus.EventBus
	orch    *orchestrator.Orchestrator
	router  http.Handler
}

func setupTestEnv(t *testing.T) *testEnv {
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

	t.Cleanup(func() {
		// Clean up test data
		pool := s.Pool()
		pool.Exec(t.Context(), "DELETE FROM events")
		pool.Exec(t.Context(), "DELETE FROM messages")
		pool.Exec(t.Context(), "DELETE FROM executions")
		pool.Exec(t.Context(), "DELETE FROM workforce_agents")
		pool.Exec(t.Context(), "DELETE FROM workforces")
		pool.Exec(t.Context(), "DELETE FROM agents")
		eb.Close()
		s.Close()
	})

	return &testEnv{store: s, eventBus: eb, orch: orch, router: router}
}

func doRequest(router http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func parseResponse(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	return resp
}

// ─── Health ─────────────────────────────────────────────────

func TestHealthEndpoint(t *testing.T) {
	env := setupTestEnv(t)
	w := doRequest(env.router, "GET", "/health", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	resp := parseResponse(t, w)
	if resp["success"] != true {
		t.Error("success should be true")
	}
}

// ─── Agents CRUD ────────────────────────────────────────────

func TestAgentCRUD(t *testing.T) {
	env := setupTestEnv(t)

	// CREATE
	createBody := models.CreateAgentRequest{
		Name:         "Recon Scout",
		Description:  "Gathers intelligence",
		SystemPrompt: "You are an intelligence gathering agent.",
		Instructions: "Search for open ports and services.",
		EngineType:   "picoclaw",
		Model:        "gpt-5.4-mini",
		Tools:        []string{"web_search", "nmap"},
	}

	w := doRequest(env.router, "POST", "/api/v1/agents", createBody)
	if w.Code != http.StatusCreated {
		t.Fatalf("CREATE status = %d, body = %s", w.Code, w.Body.String())
	}

	resp := parseResponse(t, w)
	data := resp["data"].(map[string]any)
	agentID := data["id"].(string)

	if data["name"] != "Recon Scout" {
		t.Errorf("name = %v, want Recon Scout", data["name"])
	}
	if data["engine_type"] != "picoclaw" {
		t.Errorf("engine_type = %v, want picoclaw", data["engine_type"])
	}
	if data["status"] != "active" {
		t.Errorf("status = %v, want active", data["status"])
	}

	// GET
	w = doRequest(env.router, "GET", "/api/v1/agents/"+agentID, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d", w.Code)
	}

	resp = parseResponse(t, w)
	data = resp["data"].(map[string]any)
	if data["id"] != agentID {
		t.Errorf("id = %v, want %v", data["id"], agentID)
	}

	// LIST
	w = doRequest(env.router, "GET", "/api/v1/agents?limit=10&offset=0", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("LIST status = %d", w.Code)
	}

	resp = parseResponse(t, w)
	total := resp["total"].(float64)
	if total < 1 {
		t.Errorf("total = %v, want >= 1", total)
	}

	// UPDATE
	newName := "Updated Scout"
	updateBody := map[string]any{"name": newName}
	w = doRequest(env.router, "PATCH", "/api/v1/agents/"+agentID, updateBody)
	if w.Code != http.StatusOK {
		t.Fatalf("UPDATE status = %d, body = %s", w.Code, w.Body.String())
	}

	resp = parseResponse(t, w)
	data = resp["data"].(map[string]any)
	if data["name"] != newName {
		t.Errorf("updated name = %v, want %v", data["name"], newName)
	}

	// DELETE
	w = doRequest(env.router, "DELETE", "/api/v1/agents/"+agentID, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE status = %d", w.Code)
	}

	// Verify deleted
	w = doRequest(env.router, "GET", "/api/v1/agents/"+agentID, nil)
	if w.Code != http.StatusNotFound {
		t.Errorf("GET after delete = %d, want 404", w.Code)
	}
}

func TestAgentCreateValidation(t *testing.T) {
	env := setupTestEnv(t)

	tests := []struct {
		name string
		body map[string]any
		want int
	}{
		{"missing name", map[string]any{"system_prompt": "x", "engine_type": "picoclaw", "model": "gpt-5.4-mini"}, http.StatusBadRequest},
		{"missing system_prompt", map[string]any{"name": "x", "engine_type": "picoclaw", "model": "gpt-5.4-mini"}, http.StatusBadRequest},
		{"missing engine_type and provider_id", map[string]any{"name": "x", "system_prompt": "x", "model": "gpt-5.4-mini"}, http.StatusBadRequest},
		{"missing model", map[string]any{"name": "x", "system_prompt": "x", "engine_type": "picoclaw"}, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := doRequest(env.router, "POST", "/api/v1/agents", tt.body)
			if w.Code != tt.want {
				t.Errorf("status = %d, want %d, body = %s", w.Code, tt.want, w.Body.String())
			}
		})
	}
}

// ─── WorkForces CRUD ────────────────────────────────────────

func TestWorkForceCRUD(t *testing.T) {
	env := setupTestEnv(t)

	// First create two agents
	agent1 := createTestAgent(t, env, "Agent Alpha")
	agent2 := createTestAgent(t, env, "Agent Beta")

	// CREATE workforce
	createBody := models.CreateWorkForceRequest{
		Name:         "Strike Team",
		Description:  "Offensive security team",
		Objective:    "Identify vulnerabilities in target scope",
		BudgetTokens: 500000,
		BudgetTimeS:  3600,
		AgentIDs:     []string{agent1, agent2},
	}

	w := doRequest(env.router, "POST", "/api/v1/workforces", createBody)
	if w.Code != http.StatusCreated {
		t.Fatalf("CREATE status = %d, body = %s", w.Code, w.Body.String())
	}

	resp := parseResponse(t, w)
	data := resp["data"].(map[string]any)
	wfID := data["id"].(string)

	if data["name"] != "Strike Team" {
		t.Errorf("name = %v, want Strike Team", data["name"])
	}
	if data["status"] != "draft" {
		t.Errorf("status = %v, want draft", data["status"])
	}

	agentIDs := data["agent_ids"].([]any)
	if len(agentIDs) != 2 {
		t.Errorf("agent_ids count = %d, want 2", len(agentIDs))
	}

	// GET (should include full agent objects)
	w = doRequest(env.router, "GET", "/api/v1/workforces/"+wfID, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d", w.Code)
	}
	resp = parseResponse(t, w)
	data = resp["data"].(map[string]any)
	if agents, ok := data["agents"].([]any); ok {
		if len(agents) != 2 {
			t.Errorf("agents count = %d, want 2", len(agents))
		}
		// Verify agent objects have name
		for _, a := range agents {
			agent := a.(map[string]any)
			if agent["name"] == nil || agent["name"] == "" {
				t.Error("agent in workforce should have name")
			}
		}
	} else {
		t.Error("GET workforce should return agents array")
	}

	// LIST (should include agent_ids, not null)
	w = doRequest(env.router, "GET", "/api/v1/workforces?limit=10", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("LIST status = %d", w.Code)
	}

	resp = parseResponse(t, w)
	if resp["total"].(float64) < 1 {
		t.Error("total should be >= 1")
	}
	// Verify list items have agent_ids array
	listData := resp["data"].([]any)
	if len(listData) > 0 {
		firstWF := listData[0].(map[string]any)
		if firstWF["agent_ids"] == nil {
			t.Error("workforce list items should have agent_ids, got null")
		}
	}

	// UPDATE
	newObj := "Updated objective"
	w = doRequest(env.router, "PATCH", "/api/v1/workforces/"+wfID, map[string]any{"objective": newObj})
	if w.Code != http.StatusOK {
		t.Fatalf("UPDATE status = %d, body = %s", w.Code, w.Body.String())
	}

	resp = parseResponse(t, w)
	data = resp["data"].(map[string]any)
	if data["objective"] != newObj {
		t.Errorf("objective = %v, want %v", data["objective"], newObj)
	}

	// DELETE
	w = doRequest(env.router, "DELETE", "/api/v1/workforces/"+wfID, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("DELETE status = %d", w.Code)
	}

	w = doRequest(env.router, "GET", "/api/v1/workforces/"+wfID, nil)
	if w.Code != http.StatusNotFound {
		t.Errorf("GET after delete = %d, want 404", w.Code)
	}
}

func TestWorkForceCreateValidation(t *testing.T) {
	env := setupTestEnv(t)

	tests := []struct {
		name string
		body map[string]any
		want int
	}{
		{"missing name", map[string]any{"objective": "x", "agent_ids": []string{"a"}}, http.StatusBadRequest},
		{"missing objective", map[string]any{"name": "x", "agent_ids": []string{"a"}}, http.StatusBadRequest},
		{"missing agent_ids", map[string]any{"name": "x", "objective": "x"}, http.StatusBadRequest},
		{"empty agent_ids", map[string]any{"name": "x", "objective": "x", "agent_ids": []string{}}, http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := doRequest(env.router, "POST", "/api/v1/workforces", tt.body)
			if w.Code != tt.want {
				t.Errorf("status = %d, want %d, body = %s", w.Code, tt.want, w.Body.String())
			}
		})
	}
}

// ─── Executions ─────────────────────────────────────────────

func TestExecutionStartValidation(t *testing.T) {
	env := setupTestEnv(t)

	agent1 := createTestAgent(t, env, "Exec Agent")
	wfID := createTestWorkForce(t, env, "Exec WF", agent1)

	// Missing objective
	w := doRequest(env.router, "POST", fmt.Sprintf("/api/v1/workforces/%s/executions", wfID), map[string]any{})
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for missing objective", w.Code)
	}
}

func TestExecutionListEmpty(t *testing.T) {
	env := setupTestEnv(t)

	agent1 := createTestAgent(t, env, "List Agent")
	wfID := createTestWorkForce(t, env, "List WF", agent1)

	w := doRequest(env.router, "GET", fmt.Sprintf("/api/v1/workforces/%s/executions", wfID), nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}

	resp := parseResponse(t, w)
	if resp["total"].(float64) != 0 {
		t.Errorf("total = %v, want 0", resp["total"])
	}
}

func TestExecutionHaltNotRunning(t *testing.T) {
	env := setupTestEnv(t)

	// Try to halt a non-existent execution
	fakeID := "00000000-0000-0000-0000-000000000001"
	w := doRequest(env.router, "POST", fmt.Sprintf("/api/v1/executions/%s/halt", fakeID), nil)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for non-running execution", w.Code)
	}
}

// ─── Helpers ────────────────────────────────────────────────

func createTestAgent(t *testing.T, env *testEnv, name string) string {
	t.Helper()
	w := doRequest(env.router, "POST", "/api/v1/agents", models.CreateAgentRequest{
		Name:         name,
		Description:  "Test agent",
		SystemPrompt: "You are a test agent.",
		Instructions: "Do test things.",
		EngineType:   "picoclaw",
		Model:        "gpt-5.4-mini",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create test agent: %d - %s", w.Code, w.Body.String())
	}
	resp := parseResponse(t, w)
	return resp["data"].(map[string]any)["id"].(string)
}

func createTestWorkForce(t *testing.T, env *testEnv, name, agentID string) string {
	t.Helper()
	w := doRequest(env.router, "POST", "/api/v1/workforces", models.CreateWorkForceRequest{
		Name:         name,
		Objective:    "Test objective",
		BudgetTokens: 100000,
		BudgetTimeS:  600,
		AgentIDs:     []string{agentID},
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create test workforce: %d - %s", w.Code, w.Body.String())
	}
	resp := parseResponse(t, w)
	return resp["data"].(map[string]any)["id"].(string)
}
