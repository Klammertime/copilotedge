# Configuration

Complete guide to configuring CopilotEdge for your needs.

## Basic Configuration

```typescript
import { createCopilotEdgeHandler } from 'copilotedge';

const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | Required | Cloudflare API token |
| `accountId` | `string` | Required | Cloudflare account ID |
| `model` | `string` | `@cf/meta/llama-3.1-8b-instruct` | AI model to use |
| `debug` | `boolean` | `false` | Enable debug logging |
| `cacheTimeout` | `number` | `60000` | Cache TTL in milliseconds |
| `maxRetries` | `number` | `3` | Maximum retry attempts |
| `rateLimit` | `number` | `60` | Requests per minute limit |
| `enableInternalSensitiveLogging` | `boolean` | `false` | **DANGER**: Never use in production |

## Environment Variables

CopilotEdge can read from environment variables:

```bash
CLOUDFLARE_API_TOKEN=your-token
CLOUDFLARE_ACCOUNT_ID=your-account-id
NODE_ENV=development  # Enables debug mode when set to 'development'
```

## Caching Configuration

### Default Behavior
- Cache TTL: 60 seconds
- LRU eviction when cache exceeds 100 entries
- Cache key based on request hash

### Custom Cache Settings

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  cacheTimeout: 120000  // 2 minutes
});
```

### Disable Caching

```typescript
const handler = createCopilotEdgeHandler({
  cacheTimeout: 0  // Disables caching
});
```

## Retry Configuration

### Default Behavior
- Max retries: 3
- Exponential backoff with jitter
- Max delay: 8 seconds
- No retry on 4xx errors (except 429)

### Custom Retry Settings

```typescript
const handler = createCopilotEdgeHandler({
  maxRetries: 5  // More aggressive retrying
});
```

## Rate Limiting

### Default Behavior
- 60 requests per minute per client
- Returns 429 status when exceeded
- Sliding window implementation

### Custom Rate Limits

```typescript
const handler = createCopilotEdgeHandler({
  rateLimit: 120  // Allow 120 requests per minute
});
```

### Production Settings

```typescript
const handler = createCopilotEdgeHandler({
  rateLimit: 30  // More conservative for production
});
```

## Debug Mode

### Enable Debug Logging

```typescript
const handler = createCopilotEdgeHandler({
  debug: true
});
```

### Debug Output Example

```
[CopilotEdge] Initialized with: {
  model: '@cf/meta/llama-3.1-8b-instruct',
  cacheTimeout: 60000,
  maxRetries: 3,
  rateLimit: 60
}
[CopilotEdge] Testing edge regions for optimal performance...
[CopilotEdge] Selected: US-East (45ms)
[CopilotEdge] Cache HIT (age: 15s, saved 1 API call)
[CopilotEdge] Request completed in 12ms via US-East
```

## Production Configuration

### Recommended Settings

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/meta/llama-3.1-8b-instruct',
  debug: false,                           // Never true in production
  enableInternalSensitiveLogging: false,  // Never true in production
  cacheTimeout: 30000,                    // 30s for fresher responses
  maxRetries: 2,                          // Less aggressive retrying
  rateLimit: 30                           // Conservative rate limit
});
```

## Advanced Usage

### Multiple Handlers

```typescript
// Different models for different use cases
const chatHandler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/meta/llama-3.1-8b-instruct'
});

const codeHandler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/openai/gpt-oss-20b'  // Better for code
});
```

### Direct Class Usage

```typescript
import CopilotEdge from 'copilotedge';

const edge = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});

// Handle request manually
const response = await edge.handleRequest(body);

// Get metrics
const metrics = edge.getMetrics();
console.log('Cache hit rate:', metrics.cacheHitRate);

// Clear cache
edge.clearCache();

// Test features
await edge.testFeatures();
```

### Custom Error Handling

```typescript
import { CopilotEdge, ValidationError, APIError } from 'copilotedge';

const edge = new CopilotEdge(config);

try {
  const response = await edge.handleRequest(body);
  return response;
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation errors (400)
    console.error('Invalid request:', error.message);
  } else if (error instanceof APIError) {
    // Handle API errors
    if (error.statusCode === 429) {
      // Rate limited - implement backoff
    }
  }
  throw error;
}
```

## Configuration Validation

CopilotEdge validates configuration on initialization:

1. **Required fields**: `apiKey` and `accountId` must be provided
2. **Type checking**: All options are validated for correct types
3. **Range validation**: Rate limits and timeouts must be positive numbers

Invalid configuration will throw a `ValidationError` immediately.

## Performance Tuning

### For Low Latency

```typescript
const handler = createCopilotEdgeHandler({
  cacheTimeout: 120000,  // Longer cache
  maxRetries: 1,         // Fail fast
  model: '@cf/openai/gpt-oss-20b'  // Faster model
});
```

### For High Reliability

```typescript
const handler = createCopilotEdgeHandler({
  maxRetries: 5,         // More retries
  rateLimit: 30,         // Conservative limit
  cacheTimeout: 30000    // Shorter cache for freshness
});
```

### For Cost Optimization

```typescript
const handler = createCopilotEdgeHandler({
  cacheTimeout: 300000,  // 5 minute cache
  model: '@cf/meta/llama-3.1-8b-instruct'  // Efficient model
});
```