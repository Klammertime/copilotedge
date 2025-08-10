# CopilotEdge

The **first and only** adapter that enables [CopilotKit](https://github.com/CopilotKit/CopilotKit) applications to leverage [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)'s powerful edge computing infrastructure for AI inference.

[![npm version](https://img.shields.io/npm/v/copilotedge)](https://www.npmjs.com/package/copilotedge)
[![CI](https://github.com/Klammertime/copilotedge/actions/workflows/ci.yml/badge.svg)](https://github.com/Klammertime/copilotedge/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/copilotedge)](https://github.com/Klammertime/copilotedge/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/copilotedge)](https://www.npmjs.com/package/copilotedge)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## Why CopilotEdge?

**CopilotKit** is an amazing open-source framework for building AI-powered copilots, but it typically requires expensive API calls to OpenAI or other cloud providers. **Cloudflare Workers AI** offers a compelling alternative with:

- **100+ AI models** running on Cloudflare's global edge network
- **Significantly lower costs** compared to traditional AI APIs
- **Ultra-low latency** with automatic region selection
- **Privacy-focused** inference that keeps data within Cloudflare's network

**The problem:** There was no way to connect these two powerful technologies... until now.

**CopilotEdge** bridges this gap, allowing CopilotKit developers to:

- 🚀 Run AI inference at the edge across 100+ global locations
- 💰 Reduce AI costs by up to 90% with built-in caching
- ⚡ Achieve sub-second response times with edge computing
- 🔒 Keep sensitive data within Cloudflare's secure infrastructure
- 🎯 Access OpenAI's massive 120B parameter models via Cloudflare

## Features

- **🌍 Edge Computing** - Automatic region selection across 100+ locations for lowest latency
- **💾 Smart Caching** - 60s default TTL reduces costs by up to 90% for repeated queries
- **🔄 Enterprise Resilience** - Built-in retry logic with exponential backoff and jitter
- **🛡️ Rate Limiting** - Configurable limits to prevent abuse and control costs
- **📘 Type Safe** - Full TypeScript support with comprehensive types and IntelliSense
- **🪶 Zero Dependencies** - Lightweight ~38KB total, no bloat
- **🧠 OpenAI Models** - Access OpenAI's massive 120B and 20B parameter models via Cloudflare
- **🎯 Model Fallbacks** - Automatic failover to alternative models for high availability

## What Makes This Special?

This is **the only package** that connects CopilotKit to Cloudflare Workers AI. Without CopilotEdge, CopilotKit users are limited to:

- Expensive OpenAI API calls ($20-60 per million tokens)
- Higher latency from centralized API endpoints
- Privacy concerns with data leaving your infrastructure

With CopilotEdge, you get:

- Cloudflare's competitive pricing (as low as $0.01 per million tokens for some models)
- Edge inference in the closest data center to your users
- Data processing within Cloudflare's secure network
- Access to 100+ models including Llama, Mistral, and OpenAI models

## Quick Start

**⚠️ Before deploying to production, read [Security & Privacy](docs/security.md).**

### 1. Install

```bash
npm install copilotedge
```

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

// Basic setup
export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
});

// With OpenAI model and fallback
// export const POST = createCopilotEdgeHandler({
//   apiKey: process.env.CLOUDFLARE_API_TOKEN,
//   accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
//   model: '@cf/openai/gpt-oss-120b',           // OpenAI's 120B parameter model
//   fallback: '@cf/meta/llama-3.1-8b-instruct'  // Fallback model
// });
```

### 4. Configure CopilotKit

```tsx
// app/layout.tsx
import { CopilotKit } from "@copilotkit/react-core";

export default function Layout({ children }) {
  return <CopilotKit runtimeUrl="/api/copilotedge">{children}</CopilotKit>;
}
```

### Get Cloudflare Credentials

1. Sign up for [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
2. Get your API token from the dashboard
3. Copy your account ID

## Documentation

| Topic                                              | Description                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [**Configuration**](docs/configuration.md)         | All options, defaults, and advanced setup                                                                                        |
| [**Supported Models**](docs/models.md)             | Available models, pricing, and updates                                                                                           |
| [**Error Handling**](docs/errors.md)               | Error types, status codes, and retry strategies                                                                                  |
| [**Streaming**](docs/streaming.md)                 | No streaming in v0.2.x. Typical chat p95: 0.8–1.1s with loaders. Long-form uses a separate streaming endpoint (example provided) |
| [**Security**](docs/security.md)                   | Best practices and production config                                                                                             |
| [**Benchmarks**](docs/benchmarks.md)               | Performance data and methodology                                                                                                 |
| [**Troubleshooting**](docs/troubleshooting.md)     | Common issues and solutions                                                                                                      |
| [**Examples**](docs/examples.md)                   | Implementation patterns and demos                                                                                                |
| [**Streaming Worker**](examples/streaming-worker/) | Hybrid SSE streaming example                                                                                                     |

See [CHANGELOG.md](CHANGELOG.md) for full release history.

## API Reference

### `createCopilotEdgeHandler(config)`

Creates a Next.js API route handler.

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: string, // Required
  accountId: string, // Required
  model: string, // Default: '@cf/meta/llama-3.1-8b-instruct'
  provider: string, // Default: 'cloudflare'
  fallback: string, // Optional fallback model
  debug: boolean, // Default: false
  cacheTimeout: number, // Default: 60000 (ms)
  maxRetries: number, // Default: 3
  rateLimit: number, // Default: 60 (requests/min)
  enableInternalSensitiveLogging: boolean, // DANGER: See docs/security.md
});
```

See [Configuration](docs/configuration.md) for detailed options.

### `CopilotEdge` Class

For advanced use cases:

```typescript
import CopilotEdge from "copilotedge";

const edge = new CopilotEdge(config);
const response = await edge.handleRequest(body);
const metrics = edge.getMetrics();
```

## Testing

```bash
npm test                  # Run tests
npm run test:coverage     # With coverage
npm run test:integration  # Miniflare integration tests
```

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT © [Audrey Klammer](https://github.com/Klammertime)

## Support

- [Report Issues](https://github.com/Klammertime/copilotedge/issues)
- [View on npm](https://www.npmjs.com/package/copilotedge)
- [Star on GitHub](https://github.com/Klammertime/copilotedge)
