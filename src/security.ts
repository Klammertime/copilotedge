/**
 * Security module for CopilotEdge
 * Implements practical security features for Cloudflare Workers
 */

import { SpanStatusCode } from '@opentelemetry/api';
import { TelemetryManager } from './telemetry';

/**
 * HMAC signature verification for request authentication
 */
export class HMACValidator {
  private secret: string;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error('HMAC secret must be at least 32 characters');
    }
    this.secret = secret;
  }

  /**
   * Generate HMAC signature for a request
   */
  async sign(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    );
    
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  /**
   * Verify HMAC signature from request header
   */
  async verify(payload: string, signature: string): Promise<boolean> {
    try {
      const expectedSignature = await this.sign(payload);
      return signature === expectedSignature;
    } catch (error) {
      console.error('HMAC verification failed:', error);
      return false;
    }
  }
}

/**
 * KV storage encryption using AES-GCM
 */
export class KVEncryption {
  private key: CryptoKey | null = null;

  constructor(private keyString?: string) {}

  /**
   * Initialize encryption key
   */
  private async getKey(): Promise<CryptoKey> {
    if (this.key) return this.key;
    
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.keyString || 'default-key-change-in-production!!'),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    this.key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('copilotedge-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return this.key;
  }

  /**
   * Encrypt data for KV storage
   */
  async encrypt(data: string): Promise<string> {
    const key = await this.getKey();
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt data from KV storage
   */
  async decrypt(encryptedData: string): Promise<string> {
    const key = await this.getKey();
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    
    return new TextDecoder().decode(decrypted);
  }
}

/**
 * Rate limiter using Durable Objects
 */
export class RateLimiter {
  private limits: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(
    private requestsPerMinute: number = 60,
    private durableObject?: any // DurableObjectNamespace
  ) {}

  /**
   * Check if request should be rate limited
   */
  async checkLimit(identifier: string): Promise<{ allowed: boolean; remaining: number }> {
    // If we have a Durable Object, use distributed rate limiting
    if (this.durableObject) {
      try {
        const id = this.durableObject.idFromName(identifier);
        const stub = this.durableObject.get(id);
        const response = await stub.fetch('http://internal/check-limit', {
          method: 'POST',
          body: JSON.stringify({ requestsPerMinute: this.requestsPerMinute })
        });
        return await response.json();
      } catch (error) {
        console.error('Durable Object rate limit check failed:', error);
        // Fall back to local rate limiting
      }
    }

    // Local rate limiting fallback
    const now = Date.now();
    const limit = this.limits.get(identifier);
    
    if (!limit || now > limit.resetTime) {
      this.limits.set(identifier, {
        count: 1,
        resetTime: now + 60000 // 1 minute
      });
      return { allowed: true, remaining: this.requestsPerMinute - 1 };
    }

    if (limit.count >= this.requestsPerMinute) {
      return { allowed: false, remaining: 0 };
    }

    limit.count++;
    return { allowed: true, remaining: this.requestsPerMinute - limit.count };
  }
}

/**
 * Structured logger that sanitizes sensitive data
 */
export class SecureLogger {
  private sensitivePatterns = [
    /api[_-]?key/gi,
    /api[_-]?token/gi,
    /bearer\s+[a-zA-Z0-9_-]+/gi,
    /password/gi,
    /secret/gi,
    /credential/gi
  ];

  constructor(private debugMode: boolean = false) {}

  /**
   * Sanitize sensitive data from logs
   */
  private sanitize(data: any): any {
    if (typeof data === 'string') {
      let sanitized = data;
      for (const pattern of this.sensitivePatterns) {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      }
      return sanitized;
    }
    
    if (typeof data === 'object' && data !== null) {
      const sanitized: any = Array.isArray(data) ? [] : {};
      for (const key in data) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('key') || lowerKey.includes('token') || 
            lowerKey.includes('secret') || lowerKey.includes('password')) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(data[key]);
        }
      }
      return sanitized;
    }
    
    return data;
  }

  /**
   * Internal method for structured logging
   */
  private logStructured(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any) {
    if (level === 'debug' && !this.debugMode) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data ? this.sanitize(data) : undefined
    };

    // In production, you'd send this to a logging service
    // For now, we'll use console with structured output
    console.log(JSON.stringify(logEntry));
  }

  info(message: string, data?: any) {
    this.logStructured('info', message, data);
  }

  warn(message: string, data?: any) {
    this.logStructured('warn', message, data);
  }

  error(message: string, data?: any) {
    this.logStructured('error', message, data);
  }

  debug(message: string, data?: any) {
    this.logStructured('debug', message, data);
  }

  // Compatibility method for simple logger interface
  log(...args: any[]) {
    // For backward compatibility with simple logger
    if (!this.debugMode) return;
    
    if (args.length === 1 && typeof args[0] === 'string') {
      this.info(args[0]);
    } else if (args.length > 1) {
      this.info(String(args[0]), args.slice(1));
    } else {
      this.info('Log', args);
    }
  }
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  enableRequestSigning?: boolean;
  hmacSecret?: string;
  enableKVEncryption?: boolean;
  kvEncryptionKey?: string;
  enableRateLimiting?: boolean;
  rateLimit?: {
    requestsPerMinute?: number;
    useDistributed?: boolean;
  };
  enableSecureLogging?: boolean;
  debugMode?: boolean;
}

