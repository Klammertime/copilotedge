# OpenTelemetry Integration Guide

CopilotEdge v0.7.0 introduces comprehensive OpenTelemetry support for production observability. This guide covers configuration, integration with popular platforms, and best practices.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Metrics & Traces](#metrics--traces)
- [Platform Integrations](#platform-integrations)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Quick Start

Enable telemetry with minimal configuration:

```typescript
import { CopilotEdge } from 'copilotedge';

const copilot = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  
  telemetry: {
    enabled: true,
    serviceName: 'my-ai-service'
  }
});
```

## Configuration

### Full Configuration Options

```typescript
interface TelemetryConfig {
  // Core settings
  enabled: boolean;                    // Enable/disable telemetry
  serviceName?: string;                 // Service identifier (default: 'copilotedge')
  serviceVersion?: string;              // Version tracking
  environment?: string;                 // Environment (production, staging, development)
  
  // Export settings
  endpoint?: string;                    // OTLP collector endpoint
  exportInterval?: number;              // Export interval in ms (default: 10000)
  headers?: Record<string, string>;     // Auth headers for collector
  
  // Performance tuning
  samplingRate?: number;                // 0-1, where 1 = 100% sampling
  debug?: boolean;                      // Enable debug logging
  
  // Global attributes
  attributes?: Record<string, string | number | boolean>;
  
  // Exporters
  exporters?: {
    console?: boolean;                  // Log to console
    otlp?: boolean;                     // Export via OTLP
    custom?: (span: any) => void;      // Custom exporter function
  };
}
```

### Environment-Based Configuration

```typescript
const telemetryConfig: TelemetryConfig = {
  enabled: process.env.NODE_ENV !== 'test',
  serviceName: process.env.SERVICE_NAME || 'copilotedge',
  environment: process.env.NODE_ENV || 'development',
  
  // Production settings
  ...(process.env.NODE_ENV === 'production' && {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    samplingRate: 0.1, // Sample 10% in production
    exporters: { otlp: true }
  }),
  
  // Development settings
  ...(process.env.NODE_ENV === 'development' && {
    debug: true,
    samplingRate: 1.0, // Sample everything in dev
    exporters: { console: true }
  })
};
```

## Metrics & Traces

### Automatic Instrumentation

CopilotEdge automatically instruments the following:

#### Request Spans

```
copilotedge.request (root span)
├── copilotedge.validation
├── copilotedge.cache.lookup
├── copilotedge.conversation.load (if enabled)
├── copilotedge.ai.call
│   └── copilotedge.ai.retry (if retries occur)
├── copilotedge.streaming (if streaming enabled)
├── copilotedge.cache.write
├── copilotedge.conversation.save (if enabled)
└── copilotedge.response
```

#### Span Attributes

Each span includes relevant attributes:

- **Request Span**: `request.size`, `request.type`, `model.id`, `cache.hit`
- **Cache Spans**: `cache.type`, `cache.latency_ms`, `cache.hit`
- **AI Spans**: `ai.model`, `ai.provider`, `ai.prompt_tokens`, `ai.completion_tokens`, `ai.latency_ms`
- **Error Spans**: `error.type`, `error.message`, `error.stack`

### Custom Metrics

Access the telemetry manager to record custom metrics:

```typescript
// Record custom cache metrics
copilot.telemetry?.recordCacheMetrics(
  true,           // hit
  'memory',       // cache type
  15              // latency in ms
);

// Record AI metrics
copilot.telemetry?.recordAIMetrics(
  model,          // model name
  provider,       // provider name
  promptTokens,   // input tokens
  completionTokens, // output tokens
  latencyMs,      // response time
  streaming       // streaming enabled
);

// Record circuit breaker state
copilot.telemetry?.recordCircuitBreakerState('open');
```

## Platform Integrations

### Grafana Cloud

```typescript
const copilot = new CopilotEdge({
  telemetry: {
    enabled: true,
    endpoint: 'https://otlp-gateway-prod-us-central-0.grafana.net/otlp/v1/traces',
    headers: {
      'Authorization': `Basic ${Buffer.from(
        `${GRAFANA_INSTANCE_ID}:${GRAFANA_API_TOKEN}`
      ).toString('base64')}`
    },
    serviceName: 'copilotedge',
    environment: 'production',
    samplingRate: 0.1
  }
});
```

### Datadog

```typescript
const copilot = new CopilotEdge({
  telemetry: {
    enabled: true,
    endpoint: 'https://ingest.datadoghq.com/v1/traces',
    headers: {
      'DD-API-KEY': process.env.DD_API_KEY
    },
    serviceName: 'copilotedge',
    environment: process.env.DD_ENV,
    attributes: {
      'dd.trace.sample_rate': '0.1'
    }
  }
});
```

### New Relic

```typescript
const copilot = new CopilotEdge({
  telemetry: {
    enabled: true,
    endpoint: 'https://otlp.nr-data.net:4318/v1/traces',
    headers: {
      'api-key': process.env.NEW_RELIC_LICENSE_KEY
    },
    serviceName: 'copilotedge',
    environment: 'production'
  }
});
```

### Jaeger (Local Development)

1. Start Jaeger:
```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

2. Configure CopilotEdge:
```typescript
const copilot = new CopilotEdge({
  telemetry: {
    enabled: true,
    endpoint: 'http://localhost:4318/v1/traces',
    serviceName: 'copilotedge-dev',
    exporters: {
      otlp: true,
      console: true // Also log to console
    }
  }
});
```

3. View traces at: http://localhost:16686

## Security Considerations

### ⚠️ IMPORTANT SECURITY WARNINGS

#### 1. **HTTPS Required for Production**

```typescript
// ❌ INSECURE - Never use HTTP in production
telemetry: {
  endpoint: 'http://collector.example.com/v1/traces' // DANGER!
}

// ✅ SECURE - Always use HTTPS
telemetry: {
  endpoint: 'https://collector.example.com/v1/traces'
}

// ✅ OK for local development only
telemetry: {
  endpoint: 'http://localhost:4318/v1/traces' // Local only
}
```

**Note**: CopilotEdge v0.7.0+ automatically enforces HTTPS for non-localhost endpoints.

#### 2. **Protect Authentication Headers**

```typescript
// ❌ INSECURE - Never hardcode credentials
telemetry: {
  headers: {
    'Authorization': 'Bearer sk-abc123xyz' // NEVER DO THIS!
  }
}

// ✅ SECURE - Use environment variables
telemetry: {
  headers: {
    'Authorization': `Bearer ${process.env.TELEMETRY_API_KEY}`
  }
}
```

#### 3. **PII Protection**

CopilotEdge automatically:
- **Sanitizes URLs** - Query parameters are removed from telemetry spans
- **Hashes model names** - Infrastructure details are obfuscated
- **Limits message logging** - User messages are never included in spans
- **Scrubs sensitive patterns** - SSNs, cards, emails are auto-redacted

#### 4. **Data Minimization**

```typescript
// ✅ RECOMMENDED - Minimal attributes
telemetry: {
  attributes: {
    'service.version': '1.0.0',
    'deployment.environment': 'production'
    // Do NOT include: user IDs, emails, IPs, etc.
  }
}
```

#### 5. **Sampling for Privacy**

```typescript
// Production configuration with sampling
telemetry: {
  enabled: true,
  samplingRate: 0.01, // Only 1% of requests are traced
  exporters: {
    otlp: true,
    console: false // Never log to console in production
  }
}
```

#### 6. **Secure Storage**

- Store telemetry data in encrypted storage
- Implement data retention policies (e.g., 30-day deletion)
- Ensure GDPR/CCPA compliance for user data
- Use role-based access control for telemetry dashboards

#### 7. **Base64 is NOT Encryption**

```typescript
// ⚠️ WARNING - Base64 is encoding, not encryption
const encoded = Buffer.from('secret').toString('base64');
// Anyone can decode: Buffer.from(encoded, 'base64').toString()

// ✅ Use proper authentication methods
headers: {
  'Authorization': `Bearer ${process.env.SECURE_TOKEN}`
}
```

## Best Practices

### 1. Sampling Strategy

Balance observability with cost:

```typescript
const samplingRate = {
  production: 0.01,    // 1% for high-volume production
  staging: 0.1,        // 10% for staging
  development: 1.0     // 100% for development
}[environment];
```

### 2. Attribute Management

Add contextual information without PII:

```typescript
attributes: {
  'deployment.region': process.env.AWS_REGION,
  'deployment.version': process.env.GIT_SHA,
  'feature.flags': process.env.FEATURE_FLAGS,
  // Never include: API keys, user emails, passwords, etc.
}
```

### 3. Error Handling

Telemetry failures should not affect your application:

```typescript
telemetry: {
  enabled: true,
  endpoint: process.env.OTEL_ENDPOINT,
  // Graceful degradation is built-in
  // If telemetry fails, requests continue normally
}
```

### 4. Performance Optimization

- **Use sampling**: Don't trace every request in production
- **Batch exports**: Default 10-second batching reduces overhead
- **Async processing**: Telemetry export doesn't block requests
- **Disable in tests**: Set `enabled: false` for unit tests

### 5. Cloudflare Workers Considerations

```typescript
export default {
  async fetch(request: Request, env: any, ctx: any) {
    const copilot = new CopilotEdge({
      telemetry: {
        enabled: true,
        endpoint: env.OTEL_ENDPOINT,
        // Lower sampling for Workers edge locations
        samplingRate: 0.001, // 0.1%
        attributes: {
          'cf.colo': request.cf?.colo,
          'cf.country': request.cf?.country
        }
      }
    });
    
    // Use ctx.waitUntil for telemetry export
    ctx.waitUntil(copilot.telemetry?.shutdown());
    
    return copilot.createNextHandler()(request);
  }
};
```

## Troubleshooting

### Debug Mode

Enable debug logging to troubleshoot telemetry issues:

```typescript
telemetry: {
  enabled: true,
  debug: true, // Enables OpenTelemetry debug logging
  exporters: {
    console: true // See spans in console
  }
}
```

### Common Issues

#### 1. No traces appearing

- Verify `enabled: true` in configuration
- Check endpoint URL is correct
- Verify authentication headers
- Check sampling rate (might be too low)
- Enable debug mode to see errors

#### 2. High latency

- Reduce sampling rate
- Increase export interval
- Use batch processing (enabled by default)
- Consider regional endpoints

#### 3. Memory usage

- Lower sampling rate in production
- Reduce attribute cardinality
- Increase export interval
- Monitor span creation rate

### Metrics Dashboard

Create these key metrics in your observability platform:

```yaml
# Request Rate
rate(copilotedge_requests_total[5m])

# Error Rate
rate(copilotedge_requests_error[5m]) / rate(copilotedge_requests_total[5m])

# P99 Latency
histogram_quantile(0.99, copilotedge_request_duration)

# Cache Hit Rate
rate(copilotedge_cache_hits[5m]) / 
  (rate(copilotedge_cache_hits[5m]) + rate(copilotedge_cache_misses[5m]))

# Token Usage
sum(rate(copilotedge_tokens_total[5m])) by (model)

# Circuit Breaker State
copilotedge_circuit_breaker_state
```

## API Reference

### TelemetryManager Methods

```typescript
class TelemetryManager {
  // Check if telemetry is enabled
  isEnabled(): boolean;
  
  // Create a span
  startSpan(name: string, options?: SpanOptions): Span | null;
  
  // End a span
  endSpan(name: string, error?: Error): void;
  
  // Execute function within span context
  withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: SpanOptions
  ): Promise<T>;
  
  // Record metrics
  recordCacheMetrics(hit: boolean, type: string, latencyMs: number): void;
  recordAIMetrics(model: string, ...): void;
  recordCircuitBreakerState(state: string): void;
  
  // Shutdown telemetry
  shutdown(): Promise<void>;
}
```

## Migration Guide

### From v0.6.0 to v0.7.0

No breaking changes. Telemetry is opt-in:

```typescript
// v0.6.0 (still works)
const copilot = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct'
});

// v0.7.0 (with telemetry)
const copilot = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  telemetry: {
    enabled: true,
    serviceName: 'my-service'
  }
});
```

## Performance Impact

- **When disabled**: Zero overhead
- **When enabled**: 
  - ~2-5ms per request for span creation
  - ~0.1-0.5KB additional memory per request
  - Network overhead depends on export interval (default 10s batch)
- **With sampling**: Linear reduction (10% sampling = 10% of overhead)

## Security Considerations

1. **Never log sensitive data** in spans or attributes
2. **Use secure endpoints** (HTTPS) for telemetry export
3. **Rotate API keys** for telemetry collectors regularly
4. **Implement PII scrubbing** in custom exporters
5. **Review attributes** before production deployment

## Support

For issues or questions about telemetry:

1. Check debug logs: `telemetry: { debug: true }`
2. Review this documentation
3. Check [examples/telemetry-example.ts](../examples/telemetry-example.ts)
4. Open an issue on [GitHub](https://github.com/Klammertime/copilotedge/issues)

## Next Steps

- Set up dashboards in your observability platform
- Configure alerts for error rates and latency
- Implement custom attributes for your use case
- Consider distributed tracing across services
- Monitor cost optimization through cache hit rates