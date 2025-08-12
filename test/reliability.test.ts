import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopilotEdge, APIError } from '../dist/index';

vi.setConfig({ testTimeout: 15000 });

describe('CopilotEdge Core Reliability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // LRU eviction test removed - Workers handles memory automatically

  it('should not retry on 4xx client errors', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    const edge = new CopilotEdge({ apiKey: 'test', accountId: 'test' });

    await expect(edge.handleRequest({ messages: [{ role: 'user', content: 'test' }] }))
        .rejects.toThrow(APIError);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
