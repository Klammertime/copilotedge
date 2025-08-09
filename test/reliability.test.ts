/**
 * CopilotEdge Reliability Test Suite
 * Tests for production-grade reliability, fault tolerance, and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import CopilotEdge, { ValidationError, APIError } from '../dist/index';

// Mock fetch for controlled testing
global.fetch = vi.fn();

describe('CopilotEdge Reliability Tests', () => {
  let edge: CopilotEdge;
  
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    (global.fetch as any).mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('1. Memory Management & Resource Leaks', () => {
    it('should prevent unbounded cache growth (LRU eviction)', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        cacheTimeout: 60000
      });

      // Simulate 150 unique requests (cache limit is 100)
      const requests = [];
      for (let i = 0; i < 150; i++) {
        requests.push({
          messages: [{ role: 'user', content: `Test message ${i}` }]
        });
      }

      // Mock successful responses
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: 'Response' }
          }]
        })
      });

      // Process all requests
      for (const req of requests) {
        try {
          await edge.handleRequest(req);
        } catch (e) {
          // Some may fail due to mocking, that's ok for this test
        }
      }

      // Cache should not exceed 100 entries
      const metrics = edge.getMetrics();
      expect(metrics.totalRequests).toBeLessThanOrEqual(150);
      
      // Memory safety: verify no memory leaks by checking internal state
      // The cache Map should have at most 100 entries due to LRU eviction
      expect(edge['cache'].size).toBeLessThanOrEqual(100);
    });

    it('should clean up old rate limit entries to prevent memory leak', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        rateLimit: 10
      });

      // Mock time progression
      const originalNow = Date.now;
      let currentTime = Date.now();
      Date.now = () => currentTime;

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      // Simulate requests over multiple minutes
      for (let minute = 0; minute < 5; minute++) {
        currentTime = originalNow() + (minute * 60000);
        
        // Make a few requests each minute
        for (let i = 0; i < 3; i++) {
          try {
            await edge.handleRequest({
              messages: [{ role: 'user', content: 'Test' }]
            });
          } catch (e) {
            // Rate limit or other errors expected
          }
        }
      }

      // Restore original Date.now
      Date.now = originalNow;

      // Check that old entries are cleaned up
      const requestCount = edge['requestCount'];
      expect(requestCount.size).toBeLessThanOrEqual(2); // Should only keep current and previous minute
    });

    it('should handle large message sanitization without memory overflow', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      // Create a very large message (10MB)
      const largeContent = 'x'.repeat(10 * 1024 * 1024);
      
      const request = {
        messages: [{
          role: 'user',
          content: largeContent
        }]
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      await edge.handleRequest(request);

      // Verify message was truncated to 4000 chars
      const lastCall = (global.fetch as any).mock.lastCall;
      const body = JSON.parse(lastCall[1].body);
      expect(body.messages[0].content.length).toBe(4000);
    });
  });

  describe('2. Rate Limiting & Throttling', () => {
    it('should enforce rate limits correctly under concurrent load', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        rateLimit: 5 // Very low for testing
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      // Fire 10 concurrent requests
      const promises = Array(10).fill(null).map((_, i) => 
        edge.handleRequest({
          messages: [{ role: 'user', content: `Request ${i}` }]
        }).catch(e => e)
      );

      const results = await Promise.all(promises);
      
      // Count successful vs rate-limited requests
      const rateLimited = results.filter(r => 
        r instanceof APIError && r.statusCode === 429
      );
      const successful = results.filter(r => 
        !(r instanceof Error)
      );

      expect(successful.length).toBeLessThanOrEqual(5);
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it('should reset rate limit after time window', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        rateLimit: 2
      });

      const originalNow = Date.now;
      let currentTime = Date.now();
      Date.now = () => currentTime;

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      // Use up rate limit
      await edge.handleRequest({ messages: [{ role: 'user', content: 'Test 1' }] });
      await edge.handleRequest({ messages: [{ role: 'user', content: 'Test 2' }] });

      // Should be rate limited
      await expect(
        edge.handleRequest({ messages: [{ role: 'user', content: 'Test 3' }] })
      ).rejects.toThrow(APIError);

      // Advance time by 1 minute
      currentTime += 60001;

      // Should work again
      await expect(
        edge.handleRequest({ messages: [{ role: 'user', content: 'Test 4' }] })
      ).resolves.toBeTruthy();

      Date.now = originalNow;
    });
  });

  describe('3. Retry Logic & Circuit Breaker', () => {
    it('should implement exponential backoff with jitter', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        maxRetries: 3,
        debug: true
      });

      let callCount = 0;
      const delays: number[] = [];
      const startTimes: number[] = [];

      (global.fetch as any).mockImplementation(async () => {
        callCount++;
        startTimes.push(Date.now());
        
        if (callCount < 3) {
          throw new Error('Network error');
        }
        
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Success' } }]
          })
        };
      });

      const start = Date.now();
      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test' }]
      });

      // Calculate actual delays between retries
      for (let i = 1; i < startTimes.length; i++) {
        delays.push(startTimes[i] - startTimes[i - 1]);
      }

      // Verify exponential backoff pattern (with jitter)
      expect(delays[0]).toBeGreaterThanOrEqual(500); // First retry: ~1s
      expect(delays[0]).toBeLessThanOrEqual(1500);
      
      expect(delays[1]).toBeGreaterThanOrEqual(1500); // Second retry: ~2s
      expect(delays[1]).toBeLessThanOrEqual(2500);
    });

    it('should not retry on 4xx errors except 429', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        maxRetries: 3
      });

      let callCount = 0;
      (global.fetch as any).mockImplementation(async () => {
        callCount++;
        return {
          ok: false,
          status: 400,
          text: async () => 'Bad Request'
        };
      });

      await expect(
        edge.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow(APIError);

      // Should only call once (no retries for 400)
      expect(callCount).toBe(1);
    });

    it('should retry on 429 (rate limit) errors', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        maxRetries: 3
      });

      let callCount = 0;
      (global.fetch as any).mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          return {
            ok: false,
            status: 429,
            text: async () => 'Rate Limited'
          };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Success' } }]
          })
        };
      });

      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test' }]
      });

      // Should retry on 429
      expect(callCount).toBe(2);
    });

    it('should handle max retries exhaustion gracefully', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        maxRetries: 2
      });

      let callCount = 0;
      (global.fetch as any).mockImplementation(async () => {
        callCount++;
        throw new Error('Persistent network error');
      });

      await expect(
        edge.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow('Persistent network error');

      expect(callCount).toBe(2); // Initial + 1 retry
      
      // Verify error metrics updated
      const metrics = edge.getMetrics();
      expect(metrics.errors).toBeGreaterThan(0);
    });
  });

  describe('4. Timeout Handling', () => {
    it('should timeout long-running requests (10s limit)', { timeout: 15000 }, async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      (global.fetch as any).mockImplementation(() => 
        new Promise((resolve) => {
          // Never resolves, simulating hung request
          setTimeout(() => resolve({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'Too late' } }] })
          }), 60000);
        })
      );

      // Should timeout and throw
      await expect(
        edge.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow();
    });

    it('should handle region selection timeout (2s limit)', { timeout: 15000 }, async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      let callCount = 0;
      (global.fetch as any).mockImplementation((url: string) => {
        callCount++;
        if (url.includes('/client/v4')) {
          // Region check - simulate timeout
          return new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false }), 3000);
          });
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Response' } }]
          })
        };
      });

      // Should fallback to default region after timeout
      await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test' }]
      });

      // Should have attempted region checks
      expect(callCount).toBeGreaterThan(0);
    });
  });

  describe('5. Concurrent Request Handling', () => {
    it('should handle race conditions in cache access', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        cacheTimeout: 60000
      });

      let callCount = 0;
      (global.fetch as any).mockImplementation(async () => {
        callCount++;
        // Simulate varying response times
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: `Response ${callCount}` } }]
          })
        };
      });

      // Fire identical requests concurrently
      const request = { messages: [{ role: 'user', content: 'Same message' }] };
      const promises = Array(10).fill(null).map(() => 
        edge.handleRequest(request)
      );

      const results = await Promise.all(promises);
      
      // All should succeed
      expect(results.every(r => r)).toBeTruthy();
      
      // Some should be from cache (not all should trigger API calls)
      const metrics = edge.getMetrics();
      expect(metrics.cacheHits).toBeGreaterThan(0);
    });

    it('should handle concurrent region selection properly', async () => {
      // Create multiple instances
      const edges = Array(5).fill(null).map(() => 
        new CopilotEdge({
          apiKey: 'test-key',
          accountId: 'test-account'
        })
      );

      (global.fetch as any).mockImplementation(async (url: string) => {
        if (url.includes('/client/v4')) {
          // Simulate varying latencies for regions
          await new Promise(resolve => 
            setTimeout(resolve, Math.random() * 100)
          );
          return { ok: true };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Response' } }]
          })
        };
      });

      // All instances try to select regions concurrently
      const promises = edges.map(e => 
        e.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        }).catch(() => null)
      );

      const results = await Promise.all(promises);
      
      // All should handle region selection without race conditions
      expect(results.filter(r => r !== null).length).toBeGreaterThan(0);
    });
  });

  describe('6. Error Recovery & Graceful Degradation', () => {
    it('should continue working after region failure', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      let regionCheckCount = 0;
      (global.fetch as any).mockImplementation(async (url: string) => {
        if (url.includes('/client/v4')) {
          regionCheckCount++;
          // All region checks fail
          throw new Error('Region unavailable');
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Response' } }]
          })
        };
      });

      // Should still work with default region
      const result = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test' }]
      });

      expect(result).toBeTruthy();
      expect(regionCheckCount).toBeGreaterThan(0);
    });

    it('should handle partial API response gracefully', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          // Missing expected fields
          choices: []
        })
      });

      await expect(
        edge.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow('Invalid response from Cloudflare AI');
    });

    it('should handle malformed JSON response', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        }
      });

      await expect(
        edge.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow();
    });
  });

  describe('7. Input Validation & Sanitization', () => {
    it('should reject requests with invalid message roles', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      await expect(
        edge.handleRequest({
          messages: [{ role: 'hacker', content: 'Malicious' }]
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should handle missing required fields', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      await expect(
        edge.handleRequest({
          messages: [{ role: 'user' }] // Missing content
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should handle extremely nested objects without stack overflow', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      // Create deeply nested object
      let nested: any = { content: 'test' };
      for (let i = 0; i < 1000; i++) {
        nested = { nested };
      }

      // Should handle without crashing
      await expect(
        edge.handleRequest({
          messages: [{ role: 'user', content: JSON.stringify(nested) }]
        })
      ).rejects.toThrow();
    });

    it('should sanitize and truncate oversized messages', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      const longContent = 'x'.repeat(5000);
      await edge.handleRequest({
        messages: [{ role: 'user', content: longContent }]
      });

      const lastCall = (global.fetch as any).mock.lastCall;
      const body = JSON.parse(lastCall[1].body);
      
      // Should be truncated to 4000 chars
      expect(body.messages[0].content.length).toBe(4000);
    });
  });

  describe('8. Cache Consistency', () => {
    it('should handle cache key collisions', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      let responseCount = 0;
      (global.fetch as any).mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ 
            message: { content: `Response ${++responseCount}` } 
          }]
        })
      }));

      // Different requests that might have hash collisions
      const req1 = { messages: [{ role: 'user', content: 'Test A' }] };
      const req2 = { messages: [{ role: 'user', content: 'Test B' }] };

      const res1 = await edge.handleRequest(req1);
      const res2 = await edge.handleRequest(req2);

      // Should get different responses (no false cache hits)
      expect(res1).not.toEqual(res2);
    });

    it('should expire cache entries correctly', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        cacheTimeout: 100 // 100ms for testing
      });

      let callCount = 0;
      (global.fetch as any).mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Response' } }]
          })
        };
      });

      const request = { messages: [{ role: 'user', content: 'Test' }] };

      // First call
      await edge.handleRequest(request);
      expect(callCount).toBe(1);

      // Immediate second call (should hit cache)
      await edge.handleRequest(request);
      expect(callCount).toBe(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Third call (cache expired, should hit API)
      await edge.handleRequest(request);
      expect(callCount).toBe(2);
    });
  });

  describe('9. State Management', () => {
    it('should maintain metrics accuracy under concurrent load', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      (global.fetch as any).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Response' } }]
          })
        };
      });

      // Fire many concurrent requests
      const promises = Array(20).fill(null).map((_, i) => 
        edge.handleRequest({
          messages: [{ role: 'user', content: `Test ${i}` }]
        }).catch(() => null)
      );

      await Promise.all(promises);

      const metrics = edge.getMetrics();
      
      // Metrics should be consistent
      expect(metrics.totalRequests).toBe(20);
      expect(metrics.errorRate).toBeLessThanOrEqual(1);
      expect(metrics.avgLatency).toBeGreaterThan(0);
    });

    it('should handle metrics overflow', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      // Force metrics to large values
      edge['metrics'].totalRequests = Number.MAX_SAFE_INTEGER - 10;
      edge['metrics'].errors = Number.MAX_SAFE_INTEGER - 10;

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      // Should handle without overflow errors
      for (let i = 0; i < 20; i++) {
        await edge.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        }).catch(() => null);
      }

      const metrics = edge.getMetrics();
      expect(metrics).toBeDefined();
    });
  });

  describe('10. Edge Cases & Boundary Conditions', () => {
    it('should handle empty message arrays', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      await expect(
        edge.handleRequest({ messages: [] })
      ).rejects.toThrow();
    });

    it('should handle null/undefined in messages', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      await expect(
        edge.handleRequest({
          messages: [null as any]
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should handle GraphQL mutations with empty messages', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      const result = await edge.handleRequest({
        operationName: 'generateCopilotResponse',
        variables: {
          data: {
            threadId: 'test-thread',
            messages: []
          }
        }
      });

      // Should return default response
      expect(result.data.generateCopilotResponse.messages[0].content[0])
        .toContain('Hello');
    });

    it('should handle special characters in content', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      const specialChars = '\\n\\r\\t"\'`${}[]()<>;&|';
      await edge.handleRequest({
        messages: [{ role: 'user', content: specialChars }]
      });

      const lastCall = (global.fetch as any).mock.lastCall;
      const body = JSON.parse(lastCall[1].body);
      
      // Should handle special characters
      expect(body.messages[0].content).toBe(specialChars);
    });

    it('should handle unicode and emoji in messages', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response 👍' } }]
        })
      });

      const result = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test 测试 🚀' }]
      });

      expect(result.choices[0].message.content).toContain('👍');
    });
  });

  describe('11. Network Resilience', () => {
    it('should handle DNS resolution failures', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        maxRetries: 2
      });

      (global.fetch as any).mockRejectedValue(
        new Error('getaddrinfo ENOTFOUND')
      );

      await expect(
        edge.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow('getaddrinfo ENOTFOUND');
    });

    it('should handle connection reset errors', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        maxRetries: 3
      });

      let attempts = 0;
      (global.fetch as any).mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('ECONNRESET');
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Success after retry' } }]
          })
        };
      });

      const result = await edge.handleRequest({
        messages: [{ role: 'user', content: 'Test' }]
      });

      expect(result.choices[0].message.content).toBe('Success after retry');
      expect(attempts).toBe(3);
    });

    it('should handle partial response/connection drop', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => {
          // Simulate partial JSON parse error
          throw new SyntaxError('Unexpected end of JSON input');
        }
      });

      await expect(
        edge.handleRequest({
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow();
    });
  });

  describe('12. Security & Input Validation', () => {
    it('should detect potential injection attempts', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      const injectionAttempts = [
        { role: '../../../etc/passwd', content: 'test' },
        { role: 'user', content: '<script>alert(1)</script>' },
        { role: 'user\'; DROP TABLE users; --', content: 'test' }
      ];

      for (const attempt of injectionAttempts) {
        await expect(
          edge.handleRequest({ messages: [attempt as any] })
        ).rejects.toThrow();
      }
    });

    it('should handle prototype pollution attempts', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      const maliciousPayload = {
        messages: [{ role: 'user', content: 'test' }],
        '__proto__': { isAdmin: true },
        'constructor': { prototype: { isAdmin: true } }
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      // Should process without pollution
      await edge.handleRequest(maliciousPayload);
      
      // Verify no pollution occurred
      expect((edge as any).isAdmin).toBeUndefined();
      expect(Object.prototype.hasOwnProperty('isAdmin')).toBe(false);
    });
  });

  describe('13. Performance Under Load', () => {
    it('should maintain sub-second response times under load', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        cacheTimeout: 60000
      });

      (global.fetch as any).mockImplementation(async () => {
        // Simulate API latency
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Response' } }]
          })
        };
      });

      const start = Date.now();
      
      // Simulate load with mixed cached/uncached requests
      const requests = Array(50).fill(null).map((_, i) => ({
        messages: [{ 
          role: 'user', 
          content: i < 25 ? 'Cached request' : `Unique ${i}` 
        }]
      }));

      const promises = requests.map(r => 
        edge.handleRequest(r).catch(() => null)
      );

      await Promise.all(promises);
      
      const elapsed = Date.now() - start;
      
      // Should complete within reasonable time despite load
      expect(elapsed).toBeLessThan(5000); // 5 seconds for 50 requests
      
      // Cache should have helped
      const metrics = edge.getMetrics();
      expect(metrics.cacheHits).toBeGreaterThan(0);
    });
  });

  describe('14. Sensitive Content Detection', () => {
    it('should detect API keys and secrets when enabled', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        enableInternalSensitiveLogging: true,
        debug: true
      });

      const consoleSpy = vi.spyOn(console, 'warn');

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      const handler = edge.createNextHandler();
      
      // Simulate Next.js request with sensitive data
      const mockReq = {
        json: async () => ({
          messages: [
            { role: 'user', content: 'My API key is sk_live_abcd1234' }
          ]
        })
      } as any;

      await handler(mockReq);

      // Should have logged warning
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('sensitive content detected')
      );

      consoleSpy.mockRestore();
    });

    it('should not expose sensitive detection in response headers', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        enableInternalSensitiveLogging: true
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      const handler = edge.createNextHandler();
      
      const mockReq = {
        json: async () => ({
          messages: [
            { role: 'user', content: 'password: secret123' }
          ]
        })
      } as any;

      const response = await handler(mockReq);
      const headers = Object.fromEntries(response.headers.entries());
      
      // Should NOT have sensitive content header
      expect(headers['X-Contained-Sensitive']).toBeUndefined();
    });

    it('should be disabled by default for security', () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
        // enableInternalSensitiveLogging not set
      });

      expect(edge['enableInternalSensitiveLogging']).toBe(false);
    });
  });

  describe('15. System Recovery & Cleanup', () => {
    it('should recover from out-of-memory scenarios', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      // Fill cache to near limit
      for (let i = 0; i < 99; i++) {
        edge['cache'].set(`key-${i}`, {
          data: { large: 'x'.repeat(1000) },
          timestamp: Date.now()
        });
      }

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      // Should handle new requests and evict old cache
      await edge.handleRequest({
        messages: [{ role: 'user', content: 'New request' }]
      });

      expect(edge['cache'].size).toBeLessThanOrEqual(100);
    });

    it('should cleanup aborted requests properly', async () => {
      edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });

      const abortController = new AbortController();
      
      (global.fetch as any).mockImplementation(async (url: string, opts: any) => {
        if (opts.signal) {
          return new Promise((resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              reject(new Error('AbortError'));
            });
            setTimeout(() => resolve({
              ok: true,
              json: async () => ({ choices: [{ message: { content: 'Late' } }] })
            }), 1000);
          });
        }
        return { ok: true, json: async () => ({ choices: [] }) };
      });

      // Start request then abort
      const promise = edge.handleRequest({
        messages: [{ role: 'user', content: 'Test' }]
      });

      setTimeout(() => abortController.abort(), 50);

      await expect(promise).rejects.toThrow();
      
      // Metrics should reflect the error
      const metrics = edge.getMetrics();
      expect(metrics.errors).toBeGreaterThan(0);
    });
  });
});

describe('Integration Stress Tests', () => {
  it('should handle sustained high load without degradation', async () => {
    const edge = new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account',
      rateLimit: 100,
      cacheTimeout: 60000,
      maxRetries: 2
    });

    let apiCalls = 0;
    (global.fetch as any).mockImplementation(async () => {
      apiCalls++;
      // Simulate variable latency
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      
      // Simulate occasional failures
      if (Math.random() < 0.1) {
        throw new Error('Random failure');
      }
      
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: `Response ${apiCalls}` } }]
        })
      };
    });

    const startTime = Date.now();
    const duration = 2000; // Run for 2 seconds
    const results = { success: 0, failure: 0, cached: 0 };
    
    // Generate continuous load
    while (Date.now() - startTime < duration) {
      const promises = Array(10).fill(null).map((_, i) => 
        edge.handleRequest({
          messages: [{ 
            role: 'user', 
            content: i % 3 === 0 ? 'Repeated' : `Unique ${Date.now()}-${i}`
          }]
        }).then(r => {
          results.success++;
          if (r.cached) results.cached++;
          return r;
        }).catch(e => {
          results.failure++;
          return null;
        })
      );
      
      await Promise.all(promises);
      
      // Small delay between batches
      await new Promise(r => setTimeout(r, 100));
    }

    const metrics = edge.getMetrics();
    
    // System should have handled load
    expect(results.success).toBeGreaterThan(0);
    expect(results.cached).toBeGreaterThan(0); // Cache should have helped
    expect(metrics.avgLatency).toBeLessThan(1000); // Sub-second average
    expect(edge['cache'].size).toBeLessThanOrEqual(100); // Cache limit maintained
    
    console.log('Stress test results:', {
      totalRequests: results.success + results.failure,
      successRate: (results.success / (results.success + results.failure) * 100).toFixed(1) + '%',
      cacheHitRate: (results.cached / results.success * 100).toFixed(1) + '%',
      avgLatency: metrics.avgLatency + 'ms'
    });
  });
});