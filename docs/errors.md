# Error Handling

Comprehensive guide to error types, status codes, and recovery strategies.

## Error Types

CopilotEdge uses two main error classes:

```typescript
import { ValidationError, APIError } from 'copilotedge';
```

## Error Mapping

| Error Type | Status Code | Description | Retry? |
|------------|-------------|-------------|--------|
| `ValidationError` | 400 | Invalid request format, missing fields | ❌ No |
| `APIError` (auth) | 401 | Invalid API token | ❌ No |
| `APIError` (forbidden) | 403 | Account restrictions, quota exceeded | ❌ No |
| `APIError` (not found) | 404 | Invalid endpoint or model | ❌ No |
| `APIError` (rate limit) | 429 | Too many requests | ✅ Yes (with backoff) |
| `APIError` (server) | 500 | Cloudflare service error | ✅ Yes |
| `APIError` (bad gateway) | 502 | Upstream service error | ✅ Yes |
| `APIError` (unavailable) | 503 | Service temporarily unavailable | ✅ Yes |
| `APIError` (timeout) | 504 | Request timeout | ✅ Yes |
| Network timeout | - | Request exceeded 30s | ✅ Yes |

## Error Response Format

All errors return a consistent JSON structure:

```json
{
  "error": "Detailed error message describing the issue",
  "type": "ValidationError | APIError"
}
```

## Handling Errors

### Basic Error Handling

```typescript
try {
  const response = await edge.handleRequest(body);
  return response;
} catch (error) {
  if (error instanceof ValidationError) {
    // Client error - fix the request
    console.error('Invalid request:', error.message);
    return new Response(JSON.stringify({
      error: error.message,
      type: 'ValidationError'
    }), { status: 400 });
  } 
  
  if (error instanceof APIError) {
    // API error - check status code
    console.error(`API error ${error.statusCode}:`, error.message);
    return new Response(JSON.stringify({
      error: error.message,
      type: 'APIError'
    }), { status: error.statusCode });
  }
  
  // Unknown error
  console.error('Unexpected error:', error);
  return new Response('Internal Server Error', { status: 500 });
}
```

### Advanced Retry Logic

```typescript
async function handleWithRetry(body, maxAttempts = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await edge.handleRequest(body);
    } catch (error) {
      lastError = error;
      
      // Don't retry client errors
      if (error instanceof ValidationError) {
        throw error;
      }
      
      // Don't retry 4xx errors (except 429)
      if (error instanceof APIError) {
        if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
          throw error;
        }
      }
      
      // Calculate backoff
      if (attempt < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        const jitter = Math.random() * 500;
        console.log(`Retry ${attempt}/${maxAttempts} after ${delay + jitter}ms`);
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
      }
    }
  }
  
  throw lastError;
}
```

## Common Failure Scenarios

### 1. Rate Limiting (429)

**Symptom**: `Rate limit exceeded (60 req/min)`

**Cause**: Too many requests in a short period

**Solution**:
```typescript
// Option 1: Increase rate limit
const handler = createCopilotEdgeHandler({
  rateLimit: 120  // Allow more requests
});

// Option 2: Implement client-side throttling
const queue = [];
const processQueue = async () => {
  if (queue.length > 0) {
    const task = queue.shift();
    await task();
    setTimeout(processQueue, 1000); // 1 request per second
  }
};

// Option 3: Implement exponential backoff
async function withBackoff(fn) {
  let delay = 1000;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (error.statusCode === 429) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else {
        throw error;
      }
    }
  }
}
```

### 2. Invalid Model (404)

**Symptom**: `Model not found: @cf/invalid/model`

**Cause**: Specified model doesn't exist or was deprecated

**Solution**:
```typescript
// Use a valid model from the supported list
const handler = createCopilotEdgeHandler({
  model: '@cf/meta/llama-3.1-8b-instruct'  // Known good model
});

// Implement fallback
const models = [
  '@cf/preferred/model',
  '@cf/meta/llama-3.1-8b-instruct'  // Fallback
];

for (const model of models) {
  try {
    const handler = createCopilotEdgeHandler({ model });
    return await handler(request);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
}
```

### 3. Authentication Failed (401)

**Symptom**: `Invalid API token`

**Cause**: Missing or incorrect Cloudflare API token

**Solution**:
```bash
# Verify your token
curl https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer YOUR_TOKEN"

# Set correct environment variable
export CLOUDFLARE_API_TOKEN="your-valid-token"
```

### 4. Request Timeout

**Symptom**: Request hangs or times out after 30 seconds

**Cause**: Complex prompt, network issues, or service degradation

**Solution**:
```typescript
// Simplify prompts
const messages = [
  { role: 'user', content: shortPrompt.slice(0, 1000) }  // Limit length
];

// Implement custom timeout
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20000); // 20s

try {
  const response = await fetch(url, {
    signal: controller.signal,
    // ...
  });
} finally {
  clearTimeout(timeout);
}
```

### 5. Cache Expired

**Symptom**: Previously fast responses become slow

**Cause**: Cache entry expired after TTL

**Solution**:
```typescript
// Increase cache timeout for stable content
const handler = createCopilotEdgeHandler({
  cacheTimeout: 300000  // 5 minutes
});

// Or implement pre-warming
async function prewarmCache() {
  const commonRequests = [
    { messages: [{ role: 'user', content: 'Hello' }] },
    // ... other common requests
  ];
  
  for (const request of commonRequests) {
    await edge.handleRequest(request);
  }
}

// Run periodically
setInterval(prewarmCache, 60000);
```

### 6. Invalid Request Format

**Symptom**: `ValidationError: messages must be an array`

**Cause**: Incorrect request structure

**Solution**:
```typescript
// Correct format for direct chat
const validRequest = {
  messages: [
    { role: 'user', content: 'Hello' }
  ]
};

// Correct format for CopilotKit GraphQL
const validGraphQL = {
  operationName: 'generateCopilotResponse',
  variables: {
    data: {
      messages: [
        {
          textMessage: {
            role: 'user',
            content: 'Hello'
          }
        }
      ],
      threadId: 'thread-123'
    }
  }
};
```

## Error Monitoring

### Log Errors for Analysis

```typescript
const handler = createCopilotEdgeHandler({
  debug: true  // Enable detailed logging
});

// Custom error logger
function logError(error, context) {
  console.error({
    timestamp: new Date().toISOString(),
    type: error.constructor.name,
    message: error.message,
    statusCode: error.statusCode,
    context
  });
  
  // Send to monitoring service
  // sendToSentry(error, context);
}
```

### Track Error Metrics

```typescript
const errorCounts = new Map();

function trackError(error) {
  const key = `${error.constructor.name}-${error.statusCode || 'unknown'}`;
  errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
}

// Periodic reporting
setInterval(() => {
  console.log('Error summary:', Object.fromEntries(errorCounts));
  errorCounts.clear();
}, 60000);
```

## Best Practices

1. **Always handle both error types** - `ValidationError` and `APIError`
2. **Implement retry logic** for transient failures (5xx, 429)
3. **Log errors with context** for debugging
4. **Set appropriate timeouts** to fail fast
5. **Use fallback models** for resilience
6. **Monitor error rates** to detect issues early
7. **Validate input early** to avoid unnecessary API calls