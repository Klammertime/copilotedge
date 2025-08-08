# CI/CD Recommendations

## Essential CI Checks

### 1. Daily Real Workers Environment Testing

While Miniflare tests are great for rapid development, you should also test against real Cloudflare Workers to catch emulation drift:

```yaml
# .github/workflows/daily-workers-test.yml
name: Daily Workers Integration Test
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight
  workflow_dispatch:  # Manual trigger

jobs:
  test-real-workers:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
      - run: |
          wrangler deploy --env preview
          npm run test:e2e:workers  # Test against preview URL
```

### 2. Model List Freshness Check

Fail the build if the model list is >90 days old to ensure documentation stays current:

```yaml
# .github/workflows/check-models.yml
name: Check Model List Age
on: [push, pull_request]

jobs:
  check-model-freshness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check model list age
        run: |
          # Extract date from README
          LAST_UPDATED=$(grep -E "as of \w+ [0-9]{4}" README.md | head -1)
          echo "Last updated: $LAST_UPDATED"
          
          # Calculate days since update
          DAYS_OLD=$(node -e "
            const match = '$LAST_UPDATED'.match(/as of (\w+) (\d{4})/);
            if (match) {
              const date = new Date(match[1] + ' 1, ' + match[2]);
              const days = Math.floor((Date.now() - date) / (1000 * 60 * 60 * 24));
              console.log(days);
            } else {
              console.log(999);
            }
          ")
          
          if [ "$DAYS_OLD" -gt 90 ]; then
            echo "❌ Model list is $DAYS_OLD days old (>90 days)"
            echo "Please update the model list in README.md"
            exit 1
          else
            echo "✅ Model list is $DAYS_OLD days old"
          fi
```

### 3. Security Audit on Sensitive Config

Ensure the dangerous config flag isn't accidentally enabled:

```yaml
# .github/workflows/security-check.yml
name: Security Configuration Check
on: [push, pull_request]

jobs:
  check-sensitive-logging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check for enabled sensitive logging
        run: |
          # Check for enableInternalSensitiveLogging: true in examples
          if grep -r "enableInternalSensitiveLogging: true" examples/ --include="*.js" --include="*.ts"; then
            echo "❌ Found enableInternalSensitiveLogging set to true in examples!"
            echo "This dangerous setting should never be enabled in example code."
            exit 1
          fi
          
          # Check for it in tests (allowed but warn)
          if grep -r "enableInternalSensitiveLogging: true" test/ --include="*.js" --include="*.ts"; then
            echo "⚠️ Warning: enableInternalSensitiveLogging is enabled in tests"
          fi

### 4. Bundle Size Check

Monitor package size to prevent bloat:

```yaml
- name: Check bundle size
  run: |
    npm run build
    SIZE=$(du -k dist | cut -f1)
    if [ "$SIZE" -gt 100 ]; then
      echo "❌ Bundle size ${SIZE}KB exceeds 100KB limit"
      exit 1
    fi
```

## Recommended GitHub Actions

```yaml
# .github/workflows/main.yml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:coverage
      
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:integration
```

## Pre-release Checklist

Before each release, ensure:

1. [ ] Model list is <90 days old
2. [ ] All tests pass including integration tests
3. [ ] No sensitive logging enabled in examples
4. [ ] Bundle size is reasonable (<100KB)
5. [ ] Benchmarks have been re-run if performance claims changed
6. [ ] CHANGELOG is updated
7. [ ] Version bumped in package.json and src/index.ts