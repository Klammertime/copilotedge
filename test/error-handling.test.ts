import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CopilotEdge } from '../src/index';

describe('Error Handling Tests', () => {
  let copilot: CopilotEdge;
  let mockEnv: any;
  let mockCtx: any;

  beforeEach(() => {
    console.log('Test environment setup complete');
    
    mockEnv = {
      AI: {
        run: vi.fn()
      },
      CONVERSATIONS: {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'test-id' }),
        get: vi.fn()
      },
      COPILOT_KV: {
        get: vi.fn(),
        put: vi.fn(),
        list: vi.fn().mockResolvedValue({ keys: [] })
      }
    };

    mockCtx = {
      waitUntil: vi.fn()
    };

    copilot = new CopilotEdge({
      model: '@cf/meta/llama-3.1-8b-instruct',
      debug: true,
      maxRetries: 2,
      retryDelay: 100,
      enableConversations: true,
      apiKey: 'test-api-key',
      accountId: 'test-account-id'
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Network Errors', () => {
    it('should handle fetch timeout errors', async () => {
      const errorMessage = 'AbortError: The operation was aborted';
      mockEnv.AI.run.mockRejectedValueOnce(new Error(errorMessage));
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test prompt' }]
      })).rejects.toThrow('Request timeout');
    });

    it('should handle network connection errors', async () => {
      mockEnv.AI.run.mockRejectedValueOnce(new Error('Network error: Connection refused'));
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow();
    });

    it('should handle DNS resolution errors', async () => {
      mockEnv.AI.run.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow();
    });
  });

  describe('API Response Errors', () => {
    it('should handle malformed JSON responses', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValueOnce(new SyntaxError('Unexpected token < in JSON at position 0')),
        text: vi.fn().mockResolvedValue('<html>Error page</html>')
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Invalid JSON response');
    });

    it('should handle empty responses', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(null)
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Invalid response format');
    });

    it('should handle 500 Internal Server Error', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error')
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('API Error');
    });

    it('should handle 503 Service Unavailable', async () => {
      const mockResponse = {
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue('Service temporarily unavailable')
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow();
    });

    it('should handle rate limiting with 429 status', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue('Rate limit exceeded'),
        headers: new Headers({
          'Retry-After': '60'
        })
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle 404 model not found', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('Model not found')
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Model not found');
    });
  });

  describe('KV Store Errors', () => {
    it('should gracefully handle KV read failures', async () => {
      mockEnv.COPILOT_KV.get.mockRejectedValueOnce(new Error('KV unavailable'));
      
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'test response'
        })
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      expect(result).toBeDefined();
      expect(result.response).toBe('test response');
    });

    it('should handle KV write failures without blocking response', async () => {
      mockEnv.COPILOT_KV.put.mockRejectedValueOnce(new Error('KV write failed'));
      
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'test response'
        })
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      expect(result).toBeDefined();
      expect(result.response).toBe('test response');
    });

    it('should handle KV list failures during cache clear', async () => {
      mockEnv.COPILOT_KV.list.mockRejectedValueOnce(new Error('KV list failed'));
      
      copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
      
      // Should not throw
      await expect(copilot.clearCache()).resolves.not.toThrow();
    });
  });

  describe('Durable Object Errors', () => {
    it('should handle DO fetch failures gracefully', async () => {
      const mockStub = {
        fetch: vi.fn().mockRejectedValueOnce(new Error('DO unreachable'))
      };
      
      mockEnv.CONVERSATIONS.get.mockReturnValue(mockStub);
      
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'test response'
        })
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        conversationId: 'test-conv'
      });
      
      expect(result).toBeDefined();
      expect(result.response).toBe('test response');
    });

    it('should handle DO save failures without blocking response', async () => {
      const mockStub = {
        fetch: vi.fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }))
          .mockRejectedValueOnce(new Error('DO save failed'))
      };
      
      mockEnv.CONVERSATIONS.get.mockReturnValue(mockStub);
      
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'test response'
        })
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        conversationId: 'test-conv'
      });
      
      expect(result).toBeDefined();
      expect(result.response).toBe('test response');
    });
  });

  describe('Validation Errors', () => {
    it('should not retry on validation errors', async () => {
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      copilot['maxMessageSize'] = 1000; // Set a limit
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'a'.repeat(10000) }] // Exceeds max length
      })).rejects.toThrow('Message size');
      
      // Should not have retried
      expect(mockEnv.AI.run).not.toHaveBeenCalled();
    });

    it('should handle circular reference in request', async () => {
      const circularObj: any = { messages: [{ role: 'user', content: 'test' }] };
      circularObj.messages[0].self = circularObj;
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest(circularObj)).rejects.toThrow();
    });
  });

  describe('Streaming Errors', () => {
    it('should handle stream interruption', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"test": "partial'));
          controller.error(new Error('Stream interrupted'));
        }
      });
      
      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        stream: true
      });
      
      expect(result.streaming).toBe(true);
      
      // Try to read from the stream
      const reader = result.stream.getReader();
      await expect(reader.read()).rejects.toThrow('Stream interrupted');
    });

    it('should handle malformed SSE data', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('invalid sse format\n'));
          controller.enqueue(new TextEncoder().encode('data: {invalid json}\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
          controller.close();
        }
      });
      
      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        stream: true
      });
      
      expect(result.streaming).toBe(true);
      
      // Read the stream to completion
      const reader = result.stream.getReader();
      const chunks = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
      
      // Should have handled the malformed data gracefully
      expect(chunks.join('')).toContain('[DONE]');
    });
  });

  describe('Retry and Circuit Breaker Errors', () => {
    it('should exhaust retries and fail', async () => {
      mockEnv.AI.run
        .mockRejectedValueOnce(new Error('Server error 1'))
        .mockRejectedValueOnce(new Error('Server error 2'))
        .mockRejectedValueOnce(new Error('Server error 3'));
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Server error 3');
      
      // Should have tried maxRetries + 1 times
      expect(mockEnv.AI.run).toHaveBeenCalledTimes(3);
    });

    it('should handle circuit breaker opening', async () => {
      // Simulate multiple failures to open circuit
      for (let i = 0; i < 5; i++) {
        mockEnv.AI.run.mockRejectedValueOnce(new Error('Server error'));
      }
      
      copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
      
      // Make requests that will fail
      for (let i = 0; i < 3; i++) {
        try {
          await copilot.handleRequest({ messages: [{ role: 'user', content: 'test' }] });
        } catch (e) {
          // Expected to fail
        }
      }
      
      // Circuit should be open now
      await expect(copilot.processRequest({
        prompt: 'test'
      })).rejects.toThrow('Circuit breaker is open');
    });
  });

  describe('Fallback Model Errors', () => {
    it('should fall back to secondary model on primary failure', async () => {
      const copilotWithFallback = new CopilotEdge({
        model: '@cf/meta/llama-3.1-8b-instruct',
        fallback: '@cf/meta/llama-2-7b-chat',
        debug: true,
        apiKey: 'test-api-key',
        accountId: 'test-account-id'
      });
      
      // First call fails with 404
      const primaryResponse = {
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('Model not found')
      };
      
      // Second call succeeds with fallback
      const fallbackResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'fallback response'
        })
      };
      
      mockEnv.AI.run
        .mockResolvedValueOnce(primaryResponse)
        .mockResolvedValueOnce(fallbackResponse);
      
      copilotWithFallback['env'] = mockEnv;
      copilotWithFallback['ctx'] = mockCtx;
      
      const result = await copilotWithFallback.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      expect(result.response).toBe('fallback response');
      expect(mockEnv.AI.run).toHaveBeenCalledTimes(2);
    });

    it('should fail if both primary and fallback models fail', async () => {
      const copilotWithFallback = new CopilotEdge({
        model: '@cf/meta/llama-3.1-8b-instruct',
        fallback: '@cf/meta/llama-2-7b-chat',
        debug: true,
        apiKey: 'test-api-key',
        accountId: 'test-account-id'
      });
      
      const errorResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error')
      };
      
      mockEnv.AI.run
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(errorResponse);
      
      copilotWithFallback['env'] = mockEnv;
      copilotWithFallback['ctx'] = mockCtx;
      
      await expect(copilotWithFallback.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('API Error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle response.text() failure', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockRejectedValueOnce(new Error('Cannot read response'))
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Could not read error response');
    });

    it('should handle missing response data', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({})
      };
      
      mockEnv.AI.run.mockResolvedValueOnce(mockResponse);
      
      copilot['env'] = mockEnv;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Invalid response format');
    });

    it('should handle undefined AI binding', async () => {
      const envWithoutAI = { ...mockEnv };
      delete envWithoutAI.AI;
      
      copilot['env'] = envWithoutAI;
      copilot['ctx'] = mockCtx;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('AI binding not available');
    });
  });
});