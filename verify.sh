#!/bin/bash

echo "=== Verification Script ==="

# Check files exist
echo "Checking files..."
FILES=(
  "examples/next-edge/app/components/SmartChatResponse.tsx"
  "examples/next-edge/app/lib/telemetry.ts"
  "examples/next-edge/app/page.tsx"
  "examples/streaming-worker/src/worker.ts"
  "examples/scripts/ab-test.md"
  "dist/index.js"
  "dist/index.d.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✓ $file exists"
  else
    echo "✗ $file missing"
    exit 1
  fi
done

# Check for specific code patterns
echo -e "\nChecking implementations..."

grep -q "CE_FAKE_TYPEWRITER" examples/next-edge/app/page.tsx && echo "✓ CE_FAKE_TYPEWRITER flag found" || exit 1
grep -q "ce:latency" examples/next-edge/app/components/SmartChatResponse.tsx && echo "✓ ce:latency event found" || exit 1
grep -q "ttfb_ms" src/index.ts && echo "✓ ttfb_ms metrics found" || exit 1
grep -q "event: open" examples/streaming-worker/src/worker.ts && echo "✓ SSE streaming found" || exit 1

# Check tarball contents
echo -e "\nChecking npm package..."
npm pack > /dev/null 2>&1
TARBALL=$(ls copilotedge-*.tgz 2>/dev/null | head -n1)
if [ -z "$TARBALL" ]; then
  echo "✗ Failed to create tarball"
  exit 1
fi
tar -tzf "$TARBALL" | grep -q "dist/index.js" && echo "✓ dist/index.js in tarball" || exit 1
tar -tzf "$TARBALL" | grep -q "dist/index.d.ts" && echo "✓ dist/index.d.ts in tarball" || exit 1

# Clean up tarball
rm -f "$TARBALL"

echo -e "\n=== All checks passed ==="