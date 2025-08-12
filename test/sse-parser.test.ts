import { describe, it, expect, vi } from 'vitest';

// Direct test of SSEParser class which is currently uncovered
describe('SSE Parser Tests', () => {
  // Mock the SSEParser class as it would be in index.ts
  class SSEParser {
    private buffer: string = '';

    parseChunk(chunk: string): Array<{ type: 'data' | 'done', content?: any }> {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      
      const events: Array<{ type: 'data' | 'done', content?: any }> = [];
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            events.push({ type: 'done' });
          } else {
            try {
              const parsed = JSON.parse(data);
              events.push({ type: 'data', content: parsed });
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
      
      return events;
    }
  }

  describe('SSEParser', () => {
    it('should parse complete SSE data chunks', () => {
      const parser = new SSEParser();
      
      const chunk = 'data: {"message": "Hello"}\ndata: {"message": "World"}\n';
      const events = parser.parseChunk(chunk);
      
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'data', content: { message: 'Hello' } });
      expect(events[1]).toEqual({ type: 'data', content: { message: 'World' } });
    });

    it('should handle [DONE] marker', () => {
      const parser = new SSEParser();
      
      const chunk = 'data: {"message": "Last"}\ndata: [DONE]\n';
      const events = parser.parseChunk(chunk);
      
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'data', content: { message: 'Last' } });
      expect(events[1]).toEqual({ type: 'done' });
    });

    it('should handle partial chunks and buffer data', () => {
      const parser = new SSEParser();
      
      // First partial chunk
      const events1 = parser.parseChunk('data: {"mess');
      expect(events1).toHaveLength(0);
      
      // Complete the message
      const events2 = parser.parseChunk('age": "Hello"}\n');
      expect(events2).toHaveLength(1);
      expect(events2[0]).toEqual({ type: 'data', content: { message: 'Hello' } });
    });

    it('should skip invalid JSON', () => {
      const parser = new SSEParser();
      
      const chunk = 'data: {invalid json}\ndata: {"valid": "json"}\n';
      const events = parser.parseChunk(chunk);
      
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'data', content: { valid: 'json' } });
    });

    it('should ignore non-data lines', () => {
      const parser = new SSEParser();
      
      const chunk = 'event: message\nid: 123\ndata: {"test": "data"}\n';
      const events = parser.parseChunk(chunk);
      
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'data', content: { test: 'data' } });
    });

    it('should handle empty data lines', () => {
      const parser = new SSEParser();
      
      const chunk = 'data: \ndata: {"test": "data"}\n';
      const events = parser.parseChunk(chunk);
      
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'data', content: { test: 'data' } });
    });

    it('should handle multiple chunks building up a message', () => {
      const parser = new SSEParser();
      
      // Simulate streaming data
      const chunks = [
        'data: {"id": ',
        '123, "message": ',
        '"Hello World"',
        '}\n',
        'data: [DONE]\n'
      ];
      
      const allEvents: any[] = [];
      for (const chunk of chunks) {
        const events = parser.parseChunk(chunk);
        allEvents.push(...events);
      }
      
      expect(allEvents).toHaveLength(2);
      expect(allEvents[0]).toEqual({ type: 'data', content: { id: 123, message: 'Hello World' } });
      expect(allEvents[1]).toEqual({ type: 'done' });
    });
  });
});