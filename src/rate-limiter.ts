/**
 * Rate Limiter Durable Object for distributed rate limiting
 */

export class RateLimiterDO {
  private state: any; // DurableObjectState type from Cloudflare
  private requests: Map<string, number[]> = new Map();

  constructor(state: any) {
    this.state = state;
    // Load state from storage if it exists
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get('requests');
      if (stored) {
        this.requests = new Map(stored as any);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/check-limit') {
      return this.checkLimit(request);
    }
    
    if (url.pathname === '/reset') {
      return this.reset();
    }

    if (url.pathname === '/stats') {
      return this.getStats();
    }

    return new Response('Not found', { status: 404 });
  }

  private async checkLimit(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { 
        identifier?: string; 
        requestsPerMinute?: number;
        window?: number; // Time window in ms
      };
      
      const identifier = body.identifier || 'default';
      const limit = body.requestsPerMinute || 60;
      const window = body.window || 60000; // Default 1 minute
      
      const now = Date.now();
      const windowStart = now - window;
      
      // Get or create request timestamps for this identifier
      let timestamps = this.requests.get(identifier) || [];
      
      // Remove timestamps outside the window
      timestamps = timestamps.filter(ts => ts > windowStart);
      
      // Check if limit exceeded
      if (timestamps.length >= limit) {
        return Response.json({
          allowed: false,
          remaining: 0,
          resetAt: Math.min(...timestamps) + window,
          currentCount: timestamps.length
        });
      }
      
      // Add current timestamp
      timestamps.push(now);
      this.requests.set(identifier, timestamps);
      
      // Persist state (async, don't wait)
      this.state.storage.put('requests', Array.from(this.requests.entries()));
      
      return Response.json({
        allowed: true,
        remaining: limit - timestamps.length,
        resetAt: timestamps[0] + window,
        currentCount: timestamps.length
      });
    } catch (error) {
      console.error('Rate limit check error:', error);
      return Response.json({ 
        allowed: true, 
        remaining: -1,
        error: 'Rate limit check failed' 
      });
    }
  }

  private async reset(): Promise<Response> {
    this.requests.clear();
    await this.state.storage.delete('requests');
    return Response.json({ success: true, message: 'Rate limits reset' });
  }

  private async getStats(): Promise<Response> {
    const stats: any = {};
    const now = Date.now();
    
    for (const [identifier, timestamps] of this.requests.entries()) {
      // Only count requests in the last minute
      const recentRequests = timestamps.filter(ts => ts > now - 60000);
      stats[identifier] = {
        requestsLastMinute: recentRequests.length,
        oldestRequest: timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null,
        newestRequest: timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null
      };
    }
    
    return Response.json({
      identifiers: this.requests.size,
      stats
    });
  }
}