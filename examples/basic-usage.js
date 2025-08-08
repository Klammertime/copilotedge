/**
 * Basic usage example of CopilotEdge
 * 
 * This example shows how to integrate CopilotEdge with your Next.js app
 * to connect CopilotKit to Cloudflare Workers AI.
 */

// ============================================
// 1. API Route Handler (app/api/copilot/route.js)
// ============================================

import { createCopilotEdgeHandler } from 'copilotedge';

// Simple one-line setup
export const POST = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});

// ============================================
// 2. With Custom Configuration
// ============================================

import { CopilotEdge } from 'copilotedge';

const edge = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/meta/llama-3.1-70b-instruct', // Use larger model
  debug: true,                               // Enable debug logging
  cacheTimeout: 120000,                      // 2 minute cache
  maxRetries: 5,                            // More retries for production
  rateLimit: 100                            // Higher rate limit
});

export const POST = edge.createNextHandler();

// ============================================
// 3. React Component with CopilotKit
// ============================================

// app/layout.jsx
import { CopilotKit } from '@copilotkit/react-core';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <CopilotKit runtimeUrl="/api/copilot">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}

// app/page.jsx
import { useCopilotChat } from '@copilotkit/react-core';

export default function ChatPage() {
  const { messages, sendMessage, isLoading } = useCopilotChat();
  
  return (
    <div>
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>
      
      <form onSubmit={(e) => {
        e.preventDefault();
        const input = e.target.message;
        sendMessage(input.value);
        input.value = '';
      }}>
        <input 
          name="message" 
          placeholder="Ask anything..." 
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>
          Send
        </button>
      </form>
    </div>
  );
}

// ============================================
// 4. Direct API Usage (without CopilotKit)
// ============================================

import { CopilotEdge } from 'copilotedge';

async function chatWithAI() {
  const edge = new CopilotEdge({
    apiKey: 'your-cloudflare-api-key',
    accountId: 'your-account-id'
  });
  
  const response = await edge.handleRequest({
    messages: [
      { role: 'user', content: 'What is the capital of France?' }
    ]
  });
  
  console.log(response.choices[0].message.content);
  // Output: "The capital of France is Paris."
}

// ============================================
// 5. Performance Testing
// ============================================

async function testPerformance() {
  const edge = new CopilotEdge({
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    debug: true
  });
  
  // Test features
  await edge.testFeatures();
  
  // Make requests and check metrics
  await edge.handleRequest({
    messages: [{ role: 'user', content: 'Hello' }]
  });
  
  const metrics = edge.getMetrics();
  console.log('Performance Metrics:', metrics);
  // {
  //   totalRequests: 1,
  //   cacheHits: 0,
  //   cacheHitRate: 0,
  //   avgLatency: 145,
  //   errors: 0,
  //   errorRate: 0
  // }
}