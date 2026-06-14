#!/bin/bash
# build-plugin-zip.sh
#
# Packages the nextlib-agent PHP plugin into a zip archive
# for distribution via the /api/v1/download/plugin endpoint.
#
# Usage:
#   cd nextlib-cloud
#   bash scripts/build-plugin-zip.sh
#
# Prerequisites:
#   - zip command available
#   - nextlib-agent directory exists at ../nextlib-agent

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AGENT_DIR="$(dirname "$PROJECT_ROOT")/nextlib-agent"
OUTPUT_DIR="$PROJECT_ROOT/public/downloads"
OUTPUT_FILE="$OUTPUT_DIR/nextlib-agent.zip"

# Verify source directory exists
if [ ! -d "$AGENT_DIR" ]; then
  echo "Error: nextlib-agent directory not found at $AGENT_DIR"
  exit 1
fi

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# Remove old zip if it exists
if [ -f "$OUTPUT_FILE" ]; then
  rm "$OUTPUT_FILE"
  echo "Removed existing $OUTPUT_FILE"
fi

# Create zip archive excluding development files
cd "$(dirname "$AGENT_DIR")"
zip -r "$OUTPUT_FILE" nextlib-agent/ \
  -x "nextlib-agent/vendor/*" \
  -x "nextlib-agent/tests/*" \
  -x "nextlib-agent/.phpunit.result.cache" \
  -x "nextlib-agent/phpunit.xml" \
  -x "nextlib-agent/composer.lock" \
  -x "nextlib-agent/.env.example"

echo ""
echo "Plugin zip created successfully: $OUTPUT_FILE"
echo "Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
