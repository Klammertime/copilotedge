#!/bin/bash

echo "=== Verification Script ==="

# Check files exist
echo "Checking files..."
FILES=(
  "examples/basic-api-usage.js"
  "examples/openai-models.js"
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

grep -q "createCopilotEdgeHandler" examples/basic-api-usage.js && echo "✓ createCopilotEdgeHandler found in examples" || exit 1
grep -q "createCopilotEdgeHandler" src/index.ts && echo "✓ createCopilotEdgeHandler found in source" || exit 1
grep -q "handleRequest" src/index.ts && echo "✓ handleRequest method found" || exit 1
grep -q "getMetrics" src/index.ts && echo "✓ getMetrics method found" || exit 1

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