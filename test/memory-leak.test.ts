import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CopilotEdge } from '../dist/index';

describe('Memory Leak Prevention', () => {
  let edge: CopilotEdge;

  beforeEach(() => {
    edge = new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account',
      debug: false,
    });
    vi.useFakeTimers();
  });

  describe('Resource Cleanup on Destroy', () => {
    it('should clear all caches on destroy', async () => {
      // Populate caches
      (edge as any).cache.set('cache-key', { data: 'test', timestamp: Date.now() });
      (edge as any).cacheLocks.set('lock-key', Promise.resolve());
      (edge as any).requestCount.set('count-key', 5);

      // Verify data exists
      expect((edge as any).cache.size).toBe(1);
      expect((edge as any).cacheLocks.size).toBe(1);
      expect((edge as any).requestCount.size).toBe(1);

      // Destroy and verify cleanup
      await edge.destroy();
      expect((edge as any).cache.size).toBe(0);
      expect((edge as any).cacheLocks.size).toBe(0);
      expect((edge as any).requestCount.size).toBe(0);
    });

    it('should reset circuit breaker on destroy', async () => {
      // Trip the circuit breaker
      const circuitBreaker = (edge as any).circuitBreaker;
      for (let i = 0; i < circuitBreaker.failureThreshold; i++) {
        (circuitBreaker as any).recordFailure();
      }
      expect((circuitBreaker as any).state).toBe('open');

      // Destroy and check
      await edge.destroy();
      const newCircuitBreaker = (edge as any).circuitBreaker;
      expect(newCircuitBreaker.state).toBe('closed');
    });

    it('should log cleanup in debug mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const debugEdge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        debug: true,
      });

      await debugEdge.destroy();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cache cleared'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Instance destroyed'));
      consoleSpy.mockRestore();
    });
  });

  describe('Abort Controller Cleanup', () => {
    it('should clean up abort controller timeouts in API calls', async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
      
      // Mock a fetch that never resolves to force a timeout
      vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));

      const requestPromise = edge.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });

      await vi.advanceTimersByTimeAsync(35000); // Advance past 30s timeout

      await expect(requestPromise).rejects.toThrow();
      
      // The abort signal should have been triggered
      expect(abortSpy).toHaveBeenCalled();

      abortSpy.mockRestore();
    });
  });
});