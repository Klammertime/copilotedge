import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CopilotEdge, ValidationError } from '../dist/index';

describe('DoS Protection - Request Size Limits', () => {
  let edge: CopilotEdge;

  beforeEach(() => {
    edge = new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account',
      maxRequestSize: 1024, // 1KB for testing
      maxMessages: 5,
      maxMessageSize: 100, // 100 bytes for testing
      maxObjectDepth: 3,
      debug: false
    });
  });

  describe('Request Size Validation', () => {
    it('should accept requests within size limit', () => {
      const smallRequest = {
        messages: [
          { role: 'user', content: 'Hello' }
        ]
      };
      
      expect(() => (edge as any).validateRequest(smallRequest)).not.toThrow();
    });

    it('should reject requests exceeding size limit', () => {
      const largeContent = 'x'.repeat(2000); // 2KB content
      const largeRequest = {
        messages: [
          { role: 'user', content: largeContent }
        ]
      };
      
      expect(() => (edge as any).validateRequest(largeRequest))
        .toThrow(ValidationError);
      expect(() => (edge as any).validateRequest(largeRequest))
        .toThrow(/exceeds maximum allowed size/);
    });
  });

  describe('Message Count Validation', () => {
    it('should accept requests within message count limit', () => {
      const request = {
        messages: [
          { role: 'user', content: 'msg1' },
          { role: 'assistant', content: 'msg2' },
          { role: 'user', content: 'msg3' }
        ]
      };
      
      expect(() => (edge as any).validateRequest(request)).not.toThrow();
    });

    it('should reject requests exceeding message count limit', () => {
      const messages = Array(10).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`
      }));
      
      const request = { messages };
      
      expect(() => (edge as any).validateRequest(request))
        .toThrow(ValidationError);
      expect(() => (edge as any).validateRequest(request))
        .toThrow(/Number of messages.*exceeds maximum allowed/);
    });
  });

  describe('Individual Message Size Validation', () => {
    it('should accept messages within size limit', () => {
      const request = {
        messages: [
          { role: 'user', content: 'Short message' }
        ]
      };
      
      expect(() => (edge as any).validateRequest(request)).not.toThrow();
    });

    it('should reject messages exceeding individual size limit', () => {
      const largeMessage = 'x'.repeat(200); // 200 bytes, limit is 100
      const request = {
        messages: [
          { role: 'user', content: 'ok' },
          { role: 'assistant', content: largeMessage }
        ]
      };
      
      expect(() => (edge as any).validateRequest(request))
        .toThrow(ValidationError);
      expect(() => (edge as any).validateRequest(request))
        .toThrow(/Message size.*exceeds maximum allowed/);
    });
  });

  describe('Object Depth Validation', () => {
    it('should accept objects within depth limit', () => {
      const request = {
        messages: [
          { role: 'user', content: 'test' }
        ],
        metadata: {
          level1: {
            level2: 'value'
          }
        }
      };
      
      expect(() => (edge as any).validateRequest(request)).not.toThrow();
    });

    it('should reject deeply nested objects', () => {
      const deeplyNested: any = { messages: [] };
      let current = deeplyNested;
      
      // Create object with depth of 5 (limit is 3)
      for (let i = 0; i < 5; i++) {
        current.nested = { level: i };
        current = current.nested;
      }
      
      expect(() => (edge as any).validateRequest(deeplyNested))
        .toThrow(ValidationError);
      expect(() => (edge as any).validateRequest(deeplyNested))
        .toThrow(/exceeds maximum nesting depth/);
    });

    it('should handle arrays in depth checking', () => {
      const request = {
        messages: [
          { 
            role: 'user', 
            content: 'test'
          }
        ]
      };
      
      // Simple request should not exceed depth
      expect(() => (edge as any).validateRequest(request)).not.toThrow();
      
      // Test with nested structure at the limit
      const nestedRequest = {
        messages: [
          { role: 'user', content: 'test' }
        ],
        meta: { level1: { value: 'ok' } } // Depth 3, at the limit
      };
      
      expect(() => (edge as any).validateRequest(nestedRequest)).not.toThrow();
    });
  });

  describe('GraphQL Request Validation', () => {
    it('should validate GraphQL mutation size', () => {
      const graphQLRequest = {
        operationName: 'generateCopilotResponse',
        variables: {
          data: {
            messages: Array(100).fill(null).map(() => ({
              textMessage: { 
                role: 'user', 
                content: 'x'.repeat(50) 
              }
            }))
          }
        }
      };
      
      expect(() => (edge as any).validateRequest(graphQLRequest))
        .toThrow(ValidationError);
      // The request size check happens first, before the GraphQL specific check
      expect(() => (edge as any).validateRequest(graphQLRequest))
        .toThrow(/exceeds maximum allowed size/);
    });
  });

  describe('Configuration', () => {
    it('should use default limits when not configured', () => {
      const defaultEdge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account'
      });
      
      // Create a request that would fail with test limits but pass with defaults
      const request = {
        messages: Array(50).fill(null).map((_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'Normal sized message content here'
        }))
      };
      
      // Should not throw with default limits (100 messages)
      expect(() => (defaultEdge as any).validateRequest(request)).not.toThrow();
      
      // But should throw with our test edge instance (5 messages)
      expect(() => (edge as any).validateRequest(request)).toThrow();
    });

    it('should log size limits in debug mode', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      
      new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        debug: true,
        maxRequestSize: 2048,
        maxMessages: 10,
        maxMessageSize: 500,
        maxObjectDepth: 5
      });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CopilotEdge] Initialized'),
        expect.objectContaining({
          maxRequestSize: '2KB',
          maxMessages: 10,
          maxMessageSize: '0KB',
          maxObjectDepth: 5
        })
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Performance', () => {
    it('should validate quickly even for large valid requests', () => {
      const largeValidRequest = {
        messages: Array(5).fill(null).map((_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'a'.repeat(60) // Further reduced to ensure it fits under 100 bytes
        }))
      };
      
      const start = performance.now();
      (edge as any).validateRequest(largeValidRequest);
      const duration = performance.now() - start;
      
      // Validation should be fast (under 10ms)
      expect(duration).toBeLessThan(10);
    });
  });
});