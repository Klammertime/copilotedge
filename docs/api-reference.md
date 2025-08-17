# CopilotEdge API Reference

Complete API documentation for CopilotEdge v0.8.0 with TypeScript types, import patterns, and detailed configuration.

## Table of Contents

- [Installation & Import](#installation--import)
- [TypeScript Types & Interfaces](#typescript-types--interfaces)
- [Telemetry Configuration](#telemetry-configuration)
- [OTLP Endpoint Requirements](#otlp-endpoint-requirements)
- [Token Counting & Cost Calculation](#token-counting--cost-calculation)
- [Response Headers](#response-headers)
- [Complete API](#complete-api)

## Installation & Import

### Installation

```bash
npm install copilotedge
# or
pnpm add copilotedge
# or
yarn add copilotedge
```

### Environment Auto-Discovery

CopilotEdge automatically discovers configuration from environment variables:

#### API Credentials
```bash
# CopilotEdge-specific (highest priority)
COPILOTEDGE_API_KEY=your-api-key
COPILOTEDGE_ACCOUNT_ID=your-account-id

# Cloudflare standard (fallback)
CLOUDFLARE_API_TOKEN=your-api-token
CLOUDFLARE_ACCOUNT_ID=your-account-id
```

#### Telemetry Configuration
```bash
# Telemetry endpoint (auto-discovered in order)
COPILOTEDGE_TELEMETRY_ENDPOINT=https://otel-collector.example.com/v1/traces
COPILOTEDGE_DASHBOARD_URL=https://dash.copilotedge.io/otlp

# Environment setting
COPILOTEDGE_ENVIRONMENT=production  # or staging, development
NODE_ENV=production                  # fallback for environment
```

Auto-discovery priority order:
1. Explicit config passed to constructor
2. `COPILOTEDGE_*` environment variables
3. Standard environment variables (`CLOUDFLARE_*`, `NODE_ENV`)
4. Default values

### Import Patterns

#### ES Modules (Recommended)

```typescript
// Default import
import CopilotEdge from 'copilotedge';

// Named imports
import { 
  CopilotEdge,
  createCopilotEdgeHandler,
  ValidationError,
  APIError,
  TelemetryManager,
  TokenCounter,
  getTokenCounter,
  MODEL_PRICING
} from 'copilotedge';

// Type imports
import type {
  CopilotEdgeConfig,
  CopilotEdgeMetrics,
  TelemetryConfig,
  TelemetryMetrics,
  StreamingResponse,
  DurableObjectNamespace,
  KVNamespace
} from 'copilotedge';
```

#### CommonJS

```javascript
// CommonJS require
const { CopilotEdge, createCopilotEdgeHandler } = require('copilotedge');

// Or default import
const CopilotEdge = require('copilotedge').default;
```

#### Dynamic Import (for edge environments)

```typescript
// Dynamic import for Workers/Edge Runtime
const { CopilotEdge } = await import('copilotedge');
```

## TypeScript Types & Interfaces

### Core Configuration Interface

```typescript
interface CopilotEdgeConfig {
  // Cloudflare credentials
  apiKey?: string;                      // API token (or CLOUDFLARE_API_TOKEN env)
  accountId?: string;                   // Account ID (or CLOUDFLARE_ACCOUNT_ID env)
  
  // Model configuration
  model?: string;                       // AI model to use
  provider?: string;                    // Provider (default: 'cloudflare')
  fallback?: string;                    // Fallback model for resilience
  
  // Performance settings
  cacheTimeout?: number;                // Cache TTL in ms (default: 60000)
  maxRetries?: number;                  // Max retry attempts (default: 3)
  rateLimit?: number;                   // Requests per minute (default: 60)
  apiTimeout?: number;                  // API call timeout in ms (default: 30000)
  
  // Security settings
  maxRequestSize?: number;              // Max request size in bytes (default: 1MB)
  maxMessages?: number;                 // Max messages per request (default: 100)
  maxMessageSize?: number;              // Max single message size (default: 10KB)
  maxObjectDepth?: number;              // Max object nesting depth (default: 10)
  
  // Streaming
  stream?: boolean;                     // Enable streaming responses
  onChunk?: (chunk: string) => void;    // Streaming chunk callback
  
  // Workers KV (persistent cache)
  kvNamespace?: KVNamespace;            // KV namespace for global cache
  kvCacheTTL?: number;                  // KV cache TTL in seconds (default: 86400)
  kvCachePrefix?: string;               // KV key prefix (default: 'copilotedge:')
  
  // Durable Objects (conversations)
  conversationDO?: DurableObjectNamespace;
  enableConversations?: boolean;
  defaultConversationId?: string;
  
  // Telemetry
  telemetry?: TelemetryConfig;          // OpenTelemetry configuration
  
  // Development
  debug?: boolean;                      // Enable debug logging
  fetch?: typeof fetch;                 // Custom fetch (for testing)
}
```

### Metrics Interface

```typescript
interface CopilotEdgeMetrics {
  totalRequests: number;      // Total requests processed
  cacheHits: number;          // Number of cache hits
  cacheHitRate: number;       // Cache hit rate (0-1)
  avgLatency: number;         // Average latency in ms
  errors: number;             // Total errors
  errorRate: number;          // Error rate (0-1)
  fallbackUsed: number;       // Times fallback model used
  fallbackRate: number;       // Fallback usage rate (0-1)
  activeModel: string;        // Currently active model
}
```

### Telemetry Types

```typescript
interface TelemetryConfig {
  enabled: boolean;                              // Enable telemetry
  endpoint?: string;                             // OTLP collector URL (auto-discovered)
  serviceName?: string;                          // Service identifier
  serviceVersion?: string;                       // Version string
  environment?: string;                          // Environment (auto-discovered from COPILOTEDGE_ENVIRONMENT or NODE_ENV)
  exportInterval?: number;                       // Export interval in ms
  headers?: Record<string, string>;              // Auth headers
  attributes?: Record<string, string | number>;  // Global attributes
  samplingRate?: number;                         // 0-1 sampling rate
  batchSize?: number;                           // Batch size for exports
  batchTimeoutMs?: number;                      // Batch timeout
  exporters?: {
    console?: boolean;                           // Log to console
    otlp?: boolean;                             // OTLP export
    custom?: (spans: any[]) => void;            // Custom exporter
  };
  debug?: boolean;                              // Debug logging
}

interface TelemetryMetrics {
  cacheHits: number;
  cacheMisses: number;
  requestCount: number;
  errorCount: number;
  averageLatency: number;
  tokensProcessed: number;
}
```

### Error Classes

```typescript
class ValidationError extends Error {
  field?: string;  // Optional field that failed validation
}

class APIError extends Error {
  statusCode: number;  // HTTP status code
}
```

### Streaming Types

```typescript
interface StreamingResponse {
  stream: AsyncGenerator<string, void, unknown>;  // Content stream
  getFullResponse: () => Promise<string>;         // Get complete response
}
```

## Telemetry Configuration

### Basic Setup

```typescript
// Minimal config - uses environment auto-discovery
const copilot = new CopilotEdge({
  // API credentials auto-discovered from:
  // COPILOTEDGE_API_KEY or CLOUDFLARE_API_TOKEN
  // COPILOTEDGE_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID
  
  telemetry: {
    enabled: true,
    serviceName: 'my-ai-service'
    // endpoint auto-discovered from COPILOTEDGE_TELEMETRY_ENDPOINT
    // environment auto-discovered from COPILOTEDGE_ENVIRONMENT or NODE_ENV
  }
});

// Or with explicit config (overrides env vars)
const copilot = new CopilotEdge({
  apiKey: 'explicit-key',
  accountId: 'explicit-account',
  telemetry: {
    enabled: true,
    serviceName: 'my-ai-service',
    endpoint: 'https://otel-collector.example.com/v1/traces',
    environment: 'production'
  }
});
```

### Advanced Configuration with Authentication

```typescript
const copilot = new CopilotEdge({
  telemetry: {
    enabled: true,
    serviceName: 'production-ai',
    serviceVersion: '1.0.0',
    endpoint: 'https://otel.grafana.net/otlp',
    headers: {
      'Authorization': `Bearer ${process.env.GRAFANA_API_KEY}`
    },
    samplingRate: 0.1,  // Sample 10% in production
    attributes: {
      'deployment.environment': 'production',
      'service.namespace': 'ai-services',
      'cloud.provider': 'cloudflare',
      'cloud.region': 'auto'
    }
  }
});
```

### Telemetry Attributes

Every request automatically includes these OpenTelemetry attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `ai.tokens.input` | number | Actual input token count (using tiktoken) |
| `ai.tokens.output` | number | Actual output token count |
| `ai.tokens.total` | number | Total tokens (input + output) |
| `ai.cost.input_usd` | number | Input cost in USD |
| `ai.cost.output_usd` | number | Output cost in USD |
| `ai.cost.total_usd` | number | Total cost in USD |
| `ai.cost.estimated` | boolean | Always `false` (real counts) |
| `copilot.model` | string | Model name used |
| `copilot.cache.hit` | boolean | Whether cache was hit |
| `copilot.correlation.id` | string | Unique request correlation ID |
| `copilot.conversation_id` | string | Conversation identifier |
| `correlation.id` | string | Request correlation ID |
| `conversation.id` | string | Conversation ID |

## OTLP Endpoint Requirements

### Endpoint Format

The OTLP endpoint must follow the OpenTelemetry specification:

```
https://<collector-host>/v1/traces     # For traces
https://<collector-host>/v1/metrics    # For metrics
```

### Auto-Discovery

CopilotEdge automatically discovers the endpoint from environment variables in this order:

1. `COPILOTEDGE_TELEMETRY_ENDPOINT`
2. `COPILOTEDGE_DASHBOARD_URL`
3. `OTEL_EXPORTER_OTLP_ENDPOINT`
4. `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`

### Platform-Specific Endpoints

#### Grafana Cloud
```typescript
{
  endpoint: 'https://otlp-gateway-prod-us-central-0.grafana.net/otlp',
  headers: {
    'Authorization': `Bearer ${GRAFANA_API_KEY}`
  }
}
```

#### Datadog
```typescript
{
  endpoint: 'https://http-intake.logs.datadoghq.com/v1/input',
  headers: {
    'DD-API-KEY': DATADOG_API_KEY
  }
}
```

#### New Relic
```typescript
{
  endpoint: 'https://otlp.nr-data.net',
  headers: {
    'api-key': NEW_RELIC_LICENSE_KEY
  }
}
```

#### Self-Hosted Collector
```typescript
{
  endpoint: 'http://localhost:4318/v1/traces',
  // No auth needed for local collector
}
```

## Token Counting & Cost Calculation

### How Token Counting Works

CopilotEdge uses the **tiktoken** library (same as OpenAI) for accurate token counting:

1. **Input Tokens**: Counted before sending to AI
2. **Output Tokens**: Counted from the response
3. **Streaming**: Tokens counted progressively during streaming

### Accuracy Details

```typescript
// Token counting uses the appropriate encoder for each model
const tokenCounter = getTokenCounter(modelName);

// For messages
const inputTokens = tokenCounter.countMessageTokens(messages);

// For text
const outputTokens = tokenCounter.countTokens(responseText);
```

#### Model-Specific Encoders

- **GPT models**: Uses `cl100k_base` encoder
- **Llama models**: Uses `cl100k_base` encoder (close approximation)
- **Other models**: Falls back to character-based estimation (÷4)

### Cost Calculation Methodology

Costs are calculated using real-time token counts and model-specific pricing:

```typescript
const MODEL_PRICING = {
  '@cf/meta/llama-3.1-8b-instruct': {
    input: 0.01,   // $0.01 per 1M input tokens
    output: 0.01   // $0.01 per 1M output tokens
  },
  '@cf/meta/llama-3.1-70b-instruct': {
    input: 0.50,   // $0.50 per 1M input tokens
    output: 0.50   // $0.50 per 1M output tokens
  },
  // ... more models
};

// Cost calculation
const inputCost = (inputTokens / 1_000_000) * pricing.input;
const outputCost = (outputTokens / 1_000_000) * pricing.output;
const totalCost = inputCost + outputCost;
```

### Using Token Counter Directly

```typescript
import { getTokenCounter, MODEL_PRICING } from 'copilotedge';

// Get counter for specific model
const counter = getTokenCounter('@cf/meta/llama-3.1-8b-instruct');

// Count tokens
const tokens = counter.countTokens('Hello, world!');
const messageTokens = counter.countMessageTokens([
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi there!' }
]);

// Calculate costs
const costs = counter.calculateCost(
  inputTokens,
  outputTokens,
  '@cf/meta/llama-3.1-8b-instruct'
);
// Returns: { inputCost, outputCost, totalCost }
```

## Response Headers

CopilotEdge adds these headers to HTTP responses for debugging:

| Header | Description | Example |
|--------|-------------|---------|
| `X-Powered-By` | Always "CopilotEdge" | `CopilotEdge` |
| `X-Cache` | Cache status | `HIT` or `MISS` |
| `X-CopilotEdge-Cache-Hit-Rate` | Current cache hit rate | `0.85` |
| `X-CopilotEdge-Model` | Model used for this request | `@cf/meta/llama-3.1-8b-instruct` |
| `X-CopilotEdge-Latency` | Request processing time | `245ms` |
| `X-Streaming` | Whether response is streamed | `true` or absent |

### Accessing Headers in Client

```typescript
const response = await fetch('/api/copilotedge', {
  method: 'POST',
  body: JSON.stringify({ messages })
});

console.log('Cache:', response.headers.get('X-Cache'));
console.log('Model:', response.headers.get('X-CopilotEdge-Model'));
console.log('Latency:', response.headers.get('X-CopilotEdge-Latency'));
```

## Complete API

### CopilotEdge Class

```typescript
class CopilotEdge {
  constructor(config?: CopilotEdgeConfig);
  
  // Main request handler
  handleRequest(body: any): Promise<any>;
  
  // Create Next.js handler
  createNextHandler(): (req: NextRequest) => Promise<NextResponse>;
  
  // Get metrics
  getMetrics(): CopilotEdgeMetrics;
  
  // Cache management
  clearCache(clearKV?: boolean): Promise<void>;
  
  // Testing utilities
  testFeatures(): Promise<void>;
  sleep(ms: number): Promise<void>;
}
```

### Factory Functions

```typescript
// Create a Next.js API route handler
function createCopilotEdgeHandler(
  config?: CopilotEdgeConfig
): (req: NextRequest) => Promise<NextResponse>;

// Get a token counter for a model
function getTokenCounter(
  modelName?: string
): TokenCounter;
```

### TokenCounter Class

```typescript
class TokenCounter {
  constructor(modelName?: string);
  
  // Count tokens in text
  countTokens(text: string): number;
  
  // Count tokens in messages
  countMessageTokens(messages: Array<{
    role: string;
    content: string;
  }>): number;
  
  // Calculate costs
  calculateCost(
    inputTokens: number,
    outputTokens: number,
    modelName: string
  ): {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  };
}
```

### TelemetryManager Class

```typescript
class TelemetryManager {
  constructor(config: TelemetryConfig);
  
  // Span management
  startSpan(name: string, options?: SpanOptions): Span | null;
  endSpan(name: string, status?: SpanStatus): void;
  
  // Execute function with tracing
  withSpan<T>(
    name: string,
    fn: () => Promise<T>,
    options?: SpanOptions
  ): Promise<T>;
  
  // Metrics
  updateMetrics(update: Partial<TelemetryMetrics>): void;
  getMetrics(): TelemetryMetrics;
  
  // Lifecycle
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
```

## Examples

### Basic Usage

```typescript
import { CopilotEdge } from 'copilotedge';

const copilot = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/meta/llama-3.1-8b-instruct'
});

const response = await copilot.handleRequest({
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});
```

### With Full Telemetry

```typescript
import { CopilotEdge } from 'copilotedge';
import type { CopilotEdgeConfig } from 'copilotedge';

const config: CopilotEdgeConfig = {
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/meta/llama-3.1-70b-instruct',
  fallback: '@cf/meta/llama-3.1-8b-instruct',
  
  // Enable telemetry with cost tracking
  telemetry: {
    enabled: true,
    serviceName: 'ai-production',
    endpoint: process.env.OTEL_ENDPOINT,
    headers: {
      'Authorization': `Bearer ${process.env.OTEL_API_KEY}`
    },
    samplingRate: 0.1,
    attributes: {
      'environment': 'production',
      'version': '1.0.0'
    }
  },
  
  // Performance tuning
  cacheTimeout: 300000,  // 5 minutes
  maxRetries: 5,
  rateLimit: 100,
  
  // Enable streaming
  stream: true
};

const copilot = new CopilotEdge(config);

// Monitor metrics
setInterval(() => {
  const metrics = copilot.getMetrics();
  console.log('Metrics:', metrics);
}, 60000);
```

### Next.js API Route

```typescript
// app/api/copilot/route.ts
import { createCopilotEdgeHandler } from 'copilotedge';
import type { CopilotEdgeConfig } from 'copilotedge';

const config: CopilotEdgeConfig = {
  model: '@cf/openai/gpt-oss-120b',
  fallback: '@cf/openai/gpt-oss-20b',
  telemetry: {
    enabled: true,
    serviceName: 'nextjs-ai-app'
  }
};

export const POST = createCopilotEdgeHandler(config);
```

## Migration Guide

### From v0.7.x to v0.8.0

The main changes in v0.8.0 are additions, not breaking changes:

```typescript
// Old (still works)
import CopilotEdge from 'copilotedge';

// New (with all exports available)
import {
  CopilotEdge,
  TokenCounter,
  TelemetryManager,
  getTokenCounter,
  MODEL_PRICING
} from 'copilotedge';

// Types are now properly exported
import type {
  CopilotEdgeConfig,
  CopilotEdgeMetrics,
  TelemetryConfig
} from 'copilotedge';
```

## Support

For issues, questions, or contributions:

- GitHub: [github.com/Klammertime/copilotedge](https://github.com/Klammertime/copilotedge)
- NPM: [npmjs.com/package/copilotedge](https://www.npmjs.com/package/copilotedge)
- Documentation: [This file and /docs folder](https://github.com/Klammertime/copilotedge/tree/main/docs)