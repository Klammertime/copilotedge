/**
 * Basic usage example for CopilotEdge
 * 
 * This file contains several snippets showing how to integrate CopilotEdge
 * with a Next.js application.
 */

// ============================================
// 1. API Route Handler (app/api/copilotedge/route.js)
// ============================================

import { createCopilotEdgeHandler } from 'copilotedge';

// Choose one of the following configurations for your API route:

// ---
// OPTION 1: Basic Setup (Recommended)
// ---
// This is the simplest way to get started. It reads your Cloudflare
// credentials from environment variables (CLOUDFLARE_API_TOKEN, etc.)
// and uses the default model.
export const POST = createCopilotEdgeHandler();


// ---
// OPTION 2: Custom Configuration
// ---
// Uncomment this block to use custom settings. This allows you to
// specify a different model, change caching behavior, and more.
/*
export const POST = createCopilotEdgeHandler({
  // apiKey and accountId are still read from environment variables by default
  model: '@cf/meta/llama-3.1-70b-instruct', // Use a larger model
  fallback: '@cf/meta/llama-3.1-8b-instruct', // Fallback to a smaller model
  debug: true,                               // Enable debug logging
  cacheTimeout: 120000,                      // 2-minute cache
  maxRetries: 5,                             // More retries for production
  rateLimit: 100,                            // Higher rate limit per minute
});
*/

// ---
// OPTION 3: OpenAI Open-Source Models
// ---
// Uncomment this block to use OpenAI's powerful open-source models,
// served through Cloudflare's edge network.
/*
export const POST = createCopilotEdgeHandler({
  model: '@cf/openai/gpt-oss-120b',
  fallback: '@cf/openai/gpt-oss-20b', // Fallback to the smaller OSS model
  debug: true,
});
*/

// ---
// OPTION 4: Streaming Responses (NEW in v0.4.0!)
// ---
// Enable real-time streaming for immediate feedback (~200ms to first token)
/*
export const POST = createCopilotEdgeHandler({
  stream: true,  // Enable streaming for all requests
  onChunk: (chunk) => {
    // Optional: Track progress or perform side effects
    console.log('Streamed:', chunk.length, 'characters');
  },
  // Streaming works with any model
  model: '@cf/meta/llama-3.1-70b-instruct',
  debug: true,
});
*/

// ---
// OPTION 5: With Durable Objects (NEW in v0.6.0!)
// ---
// Enable persistent conversation management with Durable Objects.
// This requires a Cloudflare Workers environment.
/*
// In your Worker file (not Next.js API route):
import { createCopilotEdgeHandler, ConversationDO } from 'copilotedge';

export { ConversationDO }; // Export the DO class

export default {
  async fetch(request, env) {
    const handler = createCopilotEdgeHandler({
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      conversationDO: env.CONVERSATION_DO,     // Durable Object namespace
      enableConversations: true,               // Enable conversation persistence
      defaultConversationId: 'user-session',   // Default conversation ID
      model: '@cf/openai/gpt-oss-120b',       // Use a powerful model
      kvNamespace: env.COPILOT_CACHE,         // Optional: KV for caching
      stream: true,                            // Enable streaming
    });
    
    return handler(request);
  }
};
*/


// ============================================
// 2. React Component with CopilotKit UI
// ============================================

// app/layout.jsx
import { CopilotKit } from '@copilotkit/react-core';
import { CopilotPopup } from '@copilotkit/react-ui';
// The UI package ships with a default stylesheet that you need to import.
// This gives you flexibility to override styles or create your own theme.
import "@copilotkit/react-ui/styles.css";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <CopilotKit runtimeUrl="/api/copilotedge">
          {children}
          
          {/* This one component provides the entire chat UI */}
          <CopilotPopup 
            instructions="You are a helpful AI assistant powered by CopilotEdge."
            defaultOpen={true}
            labels={{
              title: "CopilotEdge Assistant",
              initial: "Hello! How can I help you today?",
            }}
          />
        </CopilotKit>
      </body>
    </html>
  );
}

// app/page.jsx
// With the CopilotPopup, you don't need to build any chat UI on your page.
// The popup handles everything automatically.
export default function Page() {
  return (
    <div>
      <h1>Welcome to My App</h1>
      <p>Click the chat bubble in the corner to interact with the AI assistant.</p>
    </div>
  );
}

// ============================================
// 3. Performance and Feature Testing
// ============================================

// The following is a standalone function for testing and debugging.
// It is not part of the Next.js application but can be run from a
// separate script to verify your credentials and feature flags.
async function testFeatures() {
  const edge = new CopilotEdge({
    // Environment variables are used by default
    debug: true
  });
  
  // Test features
  await edge.testFeatures();
  
  // Make a request and check metrics
  try {
    await edge.handleRequest({
      messages: [{ role: 'user', content: 'Hello' }]
    });
  } catch (error) {
    console.error('Request failed:', error.message);
    // Library validates messages and will throw ValidationError if array is empty
    // or if messages don't have required role and content properties
  }
  
  const metrics = edge.getMetrics();
  console.log('Performance Metrics:', metrics);
  // {
  //   totalRequests: 1,
  //   cacheHits: 0,
  //   cacheHitRate: 0,
  //   avgLatency: 145,
  //   errors: 0,
  //   errorRate: 0,
  //   fallbackUsed: 0,
  //   fallbackRate: 0,
  //   activeModel: '@cf/meta/llama-3.1-8b-instruct'
  // }
  
  // Clear cache if needed
  edge.clearCache();
  
  // Clean up resources to prevent memory leaks
  edge.destroy();
}