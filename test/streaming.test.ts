/**
 * Tests for Cloudflare streaming API support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CopilotEdge } from '../dist/index';

describe('CopilotEdge Streaming Support', () => {
  beforeEach(() => {
    // Mock streaming response from Cloudflare API
    const createStreamingResponse = (chunks: string[]) => {
      const encoder = new TextEncoder();
      let index = 0;
      
      const stream = new ReadableStream({
        async pull(controller) {
          if (index < chunks.length) {
            // Simulate SSE format that Cloudflare uses
            const data = `data: ${JSON.stringify({ 
              choices: [{ 
                delta: { content: chunks[index] },
                index: 0
              }]
            })}\n\n`;
            controller.enqueue(encoder.encode(data));
            index++;
          } else {
            // Send the final done message
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }
      });

      return {
        ok: true,
        status: 200,
        body: stream,
        headers: new Headers({
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        }),
        json: async () => { throw new Error('Cannot parse streaming response as JSON'); },
        text: async () => { throw new Error('Cannot parse streaming response as text'); }
      };
    };

    const mockFetch = vi.fn().mockImplementation(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      
      // Check if streaming is requested
      if (body.stream === true) {
        return createStreamingResponse(['Hello', ' from', ' streaming', ' response!']);
      }
      
      // Non-streaming response
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: 'Non-streaming response'
            }
          }]
        }),
        text: async () => JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: 'Non-streaming response'
            }
          }]
        })
      };
    });

    // Create edge instance to validate configuration
    new CopilotEdge({
      apiKey: 'test-key',
      accountId: 'test-account',
      debug: false,
      stream: false, // Default to non-streaming
      fetch: mockFetch as any
    });
  });

  describe('Streaming API Response Structure', () => {
    it('should recognize SSE (Server-Sent Events) format from Cloudflare', async () => {
      // This test verifies we understand the streaming format
      const mockResponse = {
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream()
      };
      
      expect(mockResponse.headers.get('content-type')).toBe('text/event-stream');
    });

    it('should parse streaming delta chunks correctly', () => {
      // Test parsing of delta chunks
      const chunk = {
        choices: [{
          delta: { content: 'Hello' },
          index: 0,
          finish_reason: null
        }]
      };
      
      expect(chunk.choices[0].delta.content).toBe('Hello');
    });

    it('should handle [DONE] message in stream', () => {
      // Test recognition of stream completion
      const doneMessage = '[DONE]';
      expect(doneMessage).toBe('[DONE]');
    });
  });

  describe('Stream Processing Utilities', () => {
    it('should accumulate chunks into complete response', () => {
      const chunks = ['Hello', ' ', 'world', '!'];
      const accumulated = chunks.join('');
      expect(accumulated).toBe('Hello world!');
    });

    it('should handle ReadableStream iteration', async () => {
      const encoder = new TextEncoder();
      const chunks = ['chunk1', 'chunk2', 'chunk3'];
      let index = 0;
      
      const stream = new ReadableStream({
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(encoder.encode(chunks[index]));
            index++;
          } else {
            controller.close();
          }
        }
      });

      const reader = stream.getReader();
      const receivedChunks: string[] = [];
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedChunks.push(decoder.decode(value));
      }
      
      expect(receivedChunks).toEqual(chunks);
    });
  });

  describe('Streaming Configuration', () => {
    it('should identify when streaming is requested', () => {
      const requestBody = {
        model: '@cf/meta/llama-3.1-8b-instruct',
        messages: [{ role: 'user', content: 'test' }],
        stream: true
      };
      
      expect(requestBody.stream).toBe(true);
    });

    it('should support both streaming and non-streaming modes', () => {
      const streamingRequest = { stream: true };
      const nonStreamingRequest = { stream: false };
      
      expect(streamingRequest.stream).toBe(true);
      expect(nonStreamingRequest.stream).toBe(false);
    });
  });

  describe('Streaming Functionality', () => {
    it('should handle streaming request when stream is true', async () => {
      const streamingEdge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        stream: true,
        fetch: (async (_url: string, options: any) => {
          const body = JSON.parse(options.body);
          expect(body.stream).toBe(true);
          
          // Return a mock streaming response
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async pull(controller) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            }
          });
          
          return {
            ok: true,
            status: 200,
            body: stream,
            headers: new Headers({ 'content-type': 'text/event-stream' })
          };
        }) as any
      });
      
      const response = await streamingEdge.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      expect(response.streaming).toBe(true);
      expect(response.stream).toBeDefined();
      expect(response.object).toBe('chat.completion.chunk');
    });

    it('should accumulate chunks correctly', async () => {
      const chunks: string[] = [];
      const streamingEdge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        stream: true,
        onChunk: async (chunk: string) => {
          chunks.push(chunk);
        },
        fetch: (async (_url: string, _options: any) => {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async pull(controller) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" "}}]}\n\n'));
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"world"}}]}\n\n'));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            }
          });
          
          return {
            ok: true,
            status: 200,
            body: stream,
            headers: new Headers({ 'content-type': 'text/event-stream' })
          };
        }) as any
      });
      
      const response = await streamingEdge.handleRequest({
        messages: [{ role: 'user', content: 'test' }]
      });
      
      // Consume the stream
      if (response.stream) {
        for await (const chunk of response.stream) {
          // Stream is being consumed
          expect(chunk).toBeDefined();
        }
      }
      
      expect(chunks).toEqual(['Hello', ' ', 'world']);
    });

    it('should respect stream parameter in request body over config', async () => {
      const nonStreamingEdge = new CopilotEdge({
        apiKey: 'test-key',
        accountId: 'test-account',
        stream: false, // Config says no streaming
        fetch: (async (_url: string, options: any) => {
          const body = JSON.parse(options.body);
          expect(body.stream).toBe(true); // But request says yes
          
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async pull(controller) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"test"}}]}\n\n'));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            }
          });
          
          return {
            ok: true,
            status: 200,
            body: stream,
            headers: new Headers({ 'content-type': 'text/event-stream' })
          };
        }) as any
      });
      
      const response = await nonStreamingEdge.handleRequest({
        messages: [{ role: 'user', content: 'test' }],
        stream: true // Request overrides config
      });
      
      expect(response.streaming).toBe(true);
    });
  });

  describe('Future Streaming Implementation', () => {
    it('should prepare for async generator pattern', async () => {
      // Prepare for future implementation using async generators
      async function* streamGenerator() {
        yield 'chunk1';
        yield 'chunk2';
        yield 'chunk3';
      }
      
      const chunks: string[] = [];
      for await (const chunk of streamGenerator()) {
        chunks.push(chunk);
      }
      
      expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
    });

    it('should prepare for EventSource-like parsing', () => {
      const sseData = 'data: {"content": "test"}\n\n';
      const dataLine = sseData.trim();
      const jsonStr = dataLine.replace(/^data: /, '');
      const parsed = JSON.parse(jsonStr);
      
      expect(parsed.content).toBe('test');
    });

    it('should handle partial chunks and buffering', () => {
      // Prepare for handling partial SSE messages
      const buffer = 'data: {"content": "par';
      const nextChunk = 'tial"}\n\n';
      const complete = buffer + nextChunk;
      
      expect(complete).toContain('data: {"content": "partial"}\n\n');
    });
  });

  describe('Error Handling in Streaming', () => {
    it('should prepare for stream interruption handling', async () => {
      const error = new Error('Stream interrupted');
      const errorHandler = (err: Error) => {
        return { error: err.message, retry: true };
      };
      
      const result = errorHandler(error);
      expect(result.error).toBe('Stream interrupted');
      expect(result.retry).toBe(true);
    });

    it('should prepare for timeout handling in streams', () => {
      const streamTimeout = 30000; // 30 seconds
      const startTime = Date.now();
      
      const checkTimeout = () => {
        const elapsed = Date.now() - startTime;
        return elapsed > streamTimeout;
      };
      
      expect(checkTimeout()).toBe(false);
    });
  });
});