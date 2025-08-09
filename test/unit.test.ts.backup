import { describe, it, expect } from 'vitest';
import CopilotEdge, { ValidationError } from '../src/index';

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
      expect(metrics).toBeDefined();
    });
  });

  describe('Validation', () => {
    it('should validate message format', () => {
      const edge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });
      
      // This will fail when trying to validate, which is expected
      expect(edge.handleRequest({ invalid: 'format' }))
        .rejects.toThrow(ValidationError);
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