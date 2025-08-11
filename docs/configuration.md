# Configuration

Complete guide to configuring CopilotEdge for your needs.

## Basic Configuration

```typescript
import { createCopilotEdgeHandler } from "copilotedge";

// Basic setup with defaults
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
});

// With OpenAI model and fallback
const reliableHandler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: "@cf/openai/gpt-oss-120b",
  fallback: "@cf/meta/llama-3.1-8b-instruct",
});
```

## Configuration Options

| Option                           | Type         | Default                          | Description                                           |
| -------------------------------- | ------------ | -------------------------------- | ----------------------------------------------------- |
| `apiKey`                         | `string`     | Required                         | Cloudflare API token                                  |
| `accountId`                      | `string`     | Required                         | Cloudflare account ID                                 |
| `model`                          | `string`     | `@cf/meta/llama-3.1-8b-instruct` | AI model to use                                       |
| `provider`                       | `string`     | `cloudflare`                     | AI provider to use                                    |
| `fallback`                       | `string`     | `null`                           | Optional fallback model if primary fails              |
| `debug`                          | `boolean`    | `false`                          | Enable debug logging                                  |
| `cacheTimeout`                   | `number`     | `60000`                          | Memory cache TTL in milliseconds                      |
| `maxRetries`                     | `number`     | `3`                              | Maximum retry attempts                                |
| `rateLimit`                      | `number`     | `60`                             | Requests per minute limit                             |
| `stream`                         | `boolean`    | `false`                          | Enable streaming responses (**NEW in v0.4.0**)        |
| `onChunk`                        | `function`   | `undefined`                      | Callback for streaming chunks (**NEW in v0.4.0**)     |
| `kvNamespace`                    | `KVNamespace`| `undefined`                      | Workers KV namespace binding (**NEW in v0.5.0**)      |
| `kvCacheTTL`                     | `number`     | `86400`                          | KV cache TTL in seconds (**NEW in v0.5.0**)           |
| `conversationDO`                 | `DurableObjectNamespace` | `undefined`              | Durable Object namespace (**NEW in v0.6.0**)          |
| `enableConversations`            | `boolean`    | `false`                          | Enable conversation persistence (**NEW in v0.6.0**)   |
| `defaultConversationId`          | `string`     | `undefined`                      | Default conversation ID (**NEW in v0.6.0**)           |
| `enableInternalSensitiveLogging` | `boolean`    | `false`                          | **DANGER**: Never use in production                   |

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
  cacheTimeout: 120000, // 2 minutes
});
```

### Disable Caching

```typescript
const handler = createCopilotEdgeHandler({
  cacheTimeout: 0, // Disables caching
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
  maxRetries: 5, // More aggressive retrying
});
```

## Streaming Configuration (NEW in v0.4.0)

### Enable Streaming

```typescript
// Enable streaming globally
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  stream: true, // Enable streaming for all requests
});

// With progress tracking
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  stream: true,
  onChunk: async (chunk) => {
    // Process each chunk as it arrives
    console.log('Received:', chunk.length, 'characters');
    await updateProgressBar(chunk);
  }
});
```

### Per-Request Streaming

```typescript
// Override instance configuration per request
const response = await edge.handleRequest({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true, // Enable streaming just for this request
});

// Consume the stream
for await (const chunk of response.stream) {
  process.stdout.write(chunk);
}
```

### Streaming vs Caching Trade-offs

| Mode | Use When | Benefits |
|------|----------|----------|
| **Streaming ON** | Unique content, long responses | Real-time feedback, low memory |
| **Streaming OFF** | Repeated queries, short responses | Instant cached responses, cost savings |

## Rate Limiting

### Default Behavior

- 60 requests per minute per client
- Returns 429 status when exceeded
- Sliding window implementation

### Custom Rate Limits

```typescript
const handler = createCopilotEdgeHandler({
  rateLimit: 120, // Allow 120 requests per minute
});
```

### Production Settings

```typescript
const handler = createCopilotEdgeHandler({
  rateLimit: 30, // More conservative for production
});
```

## Debug Mode

### Enable Debug Logging

```typescript
const handler = createCopilotEdgeHandler({
  debug: true,
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
  model: "@cf/meta/llama-3.1-8b-instruct",
  debug: false, // Never true in production
  enableInternalSensitiveLogging: false, // Never true in production
  cacheTimeout: 30000, // 30s for fresher responses
  maxRetries: 2, // Less aggressive retrying
  rateLimit: 30, // Conservative rate limit
});
```

## Advanced Usage

### Multiple Handlers

```typescript
// Different models for different use cases
const chatHandler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: "@cf/meta/llama-3.1-8b-instruct",
});

