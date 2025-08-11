/**
 * Integration tests for CopilotEdge with Miniflare
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import CopilotEdge, { createCopilotEdgeHandler, ValidationError, APIError } from '../src/index';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

describe('CopilotEdge Integration Tests', () => {
  let mf: Miniflare;
  let edge: CopilotEdge;

  beforeAll(async () => {
    // Setup Miniflare environment
    mf = new Miniflare({
      script: `
        export default {
          async fetch(request, env) {
            const url = new URL(request.url);
            
            // Mock Cloudflare AI endpoint
            if (url.pathname.includes('/ai/v1/chat/completions')) {
              return new Response(JSON.stringify({
                choices: [{
                  message: {
                    content: 'Test response from mock AI'
                  }
                }]
              }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
            
            // Mock region check endpoint
            if (url.pathname === '/client/v4') {
              return new Response('OK', { status: 200 });
            }
            
            return new Response('Not Found', { status: 404 });
          }
        }
      `,
      modules: true,
      bindings: {
        CLOUDFLARE_API_TOKEN: 'test-token',
        CLOUDFLARE_ACCOUNT_ID: 'test-account'
      }
    });

    // Initialize CopilotEdge with test config
    edge = new CopilotEdge({
      apiKey: 'test-token',
      accountId: 'test-account',
      debug: false,
      cacheTimeout: 1000, // Short timeout for testing
      maxRetries: 2
    });
  });

  afterAll(async () => {
    await mf.dispose();
  });

  describe('Request Validation', () => {
    it('should validate GraphQL mutation format', async () => {
      const validRequest = {
        operationName: 'generateCopilotResponse',
        variables: {
          data: {
            messages: [{
              textMessage: {
                role: 'user',
                content: 'Hello'
              }
            }],
            threadId: 'test-thread'
          }
        }
      };

      await expect(edge.handleRequest(validRequest)).resolves.toBeDefined();
    });

    it('should validate direct chat format', async () => {
      const validRequest = {
        messages: [
          { role: 'user', content: 'Hello' }
        ]
      };

      await expect(edge.handleRequest(validRequest)).resolves.toBeDefined();
    });

    it('should reject invalid request format', async () => {
      const invalidRequest = {
        invalid: 'data'
      };

      await expect(edge.handleRequest(invalidRequest))
        .rejects
        .toThrow(ValidationError);
    });

    it('should reject messages with invalid roles', async () => {
      const invalidRequest = {
        messages: [
          { role: 'invalid-role', content: 'Hello' }
        ]
      };

      await expect(edge.handleRequest(invalidRequest))
        .rejects
        .toThrow(ValidationError);
    });
  });

  describe('Caching', () => {
    it('should cache identical requests', async () => {
      const request = {
        messages: [
          { role: 'user', content: 'Cached message' }
        ]
      };

      // First request - cache miss
      const response1 = await edge.handleRequest(request);
      expect(response1.cached).toBeUndefined();

      // Second request - cache hit
      const response2 = await edge.handleRequest(request);
      expect(response2.cached).toBe(true);
    });

    it('should expire cache after timeout', async () => {
      const request = {
        messages: [
          { role: 'user', content: 'Expiring message' }
        ]
      };

      // First request
      await edge.handleRequest(request);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be cache miss after expiry
      const response = await edge.handleRequest(request);
      expect(response.cached).toBeUndefined();
    });

    it('should clear cache on demand', async () => {
      const request = {
        messages: [
          { role: 'user', content: 'Clear cache test' }
        ]
      };

      // Cache the request
      await edge.handleRequest(request);
      
      // Clear cache
      edge.clearCache();

      // Should be cache miss
      const response = await edge.handleRequest(request);
      expect(response.cached).toBeUndefined();
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const rateLimitedEdge = new CopilotEdge({
        apiKey: 'test-token',
        accountId: 'test-account',
        rateLimit: 2, // Very low limit for testing
        debug: false
      });

      const request = {
        messages: [{ role: 'user', content: 'Rate limit test' }]
      };

      // Make requests up to the limit
      await rateLimitedEdge.handleRequest(request);
      await rateLimitedEdge.handleRequest(request);

      // This should exceed the rate limit
      await expect(rateLimitedEdge.handleRequest(request))
        .rejects
        .toThrow(APIError);
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      // Mock a slow response
      const slowEdge = new CopilotEdge({
        apiKey: 'test-token',
        accountId: 'test-account',
        maxRetries: 1
      });

      // Override fetch to simulate timeout
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const request = {
        messages: [{ role: 'user', content: 'Timeout test' }]
      };

      await expect(slowEdge.handleRequest(request))
        .rejects
        .toThrow();

      global.fetch = originalFetch;
    });

    it('should retry on 5xx errors', async () => {
      let attempts = 0;
      const originalFetch = global.fetch;
      
      global.fetch = vi.fn().mockImplementation((_url) => {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve(new Response('Server Error', { status: 500 }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          choices: [{ message: { content: 'Success after retry' } }]
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      });

      const request = {
        messages: [{ role: 'user', content: 'Retry test' }]
      };

      const response = await edge.handleRequest(request);
      expect(response).toBeDefined();
      expect(attempts).toBe(2); // Initial + 1 retry

      global.fetch = originalFetch;
    });

    it('should not retry on 4xx errors', async () => {
      let attempts = 0;
      const originalFetch = global.fetch;
      
      global.fetch = vi.fn().mockImplementation(() => {
        attempts++;
        return Promise.resolve(new Response('Bad Request', { status: 400 }));
      });

      const request = {
        messages: [{ role: 'user', content: 'No retry test' }]
      };

      await expect(edge.handleRequest(request))
        .rejects
        .toThrow(APIError);
      
      expect(attempts).toBe(1); // No retry

      global.fetch = originalFetch;
    });
  });

  describe('Metrics', () => {
    it('should track request metrics', async () => {
      const metricsEdge = new CopilotEdge({
        apiKey: 'test-token',
        accountId: 'test-account'
      });

      const request = {
        messages: [{ role: 'user', content: 'Metrics test' }]
      };

      // Make some requests
      await metricsEdge.handleRequest(request);
      await metricsEdge.handleRequest(request); // Cache hit

      const metrics = metricsEdge.getMetrics();
      
      expect(metrics.totalRequests).toBeGreaterThan(0);
      expect(metrics.cacheHits).toBeGreaterThan(0);
      expect(metrics.cacheHitRate).toBeGreaterThan(0);
      expect(metrics.avgLatency).toBeGreaterThan(0);
    });
  });

  describe('Sensitive Content Detection', () => {
    it('should not detect sensitive content when disabled', async () => {
      const request = {
        messages: [
          { role: 'user', content: 'My API key is sk_live_test123' }
        ]
      };

      // Feature is disabled by default
      const response = await edge.handleRequest(request);
      expect(response).toBeDefined();
    });

    it('should detect sensitive content when enabled', async () => {
      const sensitiveEdge = new CopilotEdge({
        apiKey: 'test-token',
        accountId: 'test-account',
        detectSensitiveContent: true,
        debug: true
      });

      const consoleSpy = vi.spyOn(console, 'warn');
      
      const request = {
        messages: [
          { role: 'user', content: 'My password is secret123' }
        ]
      };

      await sensitiveEdge.handleRequest(request);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('sensitive content detected')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Region Selection', () => {
    it('should select fastest region automatically', async () => {
      // The findFastestRegion method is called internally
      const request = {
        messages: [{ role: 'user', content: 'Region test' }]
      };

      const response = await edge.handleRequest(request);
      expect(response).toBeDefined();
      
      // Verify region was selected (internal state)
      const metrics = edge.getMetrics();
      expect(metrics).toBeDefined();
    });
  });
});

describe('CopilotEdge Next.js Handler', () => {
  it('should create a valid Next.js handler', async () => {
    const { createCopilotEdgeHandler } = await import('../src/index');
    
    const handler = createCopilotEdgeHandler({
      apiKey: 'test-token',
      accountId: 'test-account'
    });

    expect(handler).toBeInstanceOf(Function);

    // Create a mock NextRequest
    const mockRequest = new NextRequest('http://localhost/api/copilotedge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Integration test' }]
      })
    });

    // Execute the handler
    const response = await handler(mockRequest);
    
    // Assert the response is a valid NextResponse
    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe('Test response from mock AI');
  });
});