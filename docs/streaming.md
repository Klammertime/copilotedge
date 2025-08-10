# Streaming Support

Current status and workarounds for streaming responses.

## Current Status

**⚠️ Streaming is NOT currently supported in CopilotEdge**

All responses are returned as complete messages after processing is finished.

## Why No Streaming?

### Technical Limitations

1. **Caching Incompatibility**
   - Streaming responses can't be cached effectively
   - Each stream is unique, defeating cache benefits
   - Partial responses can't be validated for cache keys

2. **CopilotKit Protocol**
   - CopilotKit's streaming protocol requires specific adaptations
   - GraphQL subscriptions need WebSocket support
   - Response chunking must match CopilotKit's expectations

3. **Cloudflare Workers AI Constraints**
   - Streaming implementation requires specific patterns
   - Edge runtime limitations on long-lived connections
   - Response buffering complexities

## Impact on User Experience

Without streaming:
- ❌ No real-time token generation display
- ❌ No progressive response rendering
- ❌ Longer perceived wait times for responses
- ✅ But: Responses can be cached
- ✅ But: Simpler error handling
- ✅ But: More predictable performance

## Workarounds

### 1. Client-Side Typing Animation

Simulate streaming with a typing effect:

```typescript
// React component example
function TypewriterText({ text, speed = 30 }) {
  const [displayText, setDisplayText] = useState('');
  
  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      if (index < text.length) {
        setDisplayText(text.substring(0, index + 1));
        index++;
      } else {
        clearInterval(timer);
      }
    }, speed);
    
    return () => clearInterval(timer);
  }, [text, speed]);
  
  return <div>{displayText}</div>;
}

// Usage
const response = await fetch('/api/copilotedge', { /* ... */ });
const data = await response.json();
<TypewriterText text={data.message} />
```

### 2. Loading States

Provide feedback during processing:

```typescript
function ChatInterface() {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  
  const handleSubmit = async (message) => {
    setLoading(true);
    setResponse('');
    
    try {
      const res = await fetch('/api/copilotedge', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: message }] })
      });
      const data = await res.json();
      setResponse(data.choices[0].message.content);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div>
      {loading && (
        <div className="loading">
          <span>Thinking...</span>
          <div className="spinner" />
        </div>
      )}
      {response && <TypewriterText text={response} />}
    </div>
  );
}
```

### 3. Progressive Disclosure

Break long responses into chunks:

```typescript
function ChunkedResponse({ text, chunkSize = 100 }) {
  const [visibleChunks, setVisibleChunks] = useState(1);
  const chunks = text.match(new RegExp(`.{1,${chunkSize}}`, 'g')) || [];
  
  useEffect(() => {
    if (visibleChunks < chunks.length) {
      const timer = setTimeout(() => {
        setVisibleChunks(v => v + 1);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [visibleChunks, chunks.length]);
  
  return (
    <div>
      {chunks.slice(0, visibleChunks).map((chunk, i) => (
        <span key={i} className="fade-in">{chunk}</span>
      ))}
    </div>
  );
}
```

### 4. Optimistic UI Updates

Show predicted content while waiting:

```typescript
function OptimisticChat() {
  const [messages, setMessages] = useState([]);
  
  const sendMessage = async (content) => {
    // Add user message immediately
    const userMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);
    
    // Add placeholder for assistant
    const placeholder = { 
      role: 'assistant', 
      content: '...', 
      loading: true 
    };
    setMessages(prev => [...prev, placeholder]);
    
    // Fetch actual response
    const response = await fetch('/api/copilotedge', {
      method: 'POST',
      body: JSON.stringify({ messages: [...messages, userMessage] })
    });
    const data = await response.json();
    
    // Replace placeholder with actual response
    setMessages(prev => 
      prev.map((msg, i) => 
        i === prev.length - 1 
          ? { role: 'assistant', content: data.choices[0].message.content }
          : msg
      )
    );
  };
  
  return <ChatUI messages={messages} onSend={sendMessage} />;
}
```

## Alternative Approaches

### 1. Use Smaller Models

Faster models reduce wait time:

```typescript
const handler = createCopilotEdgeHandler({
  model: '@cf/openai/gpt-oss-20b'  // Faster than 120b
});
```

### 2. Implement Response Caching

Cache common responses to appear instant:

```typescript
const responseCache = new Map();

async function cachedFetch(message) {
  const cacheKey = message.toLowerCase().trim();
  
  // Check local cache first
  if (responseCache.has(cacheKey)) {
    return responseCache.get(cacheKey);
  }
  
  // Fetch from API
  const response = await fetch('/api/copilotedge', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: message }] })
  });
  const data = await response.json();
  
  // Cache for common queries
  if (isCommonQuery(message)) {
    responseCache.set(cacheKey, data);
  }
  
  return data;
}
```

### 3. Parallel Processing

For multi-part responses:

```typescript
async function parallelQueries(queries) {
  const promises = queries.map(query =>
    fetch('/api/copilotedge', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: query }] })
    }).then(r => r.json())
  );
  
  return Promise.all(promises);
}

// Usage
const [summary, details, examples] = await parallelQueries([
  'Summarize this topic',
  'Provide detailed explanation',
  'Give me 3 examples'
]);
```

## Future Plans

### Tracking Streaming Support

Follow the progress:
- GitHub Issue: [#streaming-support](https://github.com/Klammertime/copilotedge/issues)

### Potential Implementation

When implemented, streaming might look like:

```typescript
// Future API (not yet available)
const handler = createCopilotEdgeHandler({
  streaming: true,  // Enable streaming
  cacheTimeout: 0   // Disable caching for streams
});

// Client-side consumption
const response = await fetch('/api/copilotedge', {
  method: 'POST',
  body: JSON.stringify({ messages, stream: true })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  console.log('Received chunk:', chunk);
}
```

## Recommendations

1. **Set expectations** - Tell users responses are not streamed
2. **Use loading indicators** - Show progress during processing
3. **Implement typing animations** - Simulate streaming on client
4. **Cache aggressively** - Make subsequent requests instant
5. **Choose fast models** - Reduce actual processing time
6. **Consider alternatives** - If streaming is critical, consider other solutions

## Feature Flag Routing

Route based on content characteristics:

```typescript
const useStreaming = prompt.length > 600 || expectedTokens > 150;
const url = useStreaming ? "/api/stream" : "/api/copilotedge";
```

## When You Need Real Streaming

If streaming is absolutely required for your use case:

1. **Direct Cloudflare Workers AI** - Implement streaming directly without CopilotKit
2. **OpenAI API** - Use OpenAI with streaming support
3. **Vercel AI SDK** - Has built-in streaming capabilities

## Performance Without Streaming

Despite no streaming, CopilotEdge can still feel responsive:

- **Cached responses**: 8-15ms
- **Warm requests**: 120-200ms  
- **Cold starts**: 300-500ms

With proper UI feedback, users won't notice the lack of streaming for most use cases.