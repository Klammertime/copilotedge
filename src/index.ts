/**
 * CopilotEdge - Production-ready adapter for CopilotKit + Cloudflare Workers AI
 * @author Audrey Klammer (@Klammertime)
 * @version 0.9.0
 * @license MIT
 * 
 * Features:
 * - ⚡ Uses Cloudflare's automatic edge routing (closest location)
 * - 💾 60-second memory cache + optional KV persistence
 * - 🔄 Automatic retry with exponential backoff and jitter
 * - 🎯 Simple configuration (just API key & account ID)
 * - 🐛 Debug mode with performance metrics
 * - 🔒 DoS protection and input validation
 * - 📊 OpenTelemetry instrumentation for monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { TelemetryConfig, TelemetryManager, SpanNames } from './telemetry';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { getTokenCounter, TokenCounter } from './tokenUtils';
import { SecurityConfig, SecurityManager, SecureLogger } from './security';

/**
 * Simple logging functions - no classes needed in Workers
 */
const createLogger = (debug: boolean) => ({
  log: debug ? (...args: any[]) => console.log(...args) : () => {},
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args)
});

/**
 * Configuration options for CopilotEdge
 */
export interface CopilotEdgeConfig {
  /** Cloudflare API token (or set CLOUDFLARE_API_TOKEN env var) */
  apiKey?: string;
  /** Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID env var) */
  accountId?: string;
  /** 
   * AI model to use (defaults to Llama 3.1 8B)
   * @deprecated Use provider and model configuration instead for more flexibility
   */
  model?: string;
  /** 
   * AI provider to use 
   * @default 'cloudflare'
   */
  provider?: string;
  /** 
   * Fallback model to use if the primary model fails 
   * For example: '@cf/meta/llama-3.1-8b-instruct'
   */
  fallback?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** 
   * Cache timeout in milliseconds.
   * @default 60000 (60 seconds)
   */
  cacheTimeout?: number;
  /**
   * Maximum number of retries for failed requests.
   * @default 3
   */
  maxRetries?: number;
  /** 
   * Rate limit per minute per client.
   * @default 60
   */
  rateLimit?: number;
  /** 
   * Timeout for region selection in milliseconds.
   * @default 2000
   */
  regionCheckTimeout?: number;
  /**
   * Timeout for API calls to Cloudflare AI in milliseconds.
   * @default 30000
   */
  apiTimeout?: number;
  /**
   * A custom fetch implementation to use for requests.
   * This is useful for testing and can be used to inject a mock fetch implementation.
   * @internal
   */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Number of consecutive failures before the circuit opens.
   * @default 5
   */
  circuitBreakerFailureThreshold?: number;
  /**
   * How long the circuit remains open before attempting half-open requests (ms).
   * @default 30000
   */
  circuitBreakerOpenStateTimeout?: number;
  /**
   * Maximum request size in bytes to prevent DoS attacks.
   * @default 1048576 (1MB)
   */
  maxRequestSize?: number;
  /**
   * Maximum number of messages in a single request.
   * @default 100
   */
  maxMessages?: number;
  /**
   * Maximum size of a single message in bytes.
   * @default 10000 (10KB)
   */
  maxMessageSize?: number;
  /**
   * Maximum object nesting depth to prevent deeply nested attack payloads.
   * @default 10
   */
  maxObjectDepth?: number;
  /**
   * OpenTelemetry configuration for distributed tracing and metrics
   */
  telemetry?: TelemetryConfig;
  /**
   * Enable streaming responses from Cloudflare AI.
   * When enabled, responses will be streamed as they are generated.
   * @default false
   */
  stream?: boolean;
  /**
   * Callback function called for each chunk in streaming mode.
   * Only used when stream is true.
   */
  onChunk?: (chunk: string) => void | Promise<void>;
  /**
   * Cloudflare Workers KV namespace for persistent caching.
   * When provided, cache will persist across all edge locations globally.
   * @example env.COPILOT_CACHE (bind in wrangler.toml)
   */
  kvNamespace?: KVNamespace;
  /**
   * TTL for KV cache entries in seconds.
   * KV has a minimum TTL of 60 seconds.
   * @default 86400 (24 hours)
   */
  kvCacheTTL?: number;
  /**
   * Prefix for KV cache keys to avoid collisions.
   * @default 'copilotedge:'
   */
  kvCachePrefix?: string;
  /**
   * Durable Object namespace for conversation state management.
   * Enables persistent conversation history and WebSocket support.
   * @example env.CONVERSATION_DO (bind in wrangler.toml)
   */
  conversationDO?: DurableObjectNamespace;
  /**
   * Whether to use Durable Objects for conversation management.
   * When enabled, conversations persist across sessions.
   * @default false
   */
  enableConversations?: boolean;
  /**
   * Default conversation ID to use if not provided in requests.
   * If not set, a new conversation is created for each session.
   */
  defaultConversationId?: string;
  /**
   * Security configuration for request validation, encryption, and rate limiting.
   * @since v0.9.1
   */
  security?: SecurityConfig;
  /**
   * Durable Object namespace for distributed rate limiting.
   * Required when using distributed rate limiting.
   * @example env.RATE_LIMITER_DO (bind in wrangler.toml)
   */
  rateLimiterDO?: DurableObjectNamespace;
}

/**
 * Cloudflare Durable Object Namespace interface
 */
export interface DurableObjectNamespace {
  newUniqueId(): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
  id: DurableObjectId;
  name?: string;
}

/**
 * Cloudflare Workers KV Namespace interface
 * This is the standard KV interface provided by Cloudflare Workers runtime
 */
export interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<any>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { 
    expirationTtl?: number;
    metadata?: any;
  }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; metadata?: any }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

// Region interface removed - using Cloudflare's automatic edge routing

/**
 * Represents an error during request validation.
 */
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Represents an error from the Cloudflare AI API.
 */
export class APIError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Represents a streaming response from the AI
 */
export interface StreamingResponse {
  /** Async generator that yields content chunks */
  stream: AsyncGenerator<string, void, unknown>;
  /** Accumulate all chunks into a complete response */
  getFullResponse: () => Promise<string>;
}

/**
 * Server-Sent Events (SSE) parser for streaming responses
 */
class SSEParser {
  private buffer: string = '';

  /**
   * Parse SSE data from a chunk
   */
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

  /**
   * Reset the buffer
   */
  reset() {
    this.buffer = '';
  }
}

/**
 * Default configuration values for CopilotEdge.
 */
