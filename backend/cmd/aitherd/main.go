package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/aitheros/backend/internal/api"
	"github.com/aitheros/backend/internal/auth"
	"github.com/aitheros/backend/internal/config"
	"github.com/aitheros/backend/internal/engine"
	"github.com/aitheros/backend/internal/engine/picoclaw"
	"github.com/aitheros/backend/internal/eventbus"
	"github.com/aitheros/backend/internal/knowledge"
	"github.com/aitheros/backend/internal/mcp"
	"github.com/aitheros/backend/internal/models"
	"github.com/aitheros/backend/internal/orchestrator"
	"github.com/aitheros/backend/internal/store"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env from project root (two levels up from cmd/aitherd)
	envPath := filepath.Join("..", "..", ".env")
	if _, err := os.Stat(envPath); err == nil {
		godotenv.Load(envPath)
	}
	// Also try loading from cwd
	godotenv.Load(".env")

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Printf("Starting AitherOS backend on %s", cfg.Addr())

	// Initialize store
	db, err := store.New(cfg.Postgres.URL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	log.Println("Connected to PostgreSQL")

	// Wire encryption key for credential storage
	if encKey := os.Getenv("ENCRYPTION_KEY"); encKey != "" {
		if err := db.SetEncryptionKey(encKey); err != nil {
			log.Printf("WARNING: invalid ENCRYPTION_KEY: %v — credential encryption disabled", err)
		} else {
			log.Println("Credential encryption enabled (AES-256-GCM)")
		}
	} else {
		log.Println("WARNING: ENCRYPTION_KEY not set — credentials will be stored unencrypted")
	}

	// Initialize event bus
	eb, err := eventbus.New(cfg.Redis.URL)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer eb.Close()
	log.Println("Connected to Redis")

	// Persist all events to DB so the frontend can replay them for completed executions
	eb.SetPersister(func(ctx context.Context, event models.Event) {
		if err := db.SaveEvent(ctx, event); err != nil {
			log.Printf("WARNING: failed to persist event %s: %v", event.Type, err)
		}
	})

	// Initialize orchestrator
	orch := orchestrator.New(db, eb, orchestrator.LLMConfig{
		APIBase: cfg.LLM.APIBase,
		APIKey:  cfg.LLM.APIKey,
		Model:   cfg.LLM.Model,
	})

	// Initialize provider registry
	reg := engine.NewProviderRegistry(db)

	// Register PicoClaw engine adapter
	picoAdapter := picoclaw.New(cfg.PicoClaw.URL, cfg.PicoClaw.Timeout)
	orch.RegisterEngine(picoAdapter)
	reg.RegisterConnector("picoclaw", picoAdapter)
	orch.SetRegistry(reg)
	log.Printf("Registered PicoClaw engine at %s", cfg.PicoClaw.URL)

	// Initialize MCP Manager for tool orchestration
	mcpMgr := mcp.NewManager(db)
	orch.SetMCPManager(mcpMgr)
	log.Println("MCP Manager initialized")

	// Initialize Knowledge Manager (vector KB + RAG)
	embModel := os.Getenv("EMBEDDING_MODEL")
	if embModel == "" {
		embModel = "text-embedding-3-small"
	}
	embedder := knowledge.NewEmbedder(cfg.LLM.APIBase, cfg.LLM.APIKey, embModel)
	knowledgeMgr := knowledge.NewManager(db, embedder)
	orch.SetKnowledgeManager(knowledgeMgr)
	log.Printf("Knowledge Manager initialized (embedding model: %s)", embModel)

	// Initialize JWT auth
	var jwtMgr *auth.JWTManager
	if cfg.JWT.Secret != "" {
		jwtMgr = auth.NewJWTManager(cfg.JWT.Secret, cfg.JWT.Expiry)
		log.Println("JWT authentication enabled")
	} else {
		log.Println("WARNING: JWT_SECRET not set, auth endpoints disabled")
	}

	// Build router
	router := api.NewRouter(db, orch, eb, reg, jwtMgr, knowledgeMgr, mcpMgr, cfg.CORS.Origins)

	// Start server
	server := &http.Server{
		Addr:    cfg.Addr(),
		Handler: router,
	}

	fmt.Printf(`
╔══════════════════════════════════════════╗
║           AitherOS Backend v0.1          ║
║──────────────────────────────────────────║
║  API:    http://%s             ║
║  WS:     ws://%s/ws            ║
║  Engine: PicoClaw @ %s   ║
║  LLM:    %s       ║
╚══════════════════════════════════════════╝
`, cfg.Addr(), cfg.Addr(), cfg.PicoClaw.URL, cfg.LLM.APIBase)

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
