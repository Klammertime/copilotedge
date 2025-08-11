# Streaming Support

Complete documentation for CopilotEdge's real-time streaming functionality.

---

## ✅ Current Status: Full Streaming Support (v0.4.0+)

**CopilotEdge now supports real-time streaming responses!**

Starting with version 0.4.0, CopilotEdge delivers AI-generated content in real-time using Server-Sent Events (SSE), providing immediate feedback to users as content is generated.

## Quick Start

### Basic Streaming Setup
```typescript
import { CopilotEdge } from 'copilotedge';

const edge = new CopilotEdge({
  apiKey: 'your-cloudflare-api-key',
  accountId: 'your-account-id',
  stream: true, // Enable streaming
  onChunk: (chunk) => {
    console.log('Received chunk:', chunk);
  }
});
```

### With Next.js API Route
```typescript
// app/api/copilot/route.ts
import { createCopilotEdgeHandler } from 'copilotedge';

export const runtime = 'edge'; // Use edge runtime for best performance

const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  stream: true // Enable streaming by default
});

export const POST = handler;
```

## Features

### Streaming Capabilities
- **Real-time delivery**: Content streams as it's generated (~200ms to first token)
- **Memory efficient**: Uses async generators to process chunks incrementally
- **Flexible configuration**: Enable per-instance or per-request
- **Backward compatible**: Non-streaming mode remains the default
- **Progress tracking**: Optional `onChunk` callback for monitoring
- **SSE format**: Standard Server-Sent Events for compatibility
- **Full Next.js support**: Automatic SSE response handling

## Configuration Options

### Instance-Level Streaming
```typescript
const edge = new CopilotEdge({
  stream: true, // Enable streaming for all requests
  onChunk: async (chunk) => {
    // Process each chunk as it arrives
    await processChunk(chunk);
  }
});
```

### Per-Request Streaming
```typescript
// Override instance configuration per request
const response = await edge.handleRequest({
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true // Enable streaming just for this request
});
```

## The Intelligent Caching + Streaming Balance

CopilotEdge offers the best of both worlds:

### When Caching Is Used (Default)
- **Repeated queries**: Instant responses from cache (0ms latency)
- **Cost savings**: Up to 90% reduction in API calls
- **Best for**: FAQs, common queries, static content

### When Streaming Is Used
- **Unique queries**: Real-time generation with immediate feedback
- **Long responses**: Progressive rendering without memory bloat
- **Best for**: Creative content, conversations, dynamic interactions

### Smart Behavior
```typescript
// Use cache for common queries
const cachedResponse = await edge.handleRequest({
  messages: [{ role: 'user', content: 'What is JavaScript?' }],
  stream: false // Use cache if available
});

// Stream for unique, creative content
const streamedResponse = await edge.handleRequest({
  messages: [{ role: 'user', content: 'Write me a unique story' }],
  stream: true // Always stream for fresh content
});
```

## Client-Side Consumption

### Using Fetch with Streaming
```typescript
async function streamChat(messages: Message[]) {
  const response = await fetch('/api/copilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      messages,
      stream: true
    })
  });

  if (!response.body) return;
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') break;
        
        const parsed = JSON.parse(data);
        const content = parsed.choices[0]?.delta?.content;
        if (content) {
          // Update UI with new content
          console.log(content);
        }
      }
    }
  }
}
```

### With React and CopilotKit
```typescript
import { CopilotProvider } from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';

function App() {
  return (
    <CopilotProvider
      publicApiKey="your-key"
      backendUrl="/api/copilot" // Your streaming endpoint
    >
      <CopilotChat 
        // Streaming is handled automatically
      />
    </CopilotProvider>
  );
}
```

## Response Formats

### Streaming Response Structure
When streaming is enabled, the response includes:
```typescript
{
  id: string,
  object: 'chat.completion.chunk',
  created: number,
  model: string,
  streaming: true,
  stream: AsyncGenerator<string>, // Async generator of content chunks
  getFullResponse: () => Promise<string> // Get complete response
}
```

### SSE Format
Chunks are sent as Server-Sent Events:
```
data: {"id":"chat-123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}

data: {"id":"chat-123","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"}}]}

data: [DONE]
```

## Advanced Usage

### Custom Stream Processing
```typescript
const edge = new CopilotEdge({
  stream: true,
  onChunk: async (chunk) => {
    // Custom processing for each chunk
    await saveToBuffer(chunk);
    await updateProgressBar(chunk.length);
    await broadcastToWebSocket(chunk);
  }
});

const response = await edge.handleRequest({
  messages: [{ role: 'user', content: 'Generate a story' }]
});

// Option 1: Consume the stream
for await (const chunk of response.stream) {
  process.stdout.write(chunk);
}

// Option 2: Get complete response
const fullText = await response.getFullResponse();
console.log('Complete response:', fullText);
```

