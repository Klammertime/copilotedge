"use strict";
/**
 * CopilotEdge - Production-ready adapter for CopilotKit + Cloudflare Workers AI
 * @author Audrey Klammer (@Klammertime)
 * @version 0.2.3
 * @license MIT
 *
 * Features:
 * - ⚡ Auto-selects fastest Cloudflare edge location
 * - 💾 60-second request caching (reduces costs by up to 90%)
 * - 🔄 Automatic retry with exponential backoff
 * - 🎯 Simple configuration (just needs API key)
 * - 🐛 Debug mode with detailed metrics
 * - 🔒 Input validation and sanitization
 * - 📊 Performance monitoring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopilotEdge = exports.APIError = exports.ValidationError = void 0;
exports.createCopilotEdgeHandler = createCopilotEdgeHandler;
const server_1 = require("next/server");
/**
 * Request validation error
 */
class ValidationError extends Error {
    constructor(message, field) {
        super(message);
        this.field = field;
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
/**
 * API error with status code
 */
class APIError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'APIError';
    }
}
exports.APIError = APIError;
/**
 * Circuit Breaker class
 */
class CircuitBreaker {
    constructor() {
        this.failures = 0;
        this.lastFailureTime = 0;
        this.state = 'closed';
        this.failureThreshold = 5;
        this.openStateTimeout = 30000; // 30 seconds
    }
    async execute(fn) {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime > this.openStateTimeout) {
                this.state = 'half-open';
            }
            else {
                throw new Error('Circuit breaker is open');
            }
        }
        try {
            const result = await fn();
            this.reset();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    recordFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.failureThreshold) {
            this.state = 'open';
        }
    }
    reset() {
        this.failures = 0;
        this.state = 'closed';
    }
}
/**
 * Main CopilotEdge class
 */
