package unit

import (
	"os"
	"testing"

	"github.com/aitheros/backend/internal/config"
)

func TestConfigLoadDefaults(t *testing.T) {
	// Clear any env vars that might interfere
	envVars := []string{
		"SERVER_HOST", "SERVER_PORT", "POSTGRES_HOST", "POSTGRES_PORT",
		"POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DATABASE_URL",
		"REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD", "REDIS_URL",
		"JWT_SECRET", "JWT_EXPIRY", "PICOCLAW_URL", "PICOCLAW_TIMEOUT",
		"LLM_API_BASE", "LLM_API_KEY", "LLM_MODEL", "CORS_ORIGINS",
	}
	saved := make(map[string]string)
	for _, key := range envVars {
		saved[key] = os.Getenv(key)
		os.Unsetenv(key)
	}
	defer func() {
		for k, v := range saved {
			if v != "" {
				os.Setenv(k, v)
			}
		}
	}()

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Server.Host != "0.0.0.0" {
		t.Errorf("Server.Host = %q, want %q", cfg.Server.Host, "0.0.0.0")
	}
	if cfg.Server.Port != 8080 {
		t.Errorf("Server.Port = %d, want %d", cfg.Server.Port, 8080)
	}
	if cfg.Postgres.Host != "127.0.0.1" {
		t.Errorf("Postgres.Host = %q, want %q", cfg.Postgres.Host, "127.0.0.1")
	}
	if cfg.Postgres.Port != 5432 {
		t.Errorf("Postgres.Port = %d, want %d", cfg.Postgres.Port, 5432)
	}
	if cfg.Redis.Port != 6379 {
		t.Errorf("Redis.Port = %d, want %d", cfg.Redis.Port, 6379)
	}
	if cfg.PicoClaw.URL != "http://127.0.0.1:55000" {
		t.Errorf("PicoClaw.URL = %q, want %q", cfg.PicoClaw.URL, "http://127.0.0.1:55000")
	}
	if cfg.LLM.APIBase != "http://127.0.0.1:4000/v1" {
		t.Errorf("LLM.APIBase = %q, want %q", cfg.LLM.APIBase, "http://127.0.0.1:4000/v1")
	}
	if cfg.LLM.Model != "gpt-5.4-mini" {
		t.Errorf("LLM.Model = %q, want %q", cfg.LLM.Model, "gpt-5.4-mini")
	}
}

func TestConfigLoadFromEnv(t *testing.T) {
	os.Setenv("SERVER_PORT", "9090")
	os.Setenv("PICOCLAW_URL", "http://10.0.0.1:55000")
	os.Setenv("LLM_MODEL", "gpt-6")
	defer func() {
		os.Unsetenv("SERVER_PORT")
		os.Unsetenv("PICOCLAW_URL")
		os.Unsetenv("LLM_MODEL")
	}()

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Server.Port != 9090 {
		t.Errorf("Server.Port = %d, want %d", cfg.Server.Port, 9090)
	}
	if cfg.PicoClaw.URL != "http://10.0.0.1:55000" {
		t.Errorf("PicoClaw.URL = %q, want %q", cfg.PicoClaw.URL, "http://10.0.0.1:55000")
	}
	if cfg.LLM.Model != "gpt-6" {
		t.Errorf("LLM.Model = %q, want %q", cfg.LLM.Model, "gpt-6")
	}
}

func TestConfigLoadInvalidPort(t *testing.T) {
	os.Setenv("SERVER_PORT", "not-a-number")
	defer os.Unsetenv("SERVER_PORT")

	_, err := config.Load()
	if err == nil {
		t.Error("Load() should fail with invalid port")
	}
}

func TestConfigAddr(t *testing.T) {
	cfg := &config.Config{
		Server: config.ServerConfig{Host: "0.0.0.0", Port: 8080},
	}
	if cfg.Addr() != "0.0.0.0:8080" {
		t.Errorf("Addr() = %q, want %q", cfg.Addr(), "0.0.0.0:8080")
	}
}
