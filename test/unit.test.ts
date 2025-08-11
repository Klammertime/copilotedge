import { describe, it, expect, vi, beforeEach } from 'vitest';
import CopilotEdge, { ValidationError } from '../src/index';

// Import crypto for use in tests
import * as nodeCrypto from 'node:crypto';

// Mock crypto.subtle.digest for the hashRequest method
const mockDigest = vi.fn().mockImplementation(async (algorithm, data) => {
  return nodeCrypto.createHash('sha256').update(new Uint8Array(data)).digest();
});

// Mock the crypto API
vi.stubGlobal('crypto', {
  subtle: {
    digest: mockDigest
  },
  randomUUID: nodeCrypto.randomUUID
});

// Ensure AbortSignal.timeout is available
if (!AbortSignal.timeout) {
  AbortSignal.timeout = (ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

// Mock the global fetch function
global.fetch = vi.fn();

// Helper to create a mock Response
function createFetchResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe('CopilotEdge Unit Tests', () => {
  describe('Initialization', () => {
    it('should throw error when API key is missing', () => {
      expect(() => new CopilotEdge({ accountId: 'test' } as any))
        .toThrow(ValidationError);
    });

    it('should throw error when account ID is missing', () => {
      expect(() => new CopilotEdge({ apiKey: 'test' } as any))
        .toThrow(ValidationError);
    });

    it('should initialize with valid config', () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });
      expect(edge).toBeDefined();
      expect(edge.getMetrics).toBeDefined();
    });

    it('should use default model', () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });
      const metrics = edge.getMetrics();
      // The default model should be set
      expect(metrics.activeModel).toContain('llama-3.1-8b-instruct');
    });

    it('should correctly override default settings', () => {
      const config = {
        apiKey: 'test-key',
        accountId: 'test-account',
        model: 'custom-model',
        fallback: 'custom-fallback',
        cacheTimeout: 12345,
        maxRetries: 10,
        rateLimit: 500,
      };
      const edge = new CopilotEdge(config);
      const metrics = edge.getMetrics();
      
      expect(metrics.activeModel).toBe('custom-model');
      
      // We can't directly inspect private properties, but we can infer
      // their state from the behavior tested in other files (e.g., integration tests).
      // For this unit test, we confirm the instance is created without errors.
      expect(edge).toBeInstanceOf(CopilotEdge);
    });
  });

  describe('Validation', () => {
    let edge: CopilotEdge;

    beforeEach(() => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });
    });

    it('should throw ValidationError for invalid request body', async () => {
      await expect(edge.handleRequest(null)).rejects.toThrow();
      await expect(edge.handleRequest("invalid")).rejects.toThrow();
    });

    it('should throw ValidationError for empty messages array', async () => {
      await expect(edge.handleRequest({ messages: [] }))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for messages with missing role or content', async () => {
      await expect(edge.handleRequest({ messages: [{ role: 'user' }] }))
        .rejects.toThrow(ValidationError);
      await expect(edge.handleRequest({ messages: [{ content: 'hello' }] }))
        .rejects.toThrow(ValidationError);
    });
    
    it('should accept valid direct chat requests', async () => {
      // This test will fail at the fetch stage, which is expected since we're not
      // mocking the network call. A successful validation means it proceeds to that stage.
      await expect(edge.handleRequest({ messages: [{ role: 'user', content: 'hello' }] }))
        .rejects.not.toThrow(ValidationError);
    });

    it('should accept and gracefully handle any valid GraphQL operation', async () => {
      // It should not throw any error for a request with an operationName.
      // It should resolve with a default success response.
      const response = await edge.handleRequest({ operationName: 'someOtherOperation' });
      expect(response).toEqual({ data: {} });
      
      const introspectionResponse = await edge.handleRequest({ operationName: 'IntrospectionQuery' });
      expect(introspectionResponse.data.__schema).toBeDefined();
    });

    it('should still reject malformed direct chat requests', async () => {
      // Re-testing a validation case to ensure our changes didn't break anything.
      await expect(edge.handleRequest({ messages: [{ content: 'hello' }] }))
        .rejects.toThrow(ValidationError);
    });

  });

  describe('Request Handling, Caching, and Retries', () => {
    let edge: CopilotEdge;

    // Reset mocks before each test
    beforeEach(() => {
      vi.mocked(global.fetch).mockReset();
    });

    it('should fetch from network and cache the response on the first call', async () => {
      // Mock a successful API response
      const mockResponse = { choices: [{ message: { content: 'Test response' } }] };
      vi.mocked(global.fetch).mockResolvedValue(createFetchResponse(mockResponse) as any);
      
      edge = new CopilotEdge({ apiKey: 'test', accountId: 'test', cacheTimeout: 10000 });
      const requestBody = { messages: [{ role: 'user', content: 'test' }] };
      
      // First call - should hit the network
      const response1 = await edge.handleRequest(requestBody);
      expect(response1.choices[0].message.content).toBe('Test response');
      expect(global.fetch).toHaveBeenCalledTimes(4); // 3 for region check, 1 for chat
      
      // Second call - should be served from cache
      const response2 = await edge.handleRequest(requestBody);
      expect(response2.choices[0].message.content).toBe('Test response');
      // Fetch should NOT be called again for the chat or region
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('should retry on server error and eventually fail', async () => {
      // Mock a failing API response for the chat completion
      // The first 3 calls are for the region check, which we'll mock as successful
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(createFetchResponse({}) as any) // Region 1
        .mockResolvedValueOnce(createFetchResponse({}) as any) // Region 2
        .mockResolvedValueOnce(createFetchResponse({}) as any) // Region 3
        .mockResolvedValue(createFetchResponse({ error: 'Server error' }, 500) as any); // All subsequent chat calls fail

      edge = new CopilotEdge({ apiKey: 'test', accountId: 'test', maxRetries: 3 });
      const requestBody = { messages: [{ role: 'user', content: 'test' }] };

      await expect(edge.handleRequest(requestBody)).rejects.toThrow();
      
      // Fetch should be called 3 times for the region check, then 3 times for the retries
      expect(global.fetch).toHaveBeenCalledTimes(3 + 3);
    });

    it('should use the fallback model if the primary model fails with a 404', async () => {
      edge = new CopilotEdge({
        apiKey: 'test',
        accountId: 'test',
        model: 'primary-model',
        fallback: 'fallback-model',
      });

      const fallbackResponse = { choices: [{ message: { content: 'Fallback response' } }] };

      // Mock the sequence of fetch calls
      vi.mocked(global.fetch)
        // 3 successful region checks
        .mockResolvedValueOnce(createFetchResponse({}) as any)
        .mockResolvedValueOnce(createFetchResponse({}) as any)
        .mockResolvedValueOnce(createFetchResponse({}) as any)
        // Primary model fails with 404
        .mockResolvedValueOnce(createFetchResponse({ error: 'Model not found' }, 404) as any)
        // Fallback model succeeds
        .mockResolvedValueOnce(createFetchResponse(fallbackResponse) as any);
      
      const requestBody = { messages: [{ role: 'user', content: 'test' }] };
      const response = await edge.handleRequest(requestBody);
      
      expect(response.choices[0].message.content).toBe('Fallback response');
      // 3 for region, 1 for primary (failed), 1 for fallback (success)
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });
  });

  describe('Metrics', () => {
    it('should return metrics object', () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });
      
      const metrics = edge.getMetrics();
      expect(metrics).toHaveProperty('totalRequests');
      expect(metrics).toHaveProperty('cacheHits');
      expect(metrics).toHaveProperty('avgLatency');
      expect(metrics).toHaveProperty('errors');
    });
  });

  describe('Cache', () => {
    it('should clear cache', () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });
      
      // Should not throw
      expect(() => edge.clearCache()).not.toThrow();
    });
  });
});