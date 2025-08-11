/**
 * Integration tests for CopilotEdge with Miniflare
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CopilotEdge } from '../dist/index';
import { Miniflare } from 'miniflare';

describe('CopilotEdge Integration Tests', () => {
  let mf: Miniflare;
  let edge: CopilotEdge;

  beforeEach(async () => {
    // Create a more comprehensive Cloudflare Worker mock that handles different endpoints
    mf = new Miniflare({
      script: `
        export default {
          async fetch(request) {
            const url = new URL(request.url);
            
            // Mock chat completions endpoint for chat models
            if (url.pathname.includes('/ai/v1/chat/completions')) {
              return new Response(JSON.stringify({
                choices: [{ 
                  message: { 
                    role: 'assistant',
                    content: 'Mocked Chat Model Response' 
                  },
                  index: 0,
                  finish_reason: 'stop'
                }],
                model: '@cf/meta/llama-3.1-8b-instruct',
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 20,
                  total_tokens: 30
                }
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            
            // Mock run endpoint for instruction models
            if (url.pathname.includes('/ai/run/')) {
              return new Response(JSON.stringify({
                result: {
                  response: 'Mocked Instruction Model Response'
                },
                success: true
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            
            // Default response for unknown endpoints
            return new Response(JSON.stringify({
              error: 'Unknown endpoint'
            }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
      `,
      modules: true,
    });
    
    // Use the Miniflare instance directly as the fetch function
    const customFetch = async (url: string, options?: any) => {
      return mf.dispatchFetch(url, options);
    };
    
    edge = new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account',
      debug: false,
      fetch: customFetch as any,
    });
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it('should handle a valid direct chat request with chat model', async () => {
    const response = await edge.handleRequest({
      messages: [{ role: 'user', content: 'test' }]
    });
    expect(response.choices[0].message.content).toBe('Mocked Chat Model Response');
    expect(response.choices[0].message.role).toBe('assistant');
  });

  it('should handle a valid direct chat request with instruction model', async () => {
    // Test with a model that uses the /run endpoint
    const customEdge = new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account',
      model: '@cf/openai/gpt-oss-120b',
      debug: false,
      fetch: (async (url: string, options?: any) => {
        return mf.dispatchFetch(url, options);
      }) as any,
    });
    
    const response = await customEdge.handleRequest({
      messages: [{ role: 'user', content: 'test' }]
    });
    expect(response.choices[0].message.content).toBe('Mocked Instruction Model Response');
  });

  it('should handle GraphQL mutation requests', async () => {
    const response = await edge.handleRequest({
      operationName: 'generateCopilotResponse',
      variables: {
        data: {
          threadId: 'test-thread',
          messages: [{
            textMessage: {
              role: 'user',
              content: 'Hello'
            }
          }]
        }
      }
    });
    
    expect(response.data.generateCopilotResponse).toBeDefined();
    expect(response.data.generateCopilotResponse.messages[0].content[0]).toBe('Mocked Chat Model Response');
  });

  it('should handle caching correctly', async () => {
    const request = { messages: [{ role: 'user', content: 'cached request' }] };
    
    // First request - should hit the API
    const response1 = await edge.handleRequest(request);
    expect(response1.cached).toBeUndefined();
    
    // Second request - should hit the cache
    const response2 = await edge.handleRequest(request);
    expect(response2.cached).toBe(true);
    expect(response2.choices[0].message.content).toBe(response1.choices[0].message.content);
  });

  it('should handle model fallback on error', async () => {
    // Create edge with fallback model
    const edgeWithFallback = new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account',
      model: '@cf/meta/nonexistent-model',
      fallback: '@cf/meta/llama-3.1-8b-instruct',
      debug: false,
      fetch: (async (url: string, options?: any) => {
        // Simulate 404 for primary model, success for fallback
        if (url.includes('nonexistent-model')) {
          return new Response(JSON.stringify({
            error: 'Model not found'
          }), { status: 404 });
        }
        return mf.dispatchFetch(url, options);
      }) as any,
    });
    
    const response = await edgeWithFallback.handleRequest({
      messages: [{ role: 'user', content: 'test with fallback' }]
    });
    
    expect(response.choices[0].message.content).toBe('Mocked Chat Model Response');
  });
});