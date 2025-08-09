/**
 * Example showing how to use OpenAI models on Cloudflare with fallback support
 * 
 * This example demonstrates using OpenAI's open models on Cloudflare Workers AI
 * with automatic fallback to Llama models if needed.
 */

import { CopilotEdge } from 'copilotedge';

// Example 1: Basic OpenAI model configuration
const handler1 = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/openai/gpt-oss-120b',  // OpenAI's 120B model
  debug: true
});

// Example 2: With fallback to a different model
const handler2 = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/openai/gpt-oss-120b',           // Try OpenAI's 120B model first
  fallback: '@cf/meta/llama-3.1-70b',    // Fall back to Llama if needed
  debug: true
});

// Example 3: Using the provider config
const handler3 = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  provider: 'cloudflare',
  model: '@cf/openai/gpt-oss-120b',           // Primary model
  fallback: '@cf/meta/llama-3.1-8b-instruct',  // More reliable fallback
  debug: true
});

// Usage example
async function testOpenAIModels() {
  console.log('Testing OpenAI models with automatic fallback...');
  
  try {
    // Initialize with OpenAI model and fallback
    const edge = new CopilotEdge({
      apiKey: process.env.CLOUDFLARE_API_TOKEN,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      model: '@cf/openai/gpt-oss-120b',
      fallback: '@cf/meta/llama-3.1-8b-instruct',
      debug: true
    });
    
    // Optionally test features to check configuration
    await edge.testFeatures();
    
    // Make a request
    const result = await edge.handleRequest({
      messages: [
        { 
          role: 'user', 
          content: 'Explain quantum computing in simple terms' 
        }
      ]
    });
    
    console.log('Response from model:', result.choices[0].message.content);
    
    // Get metrics to see if fallback was used
    const metrics = edge.getMetrics();
    console.log('Performance Metrics:', metrics);
    
    if (metrics.fallbackUsed > 0) {
      console.log('Note: Fallback model was used');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// For Next.js API routes
export const createOpenAIHandler = () => {
  const edge = new CopilotEdge({
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    model: '@cf/openai/gpt-oss-120b',
    fallback: '@cf/meta/llama-3.1-8b-instruct'
  });
  
  return edge.createNextHandler();
};