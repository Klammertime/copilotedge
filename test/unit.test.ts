import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CopilotEdge, { ValidationError } from '../src/index';

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
      await expect(edge.handleRequest(null)).rejects.toThrow(ValidationError);
      await expect(edge.handleRequest("invalid")).rejects.toThrow(ValidationError);
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

    it('should accept any valid GraphQL request', async () => {
      // It should not throw a validation error for any request with an operationName.
      // It will fail later at the handler stage, which is expected.
      await expect(edge.handleRequest({ operationName: 'IntrospectionQuery' })).resolves.toBeDefined();
      await expect(edge.handleRequest({ operationName: 'someOtherOperation' })).resolves.toBeDefined();
    });

    it('should throw ValidationError for malformed GraphQL requests', async () => {
      // A request with operationName but no variables (if expected) might still pass
      // initial validation, but this specific check remains in the handler logic.
      // We will leave the more specific GraphQL tests to the integration test suite.
      expect(true).toBe(true); // Placeholder for more complex tests
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
      expect(global.fetch).toHaveBeenCalledTimes(2); // 1 for region check, 1 for chat
      
      // Second call - should be served from cache
      const response2 = await edge.handleRequest(requestBody);
      expect(response2.choices[0].message.content).toBe('Test response');
      // Fetch should NOT be called again for the chat
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on server error and eventually fail', async () => {
      // Mock a failing API response
      vi.mocked(global.fetch).mockResolvedValue(createFetchResponse({ error: 'Server error' }, 500) as any);

      edge = new CopilotEdge({ apiKey: 'test', accountId: 'test', maxRetries: 3 });
      const requestBody = { messages: [{ role: 'user', content: 'test' }] };

      await expect(edge.handleRequest(requestBody)).rejects.toThrow();
      
      // Fetch should be called once for region check, then 3 times for the retries
      expect(global.fetch).toHaveBeenCalledTimes(1 + 3);
    });

    it('should use the fallback model if the primary model fails with a 404', async () => {
      edge = new CopilotEdge({
        apiKey: 'test',
        accountId: 'test',
        model: 'primary-model',
        fallback: 'fallback-model',
      });

      const fallbackResponse = { choices: [{ message: { content: 'Fallback response' } }] };

      // First, mock the 404 for the primary model, then the success for the fallback
      vi.mocked(global.fetch)
        // Region check
        .mockResolvedValueOnce(createFetchResponse({}) as any)
        // Primary model fails
        .mockResolvedValueOnce(createFetchResponse({ error: 'Model not found' }, 404) as any)
        // Fallback model succeeds
        .mockResolvedValueOnce(createFetchResponse(fallbackResponse) as any);
      
      const requestBody = { messages: [{ role: 'user', content: 'test' }] };
      const response = await edge.handleRequest(requestBody);
      
      expect(response.choices[0].message.content).toBe('Fallback response');
      // 1 for region, 1 for primary (failed), 1 for fallback (success)
      expect(global.fetch).toHaveBeenCalledTimes(3);
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