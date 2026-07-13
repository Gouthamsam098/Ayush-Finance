# Anush LMS Backend — developer tasks.
# All configuration comes from .env; nothing here hardcodes secrets.

.PHONY: help deps keys db-up db-down run build test vet seed-admin

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

deps: ## Download and tidy Go modules
	go mod tidy

keys: ## Generate the RS256 JWT key pair into ./secrets
	go run ./cmd/genkeys

db-up: ## Start the local PostgreSQL container
	docker compose up -d

db-down: ## Stop the local PostgreSQL container
	docker compose down

run: ## Run the API server (applies migrations on boot)
	go run ./cmd/server

build: ## Compile all binaries into ./bin
	go build -o bin/ ./...

test: ## Run all tests
	go test ./...

vet: ## Run go vet
	go vet ./...

seed-admin: ## Create/rotate the bootstrap admin (needs ADMIN_* env vars)
	go run ./cmd/seedadmin
