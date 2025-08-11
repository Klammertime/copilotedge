# Streaming Support Implementation Plan

## Overview
This document outlines the plan for implementing streaming support in CopilotEdge using Cloudflare's streaming APIs.

## Current State
- ✅ All tests are passing with proper Cloudflare API mocking
- ✅ Tests cover both `/ai/v1/chat/completions` and `/ai/run/{model}` endpoints
- ✅ Streaming test infrastructure is in place

## Streaming Implementation Steps

### Phase 1: Core Streaming Support
1. **Add streaming parameter to config**
   ```typescript
   interface CopilotEdgeConfig {
     stream?: boolean; // Enable streaming responses
     onChunk?: (chunk: string) => void; // Callback for each chunk
   }
   ```

2. **Modify `callCloudflareAI` method**
   - Add `stream: true` to request body when streaming is enabled
   - Handle `text/event-stream` responses
   - Parse Server-Sent Events (SSE) format

3. **Implement SSE parser**
   ```typescript
   class SSEParser {
     parse(chunk: string): { type: 'data' | 'done', content?: any }
     accumulate(chunks: string[]): string
   }
   ```

### Phase 2: Response Handling
1. **Create streaming response handler**
   - Process ReadableStream from Cloudflare
   - Handle delta chunks (`choices[0].delta.content`)
   - Accumulate chunks into complete response
   - Emit chunks via callback or async generator

2. **Update `handleRequest` method**
   - Detect streaming mode
   - Return streaming response or accumulated response
   - Maintain backward compatibility

### Phase 3: Integration with CopilotKit
1. **Support CopilotKit's streaming format**
   - Transform Cloudflare SSE to CopilotKit's expected format
   - Handle GraphQL subscription-like responses

2. **Add streaming to Next.js handler**
   - Use Next.js streaming response capabilities
   - Implement proper headers for SSE

## Implementation Example

```typescript
// Example streaming implementation
async* streamCloudflareAI(messages: Message[]): AsyncGenerator<string> {
  const response = await this.fetch(endpoint, {
    method: 'POST',
    headers: { /* ... */ },
    body: JSON.stringify({
      model: this.model,
      messages,
      stream: true // Enable streaming
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        
        const parsed = JSON.parse(data);
        const content = parsed.choices[0]?.delta?.content;
        if (content) yield content;
      }
    }
  }
}
```

## Benefits
- **Real-time responses**: Users see output as it's generated
- **Better UX**: No waiting for complete response
- **Lower perceived latency**: First token arrives faster
- **Memory efficient**: No need to buffer entire response

## Testing Strategy
- ✅ Mock streaming responses in tests
- ✅ Test SSE parsing
- ✅ Test chunk accumulation
- ✅ Test error handling in streams
- Test with real Cloudflare API (integration tests)
- Test CopilotKit integration

## Next Steps for Cloudflare Services Integration

### Workers KV Integration
- Use for persistent caching across edge locations
- Store user preferences and session data
- Implement distributed rate limiting

### Durable Objects
- Maintain WebSocket connections for real-time streaming
- Store conversation state
- Implement user-specific rate limiting

### Analytics Engine
- Track token usage per user/model
- Monitor response times and cache hit rates
- Generate usage reports

## Migration Path
1. Implement streaming as opt-in feature
2. Test thoroughly with subset of users
3. Enable by default once stable
4. Deprecate non-streaming mode eventually