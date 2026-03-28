package engine

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// imageConnector handles agents whose assigned model is type "image".
// Instead of a chat completion it calls the provider's image generation API,
// saves the result to the workforce workspace, and returns the saved path.
type imageConnector struct {
	providerType string
	baseURL      string
	apiKey       string
	model        string
	httpClient   *http.Client
}

func newImageConnector(providerType, baseURL, apiKey, model string) *imageConnector {
	return &imageConnector{
		providerType: providerType,
		baseURL:      baseURL,
		apiKey:       apiKey,
		model:        model,
		httpClient:   &http.Client{Timeout: 120 * time.Second},
	}
}

func (c *imageConnector) Name() string                         { return "image:" + c.providerType }
func (c *imageConnector) HealthCheck(_ context.Context) error  { return nil }

// IsMediaConnector returns true if the connector is an image/video/audio generator.
// Used by the orchestrator to skip the discussion/strategy phase for media agents.
func IsMediaConnector(conn Connector) bool {
	_, ok := conn.(*imageConnector)
	return ok
}

// imageSpec is parsed from the subtask message passed to the image agent.
// The message may be plain JSON or prose — JSON is tried first.
type imageSpec struct {
	Prompt         string `json:"prompt"`
	OutputPath     string `json:"output_path"`
	AspectRatio    string `json:"aspect_ratio"`
	NegativePrompt string `json:"negative_prompt"`
}

func parseImageSpec(message string) imageSpec {
	start := strings.Index(message, "{")
	end := strings.LastIndex(message, "}")
	if start != -1 && end > start {
		var spec imageSpec
		if err := json.Unmarshal([]byte(message[start:end+1]), &spec); err == nil && spec.Prompt != "" {
			return spec
		}
	}
	return imageSpec{Prompt: strings.TrimSpace(message)}
}

func resolveOutputPath(workspacePath, outputPath string) string {
	if outputPath == "" {
		outputPath = fmt.Sprintf("generated/image_%d.png", time.Now().UnixMilli())
	}
	if filepath.IsAbs(outputPath) {
		return outputPath
	}
	if workspacePath != "" {
		return filepath.Join(workspacePath, outputPath)
	}
	return outputPath
}

func (c *imageConnector) Submit(ctx context.Context, req TaskRequest) (*TaskResponse, error) {
	t0 := time.Now()

	spec := parseImageSpec(req.Message)
	if spec.Prompt == "" {
		return nil, fmt.Errorf("image agent: no prompt in message")
	}
	if spec.AspectRatio == "" {
		spec.AspectRatio = "1:1"
	}

	absPath := resolveOutputPath(req.WorkspacePath, spec.OutputPath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return nil, fmt.Errorf("image agent: mkdir: %w", err)
	}

	// Detect provider backend.
	// Google: explicit type, or googleapis.com in URL, or model name follows Google's format.
	// Imagen models are named "imagen-*" or stored with a "models/" prefix from AI Studio.
	modelLower := strings.ToLower(c.model)
	isGoogle := c.providerType == "google" ||
		strings.Contains(c.baseURL, "googleapis.com") ||
		strings.HasPrefix(modelLower, "imagen") ||
		strings.HasPrefix(modelLower, "models/imagen")
	isFal := c.providerType == "fal" || strings.Contains(c.baseURL, "fal.run") || strings.Contains(c.baseURL, "fal.ai")

	var imgBytes []byte
	var err error
	if isGoogle {
		imgBytes, err = c.generateGoogle(ctx, spec.Prompt, spec.AspectRatio)
	} else if isFal {
		imgBytes, err = c.generateFal(ctx, spec.Prompt, spec.AspectRatio)
	} else {
		imgBytes, err = c.generateOpenAI(ctx, spec.Prompt, spec.AspectRatio)
	}
	if err != nil {
		return nil, fmt.Errorf("image generation: %w", err)
	}

	if err := os.WriteFile(absPath, imgBytes, 0o644); err != nil {
		return nil, fmt.Errorf("image agent: write file: %w", err)
	}

	relPath := absPath
	if req.WorkspacePath != "" {
		if rel, e := filepath.Rel(req.WorkspacePath, absPath); e == nil {
			relPath = rel
		}
	}
	kb := float64(len(imgBytes)) / 1024.0
	content := fmt.Sprintf(
		"Image generated successfully.\nPath: %s\nSize: %.1f KB\nModel: %s\nPrompt: %s",
		relPath, kb, c.model, truncateStr(spec.Prompt, 120),
	)

	return &TaskResponse{
		Content:   content,
		LatencyMs: time.Since(t0).Milliseconds(),
		Done:      true,
	}, nil
}

func (c *imageConnector) SubmitStream(_ context.Context, req TaskRequest) (<-chan StreamEvent, error) {
	ch := make(chan StreamEvent, 4)
	go func() {
		defer close(ch)
		resp, err := c.Submit(context.Background(), req)
		if err != nil {
			ch <- StreamEvent{Type: "error", Content: err.Error()}
			return
		}
		ch <- StreamEvent{Type: "content", Content: resp.Content}
		ch <- StreamEvent{Type: "done", Content: ""}
	}()
	return ch, nil
}

// ── Provider implementations ──────────────────────────────────────────────────