### Error Handling
```typescript
try {
  const response = await edge.handleRequest({
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true
  });
  
  for await (const chunk of response.stream) {
    // Process chunks
  }
} catch (error) {
  if (error.name === 'APIError') {
    console.error('Cloudflare API error:', error.message);
  } else {
    console.error('Streaming error:', error);
  }
}
```

## Performance Comparison

| Mode | First Token | Complete Response | Memory Usage | Best For |
|------|------------|-------------------|--------------|----------|
| **Streaming** | ~200ms | Progressive | Low (incremental) | Unique content, long responses |
| **Cached** | 0ms | 0ms | Low (pre-computed) | Repeated queries, FAQs |
| **Non-cached** | 2-5s | 2-5s | High (full buffer) | One-time queries |

## Supported Models

All Cloudflare chat models support streaming:
- `@cf/meta/llama-3.1-8b-instruct` ✅
- `@cf/meta/llama-3.1-70b` ✅
- `@cf/mistral/mistral-7b-instruct` ✅
- `@cf/google/gemma-7b-it` ✅
- `@cf/openai/gpt-oss-120b` ✅
- `@cf/openai/gpt-oss-20b` ✅

## Migration Guide

### From v0.3.0 (No Streaming) to v0.4.0 (With Streaming)

No changes required! Your existing code continues to work:

```typescript
// This still works exactly the same (non-streaming, with caching)
const edge = new CopilotEdge({
  apiKey: 'key',
  accountId: 'account'
});
```

To enable streaming:

```typescript
// Option 1: Enable globally
const edge = new CopilotEdge({
  apiKey: 'key',
  accountId: 'account',
  stream: true // Add this line
});

// Option 2: Enable per-request
const response = await edge.handleRequest({
  messages: [...],
  stream: true // Or add here
});
```

## Best Practices

1. **Enable streaming for interactive use cases**
   - Chat interfaces
   - Real-time content generation
   - Progress feedback

2. **Use callbacks for side effects**
   ```typescript
   onChunk: async (chunk) => {
     await analytics.track('chunk_received', { size: chunk.length });
   }
   ```

3. **Handle connection interruptions**
   ```typescript
   const controller = new AbortController();
   setTimeout(() => controller.abort(), 30000); // 30s timeout
   
   fetch('/api/copilot', { 
     signal: controller.signal,
     // ...
   });
   ```

4. **Buffer management for UI updates**
   ```typescript
   let buffer = '';
   for await (const chunk of response.stream) {
     buffer += chunk;
     if (buffer.includes('\n') || buffer.length > 100) {
       updateUI(buffer);
       buffer = '';
     }
   }
   ```

## Technical Details

### Streaming Implementation
- Uses Cloudflare's SSE format for real-time delivery
- Async generators for memory-efficient processing
- Automatic chunk parsing and accumulation
- Error recovery and retry logic
- New `callCloudflareAIStreaming()` method
- Enhanced `createNextHandler()` for SSE responses

### Caching Strategy
- Non-streaming responses are cached for 60 seconds (configurable)
- Cache key based on request hash
- LRU eviction when cache is full
- Streaming responses can populate cache with complete content

## Troubleshooting

### Common Issues

1. **Stream not working**: Ensure `stream: true` is set
2. **Chunks not arriving**: Check network/firewall for SSE support
3. **Memory issues**: Use async iteration, not array accumulation
4. **Type errors**: Update to latest CopilotEdge version

### Debug Mode
```typescript
const edge = new CopilotEdge({
  debug: true, // Enable debug logging
  stream: true,
  onChunk: (chunk) => {
    console.log('[DEBUG] Chunk received:', chunk.length, 'bytes');
  }
});
```

## API Reference

### CopilotEdgeConfig
```typescript
interface CopilotEdgeConfig {
  // ... existing config ...
  
  /** Enable streaming responses (default: false) */
  stream?: boolean;
  
  /** Callback for each streaming chunk */
  onChunk?: (chunk: string) => void | Promise<void>;
}
```

### StreamingResponse
```typescript
interface StreamingResponse {
  stream: AsyncGenerator<string, void, unknown>;
  getFullResponse: () => Promise<string>;
}
```

## Future Enhancements

- **WebSocket support**: Bidirectional streaming
- **Compression**: Reduce bandwidth for streams
- **Parallel streams**: Handle multiple concurrent streams
- **Partial caching**: Cache common prefixes of streamed responses

## Summary

CopilotEdge v0.4.0 delivers a sophisticated streaming + caching solution:
- **Stream when you need real-time feedback**
- **Cache when you need instant responses**
- **Configure flexibly based on your use case**
- **Maintain backward compatibility**

For implementation details, see [streaming-implementation-plan.md](./streaming-implementation-plan.md).