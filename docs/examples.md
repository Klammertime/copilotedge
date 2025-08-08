# Examples

Implementation patterns and complete examples.

## Quick Examples

### Basic Next.js App Router

```typescript
// app/api/copilotedge/route.ts
import { createCopilotEdgeHandler } from 'copilotedge';

export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});
```

### With Custom Configuration

```typescript
// app/api/copilotedge/route.ts
import { createCopilotEdgeHandler } from 'copilotedge';

export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/openai/gpt-oss-20b',
  cacheTimeout: 120000,  // 2 minutes
  rateLimit: 30,         // Conservative for production
  debug: process.env.NODE_ENV === 'development'
});
```

### Direct API Usage

```typescript
// app/api/chat/route.ts
import CopilotEdge from 'copilotedge';
import { NextRequest, NextResponse } from 'next/server';

const edge = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await edge.handleRequest(body);
    
    return NextResponse.json(response, {
      headers: {
        'X-Cache': response.cached ? 'HIT' : 'MISS'
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode || 500 }
    );
  }
}
```

## Complete Examples

### 1. Chat Application with CopilotKit

```tsx
// app/layout.tsx
import { CopilotKit } from '@copilotkit/react-core';
import '@copilotkit/react-ui/styles.css';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotedge">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}

// app/page.tsx
'use client';

import { CopilotChat } from '@copilotkit/react-ui';
import { useCopilotChat } from '@copilotkit/react-core';

export default function ChatPage() {
  return (
    <div style={{ height: '100vh' }}>
      <CopilotChat 
        instructions="You are a helpful assistant powered by Cloudflare Workers AI."
        labels={{
          title: "AI Assistant",
          initial: "Hello! How can I help you today?"
        }}
      />
    </div>
  );
}

// app/api/copilotedge/route.ts
import { createCopilotEdgeHandler } from 'copilotedge';

export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});
```

### 2. Cloudflare Pages Functions

See [examples/cloudflare-pages.js](../examples/cloudflare-pages.js) for full implementation.

```javascript
// functions/api/copilotedge.js
import CopilotEdge from 'copilotedge';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const edge = new CopilotEdge({
    apiKey: context.env.CLOUDFLARE_API_TOKEN,
    accountId: context.env.CLOUDFLARE_ACCOUNT_ID
  });

  try {
    const body = await context.request.json();
    const result = await edge.handleRequest(body);
    
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.statusCode || 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

### 3. Custom Chat Interface

```tsx
// components/ChatInterface.tsx
'use client';

import { useState } from 'react';

export default function ChatInterface() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/copilotedge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages })
      });

      const data = await response.json();
      
      if (data.choices?.[0]?.message) {
        setMessages([...newMessages, data.choices[0].message]);
      } else if (data.data?.generateCopilotResponse?.messages?.[0]) {
        const msg = data.data.generateCopilotResponse.messages[0];
        setMessages([...newMessages, {
          role: 'assistant',
          content: msg.content[0]
        }]);
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages([...newMessages, {
        role: 'assistant',
        content: 'Sorry, an error occurred.'
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
        {loading && <div className="loading">AI is thinking...</div>}
      </div>
      
      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type your message..."
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  );
}
```

### 4. With Error Handling and Metrics

```typescript
// app/api/copilotedge/route.ts
import CopilotEdge, { ValidationError, APIError } from 'copilotedge';
import { NextRequest, NextResponse } from 'next/server';

const edge = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  debug: true
});

// Metrics tracking
let requestCount = 0;
let errorCount = 0;

export async function POST(req: NextRequest) {
  requestCount++;
  const startTime = Date.now();

  try {
    const body = await req.json();
    const response = await edge.handleRequest(body);
    
    // Log metrics
    const metrics = edge.getMetrics();
    console.log({
      request: requestCount,
      latency: Date.now() - startTime,
      cacheHitRate: metrics.cacheHitRate,
      totalErrors: errorCount
    });
    
    return NextResponse.json(response);
    
  } catch (error) {
    errorCount++;
    
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: 'Invalid request format', details: error.message },
        { status: 400 }
      );
    }
    
    if (error instanceof APIError) {
      if (error.statusCode === 429) {
        return NextResponse.json(
          { error: 'Too many requests. Please slow down.' },
          { status: 429 }
        );
      }
      
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: error.statusCode }
      );
    }
    
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Metrics endpoint
export async function GET() {
  const metrics = edge.getMetrics();
  return NextResponse.json({
    requests: requestCount,
    errors: errorCount,
    errorRate: errorCount / requestCount,
    ...metrics
  });
}
```

### 5. Multi-Model Router

```typescript
// app/api/ai/route.ts
import { createCopilotEdgeHandler } from 'copilotedge';

// Different models for different tasks
const handlers = {
  chat: createCopilotEdgeHandler({
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    model: '@cf/meta/llama-3.1-8b-instruct'
  }),
  
  code: createCopilotEdgeHandler({
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    model: '@cf/openai/gpt-oss-20b'
  }),
  
  analysis: createCopilotEdgeHandler({
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    model: '@cf/openai/gpt-oss-120b'
  })
};

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') || 'chat';
  
  const handler = handlers[mode] || handlers.chat;
  return handler(req);
}
```

### 6. With Authentication

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Check for API key in header
  const apiKey = request.headers.get('X-API-Key');
  
  if (request.nextUrl.pathname.startsWith('/api/copilotedge')) {
    if (!apiKey || apiKey !== process.env.CLIENT_API_KEY) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: '/api/copilotedge/:path*'
};
```

## Testing Examples

### Unit Test Example

```typescript
// __tests__/copilotedge.test.ts
import { describe, it, expect, vi } from 'vitest';
import CopilotEdge from 'copilotedge';

describe('CopilotEdge', () => {
  it('should handle requests', async () => {
    const edge = new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account'
    });
    
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Test response' } }]
      })
    });
    
    const response = await edge.handleRequest({
      messages: [{ role: 'user', content: 'Test' }]
    });
    
    expect(response).toBeDefined();
    expect(response.choices[0].message.content).toBe('Test response');
  });
});
```

### Integration Test Example

See [test/integration.test.ts](../test/integration.test.ts) for comprehensive integration tests.

## Repository Examples

Full working examples are available in the repository:

- [Basic Usage](../examples/basic-usage.js) - Simple implementation
- [Cloudflare Pages](../examples/cloudflare-pages.js) - Pages Functions deployment
- [Performance Benchmark](../benchmarks/performance.js) - Performance testing

## Community Examples

Share your implementations:

1. Fork the repository
2. Add your example to `/examples`
3. Submit a pull request

## Need Help?

- Check [Troubleshooting](troubleshooting.md) for common issues
- Review [Configuration](configuration.md) for setup options
- See [Error Handling](errors.md) for error resolution
- Report issues on [GitHub](https://github.com/Klammertime/copilotedge/issues)