const DEFAULTS = {
  PROVIDER: 'cloudflare',
  MODEL: '@cf/meta/llama-3.1-8b-instruct',
  OPENAI_MODELS: {
    '120b': '@cf/openai/gpt-oss-120b',
    '20b': '@cf/openai/gpt-oss-20b'
  },
  META_MODELS: {
    '70b': '@cf/meta/llama-3.1-70b',
    '8b': '@cf/meta/llama-3.1-8b-instruct'
  },
  CLOUDFLARE_API_URL: 'https://api.cloudflare.com/client/v4',
  CACHE_TIMEOUT: 60000, // 60 seconds
  MAX_RETRIES: 3,
  RATE_LIMIT: 60, // per minute
  MESSAGE_LENGTH_LIMIT: 4000,
  API_TIMEOUT: 30000, // 30 seconds
  MAX_BACKOFF: 8000, // 8 seconds
  JITTER: 500, // 0.5 seconds
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_OPEN_STATE_TIMEOUT: 30000, // 30 seconds
  KV_CACHE_TTL: 86400, // 24 hours (KV minimum is 60 seconds)
  KV_CACHE_PREFIX: 'copilotedge:'
};

/**
 * Main CopilotEdge class for handling AI requests.
 */
export class CopilotEdge {
  private apiToken: string;
  private accountId: string;
  private model: string;
  private fallbackModel: string | null;
  private provider: string;
  private debug: boolean;
  private cache: Map<string, { data: any; timestamp: number }>;
  private cacheTimeout: number;
  private apiTimeout: number;
  private tokenCounter: TokenCounter;
  private maxRetries: number;
  private requestCount: Map<string, number>;
  private rateLimit: number;
  private fetch: (url: string, init?: RequestInit) => Promise<Response>;
  private metrics: {
    totalRequests: number;
    cacheHits: number;
    errors: number;
    avgLatency: number[];
    fallbackUsed: number;
  };
  private isFallbackActive: boolean = false;
  private maxRequestSize?: number;
  private maxMessages?: number;
  private maxMessageSize?: number;
  private maxObjectDepth?: number;
  private stream: boolean;
  private onChunk?: (chunk: string) => void | Promise<void>;
  private kvNamespace?: KVNamespace;
  private kvCacheTTL: number;
  private kvCachePrefix: string;
  private conversationDO?: DurableObjectNamespace;
  private enableConversations: boolean;
  private defaultConversationId?: string;
  private telemetry: TelemetryManager | null = null;
  private security: SecurityManager | null = null;
  private logger: SecureLogger | ReturnType<typeof createLogger>;

  /**
   * Creates an instance of CopilotEdge.
   * @param config - Configuration options for CopilotEdge.
   */
  constructor(config: CopilotEdgeConfig = {}) {
    // Validate and set configuration with environment auto-discovery
    // In Workers, use wrangler.toml bindings or pass config directly
    // IMPORTANT: Keep the process.env fallback - it's necessary for testing!
    // Tests run in Node.js environment and need to set API credentials via env vars
    // Auto-discovery order: config > COPILOTEDGE_* > CLOUDFLARE_*
    this.apiToken = config.apiKey || 
                   (typeof process !== 'undefined' ? process.env?.COPILOTEDGE_API_KEY : '') ||
                   (typeof process !== 'undefined' ? process.env?.CLOUDFLARE_API_TOKEN : '') || 
                   '';
    this.accountId = config.accountId || 
                    (typeof process !== 'undefined' ? process.env?.COPILOTEDGE_ACCOUNT_ID : '') ||
                    (typeof process !== 'undefined' ? process.env?.CLOUDFLARE_ACCOUNT_ID : '') || 
                    '';
    this.provider = config.provider || DEFAULTS.PROVIDER;
    
    // Handle model configuration with provider and fallback support
    if (config.model) {
      // Support legacy model configuration
      this.model = config.model;
    } else if (this.provider === 'cloudflare' && config.model?.includes('@cf/openai/')) {
      // Direct OpenAI model reference
      this.model = config.model;
    } else {
      // Use default model
      this.model = DEFAULTS.MODEL;
    }
    
    // Set fallback model if provided
    this.fallbackModel = config.fallback || null;
    
    // Workers is always production, debug must be explicitly enabled
    this.debug = config.debug || false;
    this.cacheTimeout = config.cacheTimeout || DEFAULTS.CACHE_TIMEOUT;
    this.maxRetries = config.maxRetries || DEFAULTS.MAX_RETRIES;
    this.rateLimit = config.rateLimit || DEFAULTS.RATE_LIMIT;
    this.apiTimeout = config.apiTimeout || DEFAULTS.API_TIMEOUT;
    this.fetch = config.fetch || global.fetch;
    
    // DoS protection settings
    this.maxRequestSize = config.maxRequestSize;
    this.maxMessages = config.maxMessages;
    this.maxMessageSize = config.maxMessageSize;
    this.maxObjectDepth = config.maxObjectDepth;
    
    // Streaming settings
    this.stream = config.stream || false;
    this.onChunk = config.onChunk;
    
    // KV settings
    this.kvNamespace = config.kvNamespace;
    this.kvCacheTTL = config.kvCacheTTL || 86400; // 24 hours default
    this.kvCachePrefix = config.kvCachePrefix || 'copilotedge:';
    
    // Durable Objects settings
    this.conversationDO = config.conversationDO;
    this.enableConversations = config.enableConversations || false;
    this.defaultConversationId = config.defaultConversationId;
    
    // Validate required fields
    if (!this.apiToken) {
      throw new ValidationError('API key is required. Set config.apiKey or CLOUDFLARE_API_TOKEN env var');
    }
    if (!this.accountId) {
      throw new ValidationError('Account ID is required. Set config.accountId or CLOUDFLARE_ACCOUNT_ID env var');
    }
    
    // Initialize cache
    this.cache = new Map();
    
    this.requestCount = new Map();
    
    // Metrics tracking
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      errors: 0,
      avgLatency: [],
      fallbackUsed: 0
    };
    
    // Initialize telemetry if configured
    if (config.telemetry?.enabled) {
      // Hash model name for security - don't expose infrastructure details
      // Use a simple hash that works synchronously in both Node.js and Workers
      const modelHash = this.simpleHash(this.model).slice(0, 8);
      
      const modelProvider = this.model.startsWith('@cf/meta/') ? 'meta' :
                           this.model.startsWith('@cf/mistral/') ? 'mistral' :
                           this.model.startsWith('@cf/google/') ? 'google' :
                           this.model.startsWith('@cf/openai/') ? 'openai' :
                           'other';
      
      // Auto-discover environment from env vars
      const environment = config.telemetry.environment || 
                         (typeof process !== 'undefined' ? process.env?.COPILOTEDGE_ENVIRONMENT : '') ||
                         (typeof process !== 'undefined' ? process.env?.NODE_ENV : '') ||
                         'production';
      
      this.telemetry = new TelemetryManager({
        ...config.telemetry,
        environment,
        serviceVersion: '0.9.1',
        attributes: {
          'copilotedge.model_hash': modelHash, // Hashed model identifier
          'copilotedge.model_provider': modelProvider, // Generic provider category
          'copilotedge.provider': this.provider,
          'deployment.environment': environment,
          ...config.telemetry.attributes
        }
      });
    }

    // Initialize security if configured
    if (config.security) {
      this.security = new SecurityManager(
        config.security,
        config.rateLimiterDO
      );
      // Use secure logger if security is enabled
      this.logger = this.security.getLogger();
    } else {
      // Use simple logger if security not enabled
      this.logger = createLogger(this.debug);
    }
    
