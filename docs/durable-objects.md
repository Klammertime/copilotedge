# Durable Objects for Conversation Management

Complete guide to using Cloudflare Durable Objects with CopilotEdge for stateful conversation management and WebSocket support.

## Overview

Durable Objects provide:
- **Persistent conversation history** across sessions
- **WebSocket support** for real-time streaming
- **State management** for user contexts and preferences
- **Automatic cleanup** of inactive conversations

## Prerequisites

- Cloudflare Workers account with Durable Objects enabled
- CopilotEdge v0.6.0 or later (with DO support)
- Wrangler CLI for deployment

## Setup Steps

### 1. Update wrangler.toml

Add Durable Object bindings to your `wrangler.toml`:

```toml
name = "copilotedge-worker"
main = "src/index.ts"
compatibility_date = "2025-01-11"
compatibility_flags = ["nodejs_compat"]

# Durable Objects binding
[[durable_objects.bindings]]
name = "CONVERSATION_DO"
class_name = "ConversationDO"
script_name = "copilotedge-worker"

# Migration for Durable Objects
[[migrations]]
tag = "v1"
new_classes = ["ConversationDO"]

# Optional: KV for additional caching
[[kv_namespaces]]
binding = "COPILOT_CACHE"
id = "your-kv-namespace-id"
```

### 2. Create Worker with Durable Objects

```typescript
// src/index.ts
import { 
  createCopilotEdgeHandler, 
  ConversationDO,
  type DurableObjectNamespace 
} from 'copilotedge';

export interface Env {
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CONVERSATION_DO: DurableObjectNamespace;
  COPILOT_CACHE?: KVNamespace; // Optional KV
}

// Export the Durable Object class
export { ConversationDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const handler = createCopilotEdgeHandler({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      conversationDO: env.CONVERSATION_DO,
      enableConversations: true,
      defaultConversationId: 'default-session', // Optional
      kvNamespace: env.COPILOT_CACHE, // Optional KV
    });
    
    return handler(request);
  }
};
```

### 3. Deploy to Cloudflare

```bash
# Deploy with Durable Objects
wrangler deploy

# Verify deployment
wrangler tail
```

## Configuration Options

### conversationDO

The Durable Object namespace binding for conversation management.

```typescript
conversationDO: env.CONVERSATION_DO
```

### enableConversations

Enable persistent conversation management.

```typescript
enableConversations: true // Default: false
```

### defaultConversationId

Default conversation ID when not provided in requests.

```typescript
defaultConversationId: 'user-123' // Optional
```

## Using Conversations

### Basic Usage

Conversations are automatically managed when enabled:

```typescript
// Client request with conversation ID
const response = await fetch('/api/copilotedge', {
  method: 'POST',
  body: JSON.stringify({
    conversationId: 'user-session-123', // Optional
    messages: [
      { role: 'user', content: 'Hello!' }
    ]
  })
});
```

### WebSocket Connection

Connect via WebSocket for real-time streaming:

```typescript
// Client-side WebSocket connection
const ws = new WebSocket('wss://your-worker.workers.dev/conversation/user-123');

ws.onopen = () => {
  // Send chat message
  ws.send(JSON.stringify({
    type: 'chat',
    role: 'user',
    content: 'Hello via WebSocket!'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'chat':
      console.log('AI:', message.content);
      break;
    case 'status':
      console.log('Status:', message.status);
      break;
    case 'error':
      console.error('Error:', message.error);
      break;
  }
};
```

## Conversation Management

### Get Conversation History

```typescript
// HTTP endpoint
const history = await fetch('/conversation/user-123/messages');
const messages = await history.json();
```

### Clear Conversation

```typescript
// Clear conversation history
await fetch('/conversation/user-123/clear', {
  method: 'POST'
});
```

### Update Conversation State

```typescript
// Update conversation context
await fetch('/conversation/user-123/state', {
  method: 'PUT',
  body: JSON.stringify({
    userId: 'user-123',
    model: '@cf/openai/gpt-oss-120b',
    context: {
      temperature: 0.7,
      systemPrompt: 'You are a helpful assistant'
    }
  })
});
```

## WebSocket Message Types

### Chat Messages

```typescript
// User message
{
  type: 'chat',
  role: 'user',
  content: 'Your message here'
}

// Assistant response
{
  type: 'chat',
  role: 'assistant',
  content: 'AI response',
  metadata: {
    timestamp: 1234567890,
    tokens: 150
  }
}
```

### System Messages

```typescript
// Get history
{
  type: 'system',
  content: 'get_history'
}

// Clear history
{
  type: 'system',
  content: 'clear_history'
}
```

### Status Updates

