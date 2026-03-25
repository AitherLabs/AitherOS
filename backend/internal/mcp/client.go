package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aitheros/backend/internal/models"
)

// ── JSON-RPC types ──

type jsonRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonRPCError   `json:"error,omitempty"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ── Tool schemas from MCP ──

type mcpToolsListResult struct {
	Tools []mcpTool `json:"tools"`
}

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type mcpToolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

type mcpToolCallResult struct {
	Content []mcpContent `json:"content"`
	IsError bool         `json:"isError,omitempty"`
}

type mcpContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// ── Client interface ──

type Client interface {
	// ListTools discovers available tools from the MCP server.
	ListTools(ctx context.Context) ([]models.MCPToolDefinition, error)
	// CallTool executes a tool and returns the result text.
	CallTool(ctx context.Context, toolName string, args map[string]any) (string, error)
	// Close shuts down the connection.
	Close() error
}

// ── Stdio Client ──

type stdioClient struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	mu     sync.Mutex
	nextID atomic.Int64
}

func NewStdioClient(command string, args []string, envVars map[string]string) (Client, error) {
	cmd := exec.Command(command, args...)

	// Build environment
	env := cmd.Environ()
	for k, v := range envVars {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	cmd.Env = env

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("mcp stdio: stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("mcp stdio: stdout pipe: %w", err)
	}

	// Capture stderr for debugging
	cmd.Stderr = &logWriter{prefix: "mcp-stderr"}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("mcp stdio: start %s: %w", command, err)
	}

	c := &stdioClient{
		cmd:    cmd,
		stdin:  stdin,
		stdout: bufio.NewReaderSize(stdout, 1024*1024),
	}

	// Send initialize request
	if err := c.initialize(); err != nil {
		c.Close()
		return nil, fmt.Errorf("mcp stdio: initialize: %w", err)
	}

	return c, nil
}

func (c *stdioClient) initialize() error {
	resp, err := c.call("initialize", map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "aitheros",
			"version": "0.1.0",
		},
	})
	if err != nil {
		return err
	}
	_ = resp // We don't need the server capabilities right now

	// Send initialized notification (no response expected, no ID per JSON-RPC spec)
	c.mu.Lock()
	defer c.mu.Unlock()
	notification := struct {
		JSONRPC string `json:"jsonrpc"`
		Method  string `json:"method"`
	}{
		JSONRPC: "2.0",
		Method:  "notifications/initialized",
	}
	data, _ := json.Marshal(notification)
	data = append(data, '\n')
	_, err = c.stdin.Write(data)
	return err
}

// callTimeout is the max time to wait for a single JSON-RPC response.
const callTimeout = 120 * time.Second

func (c *stdioClient) call(method string, params any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	id := c.nextID.Add(1)
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.stdin.Write(data); err != nil {
		return nil, fmt.Errorf("write request: %w", err)
	}

	// Read response with timeout to prevent deadlocks
	type readResult struct {
		result json.RawMessage
		err    error
	}
	ch := make(chan readResult, 1)

	go func() {
		for {
			line, err := c.stdout.ReadBytes('\n')
			if err != nil {
				ch <- readResult{nil, fmt.Errorf("read response: %w", err)}
				return
			}
			line = bytes.TrimSpace(line)
			if len(line) == 0 {
				continue
			}

			var resp jsonRPCResponse
			if err := json.Unmarshal(line, &resp); err != nil {
				// Could be a notification, skip
				continue
			}

			if resp.ID == id {
				if resp.Error != nil {
					ch <- readResult{nil, fmt.Errorf("mcp error %d: %s", resp.Error.Code, resp.Error.Message)}
				} else {
					ch <- readResult{resp.Result, nil}
				}
				return
			}
			// Not our response (notification or other), continue reading
		}
	}()

	select {
	case res := <-ch:
		return res.result, res.err
	case <-time.After(callTimeout):
		return nil, fmt.Errorf("mcp call %s timed out after %s", method, callTimeout)
	}
}

func (c *stdioClient) ListTools(ctx context.Context) ([]models.MCPToolDefinition, error) {
	result, err := c.call("tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}

	var toolsResult mcpToolsListResult
	if err := json.Unmarshal(result, &toolsResult); err != nil {
		return nil, fmt.Errorf("unmarshal tools: %w", err)
	}

	var defs []models.MCPToolDefinition
	for _, t := range toolsResult.Tools {
		defs = append(defs, models.MCPToolDefinition{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		})
	}
	return defs, nil
}

func (c *stdioClient) CallTool(ctx context.Context, toolName string, args map[string]any) (string, error) {
	result, err := c.call("tools/call", mcpToolCallParams{
		Name:      toolName,
		Arguments: args,
	})
	if err != nil {
		return "", err
	}

	var callResult mcpToolCallResult
	if err := json.Unmarshal(result, &callResult); err != nil {
		return "", fmt.Errorf("unmarshal tool result: %w", err)
	}

	if callResult.IsError {
		var errText string
		for _, c := range callResult.Content {
			if c.Type == "text" {
				errText += c.Text
			}
		}
		return "", fmt.Errorf("tool error: %s", errText)
	}

	var text string
	for _, c := range callResult.Content {
		if c.Type == "text" {
			if text != "" {
				text += "\n"
			}
			text += c.Text
		}
	}
	return text, nil
}

func (c *stdioClient) Close() error {
	c.stdin.Close()
	done := make(chan error, 1)
	go func() { done <- c.cmd.Wait() }()
	select {
	case <-time.After(5 * time.Second):
		c.cmd.Process.Kill()
		return fmt.Errorf("mcp process killed after timeout")
	case err := <-done:
		return err
	}
}

// ── SSE/HTTP Client ──

type httpClient struct {
	baseURL    string
	headers    map[string]string
	httpClient *http.Client
	nextID     atomic.Int64
}

func NewHTTPClient(url string, headers map[string]string) (Client, error) {
	c := &httpClient{
		baseURL: url,
		headers: headers,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
	return c, nil
}

func (c *httpClient) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := c.nextID.Add(1)
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range c.headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("http status %d: %s", resp.StatusCode, string(respBody))
	}

	var rpcResp jsonRPCResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("mcp error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	return rpcResp.Result, nil
}

func (c *httpClient) ListTools(ctx context.Context) ([]models.MCPToolDefinition, error) {
	result, err := c.call(ctx, "tools/list", map[string]any{})
	if err != nil {
		return nil, err
	}

	var toolsResult mcpToolsListResult
	if err := json.Unmarshal(result, &toolsResult); err != nil {
		return nil, fmt.Errorf("unmarshal tools: %w", err)
	}

	var defs []models.MCPToolDefinition
	for _, t := range toolsResult.Tools {
		defs = append(defs, models.MCPToolDefinition{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		})
	}
	return defs, nil
}

func (c *httpClient) CallTool(ctx context.Context, toolName string, args map[string]any) (string, error) {
	result, err := c.call(ctx, "tools/call", mcpToolCallParams{
		Name:      toolName,
		Arguments: args,
	})
	if err != nil {
		return "", err
	}

	var callResult mcpToolCallResult
	if err := json.Unmarshal(result, &callResult); err != nil {
		return "", fmt.Errorf("unmarshal tool result: %w", err)
	}

	if callResult.IsError {
		var errText string
		for _, ct := range callResult.Content {
			if ct.Type == "text" {
				errText += ct.Text
			}
		}
		return "", fmt.Errorf("tool error: %s", errText)
	}

	var text string
	for _, ct := range callResult.Content {
		if ct.Type == "text" {
			if text != "" {
				text += "\n"
			}
			text += ct.Text
		}
	}
	return text, nil
}

func (c *httpClient) Close() error {
	return nil
}

// ── Helper: connect to an MCP server based on its config ──

func Connect(srv *models.MCPServer) (Client, error) {
	switch srv.Transport {
	case models.MCPTransportStdio:
		if srv.Command == "" {
			return nil, fmt.Errorf("stdio transport requires a command")
		}
		return NewStdioClient(srv.Command, srv.Args, srv.EnvVars)
	case models.MCPTransportSSE, models.MCPTransportStreamableHTTP:
		if srv.URL == "" {
			return nil, fmt.Errorf("SSE/HTTP transport requires a URL")
		}
		return NewHTTPClient(srv.URL, srv.Headers)
	default:
		return nil, fmt.Errorf("unsupported transport: %s", srv.Transport)
	}
}

// logWriter writes to log with a prefix (used for stderr capture).
type logWriter struct {
	prefix string
}

func (lw *logWriter) Write(p []byte) (n int, err error) {
	log.Printf("[%s] %s", lw.prefix, string(p))
	return len(p), nil
}
