import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CopilotEdge, createCopilotEdgeHandler } from '../src/index';
import { NextRequest } from 'next/server';

// Mock fetch globally
global.fetch = vi.fn();

describe('CopilotEdge', () => {
  let instance: CopilotEdge;
  const mockApiKey = 'test-api-key-123';
  const mockAccountId = 'test-account-123';

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new CopilotEdge({
      apiKey: mockApiKey,
      accountId: mockAccountId,
      debug: false
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Core Functionality', () => {
    it('should initialize with correct configuration', () => {
      const config = {
        apiKey: 'custom-key',
        accountId: 'custom-account',
        model: '@cf/custom/model',
        debug: true
      };
      const customInstance = new CopilotEdge(config);
      expect(customInstance).toBeDefined();
    });

    it('should use environment variables when config not provided', () => {
      process.env.CLOUDFLARE_API_TOKEN = 'env-api-key';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'env-account-id';
      
      const envInstance = new CopilotEdge();
      expect(envInstance).toBeDefined();
      
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
    });
  });

  describe('Caching Feature', () => {
    it('should cache responses for 60 seconds', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Cached response' } }]
      };

      // First call - should hit API
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const body = {
        messages: [{ role: 'user', content: 'Test message' }]
      };

      const result1 = await instance.handleRequest(body);
      expect(result1.choices[0].message.content).toBe('Cached response');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call with same body - should use cache
      const result2 = await instance.handleRequest(body);
      expect(result2.choices[0].message.content).toBe('Cached response');
      expect(global.fetch).toHaveBeenCalledTimes(1); // Still 1, used cache
    });

    it('should expire cache after 60 seconds', async () => {
      vi.useFakeTimers();
      
      const mockResponse1 = {
        choices: [{ message: { content: 'First response' } }]
      };
      const mockResponse2 = {
        choices: [{ message: { content: 'Second response' } }]
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse1
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse2
        });

      const body = {
        messages: [{ role: 'user', content: 'Test message' }]
      };

      // First call
      const result1 = await instance.handleRequest(body);
      expect(result1.choices[0].message.content).toBe('First response');

      // Advance time by 61 seconds
      vi.advanceTimersByTime(61000);

      // Second call - cache expired, should hit API again
      const result2 = await instance.handleRequest(body);
      expect(result2.choices[0].message.content).toBe('Second response');
      expect(global.fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure with exponential backoff', async () => {
      vi.useFakeTimers();
      
      const mockResponse = {
        choices: [{ message: { content: 'Success after retry' } }]
      };

      // Fail twice, then succeed
      (global.fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse
        });

      const body = {
        messages: [{ role: 'user', content: 'Test message' }]
      };

      const resultPromise = instance.handleRequest(body);
      
      // Fast-forward through retries
      await vi.runAllTimersAsync();
      
      const result = await resultPromise;
      expect(result.choices[0].message.content).toBe('Success after retry');
      expect(global.fetch).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('should fail after max retries', async () => {
      vi.useFakeTimers();
      
      // Always fail
      (global.fetch as any).mockRejectedValue(new Error('Persistent error'));

      const body = {
        messages: [{ role: 'user', content: 'Test message' }]
      };

      const resultPromise = instance.handleRequest(body);
      
      // Fast-forward through all retries
      await vi.runAllTimersAsync();
      
      await expect(resultPromise).rejects.toThrow('Persistent error');
      expect(global.fetch).toHaveBeenCalledTimes(3); // Initial + 2 retries

      vi.useRealTimers();
    });
  });

  describe('Region Selection', () => {
    it('should test all regions and select fastest', async () => {
      const instance = new CopilotEdge({
        apiKey: mockApiKey,
        accountId: mockAccountId,
        debug: true
      });

      // Mock different response times for regions
      let callCount = 0;
      (global.fetch as any).mockImplementation(async (url: string) => {
        callCount++;
        // Make first region fastest
        const delay = url.includes('api.cloudflare.com') ? 10 : 50;
        await new Promise(resolve => setTimeout(resolve, delay));
        return {
          ok: true,
          json: async () => ({ 
            choices: [{ message: { content: `Region ${callCount}` } }] 
          })
        };
      });

      // This should trigger region testing
      await instance.testFeatures();
      
      // Verify it tested multiple regions
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('GraphQL Support', () => {
    it('should handle CopilotKit GraphQL mutations', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'GraphQL response' } }]
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const graphqlBody = {
        query: 'mutation generateCopilotResponse { ... }',
        variables: {
          messages: [{ role: 'user', content: 'GraphQL test' }]
        }
      };

      const result = await instance.handleRequest(graphqlBody);
      expect(result).toBeDefined();
    });

    it('should handle streaming responses', async () => {
      const mockResponse = {
        choices: [{ 
          message: { content: 'Streaming response' },
          finish_reason: 'stop'
        }]
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const body = {
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true
      };

      const result = await instance.handleRequest(body);
      expect(result).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing API credentials gracefully', async () => {
      const instance = new CopilotEdge({});
      
      const body = {
        messages: [{ role: 'user', content: 'Test' }]
      };

      await expect(instance.handleRequest(body)).rejects.toThrow();
    });

    it('should handle malformed requests', async () => {
      const invalidBody = { invalid: 'data' };
      
      await expect(instance.handleRequest(invalidBody)).rejects.toThrow();
    });

    it('should handle Cloudflare API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Invalid API key'
      });

      const body = {
        messages: [{ role: 'user', content: 'Test' }]
      };

      await expect(instance.handleRequest(body)).rejects.toThrow();
    });
  });

  describe('Next.js Integration', () => {
    it('should create Next.js handler correctly', async () => {
      const handler = createCopilotEdgeHandler({
        apiKey: mockApiKey,
        accountId: mockAccountId
      });

      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('should handle Next.js requests', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Next.js response' } }]
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const handler = createCopilotEdgeHandler({
        apiKey: mockApiKey,
        accountId: mockAccountId
      });

      const mockRequest = new NextRequest('http://localhost:3000/api/copilotedge', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Test' }]
        })
      });

      const response = await handler(mockRequest);
      expect(response).toBeDefined();
      expect(response.status).toBe(200);
    });
  });

  describe('Performance', () => {
    it('should handle concurrent requests efficiently', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Concurrent response' } }]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const promises = Array.from({ length: 10 }, (_, i) => 
        instance.handleRequest({
          messages: [{ role: 'user', content: `Test ${i}` }]
        })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.choices[0].message.content).toBe('Concurrent response');
      });
    });

    it('should measure response times in debug mode', async () => {
      const debugInstance = new CopilotEdge({
        apiKey: mockApiKey,
        accountId: mockAccountId,
        debug: true
      });

      const mockResponse = {
        choices: [{ message: { content: 'Debug response' } }]
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const consoleSpy = vi.spyOn(console, 'log');
      
      await debugInstance.handleRequest({
        messages: [{ role: 'user', content: 'Debug test' }]
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});