/**
 * Main security manager
 */
export class SecurityManager {
  private hmacValidator?: HMACValidator;
  private kvEncryption?: KVEncryption;
  private rateLimiter?: RateLimiter;
  private logger: SecureLogger;

  constructor(config: SecurityConfig = {}, durableObject?: any) {
    // Initialize HMAC validator
    if (config.enableRequestSigning && config.hmacSecret) {
      this.hmacValidator = new HMACValidator(config.hmacSecret);
    }

    // Initialize KV encryption
    if (config.enableKVEncryption) {
      this.kvEncryption = new KVEncryption(config.kvEncryptionKey);
    }

    // Initialize rate limiter
    if (config.enableRateLimiting) {
      const rateConfig = config.rateLimit || {};
      this.rateLimiter = new RateLimiter(
        rateConfig.requestsPerMinute || 60,
        rateConfig.useDistributed ? durableObject : undefined
      );
    }

    // Initialize logger
    this.logger = new SecureLogger(config.debugMode);
  }

  /**
   * Validate incoming request
   */
  async validateRequest(request: Request, telemetry?: TelemetryManager): Promise<{ valid: boolean; error?: string }> {
    const span = telemetry?.startSpan('security.validate_request');

    try {
      // Check HMAC signature if enabled
      if (this.hmacValidator) {
        const signature = request.headers.get('X-Signature');
        if (!signature) {
          this.logger.warn('Missing HMAC signature');
          span?.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing signature' });
          return { valid: false, error: 'Missing signature' };
        }

        const body = await request.clone().text();
        const valid = await this.hmacValidator.verify(body, signature);
        
        if (!valid) {
          this.logger.warn('Invalid HMAC signature');
          span?.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid signature' });
          return { valid: false, error: 'Invalid signature' };
        }
      }

      // Check rate limit if enabled
      if (this.rateLimiter) {
        const identifier = request.headers.get('CF-Connecting-IP') || 
                         request.headers.get('X-Forwarded-For') || 
                         'unknown';
        
        const { allowed, remaining } = await this.rateLimiter.checkLimit(identifier);
        
        span?.setAttribute('security.rate_limit.remaining', remaining);
        
        if (!allowed) {
          this.logger.warn('Rate limit exceeded', { identifier });
          span?.setStatus({ code: SpanStatusCode.ERROR, message: 'Rate limit exceeded' });
          return { valid: false, error: 'Rate limit exceeded' };
        }
      }

      span?.setStatus({ code: SpanStatusCode.OK });
      return { valid: true };
    } catch (error) {
      this.logger.error('Security validation error', error);
      span?.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      return { valid: false, error: 'Security validation failed' };
    } finally {
      span?.end();
    }
  }

  /**
   * Encrypt data for KV storage
   */
  async encryptForKV(data: string): Promise<string> {
    if (!this.kvEncryption) {
      return data; // Return unencrypted if encryption not enabled
    }
    return this.kvEncryption.encrypt(data);
  }

  /**
   * Decrypt data from KV storage
   */
  async decryptFromKV(data: string): Promise<string> {
    if (!this.kvEncryption) {
      return data; // Return as-is if encryption not enabled
    }
    return this.kvEncryption.decrypt(data);
  }

  /**
   * Get the logger instance
   */
  getLogger(): SecureLogger {
    return this.logger;
  }

  /**
   * Add security headers to response
   */
  addSecurityHeaders(response: Response): Response {
    const headers = new Headers(response.headers);
    
    // Add security headers
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    headers.set('Content-Security-Policy', "default-src 'self'");
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
}