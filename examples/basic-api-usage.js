// Basic usage example for CopilotEdge
// This shows how to use CopilotEdge with Cloudflare Workers AI

import { createCopilotEdgeHandler } from 'copilotedge';

// Create a handler for Next.js API routes
export const POST = createCopilotEdgeHandler({
  // Get credentials from environment variables
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  
  // Use Cloudflare's Llama model
  model: '@cf/meta/llama-3.1-8b-instruct',
  
  // Optional: Enable telemetry
  telemetry: {
    enabled: true,
    serviceName: 'my-ai-service'
  }
});