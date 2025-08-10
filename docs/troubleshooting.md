# Troubleshooting

Common issues and their solutions.

## Quick Diagnostics

Run the built-in test:

```typescript
import CopilotEdge from 'copilotedge';

const edge = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  debug: true
});

await edge.testFeatures();
```

Expected output:
```
🚀 CopilotEdge Feature Test
========================================

✅ Configuration
  API Token: Set
  Account ID: Set
  Model: @cf/meta/llama-3.1-8b-instruct
  Debug: ON

✅ Auto-Region Selection
  Fastest: US-East
  Latencies: { "US-East": 45, "EU-West": 120, "Asia-Pacific": 200 }

✅ Request Caching
  Cache: Working
  TTL: 60 seconds

✅ Rate Limiting
  Limit: 60 req/min

✅ Retry Logic
  Max retries: 3
  Backoff: Exponential with jitter

✅ Performance Metrics
  Tracking: totalRequests, cacheHits, avgLatency, errors

========================================
All features operational! 🎉
```

## Common Startup Errors

### "API key is required"

**Error**:
```
ValidationError: API key is required. Set config.apiKey or CLOUDFLARE_API_TOKEN env var
```

**Solutions**:

1. Set environment variable:
```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
```

2. Pass in config:
```typescript
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN
});
```

3. Check .env.local file (Next.js):
```bash
# .env.local
CLOUDFLARE_API_TOKEN=your-token-here
```

### "Account ID is required"

**Error**:
```
ValidationError: Account ID is required. Set config.accountId or CLOUDFLARE_ACCOUNT_ID env var
```

**Solution**:
```bash
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
```

Find your account ID:
1. Log into Cloudflare Dashboard
2. Select your account
3. Find ID in the right sidebar

### "Cannot find module 'copilotedge'"

**Error**:
```
Error: Cannot find module 'copilotedge'
```

**Solutions**:

1. Install the package:
```bash
npm install copilotedge
```

2. Check package.json:
```json
{
  "dependencies": {
    "copilotedge": "latest"
  }
}
```

3. Clear cache and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

## Authentication Issues

### Invalid API Token (401)

**Error**:
```
APIError: Invalid API token (401)
```

**Solutions**:

1. Verify token is valid:
```bash
curl https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer YOUR_TOKEN"
```

2. Check token permissions:
- Needs: Workers AI Read
- Needs: Account Read

3. Regenerate token if needed

### Forbidden (403)

**Error**:
```
APIError: Forbidden - insufficient permissions (403)
```

**Solutions**:

1. Check Workers AI is enabled for your account
2. Verify you're not exceeding quotas
3. Ensure token has correct permissions

## Runtime Errors

### Rate Limit Exceeded (429)

**Error**:
```
APIError: Rate limit exceeded (60 req/min) (429)
```

**Solutions**:

1. Increase rate limit:
```typescript
const handler = createCopilotEdgeHandler({
  rateLimit: 120  // Double the limit
});
```

2. Implement client-side throttling:
```typescript
// Delay between requests
await new Promise(resolve => setTimeout(resolve, 1000));
```

3. Use caching more effectively:
```typescript
const handler = createCopilotEdgeHandler({
  cacheTimeout: 300000  // 5 minutes
});
```

### Model Not Found (404)

**Error**:
```
APIError: Model not found: @cf/invalid/model (404)
```

**Solutions**:

1. Use a valid model:
```typescript
const handler = createCopilotEdgeHandler({
  model: '@cf/meta/llama-3.1-8b-instruct'
});
```

2. Check available models:
```bash
curl https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/models/search \
  -H "Authorization: Bearer {token}"
```

### Request Timeout

**Error**:
```
Error: Request timeout after 30000ms
```

**Solutions**:

1. Simplify prompts:
```typescript
// Limit message length
const truncated = message.slice(0, 1000);
```

2. Use a faster model:
```typescript
model: '@cf/openai/gpt-oss-20b'  // Faster than 120b
```

3. Implement retry logic:
```typescript
let retries = 3;
while (retries > 0) {
  try {
    return await handler(request);
  } catch (error) {
    if (error.message.includes('timeout')) {
      retries--;
      await new Promise(r => setTimeout(r, 2000));
    } else {
      throw error;
    }
  }
}
```

## Performance Issues

### Slow Response Times

**Symptoms**: Responses take >1 second

**Debug**:
```typescript
const handler = createCopilotEdgeHandler({
  debug: true  // Enable performance logging
});
```

**Solutions**:

