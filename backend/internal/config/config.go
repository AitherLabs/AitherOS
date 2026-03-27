package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Server       ServerConfig
	Postgres     PostgresConfig
	Redis        RedisConfig
	JWT          JWTConfig
	PicoClaw     PicoClawConfig
	LLM          LLMConfig
	Embedding    EmbeddingConfig
	CORS         CORSConfig
	Registration RegistrationConfig
}

type ServerConfig struct {
	Host string
	Port int
}

type PostgresConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	DB       string
	URL      string
}

type RedisConfig struct {
	Host     string
	Port     int
	Password string
	URL      string
}

type JWTConfig struct {
	Secret string
	Expiry time.Duration
}

type PicoClawConfig struct {
	URL     string
	Timeout time.Duration
}

type LLMConfig struct {
	APIBase string
	APIKey  string
	Model   string
}

type EmbeddingConfig struct {
	APIBase string // EMBEDDING_API_BASE — defaults to https://api.openai.com/v1
	APIKey  string // EMBEDDING_API_KEY  — defaults to LLM_API_KEY if not set
	Model   string // EMBEDDING_MODEL    — defaults to text-embedding-3-small
}

type CORSConfig struct {
	Origins string
}

type RegistrationConfig struct {
	Token string // REGISTRATION_TOKEN — if set, self-registration requires this token
}

func Load() (*Config, error) {
	port, err := strconv.Atoi(getEnv("SERVER_PORT", "8080"))
	if err != nil {
		return nil, fmt.Errorf("invalid SERVER_PORT: %w", err)
	}

	pgPort, err := strconv.Atoi(getEnv("POSTGRES_PORT", "5432"))
	if err != nil {
		return nil, fmt.Errorf("invalid POSTGRES_PORT: %w", err)
	}

	redisPort, err := strconv.Atoi(getEnv("REDIS_PORT", "6379"))
	if err != nil {
		return nil, fmt.Errorf("invalid REDIS_PORT: %w", err)
	}

	jwtExpiry, err := time.ParseDuration(getEnv("JWT_EXPIRY", "24h"))
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_EXPIRY: %w", err)
	}

	picoTimeout, err := time.ParseDuration(getEnv("PICOCLAW_TIMEOUT", "120s"))
	if err != nil {
		return nil, fmt.Errorf("invalid PICOCLAW_TIMEOUT: %w", err)
	}

	pgUser := getEnv("POSTGRES_USER", "aitheros")
	pgPass := getEnv("POSTGRES_PASSWORD", "")
	pgHost := getEnv("POSTGRES_HOST", "127.0.0.1")
	pgDB := getEnv("POSTGRES_DB", "aitheros")
	pgURL := getEnv("DATABASE_URL", fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=disable",
		pgUser, pgPass, pgHost, pgPort, pgDB,
	))

	redisPass := getEnv("REDIS_PASSWORD", "")
	redisHost := getEnv("REDIS_HOST", "127.0.0.1")
	redisURL := getEnv("REDIS_URL", fmt.Sprintf(
		"redis://:%s@%s:%d/0",
		redisPass, redisHost, redisPort,
	))

	return &Config{
		Server: ServerConfig{
			Host: getEnv("SERVER_HOST", "0.0.0.0"),
			Port: port,
		},
		Postgres: PostgresConfig{
			Host:     pgHost,
			Port:     pgPort,
			User:     pgUser,
			Password: pgPass,
			DB:       pgDB,
			URL:      pgURL,
		},
		Redis: RedisConfig{
			Host:     redisHost,
			Port:     redisPort,
			Password: redisPass,
			URL:      redisURL,
		},
		JWT: JWTConfig{
			Secret: getEnv("JWT_SECRET", ""),
			Expiry: jwtExpiry,
		},
		PicoClaw: PicoClawConfig{
			URL:     getEnv("PICOCLAW_URL", "http://127.0.0.1:55000"),
			Timeout: picoTimeout,
		},
		LLM: LLMConfig{
			APIBase: getEnv("LLM_API_BASE", "http://127.0.0.1:4000/v1"),
			APIKey:  getEnv("LLM_API_KEY", "dummy_token"),
			Model:   getEnv("LLM_MODEL", "gpt-5.4-mini"),
		},
		Embedding: EmbeddingConfig{
			APIBase: getEnv("EMBEDDING_API_BASE", "https://api.openai.com/v1"),
			APIKey:  getEnv("EMBEDDING_API_KEY", getEnv("LLM_API_KEY", "")),
			Model:   getEnv("EMBEDDING_MODEL", "text-embedding-3-small"),
		},
		CORS: CORSConfig{
			Origins: getEnv("CORS_ORIGINS", "http://localhost:3000"),
		},
		Registration: RegistrationConfig{
			Token: getEnv("REGISTRATION_TOKEN", ""),
		},
	}, nil
}

func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
