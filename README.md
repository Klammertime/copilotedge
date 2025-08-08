# CopilotEdge 🚀

> Production-ready adapter connecting CopilotKit to Cloudflare Workers AI for edge-based inference.

[![npm version](https://img.shields.io/npm/v/copilotedge)](https://www.npmjs.com/package/copilotedge)
[![Tests](https://github.com/Klammertime/copilotedge/workflows/Tests/badge.svg)](https://github.com/Klammertime/copilotedge/actions)
[![License](https://img.shields.io/npm/l/copilotedge)](https://github.com/Klammertime/copilotedge/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/copilotedge)](https://www.npmjs.com/package/copilotedge)
[![Coverage](https://img.shields.io/badge/coverage-80%25-green)](https://github.com/Klammertime/copilotedge)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## What's New in v0.2.1 (August 2025)

- **OpenAI Models Support**: Added support for new OpenAI open-weight models (`gpt-oss-120b`, `gpt-oss-20b`)
- **Enhanced Security**: Sensitive content detection now disabled by default with opt-in configuration
- **Better Documentation**: Added comprehensive benchmarks, error handling guide, and security best practices
- **Cloudflare Pages Example**: New example for deploying with Cloudflare Pages Functions
- **Model Updates**: Support for latest Llama 3.3, Mistral Small 2503, and Gemma 3 models

## Why CopilotEdge?

**The Problem:** CopilotKit is designed primarily for OpenAI. Cloudflare Workers AI offers edge inference capabilities, but integrating the two requires custom adapter code.

**The Solution:** CopilotEdge is a drop-in adapter that connects CopilotKit to Cloudflare's edge network, providing:

- ⚡ **Edge computing** - Requests processed at the nearest Cloudflare location
- 💾 **Request caching** - Reduce redundant API calls with configurable TTL
- 🌍 **Global availability** - Leverages Cloudflare's network infrastructure
- 🔄 **Built-in resilience** - Automatic retries and rate limiting
- 🎯 **Simple setup** - Minimal configuration required

## Features

### ⚡ Auto-Region Selection
Automatically finds and uses the fastest Cloudflare edge location for each user. No manual configuration needed.

### 💾 Request Caching (60s default TTL)
Caches identical requests to reduce API calls. Useful for demos, onboarding flows, and frequently asked questions. Cache effectiveness depends on request patterns.

### 🔄 Automatic Retry Logic
Built-in exponential backoff with jitter ensures reliability even during network hiccups or rate limits.

### 🎯 Simple Configuration
```javascript
// That's it. Seriously.
const handler = createCopilotEdgeHandler({
  apiKey: 'your-cloudflare-api-key'
});
```

### 🐛 Debug Mode
See exactly what's happening with detailed performance metrics:
```
[CopilotEdge] Selected: US-East (45ms)
[CopilotEdge] Cache HIT (age: 15s, saved 1 API call)
[CopilotEdge] Request completed in 12ms via US-East
```

## Installation

```bash
npm install copilotedge
# or
pnpm add copilotedge
# or
yarn add copilotedge
```

## Quick Start

**⚠️ IMPORTANT: Before deploying to production, read the [Security & Privacy](#security--privacy) section.**

### 1. Get Your Cloudflare Credentials

1. Sign up for [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
2. Get your API token from the dashboard
3. Copy your account ID

### 2. Create an API Route

```typescript
// app/api/copilotedge/route.ts (Next.js App Router)
import { createCopilotEdgeHandler } from 'copilotedge';

export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});
```

### 3. Configure CopilotKit

```tsx
// app/layout.tsx
import { CopilotKit } from '@copilotkit/react-core';

export default function Layout({ children }) {
  return (
    <CopilotKit 
      runtimeUrl="/api/copilotedge"  // Your CopilotEdge endpoint
      showDevConsole={false}
    >
      {children}
    </CopilotKit>
  );
}
```

### 4. Use in Your Components

```tsx
// app/page.tsx
import { useCopilotChat } from '@copilotkit/react-core';

export default function ChatPage() {
  const { messages, sendMessage } = useCopilotChat();
  
  return (
    <div>
      {/* Your chat UI */}
    </div>
  );
}
```

## Advanced Configuration

```typescript
const handler = createCopilotEdgeHandler({
  // Required
  apiKey: 'your-api-key',
  accountId: 'your-account-id',
  
  // Optional
  model: '@cf/meta/llama-3.1-8b-instruct',  // Default model
  debug: true,                               // Enable debug logging
  cacheTimeout: 60000,                       // Cache TTL in ms (default: 60s)
  maxRetries: 3,                             // Retry attempts (default: 3)
  rateLimit: 60                              // Requests per minute (default: 60)
});
```

## Available Models

CopilotEdge supports all Cloudflare Workers AI text generation models.

### Current Models (as of August 2025)

| Model | Description | Speed | Cost |
|-------|-------------|-------|------|
| `@cf/meta/llama-3.1-8b-instruct` | **Default** - Fast, reliable | ⚡⚡⚡ | $0.011/1k neurons |
| `@cf/meta/llama-3.3-70b-instruct` | Latest Llama with speculative decoding | ⚡⚡ | $0.011/1k neurons |
| `@cf/openai/gpt-oss-120b` | OpenAI's open model for production | ⚡ | $0.011/1k neurons |
| `@cf/openai/gpt-oss-20b` | OpenAI's fast model for low latency | ⚡⚡⚡ | $0.011/1k neurons |
| `@cf/mistral/mistral-small-2503` | 128k context, vision capable | ⚡⚡ | $0.011/1k neurons |
| `@cf/google/gemma-3` | Multilingual, 128k context | ⚡⚡ | $0.011/1k neurons |

**Note**: Workers AI is included in both Free and Paid Workers plans. Pricing: $0.011 per 1,000 Neurons.

**New in August 2025**: OpenAI's open-weight models (`gpt-oss-120b` and `gpt-oss-20b`) are now available through Cloudflare's Day 0 partnership.

### Keeping Models Up-to-Date

Cloudflare regularly adds new models and updates existing ones. To stay current:

1. **Check Available Models** - Query the Cloudflare API directly:
```bash
curl https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/models/search \
  -H "Authorization: Bearer {api_token}" | jq '.result[] | select(.task.name=="Text Generation")'
```

2. **Test New Models** - Before using a new model in production:
```javascript
const edge = new CopilotEdge({
  model: '@cf/new-provider/new-model',  // Try the new model
  debug: true
});

// Test with sample request
const result = await edge.handleRequest({
  messages: [{ role: 'user', content: 'Test message' }]
});
```

3. **Handle Model Deprecation** - Implement fallback logic:
```javascript
const PRIMARY_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const FALLBACK_MODEL = '@cf/mistral/mistral-7b-instruct';

let model = PRIMARY_MODEL;
try {
  const result = await edge.handleRequest(body);
} catch (error) {
  if (error.statusCode === 404 && model === PRIMARY_MODEL) {
    // Model not found, try fallback
    model = FALLBACK_MODEL;
    const edge = new CopilotEdge({ model });
    const result = await edge.handleRequest(body);
  }
}
```

4. **Monitor Cloudflare Announcements**:
   - [Cloudflare Blog](https://blog.cloudflare.com/tag/workers-ai/)
   - [Workers AI Docs](https://developers.cloudflare.com/workers-ai/models/)
   - [Discord Community](https://discord.cloudflare.com)

## Performance Considerations

Performance varies based on:
- Your geographic location relative to Cloudflare edge nodes
- Model selection and complexity
- Request patterns and cache hit rates
- Network conditions

For detailed performance analysis specific to your use case, see [benchmarks.md](benchmarks.md).

## API Reference

### `CopilotEdge` Class

```typescript
const edge = new CopilotEdge(config);

// Handle a request
const response = await edge.handleRequest(body);

// Get performance metrics
const metrics = edge.getMetrics();
// Returns: { totalRequests, cacheHits, avgLatency, errors }

// Clear cache manually
edge.clearCache();

// Test all features
await edge.testFeatures();
```

### `createCopilotEdgeHandler` Function

```typescript
// Quick setup for Next.js
const handler = createCopilotEdgeHandler(config);
export const POST = handler;
```

## Error Handling

CopilotEdge provides detailed error messages with proper HTTP status codes.

### Error Types and Status Codes

| Error Type | Status Code | Common Causes | Retry? |
|------------|-------------|---------------|--------|
| `ValidationError` | 400 | Invalid request format, missing fields | No |
| `APIError` (auth) | 401 | Invalid API token | No |
| `APIError` (forbidden) | 403 | Account restrictions, quota exceeded | No |
| `APIError` (not found) | 404 | Invalid endpoint or model | No |
| `APIError` (rate limit) | 429 | Too many requests | Yes (with backoff) |
| `APIError` (server) | 500 | Cloudflare service error | Yes |
| `APIError` (unavailable) | 503 | Service temporarily unavailable | Yes |
| Network timeout | - | Request exceeded 30s timeout | Yes |

### Error Response Format

```json
{
  "error": "Detailed error message",
  "type": "ValidationError | APIError"
}
```

### Handling Errors

```typescript
try {
  const response = await edge.handleRequest(body);
} catch (error) {
  if (error instanceof ValidationError) {
    // 400 - Bad Request - Do not retry
    console.error('Invalid input:', error.message);
    // Fix the request and try again
  } else if (error instanceof APIError) {
    if (error.statusCode === 429) {
      // Rate limited - Retry with exponential backoff
      await sleep(1000 * Math.pow(2, retryCount));
    } else if (error.statusCode >= 500) {
      // Server error - Retry with backoff
    } else {
      // Client error (4xx) - Do not retry
      console.error(`API error ${error.statusCode}:`, error.message);
    }
  }
}
```

### Common Failure Scenarios

#### 1. Rate Limiting (429)
**Cause**: Exceeded configured rate limit  
**Solution**: Implement client-side rate limiting or increase limit
```typescript
const handler = createCopilotEdgeHandler({
  rateLimit: 120  // Increase from default 60
});
```

#### 2. Invalid Model (404)
**Cause**: Specified model doesn't exist  
**Solution**: Use a valid model from the supported list

#### 3. Timeout
**Cause**: Complex request or network issues  
**Solution**: Retry with exponential backoff, consider simpler prompts

#### 4. Cache Miss After Hit
**Cause**: Cache entry expired (default 60s TTL)  
**Solution**: Adjust cache timeout if appropriate
```typescript
const handler = createCopilotEdgeHandler({
  cacheTimeout: 120000  // 2 minutes
});
```

## Testing

```bash
# Run tests
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Examples

### Basic Chat Application

```typescript
// Full example at examples/basic-chat
import { createCopilotEdgeHandler } from 'copilotedge';

export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});
```

### With Custom Model

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/meta/llama-3.1-70b-instruct'
});
```

### With Debug Logging

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  debug: true  // See detailed logs
});
```

## Streaming Support

**Current Status**: CopilotEdge v0.2.0 does **not** support streaming responses. All responses are returned as complete messages.

**Why no streaming?**: 
- Cloudflare Workers AI streaming requires specific implementation patterns
- CopilotKit's streaming protocol needs careful adaptation
- Caching is incompatible with streaming responses

**Workaround**: For real-time feel, implement client-side typing animations or progressive rendering.

**Future**: Streaming support is planned for a future release. Track progress in [issue #streaming](https://github.com/Klammertime/copilotedge/issues).

## Comparison with Alternatives

| Feature | CopilotEdge | Direct OpenAI | Vercel AI SDK | LangChain |
|---------|------------|---------------|---------------|-----------|
| CopilotKit Support | ✅ Native | ✅ Native | ⚠️ Adapter needed | ❌ No |
| Cloudflare AI | ✅ Yes | ❌ No | ⚠️ Manual setup | ⚠️ Complex |
| Edge Computing | ✅ Automatic | ❌ No | ⚠️ Depends | ❌ No |
| Request Caching | ✅ Built-in | ❌ No | ❌ No | ⚠️ Manual |
| Auto-retry | ✅ Yes | ❌ No | ⚠️ Basic | ✅ Yes |
| Setup Time | **5 minutes** | 30 minutes | 1 hour | 2+ hours |
| Cost | **$0-10/mo** | $50-500/mo | $20-200/mo | Varies |

## Troubleshooting

### Common Issues

**1. "API key is required" error**
```bash
# Make sure your environment variables are set
CLOUDFLARE_API_TOKEN=your-token-here
CLOUDFLARE_ACCOUNT_ID=your-account-id-here
```

**2. Rate limiting (429 errors)**
```typescript
// Increase rate limit if needed
const handler = createCopilotEdgeHandler({
  rateLimit: 120  // Allow 120 requests per minute
});
```

**3. Slow responses**
```typescript
// Enable debug mode to see what's happening
const handler = createCopilotEdgeHandler({
  debug: true
});
```

## Security & Privacy

### Data Handling
- **No data storage**: CopilotEdge doesn't persist any user data beyond the configurable cache TTL
- **No logging of content**: Request/response content is never logged unless debug mode is explicitly enabled
- **Cache isolation**: Cached responses are memory-only and cleared on restart

### Security Features
- ✅ **Input validation**: All requests are validated and sanitized
- ✅ **Rate limiting**: Built-in protection against abuse (configurable)
- ✅ **Secure by default**: No credentials stored in code
- ✅ **Error masking**: Internal errors never expose sensitive details
- ✅ **Headers stripped**: Sensitive headers are never forwarded to upstream

### Sensitive Content Detection
Optional feature (disabled by default) to detect potential secrets in requests:

```typescript
const handler = createCopilotEdgeHandler({
  enableInternalSensitiveLogging: true  // DANGER: Never use in production!
});
```

**⚠️ WARNING**: This feature is for development/debugging ONLY. When enabled, it logs warnings about sensitive content internally. NEVER enable this in production as it could log actual secrets to your monitoring systems.

### Recommended Production Configuration
```typescript
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  debug: false,  // Disable in production
  enableInternalSensitiveLogging: false,  // NEVER enable in production
  rateLimit: 30,  // Lower limit for production
  cacheTimeout: 30000  // Shorter cache for sensitive data
});
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

```bash
# Clone the repo
git clone https://github.com/Klammertime/copilotedge.git

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build
```

## License

MIT © [Audrey Klammer](https://github.com/Klammertime)

## Author

**Audrey Klammer**
- GitHub: [@Klammertime](https://github.com/Klammertime)

## Acknowledgments

- Thanks to the CopilotKit team for building an amazing framework
- Thanks to Cloudflare for making AI accessible at the edge
- Special thanks to the open source community

---

<p align="center">
  Made with ❤️ by a developer who believes AI should be fast, affordable, and accessible to everyone.
</p>

<p align="center">
  <a href="https://github.com/Klammertime/copilotedge">⭐ Star on GitHub</a> •
  <a href="https://www.npmjs.com/package/copilotedge">📦 View on npm</a> •
  <a href="https://github.com/Klammertime/copilotedge/issues">🐛 Report an Issue</a>
</p>