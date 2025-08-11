import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CopilotEdge, APIError } from '../dist/index';

describe('CopilotEdge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  });

  it('should use environment variables when config not provided', () => {
    const envEdge = new CopilotEdge();
    expect((envEdge as any).apiToken).toBe('test-token');
    expect((envEdge as any).accountId).toBe('test-account');
  });
  
  it('should fail after max retries', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Persistent error' }), { status: 500 })
    );

    const edge = new CopilotEdge({ apiKey: 'test', accountId: 'test', maxRetries: 3 });
    await expect(edge.handleRequest({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toThrow(APIError);
    
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
  
  it('should handle Cloudflare API errors', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid model' }), { status: 400 })
    );
    
    const edge = new CopilotEdge({ apiKey: 'test', accountId: 'test' });
    await expect(edge.handleRequest({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toThrow(APIError);
  });
});