const codeHandler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: "@cf/openai/gpt-oss-20b", // Better for code
});
```

### Model Fallbacks

```typescript
// Configure with model fallback for reliability
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: "@cf/openai/gpt-oss-120b", // Try OpenAI's 120B model first
  fallback: "@cf/meta/llama-3.1-8b-instruct", // Fall back to Llama if needed
});
```

When a fallback model is specified, CopilotEdge will:

1. Always try the primary model first
2. If the primary model fails (404 or 429), it switches to the fallback model
3. The switch happens transparently with no client-side code changes needed
4. Metrics will track when fallbacks were used

### Direct Class Usage

```typescript
import CopilotEdge from "copilotedge";

const edge = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: "@cf/openai/gpt-oss-120b",
  fallback: "@cf/meta/llama-3.1-8b-instruct",
});

// Handle request manually
const response = await edge.handleRequest(body);

// Get metrics
const metrics = edge.getMetrics();
console.log("Cache hit rate:", metrics.cacheHitRate);
console.log("Fallback usage rate:", metrics.fallbackRate);

// Clear cache
edge.clearCache();

// Test features
await edge.testFeatures();
```

### Custom Error Handling

```typescript
import { CopilotEdge, ValidationError, APIError } from "copilotedge";

const edge = new CopilotEdge(config);

try {
  const response = await edge.handleRequest(body);
  return response;
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation errors (400)
    console.error("Invalid request:", error.message);
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
  cacheTimeout: 120000, // Longer cache
  maxRetries: 1, // Fail fast
  model: "@cf/openai/gpt-oss-20b", // Faster model
});
```

### For High Reliability

```typescript
const handler = createCopilotEdgeHandler({
  maxRetries: 5, // More retries
  rateLimit: 30, // Conservative limit
  cacheTimeout: 30000, // Shorter cache for freshness
  model: "@cf/openai/gpt-oss-120b", // Primary model
  fallback: "@cf/meta/llama-3.1-8b-instruct", // Reliable fallback
});
```

### For Cost Optimization

```typescript
const handler = createCopilotEdgeHandler({
  cacheTimeout: 300000, // 5 minute memory cache
  model: "@cf/meta/llama-3.1-8b-instruct", // Efficient model
  kvNamespace: env.COPILOT_CACHE, // Persistent KV cache (**NEW in v0.5.0**)
  kvCacheTTL: 86400, // 24 hour KV cache
});
```

## Workers KV Configuration (NEW in v0.5.0)

### Enable KV Caching

Workers KV provides persistent global caching that survives Worker restarts and works across all edge locations.

```typescript
// In a Cloudflare Worker
export default {
  async fetch(request, env) {
    const handler = createCopilotEdgeHandler({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      kvNamespace: env.COPILOT_CACHE, // KV namespace binding
      kvCacheTTL: 86400, // 24 hours in seconds
    });
    
    return handler(request);
  }
}
```

### Dual-Layer Caching

With KV enabled, CopilotEdge uses a two-tier caching strategy:

1. **Memory Cache** (L1): Fast, instance-local, expires after `cacheTimeout`
2. **KV Cache** (L2): Persistent, global, expires after `kvCacheTTL`

Cache lookup order:
1. Check memory cache → if hit, return immediately
2. Check KV cache → if hit, populate memory cache and return
3. Call API → populate both caches

### KV Benefits

- **90-95% Cost Reduction**: Cache persists across deployments
- **Zero Cold Starts**: Cache survives Worker restarts
- **Global Distribution**: Any edge location can serve cached content
- **Automatic Fallback**: Uses memory cache if KV fails

See [KV documentation](kv-cache.md) for complete setup guide.

## Durable Objects Configuration (NEW in v0.6.0)

### Enable Conversation Persistence

Durable Objects provide stateful conversation management with WebSocket support.

```typescript
// In a Cloudflare Worker
export default {
  async fetch(request, env) {
    const handler = createCopilotEdgeHandler({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      conversationDO: env.CONVERSATION_DO, // DO namespace binding
      enableConversations: true, // Enable conversation persistence
      defaultConversationId: 'default-session', // Optional default ID
    });
    
    return handler(request);
  }
}
```

### Conversation Features

With Durable Objects enabled:

1. **Persistent History**: Conversations survive Worker restarts
2. **WebSocket Support**: Real-time bidirectional communication
3. **Automatic Context**: Previous messages automatically loaded
4. **State Management**: User preferences and context persist

### Configuration Options

- `conversationDO`: The Durable Object namespace binding
- `enableConversations`: Toggle conversation features (default: false)
- `defaultConversationId`: Default conversation when none specified

See [Durable Objects documentation](durable-objects.md) for complete setup guide.
