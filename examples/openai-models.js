/**
 * Example demonstrating how to use OpenAI's open-source models on 
 * Cloudflare Workers AI with CopilotEdge.
 * 
 * This example shows a Next.js API route that uses the powerful `gpt-oss-120b` model
 * and automatically falls back to the more lightweight `gpt-oss-20b` model
 * if the primary model is unavailable.
 */

import { createCopilotEdgeHandler, CopilotEdge } from 'copilotedge';

/**
 * Creates a Next.js API route handler for serving OpenAI models via Cloudflare.
 * 
 * It automatically reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
 * from environment variables.
 * 
 * @returns {function} A Next.js API route handler.
 */
export function createOpenAIHandler() {
  return createCopilotEdgeHandler({
    // Use OpenAI's powerful 120B parameter open-source model.
    // This model provides near GPT-4 level performance and is licensed under Apache 2.0.
    model: '@cf/openai/gpt-oss-120b',
    
    // If the primary model fails (e.g., due to capacity issues or other errors),
    // automatically fall back to the smaller 20B parameter model.
    // Both models are licensed under Apache 2.0.
    fallback: '@cf/openai/gpt-oss-20b',
    
    // Enable debug logging to see detailed information about requests,
    // cache hits, and fallbacks in your server logs.
    debug: true,
    
    // Optional: Enable streaming for real-time responses (v0.4.0+)
    // stream: true,
    
    // Optional: Add Workers KV for persistent caching (v0.5.0+)
    // kvNamespace: env.COPILOT_CACHE,
    
    // Optional: Enable Durable Objects for conversation persistence (v0.6.0+)
    // conversationDO: env.CONVERSATION_DO,
    // enableConversations: true,
  });
}

/**
 * An example of how to use this handler in a Next.js API route.
 * 
 * To use this, create a file at `app/api/openai/route.js` and add:
 * 
 * ```javascript
 * import { createOpenAIHandler } from './path/to/this/file';
 * 
 * export const POST = createOpenAIHandler();
 * ```
 */

// ============================================
//          Testing the Handler
// ============================================

/**
 * A standalone function to test the OpenAI model handler logic.
 * This can be run in a Node.js environment to verify your setup.
 */
async function testOpenAIIntegration() {
  console.log('🧪 Testing OpenAI model with fallback...');
  
  let edge = null;
  try {
    edge = new CopilotEdge({
      model: '@cf/openai/gpt-oss-120b',
      fallback: '@cf/openai/gpt-oss-20b',
      debug: true
      // Credentials are read from process.env by default
    });
    
    // Check the configuration and feature status
    await edge.testFeatures();
    
    console.log('\nSubmitting request to the model...');
    
    // Ensure we have a valid message with required fields
    // An empty messages array or missing role/content will throw ValidationError
    const result = await edge.handleRequest({
      messages: [
        { 
          role: 'user', 
          content: 'Explain the significance of the Apache 2.0 license for open-source AI models.' 
        }
      ]
    });
    
    console.log('\n✅ Response from AI:');
    console.log(result.choices[0].message.content);
    
    const metrics = edge.getMetrics();
    console.log('\n📊 Performance Metrics:');
    console.log(metrics);
    
    if (metrics.fallbackUsed > 0) {
      console.log('\n⚠️ Fallback model was used for this request.');
    } else {
      console.log('\n✅ Primary model was used successfully.');
    }
    
  } catch (error) {
    console.error('❌ Error during testing:', error.message);
    
    // Provide more specific error handling guidance
    if (error.name === 'ValidationError') {
      console.error('Validation failed: Check that your messages array is not empty and contains valid messages');
    } else if (error.name === 'APIError') {
      console.error(`API error ${error.statusCode}: This might be a temporary issue with the model or service`);
    }
  } finally {
    // Always clean up resources, even if there was an error
    if (edge) {
      edge.destroy();
      console.log('\n🧹 Resources cleaned up');
    }
  }
}

// To run this test, you would execute the following in a script:
// testOpenAIIntegration();