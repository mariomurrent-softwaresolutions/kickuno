#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${IMAGE_NAME:-kickuno-cms}"
CONTAINER_NAME="${CONTAINER_NAME:-kickuno-cms}"
HOST_PORT="${HOST_PORT:-3000}"
CMS_PORT="${CMS_PORT:-3000}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"

if [[ "${1:-}" == "--help" ]]; then
  echo "Builds the CMS Docker image and runs it as a container."
  echo
  echo "Optional env overrides:"
  echo "  IMAGE_NAME      (default: kickuno-cms)"
  echo "  CONTAINER_NAME  (default: kickuno-cms)"
  echo "  HOST_PORT       (default: 3000)"
  echo "  CMS_PORT        (default: 3000)"
  echo "  ENV_FILE        (default: ./cms/.env)"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  echo "Create it first (you can copy from .env.example)."
  exit 1
fi

echo "Building image '$IMAGE_NAME'..."
docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR"

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  echo "Removing existing container '$CONTAINER_NAME'..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "Starting container '$CONTAINER_NAME' on http://localhost:$HOST_PORT ..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --env-file "$ENV_FILE" \
  -p "$HOST_PORT:$CMS_PORT" \
  "$IMAGE_NAME" >/dev/null

echo "Container is running."
docker ps --filter "name=$CONTAINER_NAME" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

