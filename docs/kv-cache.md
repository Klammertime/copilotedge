# Workers KV Cache Setup Guide

Complete guide to setting up Cloudflare Workers KV for persistent caching with CopilotEdge.

## Overview

Workers KV provides a globally distributed, persistent key-value store that enables CopilotEdge to cache AI responses across all Cloudflare edge locations. This results in:

- **90-95% reduction in API costs** through intelligent caching
- **Zero cold starts** - cache persists across Worker restarts
- **Global distribution** - any edge location can serve cached content
- **Automatic fallback** - uses memory cache if KV is unavailable

## Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed (`npm install -g wrangler`)
- CopilotEdge v0.5.0 or later (v0.6.0 adds Durable Objects)

## Setup Steps

### 1. Create a KV Namespace

Using Wrangler CLI:

```bash
# Create a KV namespace for production
wrangler kv:namespace create "COPILOT_CACHE"

# For local development (optional)
wrangler kv:namespace create "COPILOT_CACHE" --preview
```

This will output something like:

```
🌀 Creating namespace with title "worker-COPILOT_CACHE"
✨ Success!
Add the following to your wrangler.toml:

[[kv_namespaces]]
binding = "COPILOT_CACHE"
id = "abcd1234567890abcdef1234567890ab"
```

### 2. Update wrangler.toml

Add the KV namespace binding to your `wrangler.toml`:

```toml
name = "copilot-edge-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

# KV Namespace binding
[[kv_namespaces]]
binding = "COPILOT_CACHE"
id = "your-kv-namespace-id-here"

# For local development (optional)
[[kv_namespaces]]
binding = "COPILOT_CACHE"
id = "your-preview-namespace-id"
preview_id = "your-preview-namespace-id"
```

### 3. Update Your Worker Code

```typescript
// src/index.ts
import { createCopilotEdgeHandler } from 'copilotedge';

export interface Env {
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  COPILOT_CACHE: KVNamespace; // KV namespace binding
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const handler = createCopilotEdgeHandler({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      kvNamespace: env.COPILOT_CACHE, // Pass KV namespace
      kvCacheTTL: 86400, // 24 hours (optional, this is the default)
    });
    
    return handler(request);
  }
};
```

### 4. Deploy Your Worker

```bash
# Deploy to Cloudflare
wrangler deploy

# Or for local testing
wrangler dev
```

## Configuration Options

### kvNamespace

The Workers KV namespace binding. This is passed from the Worker environment.

```typescript
kvNamespace: env.COPILOT_CACHE
```

### kvCacheTTL

Time-to-live for cached entries in seconds. Default is 86400 (24 hours).

```typescript
kvCacheTTL: 3600 // 1 hour
kvCacheTTL: 86400 // 24 hours (default)
kvCacheTTL: 604800 // 1 week
```

## How It Works

### Dual-Layer Caching

CopilotEdge uses a two-tier caching strategy when KV is enabled:

1. **Memory Cache (L1)**: 
   - Fast, instance-local cache
   - Expires after `cacheTimeout` milliseconds
   - Survives for the Worker instance lifetime

2. **KV Cache (L2)**:
   - Persistent, globally distributed cache
   - Expires after `kvCacheTTL` seconds
   - Survives Worker restarts and redeployments

### Cache Lookup Flow

```
Request arrives
    ↓
Check memory cache
    ├─ HIT → Return immediately (0ms)
    └─ MISS ↓
        Check KV cache
            ├─ HIT → Populate memory cache → Return (5-50ms)
            └─ MISS ↓
                Call Cloudflare AI API
                    ↓
                Store in both caches
                    ↓
                Return response (200-2000ms)
```

### Cache Key Generation

Cache keys are generated using SHA-256 hash of:
- Model name
- Request messages
- System instructions
- Temperature and other parameters

This ensures unique keys for different requests while allowing identical requests to share cached responses.

## Best Practices

### 1. Set Appropriate TTLs

```typescript
// For frequently changing content
kvCacheTTL: 3600 // 1 hour

// For stable content
kvCacheTTL: 86400 // 24 hours

// For very stable content
kvCacheTTL: 604800 // 1 week
```

