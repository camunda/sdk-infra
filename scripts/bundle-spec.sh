#!/usr/bin/env bash
# Fetch and bundle the upstream OpenAPI spec using camunda-schema-bundler.
#
# This is the canonical spec bundling script. SDK repos can use this
# directly or rely on the reusable GitHub workflow (sdk-bundle-spec.yml).
#
# Environment variables:
#   SPEC_REF                     Git ref to fetch (default: main).
#   CAMUNDA_SDK_SKIP_FETCH_SPEC  If "1", bundle from local spec (skip fetch).
#   BUNDLER_BIN                  Path to standalone bundler binary (optional).
#   OUTPUT_DIR                   Output directory (default: ./bundled).
#
# Usage:
#   bash scripts/bundle-spec.sh
#   SPEC_REF=stable/8.9 bash scripts/bundle-spec.sh
#   CAMUNDA_SDK_SKIP_FETCH_SPEC=1 bash scripts/bundle-spec.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SPEC_DIR="${SPEC_DIR:-external-spec/upstream/zeebe/gateway-protocol/src/main/proto/v2}"
OUTPUT_DIR="${OUTPUT_DIR:-external-spec/bundled}"
BUNDLED_SPEC="$OUTPUT_DIR/rest-api.bundle.json"
METADATA="$OUTPUT_DIR/spec-metadata.json"

mkdir -p "$OUTPUT_DIR"

# Resolve the bundler command
if [[ -n "${BUNDLER_BIN:-}" ]]; then
    BUNDLER_CMD="$BUNDLER_BIN"
elif command -v npx &>/dev/null; then
    BUNDLER_CMD="npx --yes camunda-schema-bundler"
else
    echo "Error: No bundler available. Set BUNDLER_BIN or install Node.js (for npx)." >&2
    exit 1
fi

if [ "${CAMUNDA_SDK_SKIP_FETCH_SPEC:-0}" = "1" ]; then
    echo "[bundle-spec] Bundling with local spec (skip fetch)"
    $BUNDLER_CMD \
        --spec-dir "$SPEC_DIR" \
        --deref-path-local \
        --output-spec "$BUNDLED_SPEC" \
        --output-metadata "$METADATA"
else
    REF="${SPEC_REF:-main}"
    echo "[bundle-spec] Fetching (ref: $REF) and bundling spec"
    $BUNDLER_CMD \
        --ref "$REF" \
        --deref-path-local \
        --output-spec "$BUNDLED_SPEC" \
        --output-metadata "$METADATA"
fi

echo "[bundle-spec] Bundled spec: $BUNDLED_SPEC"
echo "[bundle-spec] Metadata:     $METADATA"
