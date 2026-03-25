#!/usr/bin/env bash
set -euo pipefail

# AitherOS Test Database Setup
# Creates a separate test database for integration tests

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

TEST_DB="aitheros_test"
TEST_USER="${POSTGRES_USER:-aitheros}"
TEST_PASS="${POSTGRES_PASSWORD:-aitheros}"

echo "=== AitherOS Test Database Setup ==="

# Create user if doesn't exist
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$TEST_USER'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER $TEST_USER WITH PASSWORD '$TEST_PASS';"

# Drop and recreate test database for clean state
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$TEST_DB'" | grep -q 1 && \
    sudo -u postgres psql -c "DROP DATABASE $TEST_DB;"

sudo -u postgres psql -c "CREATE DATABASE $TEST_DB OWNER $TEST_USER;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $TEST_DB TO $TEST_USER;"
sudo -u postgres psql -d "$TEST_DB" -c "GRANT ALL ON SCHEMA public TO $TEST_USER;"

# Run migrations on test database
PGPASSWORD="$TEST_PASS" psql -h "${POSTGRES_HOST:-127.0.0.1}" -p "${POSTGRES_PORT:-5432}" \
    -U "$TEST_USER" -d "$TEST_DB" -f "$SCRIPT_DIR/001_init.sql"

echo "=== Test database '$TEST_DB' ready ==="
echo "TEST_DATABASE_URL=postgres://$TEST_USER:$TEST_PASS@${POSTGRES_HOST:-127.0.0.1}:${POSTGRES_PORT:-5432}/$TEST_DB?sslmode=disable"