### 2. Monitor Cache Performance

```typescript
const edge = new CopilotEdge({
  apiKey: env.CLOUDFLARE_API_TOKEN,
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  kvNamespace: env.COPILOT_CACHE,
  debug: true, // Enable debug logging
});

// Get metrics
const metrics = edge.getMetrics();
console.log('Cache hit rate:', metrics.cacheHitRate);
console.log('KV operations:', metrics.kvOperations);
```

### 3. Handle KV Failures Gracefully

CopilotEdge automatically falls back to memory cache if KV operations fail:

```typescript
// This happens automatically
try {
  // Try KV cache
  const cached = await kvNamespace.get(key);
} catch (error) {
  // Fall back to memory cache
  // Continue to API if needed
}
```

### 4. Use with Streaming

KV cache works seamlessly with streaming:

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: env.CLOUDFLARE_API_TOKEN,
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  kvNamespace: env.COPILOT_CACHE,
  stream: true, // Streaming still uses cache for repeated requests
});
```

## Cost Analysis

### Without KV Cache

- Every unique request hits the API
- Cold starts require new API calls
- No sharing between Worker instances
- **Cost**: ~$0.01-0.05 per 1M tokens

### With KV Cache

- Cached responses served from KV
- Cache persists across restarts
- Global cache sharing
- **Cost**: ~$0.0005-0.0025 per 1M tokens (90-95% reduction)

### KV Pricing

- **Free tier**: 100,000 reads/day, 1,000 writes/day
- **Paid tier**: $0.50 per million reads, $5 per million writes
- Most applications stay within free tier

## Troubleshooting

### KV namespace not found

```
Error: KV namespace binding not found
```

**Solution**: Ensure your `wrangler.toml` has the correct KV namespace binding and the binding name matches your code.

### Cache not persisting

**Check**:
1. TTL is not too short
2. KV namespace is correctly bound
3. Worker is deployed (not just in dev mode)

### High KV costs

**Optimize**:
1. Increase `kvCacheTTL` to reduce writes
2. Use memory cache for very frequent requests
3. Consider request deduplication

## Examples

### Basic Setup

```typescript
// Minimal KV configuration
const handler = createCopilotEdgeHandler({
  apiKey: env.CLOUDFLARE_API_TOKEN,
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  kvNamespace: env.COPILOT_CACHE,
});
```

### Advanced Configuration

```typescript
// Optimized for cost and performance
const handler = createCopilotEdgeHandler({
  apiKey: env.CLOUDFLARE_API_TOKEN,
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  kvNamespace: env.COPILOT_CACHE,
  kvCacheTTL: 172800, // 2 days
  cacheTimeout: 300000, // 5 minutes memory cache
  model: '@cf/meta/llama-3.1-8b-instruct',
  stream: true,
});
```

### Monitoring Setup

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const edge = new CopilotEdge({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      kvNamespace: env.COPILOT_CACHE,
      debug: true,
    });
    
    const response = await edge.handleRequest(await request.json());
    
    // Log metrics
    const metrics = edge.getMetrics();
    console.log('Request served from:', 
      metrics.lastCacheHit ? 'cache' : 'API');
    
    return response;
  }
};
```

## Migration Guide

### From v0.4.0 to v0.5.0

1. Update CopilotEdge to v0.5.0:
```bash
npm install copilotedge@latest
```

2. Create KV namespace:
```bash
wrangler kv:namespace create "COPILOT_CACHE"
```

3. Update Worker code:
```diff
const handler = createCopilotEdgeHandler({
  apiKey: env.CLOUDFLARE_API_TOKEN,
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
+  kvNamespace: env.COPILOT_CACHE,
+  kvCacheTTL: 86400,
});
```

4. Deploy:
```bash
wrangler deploy
```

## Next Steps

- Monitor cache hit rates using debug mode
- Adjust TTLs based on your content freshness needs
- Consider implementing cache warming for popular queries
- Explore combining with Durable Objects for stateful sessions

## Support

For issues or questions about Workers KV integration:
- [GitHub Issues](https://github.com/Klammertime/copilotedge/issues)
- [Cloudflare Workers Discord](https://discord.gg/cloudflaredev)