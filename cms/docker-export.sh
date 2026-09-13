#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${IMAGE_NAME:-kickuno-cms}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
FULL_IMAGE_NAME="${IMAGE_NAME}:${IMAGE_TAG}"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/dist}"
OUTPUT_FILE="${OUTPUT_FILE:-$OUTPUT_DIR/${IMAGE_NAME//\//-}-${IMAGE_TAG}.tar.gz}"

if [[ "${1:-}" == "--help" ]]; then
  echo "Exports a Docker image to a compressed tar archive."
  echo
  echo "Optional env overrides:"
  echo "  IMAGE_NAME   (default: kickuno-cms)"
  echo "  IMAGE_TAG    (default: latest)"
  echo "  OUTPUT_DIR   (default: ./cms/dist)"
  echo "  OUTPUT_FILE  (default: ./cms/dist/<image>-<tag>.tar.gz)"
  exit 0
fi

if ! docker image inspect "$FULL_IMAGE_NAME" >/dev/null 2>&1; then
  echo "Image '$FULL_IMAGE_NAME' not found locally."
  echo "Build it first with ./docker-build.sh (or set IMAGE_NAME/IMAGE_TAG)."
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Exporting '$FULL_IMAGE_NAME' to '$OUTPUT_FILE'..."
docker save "$FULL_IMAGE_NAME" | gzip > "$OUTPUT_FILE"

echo "Done."
ls -lh "$OUTPUT_FILE"

