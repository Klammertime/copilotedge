# CopilotEdge

**Bridge any AI frontend to Cloudflare Workers AI** - A lightweight adapter that makes Cloudflare's AI models compatible with CopilotKit and OpenAI protocols.

[![npm version](https://img.shields.io/npm/v/copilotedge.svg)](https://www.npmjs.com/package/copilotedge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is CopilotEdge?

CopilotEdge solves a simple problem: **CopilotKit doesn't support Cloudflare Workers AI**, and Cloudflare's models are incredibly cost-effective. This package bridges that gap, allowing you to use Cloudflare's AI models with any frontend that speaks CopilotKit or OpenAI protocols.

### Key Features

- 🔌 **Works with any AI frontend** - CopilotKit, OpenAI SDK, or raw HTTP
- 💰 **10-100x cheaper** - Tracks costs per request, caching saves 90%+
- 🚀 **Global edge network** - Runs in 100+ locations worldwide
- 🔒 **Production security** - HMAC signing, encryption, rate limiting
- 📊 **Built for dashboards** - Full telemetry with token & cost tracking

## Quick Start

### Installation

```bash
npm install copilotedge
# or
pnpm add copilotedge
```

### Basic Usage (Next.js App Router)

```typescript
// app/api/copilotedge/route.ts
import { createCopilotEdgeHandler } from 'copilotedge';

export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/meta/llama-3.1-8b-instruct'
});
```

### With CopilotKit

```jsx
// app/layout.tsx
import { CopilotKit } from "@copilotkit/react-core";

export default function Layout({ children }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotedge">
      {children}
    </CopilotKit>
  );
}
```

### Direct API Usage

```javascript
const response = await fetch('/api/copilotedge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

## Advanced Features

### Streaming Responses

Get immediate feedback as AI generates content:

```typescript
// Enable streaming globally
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  stream: true  // All requests will stream by default
});

// Or enable per-request
const response = await fetch('/api/copilotedge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Tell me a story' }],
    stream: true  // Stream this specific request
  })
});

// Handle the stream
const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}
```

**Benefits:**
- First token in ~200ms (vs 2-5s non-streaming)
- Better UX with progressive display
- Server-Sent Events (SSE) format
- OpenAI-compatible streaming

### Telemetry & Cost Tracking

Track token usage and costs for your telemetry dashboard:

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  
  telemetry: {
    enabled: true,
    serviceName: 'my-ai-service',
    endpoint: process.env.OTEL_ENDPOINT,
    
    // Dashboard-specific tracking
    attributes: {
      'dashboard.user_id': userId,
      'dashboard.session_id': sessionId
    }
  }
});
```

**Tracked Metrics:**
- `ai.tokens.input/output/total` - Actual token counts
- `ai.cost.input_usd/output_usd/total_usd` - Cost per request
- `dashboard.cost_savings_usd` - Savings from cache hits
- `cache.hit_rate` - Cache effectiveness

### Security Features (v0.9.1)

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  
  security: {
    // HMAC request signing
    enableRequestSigning: true,
    hmacSecret: process.env.HMAC_SECRET,
    
    // KV encryption for cached data
    enableKVEncryption: true,
    kvEncryptionKey: process.env.KV_ENCRYPTION_KEY,
    
    // Rate limiting
    enableRateLimiting: true,
    rateLimit: {
      requestsPerMinute: 60,
      useDistributed: true // Requires Durable Objects
    }
  }
});
```

### Cloudflare Workers Deployment

For production deployment on Cloudflare Workers:

```typescript
// worker.ts
import { CopilotEdge } from 'copilotedge';
import { RateLimiterDO } from 'copilotedge/rate-limiter';

export { RateLimiterDO };

export default {
  async fetch(request: Request, env: Env) {
    const edge = new CopilotEdge({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      kvNamespace: env.CACHE_KV,
      rateLimiterDO: env.RATE_LIMITER
    });
    
    const body = await request.json();
    const response = await edge.handleRequest(body);
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

```toml
# wrangler.toml
name = "my-copilot-worker"
main = "worker.ts"
compatibility_date = "2025-08-18"

[[kv_namespaces]]
binding = "CACHE_KV"
id = "your-kv-namespace-id"

[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiterDO"

[vars]
CLOUDFLARE_ACCOUNT_ID = "your-account-id"

# Use wrangler secrets for sensitive data
# wrangler secret put CLOUDFLARE_API_TOKEN
```

## Requirements

- Node.js 18+
- Cloudflare account with Workers AI enabled

## Get Started

1. Sign up at [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
2. Get your Account ID from the dashboard
3. Create an API token with Workers AI permissions
4. `npm install copilotedge`

## License

MIT © [Audrey Klammer](https://github.com/Klammertime)

## Links

- [npm](https://www.npmjs.com/package/copilotedge) • [GitHub](https://github.com/Klammertime/copilotedge) • [Issues](https://github.com/Klammertime/copilotedge/issues)