1. Check region selection:
```
[CopilotEdge] Selected: Asia-Pacific (450ms)  // Far from you
```

2. Enable caching:
```typescript
cacheTimeout: 120000  // 2 minutes
```

3. Use faster model:
```typescript
model: '@cf/meta/llama-3.1-8b-instruct'  // Fastest
```

### High Cache Miss Rate

**Symptoms**: Cache hit rate <20%

**Debug**:
```typescript
const metrics = edge.getMetrics();
console.log('Cache hit rate:', metrics.cacheHitRate);
```

**Solutions**:

1. Increase cache timeout:
```typescript
cacheTimeout: 300000  // 5 minutes
```

2. Normalize requests:
```typescript
// Normalize messages for better cache hits
function normalizeMessage(msg) {
  return msg.toLowerCase().trim();
}
```

3. Pre-warm cache:
```typescript
// Cache common queries on startup
const commonQueries = ['Hello', 'Help', 'What can you do?'];
for (const query of commonQueries) {
  await edge.handleRequest({
    messages: [{ role: 'user', content: query }]
  });
}
```

## Debugging Techniques

### Enable Debug Logging

```typescript
const handler = createCopilotEdgeHandler({
  debug: true
});
```

Output:
```
[CopilotEdge] Initialized with: { ... }
[CopilotEdge] Testing edge regions...
[CopilotEdge] Selected: US-East (45ms)
[CopilotEdge] Cache MISS
[CopilotEdge] Request completed in 127ms
```

### Check Metrics

```typescript
const edge = new CopilotEdge(config);
const metrics = edge.getMetrics();

console.log('Metrics:', {
  requests: metrics.totalRequests,
  cacheHits: metrics.cacheHits,
  hitRate: `${(metrics.cacheHitRate * 100).toFixed(1)}%`,
  avgLatency: `${metrics.avgLatency}ms`,
  errors: metrics.errors,
  errorRate: `${(metrics.errorRate * 100).toFixed(1)}%`
});
```

### Test Individual Components

```typescript
// Test region selection
const region = await edge.findFastestRegion();
console.log('Best region:', region);

// Test cache
edge.saveToCache('test-key', { data: 'test' });
const cached = edge.getFromCache('test-key');
console.log('Cache working:', !!cached);

// Test API call
const response = await edge.callCloudflareAI(
  [{ role: 'user', content: 'test' }],
  region
);
console.log('API working:', !!response);
```

## Environment-Specific Issues

### Next.js App Router

**Issue**: Handler not working in app router

**Solution**:
```typescript
// app/api/copilotedge/route.ts
import { createCopilotEdgeHandler } from 'copilotedge';

// Must export as named export
export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});
```

### Cloudflare Pages

**Issue**: Environment variables not loading

**Solution**:
```javascript
// functions/api/copilotedge.js
export async function onRequest(context) {
  const edge = new CopilotEdge({
    // Use context.env for Cloudflare Pages
    apiKey: context.env.CLOUDFLARE_API_TOKEN,
    accountId: context.env.CLOUDFLARE_ACCOUNT_ID
  });
  // ...
}
```

### Vercel Deployment

**Issue**: Timeouts on Vercel

**Solution**:
```typescript
// Reduce timeout for Vercel's limits
const handler = createCopilotEdgeHandler({
  maxRetries: 1,  // Fail faster
  // Consider using Edge Runtime
});

export const config = {
  runtime: 'edge',  // Use Vercel Edge Runtime
};
```

## Getting Help

### Before Asking for Help

1. Run `testFeatures()` to check configuration
2. Enable debug mode and check logs
3. Check error type (ValidationError vs APIError)
4. Verify environment variables are set
5. Test with a simple request

### Information to Provide

When reporting issues, include:

```typescript
// Version
npm list copilotedge

// Configuration (redact sensitive info)
{
  model: '@cf/meta/llama-3.1-8b-instruct',
  debug: true,
  cacheTimeout: 60000,
  maxRetries: 3,
  rateLimit: 60
}

// Error message
APIError: [full error message]

// Debug output
[CopilotEdge] [relevant logs]

// Environment
- Node version: 20.x
- Framework: Next.js 14
- Deployment: Vercel/Cloudflare/etc
```

### Support Channels

- GitHub Issues: [Report bugs](https://github.com/Klammertime/copilotedge/issues)
- Discussions: [Ask questions](https://github.com/Klammertime/copilotedge/discussions)
- Discord: [Cloudflare Discord](https://discord.cloudflare.com)