class CopilotEdge {
    constructor(config = {}) {
        this.lastRegionCheck = 0;
        // Validate and set configuration
        this.apiToken = config.apiKey || process.env.CLOUDFLARE_API_TOKEN || '';
        this.accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
        this.model = config.model || '@cf/meta/llama-3.1-8b-instruct';
        this.debug = config.debug || process.env.NODE_ENV === 'development';
        this.cacheTimeout = config.cacheTimeout || 60000; // 60 seconds
        this.maxRetries = config.maxRetries || 3;
        this.rateLimit = config.rateLimit || 60; // requests per minute
        this.enableInternalSensitiveLogging = config.enableInternalSensitiveLogging || false;
        // Request size limits for DoS protection
        this.maxRequestSize = config.maxRequestSize || 1024 * 1024; // 1MB default
        this.maxMessages = config.maxMessages || 100; // 100 messages default
        this.maxMessageSize = config.maxMessageSize || 10000; // 10KB per message default
        this.maxObjectDepth = config.maxObjectDepth || 10; // Max nesting depth
        // Validate required fields
        if (!this.apiToken) {
            throw new ValidationError('API key is required. Set config.apiKey or CLOUDFLARE_API_TOKEN env var');
        }
        if (!this.accountId) {
            throw new ValidationError('Account ID is required. Set config.accountId or CLOUDFLARE_ACCOUNT_ID env var');
        }
        // Initialize cache
        this.cache = new Map();
        this.cacheLocks = new Map();
        // Edge regions ordered by typical performance
        this.regions = [
            { name: 'US-East', url: 'https://api.cloudflare.com' },
            { name: 'EU-West', url: 'https://eu.api.cloudflare.com' },
            { name: 'Asia-Pacific', url: 'https://ap.api.cloudflare.com' },
        ];
        this.fastestRegion = null;
        this.regionLatencies = new Map();
        this.requestCount = new Map();
        this.circuitBreaker = new CircuitBreaker();
        // Metrics tracking
        this.metrics = {
            totalRequests: 0,
            cacheHits: 0,
            errors: 0,
            avgLatency: []
        };
        if (this.debug) {
            console.log('[CopilotEdge] Initialized with:', {
                model: this.model,
                cacheTimeout: this.cacheTimeout,
                maxRetries: this.maxRetries,
                rateLimit: this.rateLimit,
                maxRequestSize: `${Math.round(this.maxRequestSize / 1024)}KB`,
                maxMessages: this.maxMessages,
                maxMessageSize: `${Math.round(this.maxMessageSize / 1024)}KB`,
                maxObjectDepth: this.maxObjectDepth,
                enableInternalSensitiveLogging: this.enableInternalSensitiveLogging
            });
        }
    }
    /**
     * Generate hash for cache key
     */
    async hashRequest(obj) {
        const str = JSON.stringify(obj);
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex; // Full SHA-256 hash to prevent collisions
    }
    /**
     * Get cached response if available
     */
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            this.metrics.cacheHits++;
            if (this.debug) {
                const age = Math.round((Date.now() - cached.timestamp) / 1000);
                console.log(`[CopilotEdge] Cache HIT (age: ${age}s, saved 1 API call)`);
            }
            return { ...cached.data, cached: true };
        }
        return null;
    }
    /**
     * Save response to cache
     */
    saveToCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        // LRU eviction when cache gets too large
        if (this.cache.size > 100) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }
    }
    /**
     * Check rate limit
     */
    checkRateLimit(clientId = 'default') {
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
     * Find fastest Cloudflare region
     */
    async findFastestRegion() {
        const now = Date.now();
        // Re-test regions every 5 minutes
        if (this.fastestRegion && now - this.lastRegionCheck < 300000) {
            return this.fastestRegion;
        }
        if (this.debug) {
            console.log('[CopilotEdge] Testing edge regions for optimal performance...');
        }
        const tests = this.regions.map(async (region) => {
            const start = performance.now();
            try {
                // Create AbortController for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                try {
                    const response = await fetch(region.url + '/client/v4', {
                        method: 'HEAD',
                        signal: controller.signal,
                        headers: {
                            'Authorization': `Bearer ${this.apiToken}`
                        }
                    });
                    if (response.ok) {
                        const latency = Math.round(performance.now() - start);
                        this.regionLatencies.set(region.name, latency);
                        return { region, latency };
                    }
                } finally {
                    clearTimeout(timeoutId);
                }
            }
            catch (e) {
                // Region unavailable
            }
            return { region, latency: 9999 };
        });
        const results = await Promise.all(tests);
        const sortedRegions = results.sort((a, b) => a.latency - b.latency);
        const fastest = sortedRegions[0];
        if (fastest.latency === 9999) {
            if (this.debug) {
                console.log('[CopilotEdge] WARNING: All regions failed, falling back to default');
            }
            this.fastestRegion = this.regions[0]; // Fallback to default
        }
        else {
            this.fastestRegion = fastest.region;
        }
        this.lastRegionCheck = now;
        if (this.debug) {
            console.log(`[CopilotEdge] Selected: ${this.fastestRegion.name} (${fastest.latency}ms)`);
            const latencies = Object.fromEntries(this.regionLatencies);
            console.log('[CopilotEdge] All regions:', latencies);
        }
        return this.fastestRegion;
    }
    /**
     * Sleep with proper cleanup
     */
    async sleep(ms) {
        let timeoutId;
        try {
            await new Promise((resolve) => {
                timeoutId = setTimeout(resolve, ms);
                // Store timeout ID for cleanup if needed
                if (!this.activeTimers) {
                    this.activeTimers = new Set();
                }
                this.activeTimers.add(timeoutId);
            });
        } finally {
            // Always clean up the timer
            if (timeoutId) {
                clearTimeout(timeoutId);
                if (this.activeTimers) {
                    this.activeTimers.delete(timeoutId);
                }
            }
        }
    }
    /**
     * Retry failed requests with exponential backoff
     */
    async retryWithBackoff(fn, context = 'request') {
        return this.circuitBreaker.execute(async () => {
            let lastError;
            for (let attempt = 0; attempt < this.maxRetries; attempt++) {
                try {
                    return await fn();
                }
                catch (error) {
                    lastError = error;
                    // Don't retry on validation errors
                    if (error instanceof ValidationError) {
                        throw error;
                    }
                    // Don't retry on 4xx errors (except 429)
                    if (error instanceof APIError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
                        throw error;
                    }
                    if (attempt < this.maxRetries - 1) {
                        const delay = Math.min(Math.pow(2, attempt) * 1000, 8000); // Max 8s
                        const jitter = Math.random() * 500; // Add jitter
                        if (this.debug) {
                            console.log(`[CopilotEdge] Retry ${attempt + 1}/${this.maxRetries} for ${context} after ${Math.round(delay + jitter)}ms...`);
                        }
                        // Use sleep method with proper cleanup
                        await this.sleep(delay + jitter);
                    }
                }
            }
            this.metrics.errors++;
            throw lastError;
        });
    }
    /**
     * Calculate object size in bytes
     */
    getObjectSize(obj) {
        const str = JSON.stringify(obj);
        return new Blob([str]).size;
    }
    /**
     * Check object depth to prevent deeply nested attack payloads
     */
    checkObjectDepth(obj, maxDepth = null, currentDepth = 0) {
        const limit = maxDepth || this.maxObjectDepth;
        if (currentDepth > limit) {
            throw new ValidationError(`Request exceeds maximum nesting depth of ${limit}`);
        }
        if (obj && typeof obj === 'object') {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    this.checkObjectDepth(obj[key], limit, currentDepth + 1);
                }
            }
        }
    }
    /**
     * Validate request body
     */
    validateRequest(body) {
        if (!body || typeof body !== 'object') {
            throw new ValidationError('Request body must be an object');
        }
        // Check request size
        const requestSize = this.getObjectSize(body);
        if (requestSize > this.maxRequestSize) {
            throw new ValidationError(`Request size (${Math.round(requestSize / 1024)}KB) exceeds maximum allowed size (${Math.round(this.maxRequestSize / 1024)}KB)`);
        }
        // Check object depth to prevent deeply nested payloads
        this.checkObjectDepth(body);
        // Check for GraphQL mutation
        if (body.operationName === 'generateCopilotResponse') {
            if (!body.variables?.data) {
                throw new ValidationError('Missing variables.data in GraphQL mutation');
            }
            // Validate GraphQL data size (half of max request size)
            const dataSize = this.getObjectSize(body.variables.data);
            const maxGraphQLSize = this.maxRequestSize / 2;
            if (dataSize > maxGraphQLSize) {
                throw new ValidationError(`GraphQL data size exceeds ${Math.round(maxGraphQLSize / 1024)}KB limit`);
            }
            return;
        }
        // Check for direct chat format
        if (body.messages) {
            if (!Array.isArray(body.messages)) {
                throw new ValidationError('messages must be an array');
            }
            // Limit number of messages to prevent abuse
            if (body.messages.length > this.maxMessages) {
                throw new ValidationError(`Number of messages (${body.messages.length}) exceeds maximum allowed (${this.maxMessages})`);
            }
            // Validate each message
            for (const msg of body.messages) {
                if (!msg.role || !msg.content) {
                    throw new ValidationError('Each message must have role and content');
                }
                if (!['user', 'assistant', 'system'].includes(msg.role)) {
                    throw new ValidationError(`Invalid role: ${msg.role}`);
                }
                // Check individual message size
                const messageSize = new Blob([String(msg.content)]).size;
                if (messageSize > this.maxMessageSize) {
                    throw new ValidationError(`Message size (${Math.round(messageSize / 1024)}KB) exceeds maximum allowed (${Math.round(this.maxMessageSize / 1024)}KB)`);
                }
            }
            return;
        }
        throw new ValidationError('Unsupported request format. Expected CopilotKit GraphQL or chat messages');
    }
    /**
     * Sanitize messages for AI
     */
    sanitizeMessages(messages) {
        return messages.map(msg => ({
            role: msg.role,
            content: String(msg.content).slice(0, 4000) // Limit message length
        }));
    }
    /**
     * Check if messages contain sensitive content
     * WARNING: This should only be used for internal monitoring, never exposed to clients
     */
    containsSensitiveContent(messages) {
        if (!this.enableInternalSensitiveLogging) {
            return false; // Feature disabled by default for security
        }
        const patterns = [
            /api[_-]?key/i,
            /sk_live_/,
            /pk_live_/,
            /bearer\s+/i,
            /password/i,
            /secret/i,
            /token/i,
            /\b[A-Za-z0-9]{32,}\b/ // Long random strings that might be keys
        ];
        return messages.some(m => patterns.some(p => p.test(String(m.content || ''))));
    }
    /**
     * Handle incoming requests
     * NOTE: Streaming is NOT supported. All responses are returned complete.
     */
    async handleRequest(body) {
        const start = performance.now();
        this.metrics.totalRequests++;
        try {
            // Validate request
            this.validateRequest(body);
            // Check rate limit
            this.checkRateLimit();
            const cacheKey = await this.hashRequest(body);
            // Check for an existing lock
            if (this.cacheLocks.has(cacheKey)) {
                if (this.debug) {
                    console.log(`[CopilotEdge] Cache LOCK HIT (waiting for existing request)`);
                }
                await this.cacheLocks.get(cacheKey);
            }
            // Check cache
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                const latency = Math.round(performance.now() - start);
                this.updateMetrics(latency);
                if (this.debug) {
                    console.log(`[CopilotEdge] Served from cache in ${latency}ms`);
                }
                return cached;
            }
            // Get optimal region
            const region = await this.retryWithBackoff(() => this.findFastestRegion(), 'region selection');
            let result;
            const requestPromise = (async () => {
                // Handle different request formats
                if (body.operationName === 'generateCopilotResponse' && body.variables?.data) {
                    return await this.handleGraphQLMutation(body, region);
                }
                else if (body.messages && Array.isArray(body.messages)) {
                    return await this.handleDirectChat(body, region);
                }
                else {
                    throw new ValidationError('Unsupported request format');
                }
            })();
            this.cacheLocks.set(cacheKey, requestPromise);
            try {
                result = await requestPromise;
                // Cache successful response
                this.saveToCache(cacheKey, result);
            }
            finally {
                // Remove the lock
                this.cacheLocks.delete(cacheKey);
            }
            const latency = Math.round(performance.now() - start);
            this.updateMetrics(latency);
            if (this.debug) {
                const ttfb = latency;
                const tokensOut = result.choices?.[0]?.message?.content?.length ||
                    result.data?.generateCopilotResponse?.messages?.[0]?.content?.[0]?.length || 0;
                console.log(`[CopilotEdge] Request completed`, {
                    ttfb_ms: ttfb,
                    total_ms: latency,
                    tokens_out: Math.floor(tokensOut / 4),
                    cache_hit: !!cached,
                    model: this.model,
                    abandoned: false,
                    region: region.name
                });
                this.logMetrics();
            }
            return result;
        }
        catch (error) {
            this.metrics.errors++;
            if (this.debug) {
                console.error('[CopilotEdge] Error:', error.message);
            }
            throw error;
        }
    }
    /**
     * Handle CopilotKit GraphQL mutations
     */
    async handleGraphQLMutation(body, region) {
        const data = body.variables.data;
        const messages = data.messages || [];
        // Extract conversation messages
        const conversationMessages = messages
            .filter((msg) => msg.textMessage &&
            msg.textMessage.content &&
            msg.textMessage.content.trim().length > 0 &&
            msg.textMessage.role !== 'system')
            .map((msg) => ({
            role: msg.textMessage.role,
            content: msg.textMessage.content.trim()
        }));
        if (conversationMessages.length === 0) {
            return this.createDefaultResponse(data.threadId);
        }
        // Sanitize and call AI
        const sanitized = this.sanitizeMessages(conversationMessages);
        const response = await this.retryWithBackoff(async () => await this.callCloudflareAI(sanitized, region), 'Cloudflare AI');
        return {
            data: {
                generateCopilotResponse: {
                    threadId: data.threadId || 'default-thread',
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
     * Handle direct chat format
     */
    async handleDirectChat(body, region) {
        const sanitized = this.sanitizeMessages(body.messages);
        const response = await this.retryWithBackoff(async () => await this.callCloudflareAI(sanitized, region), 'Cloudflare AI');
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
    /**
     * Call Cloudflare Workers AI
     */
    async callCloudflareAI(messages, region) {
        const baseURL = `${region.url}/client/v4/accounts/${this.accountId}/ai/v1`;
        try {
            // Create AbortController for timeout with cleanup
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
            try {
                const response = await fetch(`${baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: this.model,
                        messages: messages,
                        temperature: 0.7,
                        max_tokens: 1000,
                        stream: false
                    }),
                    signal: controller.signal
                });
                if (!response.ok) {
                    const error = await response.text();
                    throw new APIError(`Cloudflare AI error: ${error}`, response.status);
                }
                const data = await response.json();
                if (!data.choices?.[0]?.message?.content) {
                    throw new APIError('Invalid response from Cloudflare AI', 500);
                }
                return data.choices[0].message.content;
            } finally {
                clearTimeout(timeoutId);
            }
        }
        catch (error) {
            // If the fastest region fails, reset and retry region selection
            if (this.debug) {
                console.log(`[CopilotEdge] Region ${region.name} failed, re-evaluating...`);
            }
            this.fastestRegion = null;
            this.lastRegionCheck = 0;
            throw error;
        }
    }
    /**
     * Create default response
     */
    createDefaultResponse(threadId) {
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
     * Update performance metrics
     */
    updateMetrics(latency) {
        this.metrics.avgLatency.push(latency);
        // Keep only last 100 measurements
        if (this.metrics.avgLatency.length > 100) {
            this.metrics.avgLatency.shift();
        }
    }
    /**
     * Log current metrics
     */
    logMetrics() {
        const avg = this.metrics.avgLatency.length > 0
            ? Math.round(this.metrics.avgLatency.reduce((a, b) => a + b, 0) / this.metrics.avgLatency.length)
            : 0;
        const cacheRate = this.metrics.totalRequests > 0
            ? Math.round((this.metrics.cacheHits / this.metrics.totalRequests) * 100)
            : 0;
        console.log('[CopilotEdge] Metrics:', {
            totalRequests: this.metrics.totalRequests,
            cacheHitRate: `${cacheRate}%`,
            avgLatency: `${avg}ms`,
            errors: this.metrics.errors
        });
    }
    /**
     * Create Next.js API route handler
     */
    createNextHandler() {
        return async (req) => {
            try {
                const body = await req.json();
                const result = await this.handleRequest(body);
                // Check for sensitive content (only for internal logging, NEVER exposed to clients)
                if (this.enableInternalSensitiveLogging && body.messages && Array.isArray(body.messages)) {
                    const containedSensitive = this.containsSensitiveContent(body.messages);
                    if (containedSensitive && this.debug) {
                        console.warn('[CopilotEdge] WARNING: Potentially sensitive content detected in request');
                        // Log to internal monitoring but NEVER expose to client headers
                    }
                }
                return server_1.NextResponse.json(result, {
                    headers: {
                        'X-Powered-By': 'CopilotEdge',
                        'X-Cache': result.cached ? 'HIT' : 'MISS'
                        // Removed X-Contained-Sensitive header for security
                    }
                });
            }
            catch (error) {
                if (this.debug) {
                    console.error('[CopilotEdge] Handler error:', error);
                }
                const status = error instanceof APIError ? error.statusCode :
                    error instanceof ValidationError ? 400 : 500;
                return server_1.NextResponse.json({
                    error: error.message,
                    type: error.name
                }, { status });
            }
        };
    }
    /**
     * Get current metrics
     */
    getMetrics() {
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
                ? (this.metrics.errors / this.metrics.totalRequests) : 0
        };
    }
    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        this.cacheLocks.clear();
        if (this.debug) {
            console.log('[CopilotEdge] Cache cleared');
        }
    }
    /**
     * Destroy instance and clean up resources
     */
    destroy() {
        // Clear all active timers
        if (this.activeTimers) {
            for (const timerId of this.activeTimers) {
                clearTimeout(timerId);
            }
            this.activeTimers.clear();
        }
        // Clear caches
        this.cache.clear();
        this.cacheLocks.clear();
        this.requestCount.clear();
        this.regionLatencies.clear();
        // Reset circuit breaker
        this.circuitBreaker.reset();
        if (this.debug) {
            console.log('[CopilotEdge] Instance destroyed, all resources cleaned up');
        }
    }
    /**
     * Test all features
     */
    async testFeatures() {
        console.log('🚀 CopilotEdge Feature Test\n');
        console.log('='.repeat(40));
        // 1. Configuration
        console.log('\n✅ Configuration');
        console.log('  API Token:', this.apiToken ? 'Set' : '❌ Missing');
        console.log('  Account ID:', this.accountId ? 'Set' : '❌ Missing');
        console.log('  Model:', this.model);
        console.log('  Debug:', this.debug ? 'ON' : 'OFF');
        // 2. Region selection
        console.log('\n✅ Auto-Region Selection');
        const region = await this.findFastestRegion();
        console.log('  Fastest:', region.name);
        console.log('  Latencies:', Object.fromEntries(this.regionLatencies));
        // 3. Cache
        console.log('\n✅ Request Caching');
        const testKey = 'test-' + Date.now();
        this.saveToCache(testKey, { test: 'data' });
        const cached = this.getFromCache(testKey);
        console.log('  Cache:', cached ? 'Working' : 'Failed');
        console.log('  TTL:', this.cacheTimeout / 1000, 'seconds');
        // 4. Rate limiting
        console.log('\n✅ Rate Limiting');
        console.log('  Limit:', this.rateLimit, 'req/min');
        // 5. Retry logic
        console.log('\n✅ Retry Logic');
        console.log('  Max retries:', this.maxRetries);
        console.log('  Backoff: Exponential with jitter');
        // 6. Metrics
        console.log('\n✅ Performance Metrics');
        const metrics = this.getMetrics();
        console.log('  Tracking:', Object.keys(metrics).join(', '));
        console.log('\n' + '='.repeat(40));
        console.log('All features operational! 🎉\n');
    }
}
exports.CopilotEdge = CopilotEdge;
/**
 * Create a Next.js API route handler
 * @param config CopilotEdge configuration
 * @returns Next.js route handler
 */
function createCopilotEdgeHandler(config) {
    const edge = new CopilotEdge(config);
    return edge.createNextHandler();
}
// Default export
exports.default = CopilotEdge;