    // Initialize token counter
    this.tokenCounter = getTokenCounter(this.model);
    
    if (this.debug) {
      const logConfig = {
        // Always log generic model info for privacy
        model: this.model.includes('/') ? 'custom-model' : this.model,
        provider: this.provider,
        fallbackModel: this.fallbackModel ? 'configured' : 'none',
        cacheTimeout: this.cacheTimeout,
        maxRetries: this.maxRetries,
        rateLimit: this.rateLimit,
        maxRequestSize: this.maxRequestSize ? `${Math.round(this.maxRequestSize / 1024)}KB` : 'Not Set',
        maxMessages: this.maxMessages || 'Not Set',
        maxMessageSize: this.maxMessageSize ? `${Math.round(this.maxMessageSize / 1024)}KB` : 'Not Set',
        maxObjectDepth: this.maxObjectDepth || 'Not Set'
      };
      
      this.logger.log('[CopilotEdge] Initialized with:', logConfig);
      this.logger.warn('[CopilotEdge] WARNING: Debug mode is enabled. This may impact performance.');
    }
  }

  /**
   * Generate hash for cache key using SHA-256.
   * Uses cryptographic hashing to prevent collisions in cache keys.
   * @param obj - The object to hash.
   * @returns A promise that resolves to a hex string hash.
   */
  private async hashRequest(obj: any): Promise<string> {
    const str = JSON.stringify(obj);
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex; // Full SHA-256 hash to prevent collisions
  }

  /**
   * Simple synchronous hash function for telemetry.
   * Uses a fast non-cryptographic hash suitable for obfuscation.
   * @param str - The string to hash.
   * @returns A hex string hash.
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Convert to positive hex string
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Get cached response if available and not expired.
   * Checks KV first (if available), then falls back to in-memory cache.
   * @param key - The cache key.
   * @returns The cached data or null if not found.
   */
  private async getFromCache(key: string): Promise<any> {
    // Try KV cache first if available
    if (this.kvNamespace) {
      try {
        const kvKey = this.kvCachePrefix + key;
        const kvData = await this.kvNamespace.get(kvKey, { type: 'json' });
        
        if (kvData) {
          this.metrics.cacheHits++;
          if (this.debug) {
            this.logger.log(`[CopilotEdge] KV Cache HIT (global persistent cache)`);
          }
          return { ...kvData, cached: true, cacheType: 'kv' };
        }
      } catch (error) {
        if (this.debug) {
          this.logger.warn('[CopilotEdge] KV cache read failed:', error);
        }
        // Fall through to in-memory cache
      }
    }

    // Fall back to in-memory cache
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      this.metrics.cacheHits++;
      if (this.debug) {
        const age = Math.round((Date.now() - cached.timestamp) / 1000);
        this.logger.log(`[CopilotEdge] Memory Cache HIT (age: ${age}s)`);
      }
      return { ...cached.data, cached: true, cacheType: 'memory' };
    }

    return null;
  }

  /**
   * Save response to cache with LRU eviction.
   * Saves to both KV (if available) and in-memory cache.
   * @param key - The cache key.
   * @param data - The data to cache.
   */
  private async saveToCache(key: string, data: any): Promise<void> {
    // Save to in-memory cache (always)
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Save to KV if available (persistent across all edge locations)
    if (this.kvNamespace) {
      try {
        const kvKey = this.kvCachePrefix + key;
        // KV requires string or ArrayBuffer, so stringify the data
        await this.kvNamespace.put(
          kvKey, 
          JSON.stringify(data),
          { 
            expirationTtl: this.kvCacheTTL,
            metadata: { 
              timestamp: Date.now(),
              model: this.model 
            }
          }
        );
        
        if (this.debug) {
          this.logger.log(`[CopilotEdge] Saved to KV cache (TTL: ${this.kvCacheTTL}s, global persistence)`);
        }
      } catch (error) {
        if (this.debug) {
          this.logger.warn('[CopilotEdge] KV cache write failed:', error);
        }
        // Continue even if KV fails - in-memory cache still works
      }
    }
  }

  /**
   * Check rate limit for a given client ID.
   * @param clientId - The identifier for the client.
   * @throws {APIError} if the rate limit is exceeded.
   */
  private checkRateLimit(clientId: string = 'default'): void {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const key = `${clientId}-${minute}`;
    
    const count = this.requestCount.get(key) || 0;
    if (count >= this.rateLimit) {
      throw new APIError(`Rate limit exceeded (${this.rateLimit} req/min)`, 429);
    }
    
    this.requestCount.set(key, count + 1);
    
    // Clean old entries
    for (const [k] of this.requestCount) {
      const [, time] = k.split('-');
      if (parseInt(time) < minute - 1) {
        this.requestCount.delete(k);
      }
    }
  }

  /**
   * Get the Cloudflare API URL.
   * Cloudflare automatically routes to the nearest edge location.
   * @returns The Cloudflare API URL.
   */
  private getCloudflareApiUrl(): string {
    return DEFAULTS.CLOUDFLARE_API_URL;
  }

  /**
   * Retry a function with exponential backoff and jitter.
   * This is used to handle transient network errors and API failures.
   * @param fn - The async function to retry.
   * @param context - A string describing the operation for logging.
   * @returns The result of the function.
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>, 
    context: string = 'request'
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on validation errors or client errors (except 429)
        if (error instanceof ValidationError || 
            (error instanceof APIError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429)) {
          throw error;
        }
        
        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(Math.pow(2, attempt) * 1000, 8000);
          if (this.debug) {
            this.logger.log(`[CopilotEdge] Retry ${attempt + 1}/${this.maxRetries} for ${context} after ${delay}ms...`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    this.metrics.errors++;
    throw lastError;
  }

  /**
   * Validate the structure of the incoming request body.
   * Supports both CopilotKit GraphQL and direct chat message formats.
   * @param body - The request body.
   * @throws {ValidationError} if the body is invalid.
   */
  private validateRequest(body: any): void {
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body must be an object');
    }
    
    // Add DoS protection checks
    const requestSize = JSON.stringify(body).length;
    if (this.maxRequestSize && requestSize > this.maxRequestSize) {
      throw new ValidationError(`Request size (${requestSize} bytes) exceeds maximum allowed size (${this.maxRequestSize} bytes)`);
    }
    
    // Check object depth
    if (this.maxObjectDepth && this.getObjectDepth(body) > this.maxObjectDepth) {
      throw new ValidationError(`Request object depth exceeds maximum nesting depth (${this.maxObjectDepth})`);
    }
    
    // Allow any standard GraphQL operation to pass initial validation.
    // This includes the introspection query and any other operations
    // the CopilotKit frontend might send.
    if (body.operationName) {
      return;
    }
    
    // Check for direct chat format
    if (body.messages) {
      if (!Array.isArray(body.messages)) {
        throw new ValidationError('messages must be an array');
      }
      
      // Check message count limit
      if (this.maxMessages && body.messages.length > this.maxMessages) {
        throw new ValidationError(`Number of messages (${body.messages.length}) exceeds maximum allowed (${this.maxMessages})`);
      }
      
      // Check for null/undefined messages
      for (let i = 0; i < body.messages.length; i++) {
        const msg = body.messages[i];
        if (!msg) {
          throw new ValidationError(`Message at index ${i} is null or undefined`);
        }
        if (typeof msg !== 'object') {
          throw new ValidationError(`Message at index ${i} is not an object`);
        }
        if (!msg.role || !msg.content) {
          throw new ValidationError('Each message must have role and content');
        }
        if (!['user', 'assistant', 'system'].includes(msg.role)) {
          throw new ValidationError(`Invalid role: ${msg.role}`);
        }
        
        // Check individual message size
        if (this.maxMessageSize) {
          const messageSize = JSON.stringify(msg).length;
          if (messageSize > this.maxMessageSize) {
            throw new ValidationError(`Message size at index ${i} (${messageSize} bytes) exceeds maximum allowed (${this.maxMessageSize} bytes)`);
          }
        }
      }
      return;
    }
    
    throw new ValidationError('Unsupported request format. Expected CopilotKit GraphQL or chat messages');
  }

  /**
   * Helper method to calculate object depth for DoS protection
   * @param obj - The object to check
   * @param currentDepth - Current recursion depth
   * @returns The maximum depth of the object
   */
  private getObjectDepth(obj: any, currentDepth = 0): number {
    if (currentDepth > (this.maxObjectDepth || 10)) return currentDepth;
    if (typeof obj !== 'object' || obj === null) return currentDepth;
    
    let maxDepth = currentDepth;
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        const depth = this.getObjectDepth(value, currentDepth + 1);
        maxDepth = Math.max(maxDepth, depth);
      }
    }
    return maxDepth;
  }

  /**
   * Create a minimal, valid response for a GraphQL introspection query.
   * This is necessary to satisfy CopilotKit's initial "handshake" request.
   * @returns A basic GraphQL response structure.
   */
  private createIntrospectionResponse(): any {
    return {
      data: {
        __schema: {
          queryType: { name: 'Query' },
          mutationType: { name: 'Mutation' },
          types: [],
        },
      },
    };
  }

  /**
   * Sanitize messages for the AI, ensuring consistent format and length.
   * @param messages - The messages to sanitize.
   * @returns A new array of sanitized messages.
   */
  private sanitizeMessages(messages: any[]): any[] {
    return messages.map(msg => ({
      role: msg.role,
      content: String(msg.content).slice(0, DEFAULTS.MESSAGE_LENGTH_LIMIT) // Limit message length
    }));
  }


  /**
   * Extracts and sanitizes messages from a request body.
   * Handles both CopilotKit GraphQL and direct chat formats.
   * @param body The request body.
   * @returns An array of sanitized messages or null if no valid messages are found.
   */
  private getSanitizedMessages(body: any): any[] | null {
    let messages: any[] = [];

    if (body.operationName === 'generateCopilotResponse' && body.variables?.data) {
      messages = (body.variables.data.messages || [])
        .filter((msg: any) => 
          msg.textMessage && 
          msg.textMessage.content && 
          msg.textMessage.content.trim().length > 0 &&
          msg.textMessage.role !== 'system'
        )
        .map((msg: any) => ({
          role: msg.textMessage.role,
          content: msg.textMessage.content.trim()
        }));
    } else if (body.messages && Array.isArray(body.messages)) {
      messages = body.messages;
    }

    if (messages.length === 0) {
      return null;
    }

    return this.sanitizeMessages(messages);
  }

  /**
   * Main request handler. Orchestrates validation, caching, region selection, and the final API call.
   * NOTE: Streaming is NOT supported. All responses are returned complete.
   * @param body The request body.
   * @returns The response from the AI or cache.
   */
  public async handleRequest(body: any): Promise<any> {
    const start = performance.now();
    this.metrics.totalRequests++;
    
    // Extract conversation ID if present
    const conversationId = body.conversationId || this.defaultConversationId;
    
    // Wrap entire request in telemetry span if enabled
    if (this.telemetry) {
      return this.telemetry.withSpan(
        SpanNames.REQUEST,
        async () => {
          try {
            return await this.handleRequestInternal(body, start);
          } catch (error) {
            // Telemetry will record the error
            throw error;
          }
        },
        {
          kind: SpanKind.SERVER,
          attributes: {
            'request.size': JSON.stringify(body).length,
            'request.type': body.operationName ? 'graphql' : 'chat',
            ...(conversationId && {
              'conversation.id': conversationId,
              'copilot.conversation_id': conversationId
            })
          }
        }
      );
    } else {
      return this.handleRequestInternal(body, start);
    }
  }
  
  private async handleRequestInternal(body: any, start: number): Promise<any> {
    try {
      // Validate request FIRST to catch null/invalid types.
      if (this.telemetry) {
        await this.telemetry.withSpan(SpanNames.VALIDATION, async () => {
          this.validateRequest(body);
        });
      } else {
        this.validateRequest(body);
      }
      
      // Allow GraphQL introspection queries to pass through without caching, etc.
      if (body.operationName === 'IntrospectionQuery') {
        if (this.debug) {
          this.logger.log('[CopilotEdge] Received GraphQL IntrospectionQuery, returning minimal schema.');
        }
        return this.createIntrospectionResponse();
      }
      
      // Check rate limit
      this.checkRateLimit();
      
      const cacheKey = await this.hashRequest(body);

      // Check cache
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        const latency = Math.round(performance.now() - start);
        this.updateMetrics(latency);
        
        if (this.debug) {
          this.logger.log(`[CopilotEdge] Served from cache in ${latency}ms`);
        }
        return cached;
      }
      
      let result;
      // Handle different request formats
      if (body.operationName === 'generateCopilotResponse' && body.variables?.data) {
        result = await this.handleGraphQLMutation(body);
      } else if (body.messages && Array.isArray(body.messages)) {
        result = await this.handleDirectChat(body);
      } else if (body.operationName) {
        // This is a valid GraphQL request, but not one we have a specific handler for.
        // Silently acknowledge it to let CopilotKit operate normally.
        result = { data: {} }; // Default empty success response
      } else {
        // This should theoretically not be reached if validation is correct.
        throw new ValidationError('Unsupported request format');
      }
      
      // Cache successful response
      await this.saveToCache(cacheKey, result);
      
      const latency = Math.round(performance.now() - start);
      this.updateMetrics(latency);
      
      if (this.debug) {
        const ttfb = latency;
        const tokensOut = result.choices?.[0]?.message?.content?.length || 
                         result.data?.generateCopilotResponse?.messages?.[0]?.content?.[0]?.length || 0;
        this.logger.log(`[CopilotEdge] Request completed`, {
          ttfb_ms: ttfb,
          total_ms: latency,
          tokens_out: Math.floor(tokensOut / 4),
          cache_hit: !!cached,
          model: this.model,
          abandoned: false
        });
        this.logMetrics();
      }
      
      return result;
      
    } catch (error: any) {
      this.metrics.errors++;
      
      if (this.debug) {
        this.logger.error('[CopilotEdge] Error:', error.message);
      }
      
      throw error;
    }
  }

  /**
   * Handle CopilotKit GraphQL mutations.
   * @param body - The GraphQL request body.
   * @returns A GraphQL-formatted response.
   */
  private async handleGraphQLMutation(body: any): Promise<any> {
    const sanitized = this.getSanitizedMessages(body);

    if (!sanitized) {
      return this.createDefaultResponse(body.variables.data.threadId);
    }
    
    // Extract conversation ID from GraphQL variables if available
    const conversationId = body.variables?.data?.conversationId || 
                          body.variables?.data?.threadId || 
                          this.defaultConversationId;
    
    const response = await this.retryWithBackoff(
      async () => await this.callCloudflareAI(sanitized, conversationId),
      'Cloudflare AI'
    );
    
    return {
      data: {
        generateCopilotResponse: {
          threadId: body.variables.data.threadId || 'default-thread',
          runId: `run-${Date.now()}`,
          extensions: {},
          status: { code: 'SUCCESS', __typename: 'BaseResponseStatus' },
          messages: [{
            __typename: 'TextMessageOutput',
            id: `msg-${Date.now()}`,
            createdAt: new Date().toISOString(),
            content: [response],
            role: 'assistant',
            parentMessageId: null,
            status: { code: 'SUCCESS', __typename: 'SuccessMessageStatus' }
          }],
          metaEvents: []
        }
      }
    };
  }

  /**
   * Handle direct chat format requests.
   * @param body - The chat request body.
   * @returns An OpenAI-compatible chat completion response or streaming response.
   */
  private async handleDirectChat(body: any): Promise<any> {
    let sanitized = this.getSanitizedMessages(body);

    if (!sanitized) {
      // This case should be handled by validateRequest, but as a fallback:
      throw new ValidationError('Request body must contain messages.');
    }
    
    // Extract conversation ID for tracking (used for both telemetry and conversation management)
    const conversationId = body.conversationId || this.defaultConversationId;
    
    // Handle conversation management if enabled
    if (this.enableConversations && this.conversationDO && conversationId) {
      try {
          // Get or create conversation Durable Object
          const doId = this.conversationDO.idFromName(conversationId);
          const conversationStub = this.conversationDO.get(doId);
          
          // Get conversation history
          const historyResponse = await conversationStub.fetch(
            new Request('http://do/messages', { method: 'GET' })
          );
          
          if (historyResponse.ok) {
            const history = await historyResponse.json() as any;
            
            // Prepend conversation history to current messages
            if (history.messages && history.messages.length > 0) {
              const historyMessages = history.messages.map((msg: any) => ({
                role: msg.role,
                content: msg.content
              }));
              
              // Combine history with new messages, avoiding duplicates
              const currentMessages = (sanitized as any).messages || sanitized;
              sanitized = {
                messages: [...historyMessages, ...currentMessages]
              } as any;
              
              if (this.debug) {
                this.logger.log('[CopilotEdge] Using conversation history:', 
                  `${history.messages.length} previous messages`);
              }
            }
          }
        } catch (error) {
          // Log error but continue without conversation history
          this.logger.warn('[CopilotEdge] Failed to load conversation history:', error);
      }
    }
    
    // Check if streaming is requested (from body or instance config)
    const useStreaming = body.stream === true || (body.stream !== false && this.stream);
    
    if (useStreaming) {
      // Return a streaming response
      const streamingResponse = await this.retryWithBackoff(
        async () => await this.callCloudflareAIStreaming(sanitized!, conversationId),
        'Cloudflare AI Streaming'
      );
      
      // Return the streaming response object for the caller to handle
      return {
        id: 'chat-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: this.model,
        streaming: true,
        stream: streamingResponse.stream,
        getFullResponse: streamingResponse.getFullResponse
      };
    } else {
      // Non-streaming response (existing code)
      const response = await this.retryWithBackoff(
        async () => await this.callCloudflareAI(sanitized!, conversationId),
        'Cloudflare AI'
      );
      
      // Save to conversation if enabled
      if (this.enableConversations && this.conversationDO && conversationId) {
          try {
            const doId = this.conversationDO.idFromName(conversationId);
            const conversationStub = this.conversationDO.get(doId);
            
            // Save user message(s) and assistant response
            const messages = (sanitized as any).messages || sanitized;
            const lastUserMessage = messages[messages.length - 1];
            if (lastUserMessage && lastUserMessage.role === 'user') {
              await conversationStub.fetch(
                new Request('http://do/messages', {
                  method: 'POST',
                  body: JSON.stringify({
                    role: 'user',
                    content: lastUserMessage.content,
                    tokens: JSON.stringify(lastUserMessage).length / 4
                  }),
                  headers: { 'Content-Type': 'application/json' }
                })
              );
            }
            
            // Save assistant response
            await conversationStub.fetch(
              new Request('http://do/messages', {
                method: 'POST',
                body: JSON.stringify({
                  role: 'assistant',
                  content: response,
                  tokens: response.length / 4
                }),
                headers: { 'Content-Type': 'application/json' }
              })
            );
            
            if (this.debug) {
              this.logger.log('[CopilotEdge] Saved to conversation:', conversationId);
            }
          } catch (error) {
            this.logger.warn('[CopilotEdge] Failed to save to conversation:', error);
          }
      }
      
      return {
        id: 'chat-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: this.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: JSON.stringify(sanitized).length / 4,
          completion_tokens: response.length / 4,
          total_tokens: (JSON.stringify(sanitized).length + response.length) / 4
        }
      };
    }
  }

  /**
   * Call the Cloudflare Workers AI API.
   * @param messages - The sanitized messages to send.
   * @param conversationId - Optional conversation ID for tracking.
   * @returns The AI's response content as a string.
   */
  private async callCloudflareAI(messages: any[], conversationId?: string): Promise<string> {
    const baseURL = this.getCloudflareApiUrl();
    const activeModel = this.isFallbackActive && this.fallbackModel ? this.fallbackModel : this.model;

    // Count input tokens
    const inputTokens = this.tokenCounter.countMessageTokens(messages);
    
    // Generate correlation ID for this request
    const correlationId = `copilot-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    // Start telemetry span for AI call
    const aiSpan = this.telemetry?.startSpan(SpanNames.AI_CALL, {
      kind: SpanKind.CLIENT,
      attributes: {
        'copilot.model': activeModel,
        'ai.tokens.input': inputTokens,
        'correlation.id': correlationId,
        'copilot.fallback_used': this.isFallbackActive,
        ...(conversationId && {
          'conversation.id': conversationId,
          'copilot.conversation_id': conversationId
        })
      }
    });

    // A list of known chat-optimized model prefixes.
    const chatModelPatterns = [
      '@cf/meta/',
      '@cf/mistral/',
      '@cf/google/'
    ];

    // Determine the API format based on the model identifier.
    // Models not in the chat list are assumed to use the general-purpose '/run' endpoint.
    const isChatModel = chatModelPatterns.some(pattern => activeModel.startsWith(pattern));

    const endpoint = isChatModel
      ? `${baseURL}/accounts/${this.accountId}/ai/v1/chat/completions`
      : `${baseURL}/accounts/${this.accountId}/ai/run/${activeModel}`;

    const requestBody = isChatModel
      ? { // Body for /chat/completions
          model: activeModel,
          messages: messages,
          temperature: 0.7,
          max_tokens: 1000,
          stream: false
        }
      : { // Body for /run/*
          // Collapse the message history into a single prompt for instruction-based models.
          prompt: messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n')
        };

    try {
      let response;
      try {
        response = await this.fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(this.apiTimeout) // 30s timeout
        });
      } catch (fetchError: any) {
        // Handle fetch errors (network issues, etc.)
        const errorMessage = fetchError.message || 'Fetch error';
        
        if (this.debug) {
          this.logger.log(`[CopilotEdge] Fetch error: ${errorMessage}`);
        }
        throw new APIError(`Fetch error: ${errorMessage}`, 500);
      }


      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
        } catch (e) {
          errorText = 'Could not read error response';
        }
        
        // If we get a 404 (model not found) or a 429 (rate limit exceeded),
        // and we have a fallback model, and we haven't tried the fallback yet,
        // switch to the fallback model and retry
        if ((response.status === 404 || response.status === 429) && 
            this.fallbackModel && 
            !this.isFallbackActive) {
          
          if (this.debug) {
            // Don't log specific model names for privacy
            this.logger.log(`[CopilotEdge] Primary model unavailable, using fallback model`);
          }
          
          this.isFallbackActive = true;
          this.metrics.fallbackUsed++;
          
          // Retry with fallback model
          return await this.callCloudflareAI(messages, conversationId);
        }
        
        throw new APIError(
          `Cloudflare AI error: ${errorText}`,
          response.status
        );
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonError: any) {
        throw new APIError(`Invalid JSON response: ${jsonError.message || 'JSON parse error'}`, 500);
      }
      
      // Check if data is null or undefined
      if (!data) {
        throw new APIError('Invalid response format: Empty response from Cloudflare AI', 500);
      }
      
      // Handle different response formats based on model type
      let responseContent: string;
      if (isChatModel) {
        // Standard chat models return response in choices[0].message.content
        if (!data.choices?.[0]?.message?.content) {
          throw new APIError('Invalid response from Cloudflare AI Chat model', 500);
        }
        responseContent = data.choices[0].message.content;
      } else {
        // General purpose models return a simpler response structure
        if (data.result?.response) {
          responseContent = data.result.response;
        } else {
          throw new APIError('Invalid response format from Cloudflare AI Run model', 500);
        }
      }
      
      // Count output tokens and calculate costs
      const outputTokens = this.tokenCounter.countTokens(responseContent);
      const costs = this.tokenCounter.calculateCost(inputTokens, outputTokens, activeModel);
      
      // Update telemetry span with token and cost information
      if (aiSpan) {
        aiSpan.setAttributes({
          'ai.tokens.output': outputTokens,
          'ai.tokens.total': inputTokens + outputTokens,
          'ai.cost.input_usd': costs.inputCost,
          'ai.cost.output_usd': costs.outputCost,
          'ai.cost.total_usd': costs.totalCost,
          'ai.cost.estimated': false
        });
        
        this.telemetry?.endSpan(SpanNames.AI_CALL, { code: SpanStatusCode.OK });
      }
      
      // Update telemetry metrics
      this.telemetry?.updateMetrics({
        tokensProcessed: (this.telemetry?.getMetrics().tokensProcessed || 0) + inputTokens + outputTokens
      });
      
      return responseContent;
    } catch (error) {
      // Record error in telemetry
      if (aiSpan && this.telemetry) {
        this.telemetry.recordError(SpanNames.AI_CALL, error as Error);
        this.telemetry.endSpan(SpanNames.AI_CALL, { 
          code: SpanStatusCode.ERROR, 
          message: (error as Error).message 
        });
      }
      throw error;
    }
  }

  /**
   * Call the Cloudflare Workers AI API with streaming support.
   * @param messages - The sanitized messages to send.
   * @param conversationId - Optional conversation ID for tracking.
   * @returns A streaming response that can be consumed as an async generator.
   */
  private async callCloudflareAIStreaming(messages: any[], conversationId?: string): Promise<StreamingResponse> {
    const baseURL = this.getCloudflareApiUrl();
    const activeModel = this.isFallbackActive && this.fallbackModel ? this.fallbackModel : this.model;

    // Count input tokens
    const inputTokens = this.tokenCounter.countMessageTokens(messages);
    
    // Generate correlation ID for this request
    const correlationId = `copilot-stream-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    // Start telemetry span for AI call
    const aiSpan = this.telemetry?.startSpan(SpanNames.AI_CALL, {
      kind: SpanKind.CLIENT,
      attributes: {
        'copilot.model': activeModel,
        'copilot.streaming': true,
        'ai.tokens.input': inputTokens,
        'correlation.id': correlationId,
        'copilot.fallback_used': this.isFallbackActive,
        ...(conversationId && {
          'conversation.id': conversationId,
          'copilot.conversation_id': conversationId
        })
      }
    });

    // Determine if this is a chat model
    const chatModelPatterns = ['@cf/meta/', '@cf/mistral/', '@cf/google/'];
    const isChatModel = chatModelPatterns.some(pattern => activeModel.startsWith(pattern));

    const endpoint = isChatModel
      ? `${baseURL}/accounts/${this.accountId}/ai/v1/chat/completions`
      : `${baseURL}/accounts/${this.accountId}/ai/run/${activeModel}`;

    const requestBody = isChatModel
      ? {
          model: activeModel,
          messages: messages,
          temperature: 0.7,
          max_tokens: 1000,
          stream: true // Enable streaming
        }
      : {
          prompt: messages.map(msg => `${msg.role}: ${msg.content}`).join('\n\n'),
          stream: true // Enable streaming for run endpoint too
        };

    const response = await this.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.apiTimeout)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error response');
      throw new APIError(`Cloudflare AI error: ${errorText}`, response.status);
    }

    if (!response.body) {
      throw new APIError('No response body for streaming', 500);
    }

    // Create the streaming response
    const parser = new SSEParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    
    // Reference to telemetry span and token counter - passed via closure
    const telemetryManager = this.telemetry;
    const tokenCounter = this.tokenCounter;
    const model = activeModel;
    const inputTokensCount = inputTokens;  // Capture inputTokens for closure
    const aiSpanRef = aiSpan;  // Capture aiSpan for closure

    const stream = async function* (this: CopilotEdge) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Stream is complete, calculate final tokens and costs
            const outputTokens = tokenCounter.countTokens(accumulated);
            const costs = tokenCounter.calculateCost(inputTokensCount, outputTokens, model);
            
            // Update telemetry span with final metrics
            if (aiSpanRef) {
              aiSpanRef.setAttributes({
                'ai.tokens.output': outputTokens,
                'ai.tokens.total': inputTokensCount + outputTokens,
                'ai.cost.input_usd': costs.inputCost,
                'ai.cost.output_usd': costs.outputCost,
                'ai.cost.total_usd': costs.totalCost,
                'ai.cost.estimated': false
              });
              
              telemetryManager?.endSpan(SpanNames.AI_CALL, { code: SpanStatusCode.OK });
            }
            
            // Update telemetry metrics
            telemetryManager?.updateMetrics({
              tokensProcessed: (telemetryManager?.getMetrics().tokensProcessed || 0) + inputTokensCount + outputTokens
            });
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const events = parser.parseChunk(chunk);

          for (const event of events) {
            if (event.type === 'done') {
              // Handle done event - calculate final metrics
              const outputTokens = tokenCounter.countTokens(accumulated);
              const costs = tokenCounter.calculateCost(inputTokensCount, outputTokens, model);
              
              if (aiSpanRef) {
                aiSpanRef.setAttributes({
                  'ai.tokens.output': outputTokens,
                  'ai.tokens.total': inputTokensCount + outputTokens,
                  'ai.cost.input_usd': costs.inputCost,
                  'ai.cost.output_usd': costs.outputCost,
                  'ai.cost.total_usd': costs.totalCost,
                  'ai.cost.estimated': false
                });
                
                telemetryManager?.endSpan(SpanNames.AI_CALL, { code: SpanStatusCode.OK });
              }
              
              telemetryManager?.updateMetrics({
                tokensProcessed: (telemetryManager?.getMetrics().tokensProcessed || 0) + inputTokensCount + outputTokens
              });
              return;
            }
            if (event.type === 'data' && event.content) {
              // Extract content from the response
              let content = '';
              if (isChatModel && event.content.choices?.[0]?.delta?.content) {
                content = event.content.choices[0].delta.content;
              } else if (event.content.response) {
                content = event.content.response;
              } else if (event.content.text) {
                content = event.content.text;
              }

              if (content) {
                accumulated += content;
                // Call the onChunk callback if provided
                if (this.onChunk) {
                  await this.onChunk(content);
                }
                yield content;
              }
            }
          }
        }
      } catch (error) {
        // Record error in telemetry
        if (aiSpanRef && telemetryManager) {
          telemetryManager.recordError(SpanNames.AI_CALL, error as Error);
          telemetryManager.endSpan(SpanNames.AI_CALL, { 
            code: SpanStatusCode.ERROR, 
            message: (error as Error).message 
          });
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
    }.bind(this);

    return {
      stream: stream(),
      getFullResponse: async () => {
        // Consume the entire stream if not already consumed
        if (accumulated) return accumulated;
        // Consume stream to populate accumulated
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of stream()) {
          // Stream is consumed, accumulated is updated
        }
        return accumulated;
      }
    };
  }

  /**
   * Create a default response for when there are no messages to process.
   * @param threadId The thread ID from the request.
   * @returns A default GraphQL response.
   */
  private createDefaultResponse(threadId?: string): any {
    return {
      data: {
        generateCopilotResponse: {
          threadId: threadId || 'default-thread',
          runId: 'default-run',
          messages: [{
            __typename: 'TextMessageOutput',
            id: `msg-${Date.now()}`,
            createdAt: new Date().toISOString(),
            content: ["Hello! I'm powered by Cloudflare AI at the edge. How can I help you today?"],
            role: 'assistant',
            status: { code: 'SUCCESS', __typename: 'SuccessMessageStatus' }
          }]
        }
      }
    };
  }

  /**
   * Update performance metrics after a request.
   * @param latency - The latency of the request in milliseconds.
   */
  private updateMetrics(latency: number): void {
    this.metrics.avgLatency.push(latency);
    
    // Keep only last 100 measurements
    if (this.metrics.avgLatency.length > 100) {
      this.metrics.avgLatency.shift();
    }
  }

  /**
   * Log current metrics to the console if in debug mode.
   */
  private logMetrics(): void {
    const avg = this.metrics.avgLatency.length > 0
      ? Math.round(this.metrics.avgLatency.reduce((a, b) => a + b, 0) / this.metrics.avgLatency.length)
      : 0;
    
    const cacheRate = this.metrics.totalRequests > 0
      ? Math.round((this.metrics.cacheHits / this.metrics.totalRequests) * 100)
      : 0;
    
    const fallbackRate = this.metrics.totalRequests > 0
      ? Math.round((this.metrics.fallbackUsed / this.metrics.totalRequests) * 100)
      : 0;
    
    const metricsLog = {
      totalRequests: this.metrics.totalRequests,
      cacheHitRate: `${cacheRate}%`,
      avgLatency: `${avg}ms`,
      errors: this.metrics.errors,
      fallbackUsed: this.metrics.fallbackUsed,
      fallbackRate: `${fallbackRate}%`,
      // Always use generic names for privacy
      activeModel: this.isFallbackActive ? 'fallback-model' : 'primary-model'
    };
    
    this.logger.log('[CopilotEdge] Metrics:', metricsLog);
  }

  /**
   * Creates a Next.js API route handler for seamless integration.
   * @returns An async function that handles a `NextRequest` and returns a `NextResponse`.
   */
  public createNextHandler() {
    return async (req: NextRequest): Promise<NextResponse> => {
      const startTime = performance.now();
      try {
        const body = await req.json();
        const result = await this.handleRequest(body);
        
        // Check if this is a streaming response
        if (result.streaming && result.stream) {
          // Create a streaming response using Server-Sent Events
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              try {
                // Send initial metadata
                const initData = `data: ${JSON.stringify({
                  id: result.id,
                  object: 'chat.completion.chunk',
                  created: result.created,
                  model: result.model,
                  choices: [{
                    index: 0,
                    delta: { role: 'assistant' },
                    finish_reason: null
                  }]
                })}\n\n`;
                controller.enqueue(encoder.encode(initData));
                
                // Stream the content chunks
                for await (const chunk of result.stream) {
                  const chunkData = `data: ${JSON.stringify({
                    id: result.id,
                    object: 'chat.completion.chunk',
                    created: result.created,
                    model: result.model,
                    choices: [{
                      index: 0,
                      delta: { content: chunk },
                      finish_reason: null
                    }]
                  })}\n\n`;
                  controller.enqueue(encoder.encode(chunkData));
                }
                
                // Send the final chunk
                const doneData = `data: ${JSON.stringify({
                  id: result.id,
                  object: 'chat.completion.chunk',
                  created: result.created,
                  model: result.model,
                  choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                  }]
                })}\n\ndata: [DONE]\n\n`;
                controller.enqueue(encoder.encode(doneData));
                controller.close();
              } catch (error) {
                controller.error(error);
              }
            }
          });
          
          const metrics = this.getMetrics();
          const latency = Math.round(performance.now() - startTime);
          
          return new NextResponse(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive',
              'X-Powered-By': 'CopilotEdge',
              'X-Streaming': 'true',
              'X-CopilotEdge-Cache-Hit-Rate': String(metrics.cacheHitRate.toFixed(2)),
              'X-CopilotEdge-Model': this.isFallbackActive && this.fallbackModel ? this.fallbackModel : this.model,
              'X-CopilotEdge-Latency': `${latency}ms`
              // Security headers are added automatically by Cloudflare
            }
          });
        }
        
        // Non-streaming response
        const metrics = this.getMetrics();
        const latency = Math.round(performance.now() - startTime);
        
        return NextResponse.json(result, {
          headers: {
            'X-Powered-By': 'CopilotEdge',
            'X-Cache': result.cached ? 'HIT' : 'MISS',
            'X-CopilotEdge-Cache-Hit-Rate': String(metrics.cacheHitRate.toFixed(2)),
            'X-CopilotEdge-Model': this.isFallbackActive && this.fallbackModel ? this.fallbackModel : this.model,
            'X-CopilotEdge-Latency': `${latency}ms`
            // Security headers are added automatically by Cloudflare
          }
        });
      } catch (error: any) {
        if (this.debug) {
          this.logger.error('[CopilotEdge] Handler error:', error);
        }
        
        const status = error instanceof APIError ? error.statusCode : 
                      error instanceof ValidationError ? 400 : 500;
        
        return NextResponse.json(
          { 
            error: error.message,
            type: error.name
          },
          { status }
        );
      }
    };
  }

  /**
   * Get the current performance and usage metrics.
   * @returns An object containing key metrics.
   */
  public getMetrics() {
    const avg = this.metrics.avgLatency.length > 0
      ? Math.round(this.metrics.avgLatency.reduce((a, b) => a + b, 0) / this.metrics.avgLatency.length)
      : 0;
    
    return {
      totalRequests: this.metrics.totalRequests,
      cacheHits: this.metrics.cacheHits,
      cacheHitRate: this.metrics.totalRequests > 0 
        ? (this.metrics.cacheHits / this.metrics.totalRequests) : 0,
      avgLatency: avg,
      errors: this.metrics.errors,
      errorRate: this.metrics.totalRequests > 0
        ? (this.metrics.errors / this.metrics.totalRequests) : 0,
      fallbackUsed: this.metrics.fallbackUsed,
      fallbackRate: this.metrics.totalRequests > 0
        ? (this.metrics.fallbackUsed / this.metrics.totalRequests) : 0,
      activeModel: this.isFallbackActive && this.fallbackModel ? this.fallbackModel : this.model
    };
  }

  /**
   * Clears the in-memory cache and optionally KV cache.
   * @param clearKV - Whether to also clear KV cache (requires listing all keys).
   */
  public async clearCache(clearKV: boolean = false): Promise<void> {
    // Clear in-memory cache
    this.cache.clear();
    
    // Clear KV cache if requested and available
    if (clearKV && this.kvNamespace) {
      try {
        // List all keys with our prefix
        const list = await this.kvNamespace.list({ 
          prefix: this.kvCachePrefix,
          limit: 1000 
        });
        
        // Delete all found keys
        for (const key of list.keys) {
          await this.kvNamespace.delete(key.name);
        }
        
        if (this.debug) {
          this.logger.log(`[CopilotEdge] Cleared ${list.keys.length} KV cache entries`);
        }
      } catch (error) {
        if (this.debug) {
          this.logger.warn('[CopilotEdge] KV cache clear failed:', error);
        }
      }
    }
    
    if (this.debug) {
      this.logger.log(`[CopilotEdge] Cache cleared (memory: yes, KV: ${clearKV ? 'yes' : 'no'})`);
    }
  }

  /**
   * Helper method to delay execution (for testing)
   */
  public sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Runs a series of checks to test and display the current configuration and feature status.
   * Useful for debugging and ensuring the instance is configured correctly.
   */
  public async testFeatures(): Promise<void> {
    console.log('🚀 CopilotEdge Feature Test\n');
    console.log('=' .repeat(40));
    
    // 1. Configuration
    console.log('\n✅ Configuration');
    console.log('  API Token:', this.apiToken ? 'Set' : '❌ Missing');
    console.log('  Account ID:', this.accountId ? 'Set' : '❌ Missing');
    console.log('  Provider:', this.provider);
    
    // Always use generic names for privacy
    console.log('  Model:', this.model.includes('/') ? 'custom-model' : this.model);
    console.log('  Fallback:', this.fallbackModel ? 'Configured' : 'None');
    
    console.log('  Debug:', this.debug ? 'ON' : 'OFF');
    
    // 2. Edge routing
    console.log('\n✅ Cloudflare Edge Routing');
    console.log('  API URL:', this.getCloudflareApiUrl());
    console.log('  Edge Selection: Automatic (Cloudflare)');
    
    // 3. Cache
    console.log('\n✅ Request Caching');
    const testKey = 'test-' + Date.now();
    await this.saveToCache(testKey, { test: 'data' });
    const cached = await this.getFromCache(testKey);
    console.log('  Cache:', cached ? 'Working' : 'Failed');
    console.log('  TTL:', this.cacheTimeout / 1000, 'seconds');
    if (this.kvNamespace) {
      console.log('  KV:', 'Enabled (persistent global cache)');
      console.log('  KV TTL:', this.kvCacheTTL / 60, 'minutes');
    } else {
      console.log('  KV:', 'Disabled (use wrangler.toml to enable)');
    }
    
    // 4. Rate limiting
    console.log('\n✅ Rate Limiting');
    console.log('  Limit:', this.rateLimit, 'req/min');
    
    // 5. Retry logic
    console.log('\n✅ Retry Logic');
    console.log('  Max retries:', this.maxRetries);
    console.log('  Backoff: Exponential with jitter');
    console.log('  Fallback:', this.fallbackModel ? 'Enabled' : 'Disabled');
    
    // 6. Metrics
    console.log('\n✅ Performance Metrics');
    const metrics = this.getMetrics();
    console.log('  Tracking:', Object.keys(metrics).join(', '));
    
    console.log('\n' + '=' .repeat(40));
    console.log('All features operational! 🎉\n');
  }
}

/**
 * A convenience function to create a Next.js API route handler.
 * @param config - CopilotEdge configuration options.
 * @returns A Next.js route handler function.
 */
export function createCopilotEdgeHandler(config?: CopilotEdgeConfig) {
  const edge = new CopilotEdge(config);
  return edge.createNextHandler();
}

// Re-export telemetry types and classes
export {
  type TelemetryConfig,
  type TelemetryMetrics,
  TelemetryManager,
  SpanNames
} from './telemetry';

// Re-export token counting utilities
export {
  TokenCounter,
  getTokenCounter,
  MODEL_PRICING
} from './tokenUtils';

// Re-export Durable Objects
export { 
  ConversationDO, 
  type ConversationState, 
  type WSMessage 
} from './durable-objects';

// Define metrics interface type (matches the return type of getMetrics())
export interface CopilotEdgeMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheHitRate: number;
  avgLatency: number;
  errors: number;
  errorRate: number;
  fallbackUsed: number;
  fallbackRate: number;
  activeModel: string;
}

// Default export
export default CopilotEdge;