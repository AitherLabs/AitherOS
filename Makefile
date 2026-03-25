.PHONY: build run test test-unit test-integration clean setup-db setup-test-db seed help

GO := /usr/local/go/bin/go
BINARY := backend/bin/aitherd
BACKEND_DIR := backend
SCRIPTS_DIR := scripts

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build the backend binary
	cd $(BACKEND_DIR) && $(GO) build -o bin/aitherd ./cmd/aitherd/

run: build ## Build and run the backend
	cd $(BACKEND_DIR) && ./bin/aitherd

test: test-unit ## Run all tests (unit only by default)

test-unit: ## Run unit tests
	cd $(BACKEND_DIR) && $(GO) test -v ./tests/unit/ -count=1

test-integration: ## Run integration tests (requires PostgreSQL + Redis)
	cd $(BACKEND_DIR) && $(GO) test -v ./tests/integration/ -count=1 -timeout=60s

test-all: test-unit test-integration ## Run all tests including integration

test-coverage: ## Run tests with coverage report
	cd $(BACKEND_DIR) && $(GO) test -coverprofile=coverage.out ./tests/unit/ ./internal/...
	cd $(BACKEND_DIR) && $(GO) tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: $(BACKEND_DIR)/coverage.html"

vet: ## Run go vet
	cd $(BACKEND_DIR) && $(GO) vet ./...

setup-db: ## Initialize the production database
	$(SCRIPTS_DIR)/setup_db.sh

setup-test-db: ## Initialize the test database
	$(SCRIPTS_DIR)/setup_test_db.sh

seed: ## Seed the database with sample data
	$(SCRIPTS_DIR)/seed.sh

clean: ## Remove build artifacts
	rm -rf $(BACKEND_DIR)/bin $(BACKEND_DIR)/coverage.out $(BACKEND_DIR)/coverage.html

dev: build ## Run with auto-restart on file changes (requires entr)
	find $(BACKEND_DIR) -name '*.go' | entr -r make run