```typescript
{
  type: 'status',
  status: 'thinking' | 'streaming' | 'complete'
}
```

## Advanced Features

### Session Persistence

Conversations automatically persist across:
- Worker restarts
- Deployments
- Different edge locations

```typescript
const handler = createCopilotEdgeHandler({
  conversationDO: env.CONVERSATION_DO,
  enableConversations: true,
  // Conversations persist automatically
});
```

### Automatic Cleanup

Inactive conversations are automatically cleaned up after 24 hours:

```typescript
// ConversationDO handles cleanup via alarms
// No manual intervention needed
```

### Multi-User Support

Each user gets their own conversation:

```typescript
// Use unique IDs per user
const conversationId = `user-${userId}-session-${sessionId}`;

const response = await fetch('/api/copilotedge', {
  body: JSON.stringify({
    conversationId,
    messages: [...]
  })
});
```

## Performance Considerations

### Memory Usage

- Each active conversation uses ~1-10KB
- History limited to prevent excessive memory use
- Automatic eviction of old messages

### Latency

- First request: ~50-100ms (DO initialization)
- Subsequent requests: ~5-10ms (DO warm)
- WebSocket: <5ms per message

### Cost

- **Durable Objects**: $0.15/million requests + storage
- **WebSocket**: Included in DO pricing
- **Storage**: $0.20/GB-month

## Best Practices

### 1. Use Meaningful IDs

```typescript
// Good: Identifies user and session
conversationId: `user-${userId}-chat-${Date.now()}`

// Bad: Random or unclear
conversationId: 'abc123'
```

### 2. Handle Connection Errors

```typescript
ws.onerror = (error) => {
  console.error('WebSocket error:', error);
  // Implement reconnection logic
};

ws.onclose = () => {
  // Reconnect after delay
  setTimeout(reconnect, 1000);
};
```

### 3. Limit Message Size

```typescript
// Validate message size before sending
if (message.length > 10000) {
  throw new Error('Message too large');
}
```

### 4. Implement Rate Limiting

```typescript
// Track messages per minute
const messageCount = await getMessageCount(userId);
if (messageCount > 60) {
  return new Response('Rate limit exceeded', { status: 429 });
}
```

## Troubleshooting

### Conversation Not Persisting

**Check**:
1. `enableConversations: true` is set
2. `conversationDO` binding is correct
3. Migration has been applied

### WebSocket Connection Fails

**Check**:
1. WebSocket URL is correct
2. Durable Object is deployed
3. Headers include `Upgrade: websocket`

### High Latency

**Optimize**:
1. Reduce conversation history size
2. Use regional hints for DO placement
3. Enable KV caching for repeated queries

## Example: Chat Application

```typescript
// Complete example with UI
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Serve chat UI
    if (url.pathname === '/') {
      return new Response(chatHTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const conversationId = url.pathname.slice(1);
      const doId = env.CONVERSATION_DO.idFromName(conversationId);
      const stub = env.CONVERSATION_DO.get(doId);
      return stub.fetch(request);
    }
    
    // Handle API requests
    const handler = createCopilotEdgeHandler({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      conversationDO: env.CONVERSATION_DO,
      enableConversations: true,
    });
    
    return handler(request);
  }
};

const chatHTML = `
<!DOCTYPE html>
<html>
<head>
  <title>CopilotEdge Chat</title>
</head>
<body>
  <div id="messages"></div>
  <input type="text" id="input" placeholder="Type a message...">
  <button onclick="sendMessage()">Send</button>
  
  <script>
    const ws = new WebSocket('wss://' + location.host + '/chat-' + Date.now());
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'chat') {
        messages.innerHTML += '<p>' + msg.role + ': ' + msg.content + '</p>';
      }
    };
    
    function sendMessage() {
      ws.send(JSON.stringify({
        type: 'chat',
        role: 'user',
        content: input.value
      }));
      input.value = '';
    }
    
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  </script>
</body>
</html>
`;
```

## Migration from Stateless

### Before (Stateless)

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: env.CLOUDFLARE_API_TOKEN,
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
});
```

### After (With Durable Objects)

```typescript
const handler = createCopilotEdgeHandler({
  apiKey: env.CLOUDFLARE_API_TOKEN,
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  conversationDO: env.CONVERSATION_DO,
  enableConversations: true,
});
```

## Next Steps

- Implement user authentication
- Add conversation analytics
- Create conversation UI components
- Integrate with Analytics Engine for metrics

## Support

For issues with Durable Objects:
- [GitHub Issues](https://github.com/Klammertime/copilotedge/issues)
- [Cloudflare Workers Discord](https://discord.gg/cloudflaredev)
- [Durable Objects Documentation](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)