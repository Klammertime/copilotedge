import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CopilotEdge } from '../src/index';

describe('Error Handling Tests', () => {
  let copilot: CopilotEdge;
  let mockFetch: any;
  let mockEnv: any;
  let mockCtx: any;

  beforeEach(() => {
    console.log('Test environment setup complete');
    
    // Create a mock fetch function
    mockFetch = vi.fn();
    
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
      enableConversations: true,
      apiKey: 'test-api-key',
      accountId: 'test-account-id'
    });
    
    // Override the fetch method
    copilot['fetch'] = mockFetch;
    copilot['env'] = mockEnv;
    copilot['ctx'] = mockCtx;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Network Errors', () => {
    it('should handle fetch timeout errors', async () => {
      mockFetch.mockRejectedValue(new Error('AbortError: The operation was aborted'));
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Fetch error');
      
      // Should retry based on maxRetries
      expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should handle network connection errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error: Connection refused'));
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Fetch error');
      
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should handle DNS resolution errors', async () => {
      mockFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Fetch error');
      
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('API Response Errors', () => {
    it('should handle malformed JSON responses', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
        text: vi.fn().mockResolvedValue('<html>Error page</html>')
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
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
      
      mockFetch.mockResolvedValue(mockResponse);
      
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
      
      mockFetch.mockResolvedValue(mockResponse);
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Cloudflare AI error');
      
      // Should retry on 500 errors
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should handle 503 Service Unavailable', async () => {
      const mockResponse = {
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue('Service temporarily unavailable')
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Cloudflare AI error');
      
      expect(mockFetch).toHaveBeenCalledTimes(3);
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
      
      mockFetch.mockResolvedValue(mockResponse);
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Cloudflare AI error');
    });

    it('should handle 404 model not found', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('Model not found')
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Cloudflare AI error');
    });
  });

  describe('KV Store Errors', () => {
    it('should gracefully handle KV read failures', async () => {
      mockEnv.COPILOT_KV.get.mockRejectedValue(new Error('KV unavailable'));
      
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'test response'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      expect(result).toBeDefined();
      expect(result.choices[0].message.content).toBe('test response');
    });

    it('should handle KV write failures without blocking response', async () => {
      mockEnv.COPILOT_KV.put.mockRejectedValue(new Error('KV write failed'));
      
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'test response'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      expect(result).toBeDefined();
      expect(result.choices[0].message.content).toBe('test response');
    });

    it('should handle KV list failures during cache clear', async () => {
      mockEnv.COPILOT_KV.list.mockRejectedValue(new Error('KV list failed'));
      
      // Should not throw
      await expect(copilot.clearCache()).resolves.not.toThrow();
    });
  });

  describe('Durable Object Errors', () => {
    it('should handle DO fetch failures gracefully', async () => {
      const mockStub = {
        fetch: vi.fn().mockRejectedValue(new Error('DO unreachable'))
      };
      
      mockEnv.CONVERSATIONS.get.mockReturnValue(mockStub);
      
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          response: 'test response'
        })
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        conversationId: 'test-conv'
      });
      
      expect(result).toBeDefined();
      expect(result.choices[0].message.content).toBe('test response');
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
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        conversationId: 'test-conv'
      });
      
      expect(result).toBeDefined();
      expect(result.choices[0].message.content).toBe('test response');
    });
  });

  describe('Validation Errors', () => {
    it('should not retry on validation errors', async () => {
      copilot['maxMessageSize'] = 1000; // Set a limit
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'a'.repeat(10000) }]
      })).rejects.toThrow('Message size');
      
      // Should not have retried
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle invalid message roles', async () => {
      await expect(copilot.handleRequest({
        messages: [{ role: 'invalid', content: 'test' }]
      })).rejects.toThrow('Invalid role');
      
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle missing message content', async () => {
      await expect(copilot.handleRequest({
        messages: [{ role: 'user' }]
      })).rejects.toThrow('must have role and content');
      
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle max messages limit', async () => {
      copilot['maxMessages'] = 2;
      
      await expect(copilot.handleRequest({
        messages: [
          { role: 'user', content: 'test1' },
          { role: 'assistant', content: 'response1' },
          { role: 'user', content: 'test2' }
        ]
      })).rejects.toThrow('Number of messages');
      
      expect(mockFetch).not.toHaveBeenCalled();
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
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        stream: true
      });
      
      expect(result.streaming).toBe(true);
      
      // Try to read from the stream
      const reader = result.stream.getReader();
      await expect(reader.read()).rejects.toThrow('Stream interrupted');
    });

    it('should handle malformed SSE data gracefully', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('invalid sse format\n'));
          controller.enqueue(new TextEncoder().encode('data: {invalid json}\n'));
          controller.enqueue(new TextEncoder().encode('data: {"valid": "data"}\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
          controller.close();
        }
      });
      
      const mockResponse = {
        ok: true,
        status: 200,
        body: mockStream
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        stream: true
      });
      
      expect(result.streaming).toBe(true);
      
      // Read the stream to completion
      const reader = result.stream.getReader();
      const chunks: string[] = [];
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(new TextDecoder().decode(value));
        }
      } catch (e) {
        // Stream might error, that's ok for this test
      }
      
      // Should have processed some data
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('Retry and Circuit Breaker', () => {
    it('should retry on transient errors', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockRejectedValueOnce(new Error('Another temporary failure'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ response: 'success' })
        });
      
      const result = await copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      expect(result).toBeDefined();
      expect(result.choices[0].message.content).toBe('success');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should exhaust retries and fail', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent failure'));
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Persistent failure');
      
      expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should implement exponential backoff', async () => {
      const startTime = Date.now();
      
      mockFetch.mockRejectedValue(new Error('Failure'));
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow();
      
      const endTime = Date.now();
      const elapsed = endTime - startTime;
      
      // With exponential backoff, retries should add delay
      // The actual delay will vary but should be noticeable
      expect(elapsed).toBeGreaterThan(100);
    });
  });

  describe('Fallback Model', () => {
    it('should fall back to secondary model on 404', async () => {
      const copilotWithFallback = new CopilotEdge({
        model: '@cf/meta/llama-3.1-8b-instruct',
        fallback: '@cf/meta/llama-2-7b-chat',
        debug: true,
        apiKey: 'test-api-key',
        accountId: 'test-account-id'
      });
      
      copilotWithFallback['fetch'] = mockFetch;
      copilotWithFallback['env'] = mockEnv;
      copilotWithFallback['ctx'] = mockCtx;
      
      // First call fails with 404
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: vi.fn().mockResolvedValue('Model not found')
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({ response: 'fallback response' })
        });
      
      const result = await copilotWithFallback.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      expect(result.choices[0].message.content).toBe('fallback response');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should fail if both primary and fallback models fail', async () => {
      const copilotWithFallback = new CopilotEdge({
        model: '@cf/meta/llama-3.1-8b-instruct',
        fallback: '@cf/meta/llama-2-7b-chat',
        debug: true,
        apiKey: 'test-api-key',
        accountId: 'test-account-id'
      });
      
      copilotWithFallback['fetch'] = mockFetch;
      copilotWithFallback['env'] = mockEnv;
      copilotWithFallback['ctx'] = mockCtx;
      
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error')
      });
      
      await expect(copilotWithFallback.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Cloudflare AI error');
      
      // Should retry for both models
      expect(mockFetch).toHaveBeenCalledTimes(6); // 3 for primary, 3 for fallback
    });
  });

  describe('Edge Cases', () => {
    it('should handle response.text() failure', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockRejectedValue(new Error('Cannot read response'))
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Could not read error response');
    });

    it('should handle missing response data for chat models', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({})
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow('Invalid response format');
    });

    it('should handle undefined env', async () => {
      copilot['env'] = undefined;
      
      await expect(copilot.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      })).rejects.toThrow();
    });
  });
});