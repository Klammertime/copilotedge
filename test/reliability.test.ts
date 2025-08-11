import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotEdge, APIError } from '../dist/index';

vi.setConfig({ testTimeout: 15000 });

describe('CopilotEdge Core Reliability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should prevent unbounded cache growth with LRU eviction', async () => {
    const cacheSize = 5;
    
    // Create a mock fetch that returns proper Cloudflare API responses
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      // Mock response for chat completions endpoint
      if (url.includes('/ai/v1/chat/completions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ 
              message: { 
                role: 'assistant',
                content: 'mocked response' 
              }
            }]
          }),
          text: async () => JSON.stringify({
            choices: [{ 
              message: { 
                role: 'assistant',
                content: 'mocked response' 
              }
            }]
          })
        };
      }
      // Mock response for run endpoint
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            response: 'mocked response'
          }
        }),
        text: async () => JSON.stringify({
          result: {
            response: 'mocked response'
          }
        })
      };
    });
    
    const lruEdge = new CopilotEdge({ 
      apiKey: 'test', 
      accountId: 'test', 
      cacheSize,
      fetch: mockFetch as any
    });

    for (let i = 0; i < 10; i++) {
      await lruEdge.handleRequest({ messages: [{ role: 'user', content: `message ${i}` }] });
    }

    expect((lruEdge as any).cache.size).toBeLessThanOrEqual(cacheSize);
  });

  it('should not retry on 4xx client errors', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    const edge = new CopilotEdge({ apiKey: 'test', accountId: 'test' });

    await expect(edge.handleRequest({ messages: [{ role: 'user', content: 'test' }] }))
        .rejects.toThrow(APIError);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
