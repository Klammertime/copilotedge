import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CopilotEdge } from '../dist/index';

describe('Memory Leak Prevention', () => {
  let edge: CopilotEdge;
  let clearTimeoutSpy: any;
  let setTimeoutSpy: any;

  beforeEach(() => {
    // Spy on global timer functions
    clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    
    edge = new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account',
      debug: false,
      maxRetries: 2
    });
  });

  afterEach(() => {
    // Clean up
    if (edge) {
      edge.destroy();
    }
    clearTimeoutSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });

  describe('Timer Cleanup in Retry Logic', () => {
    it('should clean up timers after successful sleep', async () => {
      const sleepMs = 100;
      
      await edge.sleep(sleepMs);
      
      // Verify setTimeout was called
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), sleepMs);
      
      // Verify clearTimeout was called to clean up
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clean up timers when sleep completes normally', async () => {
      // Start sleep and let it complete
      await edge.sleep(10);
      
      // Verify cleanup was called
      expect(clearTimeoutSpy).toHaveBeenCalled();
      
      // No active timers should remain
      expect(edge.activeTimers?.size || 0).toBe(0);
    });

    it('should track active timers in a Set', async () => {
      await edge.sleep(50);
      
      // After sleep completes, activeTimers should exist but be empty
      expect(edge.activeTimers).toBeDefined();
      expect(edge.activeTimers.size).toBe(0);
    });
  });

  describe('Resource Cleanup on Destroy', () => {
    it('should clear all active timers on destroy', async () => {
      // Start a few sleeps
      const sleepPromises = [
        edge.sleep(1000),
        edge.sleep(2000),
        edge.sleep(3000)
      ];
      
      // Wait a bit for timers to be set
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Destroy should clean up all timers
      edge.destroy();
      
      // Verify clearTimeout was called multiple times
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
      
      // activeTimers should be cleared
      expect(edge.activeTimers?.size || 0).toBe(0);
    });

    it('should clear all caches on destroy', () => {
      // Add some data to caches
      edge.cache.set('test-key', { data: 'test', timestamp: Date.now() });
      edge.cacheLocks.set('lock-key', Promise.resolve());
      edge.requestCount.set('count-key', 5);
      edge.regionLatencies.set('region', 100);
      
      // Verify data exists
      expect(edge.cache.size).toBeGreaterThan(0);
      expect(edge.requestCount.size).toBeGreaterThan(0);
      expect(edge.regionLatencies.size).toBeGreaterThan(0);
      
      // Destroy
      edge.destroy();
      
      // All caches should be cleared
      expect(edge.cache.size).toBe(0);
      expect(edge.cacheLocks.size).toBe(0);
      expect(edge.requestCount.size).toBe(0);
      expect(edge.regionLatencies.size).toBe(0);
    });

    it('should reset circuit breaker on destroy', () => {
      // Simulate failures to open circuit
      edge.circuitBreaker.recordFailure();
      edge.circuitBreaker.recordFailure();
      edge.circuitBreaker.recordFailure();
      edge.circuitBreaker.recordFailure();
      edge.circuitBreaker.recordFailure();
      
      expect(edge.circuitBreaker.state).toBe('open');
      expect(edge.circuitBreaker.failures).toBe(5);
      
      // Destroy
      edge.destroy();
      
      // Circuit breaker should be reset
      expect(edge.circuitBreaker.state).toBe('closed');
      expect(edge.circuitBreaker.failures).toBe(0);
    });

    it('should log cleanup in debug mode', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      const debugEdge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        debug: true
      });
      
      debugEdge.destroy();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CopilotEdge] Instance destroyed')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Cache Lock Cleanup', () => {
    it('should clear cache locks on clearCache', () => {
      // Add cache lock
      edge.cacheLocks.set('test-lock', Promise.resolve());
      
      expect(edge.cacheLocks.size).toBe(1);
      
      edge.clearCache();
      
      expect(edge.cacheLocks.size).toBe(0);
    });
  });

  describe('Abort Controller Cleanup', () => {
    it('should clean up abort controller timeouts in region selection', async () => {
      // Mock fetch to simulate slow response
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ ok: true }), 100))
      );
      
      try {
        await edge.findFastestRegion();
        
        // Verify cleanup was called for abort controller timeouts
        // 3 regions = 3 timeouts that should be cleared
        const clearTimeoutCalls = clearTimeoutSpy.mock.calls.length;
        expect(clearTimeoutCalls).toBeGreaterThanOrEqual(3);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should clean up abort controller timeouts in API calls', async () => {
      // Mock fetch
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'test response' } }]
        })
      });
      
      try {
        const region = { name: 'test', url: 'https://api.test.com' };
        await edge.callCloudflareAI([{ role: 'user', content: 'test' }], region);
        
        // Verify timeout was set and cleared
        expect(setTimeoutSpy).toHaveBeenCalled();
        expect(clearTimeoutSpy).toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('Memory Usage Patterns', () => {
    it('should not accumulate timers over multiple retries', async () => {
      let attemptCount = 0;
      const failingFn = async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error('Temporary failure');
        }
        return 'success';
      };
      
      await edge.retryWithBackoff(failingFn);
      
      // All retry timers should be cleaned up
      expect(edge.activeTimers?.size || 0).toBe(0);
    });

    it('should handle concurrent sleep operations correctly', async () => {
      const sleepPromises = [
        edge.sleep(50),
        edge.sleep(75),
        edge.sleep(100)
      ];
      
      await Promise.all(sleepPromises);
      
      // All timers should be cleaned up
      expect(edge.activeTimers?.size || 0).toBe(0);
      
      // clearTimeout should have been called for each timer
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });
});