func (c *imageConnector) generateGoogle(ctx context.Context, prompt, aspectRatio string) ([]byte, error) {
	// Google Imagen does not go through LiteLLM or any proxy — always call the
	// Generative Language API directly using the :predict endpoint.
	// imagen-4.0+ uses the Vertex AI-style predict format, not generateImages.
	base := "https://generativelanguage.googleapis.com"
	if strings.Contains(c.baseURL, "googleapis.com") {
		base = strings.TrimRight(c.baseURL, "/")
		for _, suffix := range []string{"/openai", "/v1beta", "/v1"} {
			base = strings.TrimSuffix(base, suffix)
		}
	}

	modelID := strings.TrimPrefix(c.model, "models/")
	apiURL := fmt.Sprintf("%s/v1beta/models/%s:predict?key=%s", base, modelID, c.apiKey)
	log.Printf("image-connector: google predict → %s/v1beta/models/%s:predict (key len=%d)", base, modelID, len(c.apiKey))

	body, _ := json.Marshal(map[string]any{
		"instances": []map[string]any{
			{"prompt": prompt},
		},
		"parameters": map[string]any{
			"sampleCount":       1,
			"aspectRatio":       aspectRatio,
			"safetyFilterLevel": "block_only_high",
			"personGeneration":  "dont_allow",
		},
	})

	raw, err := c.post(ctx, apiURL, nil, body)
	if err != nil {
		return nil, fmt.Errorf("%w — body: %s", err, truncateStr(string(raw), 300))
	}

	var data struct {
		Predictions []struct {
			BytesBase64Encoded string `json:"bytesBase64Encoded"`
			MimeType           string `json:"mimeType"`
			RaiFilteredReason  string `json:"raiFilteredReason"`
		} `json:"predictions"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("parse response: %w — body: %s", err, truncateStr(string(raw), 300))
	}
	if len(data.Predictions) == 0 {
		return nil, fmt.Errorf("no images returned — body: %s", truncateStr(string(raw), 300))
	}
	if r := data.Predictions[0].RaiFilteredReason; r != "" {
		return nil, fmt.Errorf("content filtered: %s", r)
	}
	b64 := data.Predictions[0].BytesBase64Encoded
	if b64 == "" {
		return nil, fmt.Errorf("missing bytesBase64Encoded in response — body: %s", truncateStr(string(raw), 300))
	}
	return base64.StdEncoding.DecodeString(b64)
}

func (c *imageConnector) generateOpenAI(ctx context.Context, prompt, aspectRatio string) ([]byte, error) {
	// Strip trailing /v1 — we append it ourselves (same as the chat connector).
	base := strings.TrimSuffix(strings.TrimRight(c.baseURL, "/"), "/v1")
	if base == "" {
		base = "https://api.openai.com"
	}
	url := base + "/v1/images/generations"

	body, _ := json.Marshal(map[string]any{
		"model":           c.model,
		"prompt":          prompt,
		"n":               1,
		"size":            aspectRatioToOpenAISize(aspectRatio),
		"response_format": "b64_json",
	})

	raw, err := c.post(ctx, url, map[string]string{"Authorization": "Bearer " + c.apiKey}, body)
	if err != nil {
		return nil, err
	}

	var data struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &data); err != nil || len(data.Data) == 0 {
		return nil, fmt.Errorf("unexpected response format")
	}
	if data.Data[0].B64JSON != "" {
		return base64.StdEncoding.DecodeString(data.Data[0].B64JSON)
	}
	if data.Data[0].URL != "" {
		return c.download(ctx, data.Data[0].URL)
	}
	return nil, fmt.Errorf("no b64_json or url in response")
}

func (c *imageConnector) generateFal(ctx context.Context, prompt, aspectRatio string) ([]byte, error) {
	url := "https://fal.run/" + c.model
	body, _ := json.Marshal(map[string]any{
		"prompt":     prompt,
		"image_size": aspectRatioToFalSize(aspectRatio),
		"num_images": 1,
	})

	raw, err := c.post(ctx, url, map[string]string{"Authorization": "Key " + c.apiKey}, body)
	if err != nil {
		return nil, err
	}

	var data struct {
		Images []struct{ URL string `json:"url"` } `json:"images"`
	}
	if err := json.Unmarshal(raw, &data); err != nil || len(data.Images) == 0 {
		return nil, fmt.Errorf("no image URL in fal.ai response")
	}
	return c.download(ctx, data.Images[0].URL)
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

func (c *imageConnector) post(ctx context.Context, url string, extraHeaders map[string]string, body []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, truncateStr(string(data), 400))
	}
	return data, nil
}

func (c *imageConnector) download(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// ── Size helpers ──────────────────────────────────────────────────────────────

func aspectRatioToOpenAISize(ar string) string {
	switch ar {
	case "16:9":
		return "1792x1024"
	case "9:16":
		return "1024x1792"
	case "4:3":
		return "1024x768"
	case "3:4":
		return "768x1024"
	default:
		return "1024x1024"
	}
}

func aspectRatioToFalSize(ar string) string {
	switch ar {
	case "16:9":
		return "landscape_16_9"
	case "9:16":
		return "portrait_16_9"
	case "4:3":
		return "landscape_4_3"
	case "3:4":
		return "portrait_4_3"
	default:
		return "square_hd"
	}
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
