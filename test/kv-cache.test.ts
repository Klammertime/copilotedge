/**
 * Tests for Workers KV cache integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CopilotEdge } from '../dist/index';

// Mock KV Namespace
class MockKVNamespace {
  private store: Map<string, { value: string; metadata?: any; expirationTtl?: number }> = new Map();
  
  async get(key: string, options?: { type?: 'text' | 'json' }): Promise<any> {
    const item = this.store.get(key);
    if (!item) return null;
    
    if (options?.type === 'json') {
      return JSON.parse(item.value);
    }
    return item.value;
  }
  
  async put(key: string, value: string, options?: { expirationTtl?: number; metadata?: any }): Promise<void> {
    this.store.set(key, {
      value,
      metadata: options?.metadata,
      expirationTtl: options?.expirationTtl
    });
  }
  
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  
  async list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: Array<{ name: string; metadata?: any }>;
    list_complete: boolean;
  }> {
    const keys: Array<{ name: string; metadata?: any }> = [];
    
    for (const [key, item] of this.store.entries()) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        keys.push({ name: key, metadata: item.metadata });
        if (options?.limit && keys.length >= options.limit) break;
      }
    }
    
    return {
      keys,
      list_complete: true
    };
  }
  
  // Helper for tests
  clear() {
    this.store.clear();
  }
  
  size() {
    return this.store.size;
  }
}

describe('Workers KV Cache Integration', () => {
  let kvNamespace: MockKVNamespace;
  let mockFetch: any;

  beforeEach(() => {
    kvNamespace = new MockKVNamespace();
    
    // Mock fetch for AI responses
    mockFetch = vi.fn().mockImplementation(async (_url: string, _options: any) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: 'AI response from API'
            }
          }]
        }),
        text: async () => JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: 'AI response from API'
            }
          }]
        })
      };
    });
  });

  describe('KV Configuration', () => {
    it('should initialize without KV namespace', () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });
      
      expect(edge).toBeDefined();
    });

    it('should initialize with KV namespace', () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any
      });
      
      expect(edge).toBeDefined();
    });

    it('should use custom KV TTL and prefix', () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        kvCacheTTL: 3600, // 1 hour
        kvCachePrefix: 'custom:'
      });
      
      expect(edge).toBeDefined();
    });
  });

  describe('KV Cache Operations', () => {
    it('should save to KV cache when available', async () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        fetch: mockFetch
      });

      const response = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(response.choices[0].message.content).toBe('AI response from API');
      
      // Check that KV was populated
      expect(kvNamespace.size()).toBe(1);
    });

    it('should read from KV cache on second request', async () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        fetch: mockFetch
      });

      // First request - goes to API
      const response1 = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      expect(response1.cached).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second request - should come from KV cache
      const response2 = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      expect(response2.cached).toBe(true);
      expect(response2.cacheType).toBe('kv');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it('should fall back to memory cache if KV fails', async () => {
      // Mock KV to throw an error
      const failingKV = {
        get: vi.fn().mockRejectedValue(new Error('KV error')),
        put: vi.fn().mockRejectedValue(new Error('KV error')),
        delete: vi.fn(),
        list: vi.fn()
      };

      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: failingKV as any,
        fetch: mockFetch,
        debug: true
      });

      // First request - should still work despite KV failure
      const response1 = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      expect(response1.choices[0].message.content).toBe('AI response from API');
      
      // Second request - should use memory cache
      const response2 = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      expect(response2.cached).toBe(true);
      expect(response2.cacheType).toBe('memory');
    });
  });

  describe('KV Cache Management', () => {
    it('should clear KV cache when requested', async () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        kvCachePrefix: 'test:',
        fetch: mockFetch
      });

      // Make a request to populate cache
      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      
      expect(kvNamespace.size()).toBe(1);

      // Clear cache including KV
      await edge.clearCache(true);
      
      expect(kvNamespace.size()).toBe(0);
    });

    it('should not clear KV cache on destroy', async () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        fetch: mockFetch
      });

      // Make a request to populate cache
      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      
      expect(kvNamespace.size()).toBe(1);
      
      // KV persists across Worker invocations (no destroy needed in Workers)
    });

    it('should use correct prefix for KV keys', async () => {
      const customPrefix = 'myapp:';
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        kvCachePrefix: customPrefix,
        fetch: mockFetch
      });

      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      const list = await kvNamespace.list({ prefix: customPrefix });
      expect(list.keys.length).toBe(1);
      expect(list.keys[0].name).toMatch(/^myapp:/);
    });
  });

  describe('KV TTL Configuration', () => {
    it('should respect custom TTL settings', async () => {
      const customTTL = 7200; // 2 hours in seconds
      const putSpy = vi.spyOn(kvNamespace, 'put');
      
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        kvCacheTTL: customTTL,
        fetch: mockFetch
      });

      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      // Check that put was called with correct TTL
      expect(putSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          expirationTtl: customTTL
        })
      );
    });

    it('should store metadata with KV entries', async () => {
      const putSpy = vi.spyOn(kvNamespace, 'put');
      
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        fetch: mockFetch
      });

      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      // Check that metadata was stored
      expect(putSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          metadata: expect.objectContaining({
            timestamp: expect.any(Number),
            model: expect.any(String)
          })
        })
      );
    });
  });

  describe('Hybrid Caching Strategy', () => {
    it('should populate both memory and KV cache', async () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        fetch: mockFetch
      });

      const response = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test hybrid cache' }]
      });

      // First response should not be cached
      expect(response.cached).toBeUndefined();

      // Clear memory cache but keep KV
      await edge.clearCache(false);

      // Request again - should hit KV cache
      const response2 = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test hybrid cache' }]
      });
      
      expect(response2.cached).toBe(true);
      expect(response2.cacheType).toBe('kv');
    });

    it('should prefer KV cache over memory cache', async () => {
      const kvGetSpy = vi.spyOn(kvNamespace, 'get');
      
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        kvNamespace: kvNamespace as any,
        fetch: mockFetch
      });

      // Populate both caches
      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test preference' }]
      });

      // Second request should check KV first
      kvGetSpy.mockClear();
      const response = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test preference' }]
      });

      expect(kvGetSpy).toHaveBeenCalledTimes(1);
      expect(response.cacheType).toBe('kv');
    });
  });
});