import { describe, it, expect, vi, beforeEach } from 'vitest';

// Direct test of CircuitBreaker class
describe('Circuit Breaker Tests', () => {
  class CircuitBreaker {
    private failureCount = 0;
    private successCount = 0;
    private lastFailTime?: Date;
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    
    constructor(
      private threshold = 5,
      private timeout = 60000, // 1 minute
      private successThreshold = 2
    ) {}
    
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      if (this.state === 'open') {
        const now = new Date();
        if (this.lastFailTime && 
            now.getTime() - this.lastFailTime.getTime() > this.timeout) {
          this.state = 'half-open';
          this.successCount = 0;
        } else {
          throw new Error('Circuit breaker is open');
        }
      }
      
      try {
        const result = await fn();
        this.recordSuccess();
        return result;
      } catch (error) {
        this.recordFailure();
        throw error;
      }
    }
    
    private recordSuccess() {
      this.failureCount = 0;
      
      if (this.state === 'half-open') {
        this.successCount++;
        if (this.successCount >= this.successThreshold) {
          this.state = 'closed';
          this.successCount = 0;
        }
      }
    }
    
    private recordFailure() {
      this.failureCount++;
      this.lastFailTime = new Date();
      
      if (this.state === 'half-open') {
        this.state = 'open';
        this.successCount = 0;
      } else if (this.failureCount >= this.threshold) {
        this.state = 'open';
      }
    }
    
    reset() {
      this.failureCount = 0;
      this.successCount = 0;
      this.state = 'closed';
      this.lastFailTime = undefined;
    }
    
    getState() {
      return this.state;
    }
  }

  describe('CircuitBreaker', () => {
    let circuitBreaker: CircuitBreaker;

    beforeEach(() => {
      circuitBreaker = new CircuitBreaker(3, 100, 2); // threshold=3, timeout=100ms, successThreshold=2
    });

    it('should start in closed state', () => {
      expect(circuitBreaker.getState()).toBe('closed');
    });

    it('should remain closed on successful calls', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      
      for (let i = 0; i < 5; i++) {
        const result = await circuitBreaker.execute(fn);
        expect(result).toBe('success');
      }
      
      expect(circuitBreaker.getState()).toBe('closed');
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('should open after threshold failures', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      
      // First failures up to threshold
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe('open');
      
      // Further calls should fail immediately
      await expect(circuitBreaker.execute(fn)).rejects.toThrow('Circuit breaker is open');
      // Function should not be called when circuit is open
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should transition to half-open after timeout', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe('open');
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should allow one attempt (half-open)
      const result = await circuitBreaker.execute(fn);
      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe('half-open');
    });

    it('should close after success threshold in half-open state', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Succeed twice to meet success threshold
      await circuitBreaker.execute(fn);
      expect(circuitBreaker.getState()).toBe('half-open');
      
      await circuitBreaker.execute(fn);
      expect(circuitBreaker.getState()).toBe('closed');
    });

    it('should reopen on failure in half-open state', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success')
        .mockRejectedValue(new Error('fail again'));
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // First success in half-open
      await circuitBreaker.execute(fn);
      expect(circuitBreaker.getState()).toBe('half-open');
      
      // Failure should reopen
      try {
        await circuitBreaker.execute(fn);
      } catch (e) {
        // Expected
      }
      
      expect(circuitBreaker.getState()).toBe('open');
    });

    it('should reset state when reset is called', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      expect(circuitBreaker.getState()).toBe('open');
      
      // Reset
      circuitBreaker.reset();
      expect(circuitBreaker.getState()).toBe('closed');
      
      // Should work normally again
      fn.mockResolvedValue('success');
      const result = await circuitBreaker.execute(fn);
      expect(result).toBe('success');
    });

    it('should handle mixed success and failure below threshold', async () => {
      const fn = vi.fn();
      
      // Fail once
      fn.mockRejectedValueOnce(new Error('fail'));
      try {
        await circuitBreaker.execute(fn);
      } catch (e) {
        // Expected
      }
      
      // Succeed (resets failure count)
      fn.mockResolvedValueOnce('success');
      await circuitBreaker.execute(fn);
      
      // Fail twice more (still below threshold since count was reset)
      fn.mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(fn);
        } catch (e) {
          // Expected
        }
      }
      
      // Should still be closed (only 2 consecutive failures)
      expect(circuitBreaker.getState()).toBe('closed');
    });
  });
});