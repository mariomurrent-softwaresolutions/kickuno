#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${IMAGE_NAME:-kickuno-cms}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-$SCRIPT_DIR/Dockerfile}"
BUILD_CONTEXT="${BUILD_CONTEXT:-$SCRIPT_DIR}"
FULL_IMAGE_NAME="${IMAGE_NAME}:${IMAGE_TAG}"

if [[ "${1:-}" == "--help" ]]; then
  echo "Builds the Payload CMS Docker image."
  echo
  echo "Optional env overrides:"
  echo "  IMAGE_NAME       (default: kickuno-cms)"
  echo "  IMAGE_TAG        (default: latest)"
  echo "  PLATFORM         (example: linux/amd64)"
  echo "  DOCKERFILE_PATH  (default: ./cms/Dockerfile)"
  echo "  BUILD_CONTEXT    (default: ./cms)"
  exit 0
fi

BUILD_ARGS=( -t "$FULL_IMAGE_NAME" -f "$DOCKERFILE_PATH" )

if [[ -n "$PLATFORM" ]]; then
  BUILD_ARGS+=( --platform "$PLATFORM" )
fi

BUILD_ARGS+=( "$BUILD_CONTEXT" )

echo "Building image '$FULL_IMAGE_NAME'..."
docker build "${BUILD_ARGS[@]}"

echo "Done. Built image: $FULL_IMAGE_NAME"

