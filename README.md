# CopilotEdge

Adapter connecting [CopilotKit](https://github.com/CopilotKit/CopilotKit) to [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) for edge-based inference.

[![npm version](https://img.shields.io/npm/v/copilotedge)](https://www.npmjs.com/package/copilotedge)
[![CI](https://github.com/Klammertime/copilotedge/actions/workflows/ci.yml/badge.svg)](https://github.com/Klammertime/copilotedge/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/copilotedge)](https://github.com/Klammertime/copilotedge/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/copilotedge)](https://www.npmjs.com/package/copilotedge)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## Features

- **Edge Computing** - Automatic region selection for lowest latency
- **Request Caching** - 60s default TTL, configurable
- **Resilience** - Built-in retry logic with exponential backoff
- **Rate Limiting** - Configurable limits to prevent abuse
- **Type Safe** - Full TypeScript support with comprehensive types
- **Zero Dependencies** - Lightweight, ~38KB total

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
import { createCopilotEdgeHandler } from 'copilotedge';

export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});
```

### 4. Configure CopilotKit

```tsx
// app/layout.tsx
import { CopilotKit } from '@copilotkit/react-core';

export default function Layout({ children }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotedge">
      {children}
    </CopilotKit>
  );
}
```

### Get Cloudflare Credentials

1. Sign up for [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
2. Get your API token from the dashboard
3. Copy your account ID

## Documentation

| Topic | Description |
|-------|-------------|
| [**Configuration**](docs/configuration.md) | All options, defaults, and advanced setup |
| [**Supported Models**](docs/models.md) | Available models, pricing, and updates |
| [**Error Handling**](docs/errors.md) | Error types, status codes, and retry strategies |
| [**Streaming**](docs/streaming.md) | No streaming in v0.2.x. Typical chat p95: 0.8–1.1s with loaders. Long-form uses a separate streaming endpoint (example provided) |
| [**Security**](docs/security.md) | Best practices and production config |
| [**Benchmarks**](docs/benchmarks.md) | Performance data and methodology |
| [**Troubleshooting**](docs/troubleshooting.md) | Common issues and solutions |
| [**Examples**](docs/examples.md) | Implementation patterns and demos |
| [**Streaming Worker**](examples/streaming-worker/) | Hybrid SSE streaming example |

See [CHANGELOG.md](CHANGELOG.md) for full release history.

## API Reference

### `createCopilotEdgeHandler(config)`

Creates a Next.js API route handler.

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: string,              // Required
  accountId: string,           // Required
  model?: string,              // Default: '@cf/meta/llama-3.1-8b-instruct'
  debug?: boolean,             // Default: false
  cacheTimeout?: number,       // Default: 60000 (ms)
  maxRetries?: number,         // Default: 3
  rateLimit?: number,          // Default: 60 (requests/min)
  enableInternalSensitiveLogging?: boolean // DANGER: See docs/security.md
});
```

See [Configuration](docs/configuration.md) for detailed options.

### `CopilotEdge` Class

For advanced use cases:

```typescript
import CopilotEdge from 'copilotedge';

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