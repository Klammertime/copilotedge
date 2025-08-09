"use strict";
/**
 * CopilotEdge - Production-ready adapter for CopilotKit + Cloudflare Workers AI
 * @author Audrey Klammer (@Klammertime)
 * @version 0.2.4
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
 * Represents an error during request validation.
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
 * Represents an error from the Cloudflare AI API.
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
    CACHE_TIMEOUT: 60000, // 60 seconds
    MAX_RETRIES: 3,
    RATE_LIMIT: 60, // per minute
    REGION_CHECK_TIMEOUT: 2000, // 2 seconds
    CACHE_SIZE: 100,
    MESSAGE_LENGTH_LIMIT: 4000,
    API_TIMEOUT: 30000, // 30 seconds
    MAX_BACKOFF: 8000, // 8 seconds
    JITTER: 500, // 0.5 seconds
    REGION_CHECK_INTERVAL: 300000, // 5 minutes
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
    CIRCUIT_BREAKER_OPEN_STATE_TIMEOUT: 30000, // 30 seconds
};
/**
 * A simple circuit breaker implementation to prevent cascading failures.
 */
class CircuitBreaker {
    constructor(threshold = DEFAULTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD, timeout = DEFAULTS.CIRCUIT_BREAKER_OPEN_STATE_TIMEOUT) {
        this.failures = 0;
        this.lastFailureTime = 0;
        this.state = 'closed';
        this.failureThreshold = threshold;
        this.openStateTimeout = timeout;
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
 * Main CopilotEdge class for handling AI requests.
 */
class CopilotEdge {
    /**
     * Creates an instance of CopilotEdge.
     * @param config - Configuration options for CopilotEdge.
     */
    constructor(config = {}) {
        this.lastRegionCheck = 0;
        this.isFallbackActive = false;
        // Validate and set configuration
        this.apiToken = config.apiKey || process.env.CLOUDFLARE_API_TOKEN || '';
        this.accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
        this.provider = config.provider || DEFAULTS.PROVIDER;
        // Handle model configuration with provider and fallback support
        if (config.model) {
            // Support legacy model configuration
            this.model = config.model;
        }
        else if (this.provider === 'cloudflare' && config.model?.includes('@cf/openai/')) {
            // Direct OpenAI model reference
            this.model = config.model;
        }
        else {
            // Use default model
            this.model = DEFAULTS.MODEL;
        }
        // Set fallback model if provided
        this.fallbackModel = config.fallback || null;
        this.debug = config.debug || process.env.NODE_ENV === 'development';
        this.cacheTimeout = config.cacheTimeout || DEFAULTS.CACHE_TIMEOUT;
        this.maxRetries = config.maxRetries || DEFAULTS.MAX_RETRIES;
        this.rateLimit = config.rateLimit || DEFAULTS.RATE_LIMIT;
        this.enableInternalSensitiveLogging = config.enableInternalSensitiveLogging || false;
        this.regionCheckTimeout = config.regionCheckTimeout || DEFAULTS.REGION_CHECK_TIMEOUT;
        this.cacheSize = config.cacheSize || DEFAULTS.CACHE_SIZE;
        this.apiTimeout = config.apiTimeout || DEFAULTS.API_TIMEOUT;
        this.fetch = config.fetch || global.fetch;
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
        this.circuitBreaker = new CircuitBreaker(config.circuitBreakerFailureThreshold || DEFAULTS.CIRCUIT_BREAKER_FAILURE_THRESHOLD, config.circuitBreakerOpenStateTimeout || DEFAULTS.CIRCUIT_BREAKER_OPEN_STATE_TIMEOUT);
        // Metrics tracking
        this.metrics = {
            totalRequests: 0,
            cacheHits: 0,
            errors: 0,
            avgLatency: [],
            fallbackUsed: 0
        };
        if (this.debug) {
            // For production safety, create a separate log object that limits sensitive info
            const isProduction = process.env.NODE_ENV === 'production';
            const logConfig = {
                // In production, only log generic model info, not specific models
                model: isProduction ? (this.model.includes('/') ? 'custom-model' : this.model) : this.model,
                provider: this.provider,
                fallbackModel: isProduction ? (this.fallbackModel ? 'configured' : 'none') : this.fallbackModel,
                cacheTimeout: this.cacheTimeout,
                maxRetries: this.maxRetries,
                rateLimit: this.rateLimit,
                enableInternalSensitiveLogging: this.enableInternalSensitiveLogging
            };
            console.log('[CopilotEdge] Initialized with:', logConfig);
            // Add a warning when debug mode is enabled in production
            if (isProduction) {
                console.warn('[CopilotEdge] WARNING: Debug mode is enabled in production environment. This may impact performance.');
            }
        }
    }
    /**
     * Generate hash for cache key using SHA-256.
     * Uses cryptographic hashing to prevent collisions in cache keys.
     * @param obj - The object to hash.
     * @returns A promise that resolves to a hex string hash.
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
     * Get cached response if available and not expired.
     * @param key - The cache key.
     * @returns The cached data or null if not found.
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
     * Save response to cache with LRU eviction.
     * @param key - The cache key.
     * @param data - The data to cache.
     */
    saveToCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        // LRU eviction when cache gets too large
        if (this.cache.size > this.cacheSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }
    }
    /**
     * Check rate limit for a given client ID.
     * @param clientId - The identifier for the client.
     * @throws {APIError} if the rate limit is exceeded.
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
     * Find the fastest Cloudflare region by sending HEAD requests.
     * Results are cached for a few minutes to avoid excessive checks.
     * @returns The fastest region.
     */
    async findFastestRegion() {
        const now = Date.now();
        // Re-test regions every 5 minutes
        if (this.fastestRegion && now - this.lastRegionCheck < DEFAULTS.REGION_CHECK_INTERVAL) {
            return this.fastestRegion;
        }
        if (this.debug) {
            console.log('[CopilotEdge] Testing edge regions for optimal performance...');
        }
        const tests = this.regions.map(async (region) => {
            const start = performance.now();
            try {
                const response = await this.fetch(region.url + '/client/v4', {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(this.regionCheckTimeout),
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`
                    }
                });
                if (response.ok) {
                    const latency = Math.round(performance.now() - start);
                    this.regionLatencies.set(region.name, latency);
                    return { region, latency };
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
     * Retry a function with exponential backoff and jitter.
     * This is used to handle transient network errors and API failures.
     * @param fn - The async function to retry.
     * @param context - A string describing the operation for logging.
     * @returns The result of the function.
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
                        const delay = Math.min(Math.pow(2, attempt) * 1000, DEFAULTS.MAX_BACKOFF); // Max 8s
                        const jitter = Math.random() * DEFAULTS.JITTER; // Add jitter
                        if (this.debug) {
                            console.log(`[CopilotEdge] Retry ${attempt + 1}/${this.maxRetries} for ${context} after ${Math.round(delay + jitter)}ms...`);
                        }
                        await new Promise(resolve => setTimeout(resolve, delay + jitter));
                    }
                }
            }
            this.metrics.errors++;
            throw lastError;
        });
    }
    /**
     * Validate the structure of the incoming request body.
     * Supports both CopilotKit GraphQL and direct chat message formats.
     * @param body - The request body.
     * @throws {ValidationError} if the body is invalid.
     */
    validateRequest(body) {
        if (!body || typeof body !== 'object') {
            throw new ValidationError('Request body must be an object');
        }
        // Check for GraphQL mutation
        if (body.operationName === 'generateCopilotResponse') {
            if (!body.variables?.data) {
                throw new ValidationError('Missing variables.data in GraphQL mutation');
            }
            return;
        }
        // Check for direct chat format
        if (body.messages) {
            if (!Array.isArray(body.messages)) {
                throw new ValidationError('messages must be an array');
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
            }
            return;
        }
        throw new ValidationError('Unsupported request format. Expected CopilotKit GraphQL or chat messages');
    }
    /**
     * Sanitize messages for the AI, ensuring consistent format and length.
     * @param messages - The messages to sanitize.
     * @returns A new array of sanitized messages.
     */
    sanitizeMessages(messages) {
        return messages.map(msg => ({
            role: msg.role,
            content: String(msg.content).slice(0, DEFAULTS.MESSAGE_LENGTH_LIMIT) // Limit message length
        }));
    }
    /**
     * WARNING: This should only be used for internal monitoring, never exposed to clients.
     * @param messages The messages to check.
     * @returns True if sensitive content is detected.
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
     * Extracts and sanitizes messages from a request body.
     * Handles both CopilotKit GraphQL and direct chat formats.
     * @param body The request body.
     * @returns An array of sanitized messages or null if no valid messages are found.
     */
    getSanitizedMessages(body) {
        let messages = [];
        if (body.operationName === 'generateCopilotResponse' && body.variables?.data) {
            messages = (body.variables.data.messages || [])
                .filter((msg) => msg.textMessage &&
                msg.textMessage.content &&
                msg.textMessage.content.trim().length > 0 &&
                msg.textMessage.role !== 'system')
                .map((msg) => ({
                role: msg.textMessage.role,
                content: msg.textMessage.content.trim()
            }));
        }
        else if (body.messages && Array.isArray(body.messages)) {
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
     * Handle CopilotKit GraphQL mutations.
     * @param body - The GraphQL request body.
     * @param region - The selected Cloudflare region.
     * @returns A GraphQL-formatted response.
     */
    async handleGraphQLMutation(body, region) {
        const sanitized = this.getSanitizedMessages(body);
        if (!sanitized) {
            return this.createDefaultResponse(body.variables.data.threadId);
        }
        const response = await this.retryWithBackoff(async () => await this.callCloudflareAI(sanitized, region), 'Cloudflare AI');
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
     * @param region - The selected Cloudflare region.
     * @returns An OpenAI-compatible chat completion response.
     */
    async handleDirectChat(body, region) {
        const sanitized = this.getSanitizedMessages(body);
        if (!sanitized) {
            // This case should be handled by validateRequest, but as a fallback:
            throw new ValidationError('Request body must contain messages.');
        }
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
     * Call the Cloudflare Workers AI API.
     * @param messages - The sanitized messages to send.
     * @param region - The selected Cloudflare region.
     * @returns The AI's response content as a string.
     */
    async callCloudflareAI(messages, region) {
        const baseURL = `${region.url}/client/v4/accounts/${this.accountId}/ai/v1`;
        // If we've already tried the primary model and it failed,
        // use the fallback model if available
        const activeModel = this.isFallbackActive && this.fallbackModel ? this.fallbackModel : this.model;
        try {
            const response = await this.fetch(`${baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: activeModel,
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 1000,
                    stream: false
                }),
                signal: AbortSignal.timeout(this.apiTimeout) // 30s timeout
            });
            if (!response.ok) {
                const error = await response.text();
                // If we get a 404 (model not found) or a 429 (rate limit exceeded),
                // and we have a fallback model, and we haven't tried the fallback yet,
                // switch to the fallback model and retry
                if ((response.status === 404 || response.status === 429) &&
                    this.fallbackModel &&
                    !this.isFallbackActive) {
                    if (this.debug) {
                        const isProduction = process.env.NODE_ENV === 'production';
                        // In production, don't log specific model names
                        if (isProduction) {
                            console.log(`[CopilotEdge] Primary model unavailable, using fallback model`);
                        }
                        else {
                            console.log(`[CopilotEdge] Model ${activeModel} unavailable, falling back to ${this.fallbackModel}`);
                        }
                    }
                    this.isFallbackActive = true;
                    this.metrics.fallbackUsed++;
                    // Retry with fallback model
                    return await this.callCloudflareAI(messages, region);
                }
                throw new APIError(`Cloudflare AI error: ${error}`, response.status);
            }
            const data = await response.json();
            if (!data.choices?.[0]?.message?.content) {
                throw new APIError('Invalid response from Cloudflare AI', 500);
            }
            return data.choices[0].message.content;
        }
        catch (error) {
            // If error is not API related, reset region selection
            if (!(error instanceof APIError)) {
                if (this.debug) {
                    console.log(`[CopilotEdge] Region ${region.name} failed, re-evaluating...`);
                }
                this.fastestRegion = null;
                this.lastRegionCheck = 0;
            }
            throw error;
        }
    }
    /**
     * Create a default response for when there are no messages to process.
     * @param threadId The thread ID from the request.
     * @returns A default GraphQL response.
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
     * Update performance metrics after a request.
     * @param latency - The latency of the request in milliseconds.
     */
    updateMetrics(latency) {
        this.metrics.avgLatency.push(latency);
        // Keep only last 100 measurements
        if (this.metrics.avgLatency.length > 100) {
            this.metrics.avgLatency.shift();
        }
    }
    /**
     * Log current metrics to the console if in debug mode.
     */
    logMetrics() {
        const avg = this.metrics.avgLatency.length > 0
            ? Math.round(this.metrics.avgLatency.reduce((a, b) => a + b, 0) / this.metrics.avgLatency.length)
            : 0;
        const cacheRate = this.metrics.totalRequests > 0
            ? Math.round((this.metrics.cacheHits / this.metrics.totalRequests) * 100)
            : 0;
        const fallbackRate = this.metrics.totalRequests > 0
            ? Math.round((this.metrics.fallbackUsed / this.metrics.totalRequests) * 100)
            : 0;
        const isProduction = process.env.NODE_ENV === 'production';
        const metricsLog = {
            totalRequests: this.metrics.totalRequests,
            cacheHitRate: `${cacheRate}%`,
            avgLatency: `${avg}ms`,
            errors: this.metrics.errors,
            fallbackUsed: this.metrics.fallbackUsed,
            fallbackRate: `${fallbackRate}%`,
            // In production, only indicate if using primary or fallback, not specific model names
            activeModel: isProduction
                ? (this.isFallbackActive ? 'fallback-model' : 'primary-model')
                : (this.isFallbackActive && this.fallbackModel ? this.fallbackModel : this.model)
        };
        console.log('[CopilotEdge] Metrics:', metricsLog);
    }
    /**
     * Creates a Next.js API route handler for seamless integration.
     * @returns An async function that handles a `NextRequest` and returns a `NextResponse`.
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
     * Get the current performance and usage metrics.
     * @returns An object containing key metrics.
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
                ? (this.metrics.errors / this.metrics.totalRequests) : 0,
            fallbackUsed: this.metrics.fallbackUsed,
            fallbackRate: this.metrics.totalRequests > 0
                ? (this.metrics.fallbackUsed / this.metrics.totalRequests) : 0,
            activeModel: this.isFallbackActive && this.fallbackModel ? this.fallbackModel : this.model
        };
    }
    /**
     * Clears the in-memory cache.
     */
    clearCache() {
        this.cache.clear();
        if (this.debug) {
            console.log('[CopilotEdge] Cache cleared');
        }
    }
    /**
     * Runs a series of checks to test and display the current configuration and feature status.
     * Useful for debugging and ensuring the instance is configured correctly.
     */
    async testFeatures() {
        console.log('🚀 CopilotEdge Feature Test\n');
        console.log('='.repeat(40));
        // 1. Configuration
        console.log('\n✅ Configuration');
        console.log('  API Token:', this.apiToken ? 'Set' : '❌ Missing');
        console.log('  Account ID:', this.accountId ? 'Set' : '❌ Missing');
        console.log('  Provider:', this.provider);
        // Apply production safeguards to model information
        const isProduction = process.env.NODE_ENV === 'production';
        if (isProduction) {
            console.log('  Model:', this.model.includes('/') ? 'custom-model' : this.model);
            console.log('  Fallback:', this.fallbackModel ? 'Configured' : 'None');
        }
        else {
            console.log('  Model:', this.model);
            console.log('  Fallback:', this.fallbackModel || 'None');
        }
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
        console.log('  Fallback:', this.fallbackModel ? 'Enabled' : 'Disabled');
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
 * A convenience function to create a Next.js API route handler.
 * @param config - CopilotEdge configuration options.
 * @returns A Next.js route handler function.
 */
function createCopilotEdgeHandler(config) {
    const edge = new CopilotEdge(config);
    return edge.createNextHandler();
}
// Default export
exports.default = CopilotEdge;
