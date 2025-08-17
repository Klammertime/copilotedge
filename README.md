# CopilotEdge

The **first and only** adapter that enables [CopilotKit](https://github.com/CopilotKit/CopilotKit) applications to leverage [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)'s powerful edge computing infrastructure for AI inference.

[![npm version](https://img.shields.io/npm/v/copilotedge)](https://www.npmjs.com/package/copilotedge)
[![CI](https://github.com/Klammertime/copilotedge/actions/workflows/ci.yml/badge.svg)](https://github.com/Klammertime/copilotedge/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/copilotedge)](https://github.com/Klammertime/copilotedge/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/copilotedge)](https://www.npmjs.com/package/copilotedge)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## Why CopilotEdge?

**→ [Read the full explanation: Why CopilotEdge Matters](docs/why-copilotedge.md)** - Practical guide with real examples

**CopilotKit** is an amazing open-source framework for building AI-powered copilots, but it typically requires expensive API calls to OpenAI or other cloud providers. **Cloudflare Workers AI** offers a compelling alternative with:

- **100+ AI models** running on Cloudflare's global edge network
- **Significantly lower costs** compared to traditional AI APIs
- **Ultra-low latency** with automatic region selection
- **Privacy-focused** inference that keeps data within Cloudflare's network

**The problem:** There was no way to connect these two powerful technologies... until now.

**CopilotEdge** bridges this gap, allowing CopilotKit developers to:

- 🚀 Run AI inference at the edge across 100+ global locations
- 💰 Reduce AI costs by up to 90% with built-in caching (yes, even vs GPT-4o Mini)
- ⚡ Achieve sub-second response times with edge computing
- 🔒 Keep sensitive data within Cloudflare's secure infrastructure
- 🎯 Access OpenAI's open-source gpt-oss models (120B & 20B) via Cloudflare

> **"But GPT-4o Mini is already cheap!"** - [See why that's not the whole story →](docs/why-copilotedge.md#but-gpt-4o-mini-is-already-cheap)

## Features

- **📊 OpenTelemetry Support** - Production observability with AI cost tracking **v0.8.0!**
  - Distributed tracing across your AI pipeline
  - **Real token counting** with tiktoken (not estimates!)
  - **Cost tracking** per request in USD
  - Metrics for cache hits, token usage, and latency
  - Integration with Grafana, Datadog, New Relic, and more
  - Configurable sampling and graceful degradation
- **🎯 Durable Objects Support** - Stateful conversation management
  - Persistent conversation history across sessions
  - WebSocket support for real-time bidirectional communication
  - Automatic context management and state persistence
- **🗄️ Workers KV Integration** - Persistent global caching across all edge locations
  - 90-95% reduction in API costs through intelligent caching
  - Cache persists across Worker restarts and deployments
  - Automatic fallback to memory cache if KV unavailable
- **⚡ Real-Time Streaming** - Stream AI responses as they're generated (~200ms to first token)
- **🌍 Edge Computing** - Automatic region selection across 100+ locations for lowest latency
- **💾 Dual-Layer Caching** - KV (global) + memory (local) with automatic fallback
- **🔄 Enterprise Resilience** - Built-in retry logic with exponential backoff and jitter
- **🛡️ Rate Limiting** - In-memory rate limiting to prevent abuse (configurable, works per-instance)
- **📘 Type Safe** - Full TypeScript support with comprehensive types and IntelliSense
- **🪶 Lightweight** - Minimal bundle size, ~58KB main module
- **🧠 OpenAI Open Models** - Support for gpt-oss-120b (80GB GPU) and gpt-oss-20b (16GB edge devices)
- **🎯 Model Fallbacks** - Automatic failover to alternative models for high availability

## What Makes This Special?

This is **the only package** that connects CopilotKit to Cloudflare Workers AI. Without CopilotEdge, CopilotKit users are limited to:

- Expensive OpenAI API calls ($20-60 per million tokens)
- Higher latency from centralized API endpoints
- Privacy concerns with data leaving your infrastructure

With CopilotEdge, you can get:

- Cloudflare's competitive pricing (as low as $0.01 per million tokens for some models)
- Edge inference in the closest data center to your users
- Data processing within Cloudflare's secure network
- Access to 100+ models including Llama, Mistral, and OpenAI's open-source models

## OpenAI Open-Source Models (New!)

CopilotEdge supports OpenAI's latest open-source models released under Apache 2.0 license:

- **gpt-oss-120b**: Near-parity with OpenAI o4-mini, runs on 80GB GPUs
- **gpt-oss-20b**: Similar to OpenAI o3-mini, runs on 16GB edge devices

These models feature:

- ✅ Strong tool use and function calling capabilities
- ✅ Chain-of-thought (CoT) reasoning
- ✅ Structured outputs support
- ✅ Compatible with Responses API for agentic workflows
- ✅ Python code execution support (via Cloudflare Containers)

## Compatibility

- ✅ **React 18.x** - Fully supported
- ✅ **React 19.x** - Fully supported
- ✅ **Next.js 13+** - App Router & Pages Router
- ✅ **Next.js 14+** - Full support
- ✅ **Next.js 15+** - Full support
- ✅ **CopilotKit** - All versions

## Quick Start

**⚠️ Before deploying to production, read [Security & Privacy](docs/security.md).**

### 1. Install

```bash
npm install copilotedge
```

This will automatically install the necessary dependencies including OpenTelemetry packages for observability.

### 2. Set Up Environment Variables

Create a file named `.env.local` in the root of your project and add your Cloudflare credentials:

```bash
# .env.local
CLOUDFLARE_API_TOKEN=your-api-token-here
CLOUDFLARE_ACCOUNT_ID=your-account-id-here
```

> **Note:** Never commit your `.env.local` file to version control.

### 3. Create API Route

```typescript
// app/api/copilotedge/route.ts (Next.js App Router)
import { createCopilotEdgeHandler } from "copilotedge";
import type { CopilotEdgeConfig } from "copilotedge"; // Optional: for TypeScript

// Basic setup
export const POST = createCopilotEdgeHandler({
  // apiKey and accountId are read from environment variables
  // CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
});

// With OpenAI open-source model and fallback
// const config: CopilotEdgeConfig = {
//   model: '@cf/openai/gpt-oss-120b',           // OpenAI's open 120B model (Apache 2.0)
//   fallback: '@cf/openai/gpt-oss-20b',         // Lighter 20B model as fallback
//   telemetry: {                                // Optional: Enable telemetry
//     enabled: true,
//     serviceName: 'my-ai-service'
//   }
// };
// export const POST = createCopilotEdgeHandler(config);
```

📚 **[See complete import patterns and TypeScript types →](docs/api-reference.md#installation--import)**

### 4. Configure CopilotKit

```tsx
// app/layout.tsx
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css"; // Import the default styles

export default function Layout({ children }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotedge">
      {children}
      <CopilotPopup
        instructions="You are a helpful AI assistant."
        defaultOpen={true}
        labels={{
          title: "CopilotEdge Assistant",
          initial: "Hello! How can I help you?",
        }}
      />
    </CopilotKit>
  );
}
```

### Get Cloudflare Credentials

1. Sign up for [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
2. Get your API token from the dashboard
3. Copy your account ID

## 🆕 Streaming Support (v0.4.0)

CopilotEdge now supports **real-time streaming responses**! Get immediate feedback as AI generates content:

### Enable Streaming

```typescript
// Option 1: Enable globally
const handler = createCopilotEdgeHandler({
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml bindings
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml bindings
  stream: true, // Enable streaming by default
});

// Option 2: Enable per-request
const response = await edge.handleRequest({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true, // Stream this specific request
});
```

### With Progress Tracking

```typescript
const edge = new CopilotEdge({
  apiKey: 'your-key',
  accountId: 'your-account',
  stream: true,
  onChunk: (chunk) => {
    // Track progress, update UI, etc.
    console.log('Received:', chunk);
  }
});
```

### Benefits
- **10x faster perceived response** (~200ms to first token vs 2-5s)
- **Memory efficient** with async generators
- **Smooth UX** with progressive content display
- **Backward compatible** - existing code continues to work

See [streaming documentation](docs/streaming.md) for complete details.

## 🆕 Durable Objects Support (v0.6.0)

CopilotEdge now supports **Cloudflare Durable Objects** for stateful conversation management with persistent history and WebSocket support!

### Enable Durable Objects

1. **Configure wrangler.toml**:
```toml
[[durable_objects.bindings]]
name = "CONVERSATION_DO"
class_name = "ConversationDO"
script_name = "copilotedge-worker"

[[migrations]]
tag = "v1"
new_classes = ["ConversationDO"]
```

2. **Use in your Worker**:
```typescript
import { createCopilotEdgeHandler, ConversationDO } from 'copilotedge';

export { ConversationDO };

export default {
  async fetch(request, env) {
    const handler = createCopilotEdgeHandler({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      conversationDO: env.CONVERSATION_DO, // ← Add this
      enableConversations: true,
      defaultConversationId: 'user-session',
    });
    
    return handler(request);
  }
}
```

### Benefits
- **Persistent Conversations** - History survives Worker restarts
- **WebSocket Support** - Real-time bidirectional communication
- **Automatic Context** - Seamless conversation continuity
- **Cost Efficiency** - Reuse conversation context across requests

See [Durable Objects documentation](docs/durable-objects.md) for complete setup guide.

## 🆕 Workers KV Support (v0.5.0)

CopilotEdge now supports **Cloudflare Workers KV** for persistent global caching that survives restarts and works across all edge locations!

### Enable Workers KV

1. **Create a KV namespace** in Cloudflare Dashboard or via Wrangler:
```bash
wrangler kv:namespace create "COPILOT_CACHE"
```

2. **Add to your wrangler.toml**:
```toml
[[kv_namespaces]]
binding = "COPILOT_CACHE"
id = "your-kv-namespace-id"
```

3. **Use in your Worker**:
```typescript
export default {
  async fetch(request, env) {
    const handler = createCopilotEdgeHandler({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      kvNamespace: env.COPILOT_CACHE, // ← Add this
      kvCacheTTL: 86400, // 24 hours (optional)
    });
    
    return handler(request);
  }
}
```

### Benefits
- **90-95% Cost Reduction** - Cache persists globally across all deployments
- **Zero Cold Starts** - Cache survives Worker restarts
- **Global Distribution** - Any edge location can serve cached content
- **Automatic Fallback** - Uses memory cache if KV fails
- **TTL Control** - Configure cache expiration (default: 24 hours)

See [KV documentation](docs/kv-cache.md) for complete setup guide.

## 🆕 OpenTelemetry Support (v0.8.0)

Production-ready observability with distributed tracing, metrics, and **real-time cost tracking**.

### Enable Telemetry with Cost Tracking

```typescript
const edge = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  
  telemetry: {
    enabled: true,
    serviceName: 'my-ai-service',
    environment: 'production',
    
    // Auto-discovery: Uses env vars if endpoint not specified
    // COPILOTEDGE_TELEMETRY_ENDPOINT or COPILOTEDGE_DASHBOARD_URL
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: {
      'Authorization': `Bearer ${env.TELEMETRY_API_KEY}`
    },
    
    // Performance tuning
    samplingRate: 0.1, // Sample 10% of requests
    
    // Export options
    exporters: {
      otlp: true,      // Send to OTLP collector
      console: false   // Disable console logging in production
    }
  }
});
```

### What Gets Traced (NEW in v0.8.0!)

- **Request lifecycle** - validation, cache lookup, AI calls, response
- **Cache metrics** - hit/miss rates, latency by type (memory/KV)
- **AI metrics** - Real token counts (input/output/total), not estimates!
- **Cost tracking** - Actual USD costs per request (`ai.cost.input_usd`, `ai.cost.output_usd`, `ai.cost.total_usd`)
- **Correlation IDs** - Track requests across distributed systems
- **Error tracking** - automatic exception recording with context
- **Circuit breaker** - state changes and failure patterns

#### New Telemetry Attributes (v0.8.0)
- `ai.tokens.input` - Actual input token count using tiktoken
- `ai.tokens.output` - Actual output token count
- `ai.tokens.total` - Combined token usage
- `ai.cost.input_usd` - Input cost in USD
- `ai.cost.output_usd` - Output cost in USD  
- `ai.cost.total_usd` - Total request cost
- `correlation.id` - Unique request identifier
- `conversation.id` - Track conversation threads
- `user.id` - User-level tracking

### Platform Integrations

Works with all major observability platforms:
- **Grafana Cloud** - Full OTLP support with dashboards
- **Datadog** - APM integration with trace correlation
- **New Relic** - Distributed tracing across services
- **Jaeger** - Local development with Docker

See [docs/telemetry.md](docs/telemetry.md) for complete setup guides.

### Benefits

- 📊 **Monitor costs** - Track token usage and cache effectiveness
- 🔍 **Debug issues** - Trace requests across your entire pipeline
- ⚡ **Optimize performance** - Identify bottlenecks and latency
- 🛡️ **Graceful degradation** - Telemetry failures don't affect requests
- 📈 **Production insights** - Real-time dashboards and alerting

## Documentation

| Topic                                              | Description                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [**API Reference**](docs/api-reference.md)         | 📚 **Complete API documentation** - Types, imports, telemetry, token counting                                                    |
| [**Why CopilotEdge**](docs/why-copilotedge.md)     | 📖 **START HERE** - Practical guide explaining the value and real-world impact                                                   |
| [**GPT-OSS & Edge**](docs/gpt-oss-and-edge.md)     | 🆕 Understanding local models vs edge computing in production                                                                    |
| [**Configuration**](docs/configuration.md)         | All options, defaults, and advanced setup                                                                                        |
| [**OpenTelemetry**](docs/telemetry.md)            | ✅ **v0.8.0!** Production observability with tracing, metrics, and cost tracking                                                 |
| [**Durable Objects**](docs/durable-objects.md)     | Stateful conversations with WebSocket support                                                                                    |
| [**Workers KV**](docs/kv-cache.md)                 | Persistent global caching setup and configuration                                                                                |
| [**Supported Models**](docs/models.md)             | Available models, pricing, and updates                                                                                           |
| [**Error Handling**](docs/errors.md)               | Error types, status codes, and retry strategies                                                                                  |
| [**Streaming**](docs/streaming.md)                 | Real-time SSE responses with ~200ms to first token                                                                               |
| [**Security**](docs/security.md)                   | Best practices and production config                                                                                             |
| [**Benchmarks**](docs/benchmarks.md)               | Performance data and methodology                                                                                                 |
| [**Troubleshooting**](docs/troubleshooting.md)     | Common issues and solutions                                                                                                      |
| [**Examples**](docs/examples.md)                   | Implementation patterns and demos                                                                                                |
| [**Telemetry Example**](examples/telemetry-example.ts) | OpenTelemetry integration examples                                                                                          |
| [**Streaming Worker**](examples/streaming-worker/) | Hybrid SSE streaming example                                                                                                     |

See [CHANGELOG.md](CHANGELOG.md) for full release history.

## API Reference

📚 **[Complete API Documentation →](docs/api-reference.md)**

The full API reference includes:
- **Import patterns** for ES modules, CommonJS, and dynamic imports
- **TypeScript types** and interfaces with full IntelliSense support
- **Telemetry configuration** with OTLP endpoints for all platforms
- **Token counting** implementation details and accuracy
- **Cost calculation** methodology with per-model pricing
- **Response headers** for debugging and monitoring

### Quick Reference

#### `createCopilotEdgeHandler(config)`

Creates a Next.js API route handler.

```typescript
import { createCopilotEdgeHandler } from "copilotedge";
import type { CopilotEdgeConfig } from "copilotedge";

const config: CopilotEdgeConfig = {
  apiKey: string,       // Required (or CLOUDFLARE_API_TOKEN env var)
  accountId: string,    // Required (or CLOUDFLARE_ACCOUNT_ID env var)
  model: string,        // Default: '@cf/meta/llama-3.1-8b-instruct'
  fallback: string,     // Optional fallback model
  telemetry: {          // Optional telemetry config
    enabled: boolean,
    serviceName: string,
    endpoint: string,
  },
  // ... see full config in API docs
};

export const POST = createCopilotEdgeHandler(config);
```

#### `CopilotEdge` Class

For advanced use cases:

```typescript
import { CopilotEdge } from "copilotedge";
import type { CopilotEdgeConfig, CopilotEdgeMetrics } from "copilotedge";

const edge = new CopilotEdge(config);
const response = await edge.handleRequest(body);
const metrics = edge.getMetrics();
```

## Testing

```bash
npm test                  # Run tests (71 passing)
npm run test:coverage     # With coverage
npm run test:integration  # Miniflare integration tests
```

> **Note**: All 125 functional tests pass with ~32% code coverage. See [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for details. We're committed to improving coverage to 50%+ in v0.8.0.

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT © [Audrey Klammer](https://github.com/Klammertime)

## Troubleshooting

### Deprecated Dependency Warnings

If you see warnings about deprecated packages:

```
WARN deprecated glob@7.2.3, inflight@1.0.6, etc.
```

**Solution:** These are transitive dependencies from upstream packages. They don't affect functionality and will be resolved as the ecosystem updates.

## Support

- [Report Issues](https://github.com/Klammertime/copilotedge/issues)
- [View on npm](https://www.npmjs.com/package/copilotedge)
- [Star on GitHub](https://github.com/Klammertime/copilotedge)
