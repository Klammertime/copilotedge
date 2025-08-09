/**
 * Cloudflare Pages Functions Example
 * Deploy this as functions/api/copilotedge.js in your Pages project
 * 
 * Environment variables needed (set in Cloudflare dashboard):
 * - CLOUDFLARE_API_TOKEN
 * - CLOUDFLARE_ACCOUNT_ID
 */

import CopilotEdge from 'copilotedge';

export async function onRequest(context) {
  // Only handle POST requests
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Initialize CopilotEdge with env vars from context
    const edge = new CopilotEdge({
      apiKey: context.env.CLOUDFLARE_API_TOKEN,
      accountId: context.env.CLOUDFLARE_ACCOUNT_ID,
      model: '@cf/meta/llama-3.1-8b-instruct',
      debug: context.env.ENVIRONMENT !== 'production',
      cacheTimeout: 60000,
      rateLimit: 60
    });

    // Parse request body
    const body = await context.request.json();
    
    // Handle the request
    const result = await edge.handleRequest(body);
    
    // Setup secure CORS headers
    const allowedOrigins = context.env.ALLOWED_ORIGINS?.split(',') || ['https://localhost:3000'];
    const origin = context.request.headers.get('Origin');
    
    const headers = {
      'Content-Type': 'application/json',
      'X-Powered-By': 'CopilotEdge',
      'X-Cache': result.cached ? 'HIT' : 'MISS',
      'Cache-Control': 'no-cache', // Let Cloudflare handle caching
      // Security headers
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'"
    };
    
    // Only set CORS headers for allowed origins
    if (origin && allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    
    // Return response with secure headers
    return new Response(JSON.stringify(result), {
      status: 200,
      headers
    });
    
  } catch (error) {
    // Determine status code based on error type
    let status = 500;
    if (error.name === 'ValidationError') {
      status = 400;
    } else if (error.statusCode) {
      status = error.statusCode;
    }
    
    // Return error response
    return new Response(JSON.stringify({
      error: error.message,
      type: error.name
    }), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

/**
 * Optional: Handle OPTIONS for CORS preflight
 */
export async function onRequestOptions(context) {
  // Security: Configure allowed origins from environment variable
  // Set ALLOWED_ORIGINS in Cloudflare Pages environment settings
  // Example: "https://app.example.com,https://www.example.com"
  const allowedOrigins = context.env.ALLOWED_ORIGINS?.split(',') || ['https://localhost:3000'];
  const origin = context.request.headers.get('Origin');
  
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
  
  // Only allow specific origins, not wildcards
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  
  return new Response(null, {
    status: 200,
    headers
  });
}

/**
 * Advanced: Use Durable Objects for persistent metrics
 * Uncomment if you have Durable Objects enabled
 */
/*
export class CopilotEdgeMetrics {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/increment') {
      const count = (await this.state.storage.get('requests')) || 0;
      await this.state.storage.put('requests', count + 1);
      return new Response(JSON.stringify({ count: count + 1 }));
    }
    
    if (url.pathname === '/stats') {
      const requests = (await this.state.storage.get('requests')) || 0;
      const cacheHits = (await this.state.storage.get('cacheHits')) || 0;
      return new Response(JSON.stringify({ requests, cacheHits }));
    }
    
    return new Response('Not found', { status: 404 });
  }
}
*/

/**
 * Usage in your frontend (React/Vue/etc):
 * 
 * const response = await fetch('/api/copilotedge', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     messages: [
 *       { role: 'user', content: 'Hello!' }
 *     ]
 *   })
 * });
 * const data = await response.json();
 */