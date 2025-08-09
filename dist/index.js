"use strict";
/**
 * CopilotEdge - Beta adapter for CopilotKit + Cloudflare Workers AI
 * @author Audrey Klammer (@Klammertime)
 * @version 0.2.3
 * @license MIT
 *
 * Features:
 * - 💾 60-second request caching with 10MB memory limit
 * - 🔄 Automatic retry with exponential backoff for 5xx errors
 * - 🎯 Simple configuration (just needs API key)
 * - 🐛 Debug mode with metrics
 * - 🔒 Basic input validation
 * - 📊 Performance monitoring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopilotEdge = exports.APIError = exports.ValidationError = void 0;
exports.createCopilotEdgeHandler = createCopilotEdgeHandler;
const server_1 = require("next/server");
/**
 * Configuration constants
 */
const CONFIG = {
    CACHE_SIZE_MB: 10,
    CACHE_TIMEOUT_MS: 60000,
    MAX_RETRIES: 3,
    RATE_LIMIT_PER_MIN: 60,
    MESSAGE_MAX_LENGTH: 4000,
    REQUEST_TIMEOUT_MS: 10000,
    CLOUDFLARE_TIMEOUT_MS: 5000,
    MAX_BACKOFF_MS: 8000,
    BACKOFF_JITTER_MS: 500,
    DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct',
    DEFAULT_TEMPERATURE: 0.7,
    DEFAULT_MAX_TOKENS: 1000,
    METRICS_WINDOW_SIZE: 100,
    MAX_REQUEST_SIZE_BYTES: 1024 * 1024, // 1MB max request size
    MAX_MESSAGE_ARRAY_LENGTH: 100, // Max 100 messages in array
    MAX_OBJECT_DEPTH: 10, // Max nesting depth for objects
    // Circuit breaker settings
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5, // Open circuit after 5 failures
    CIRCUIT_BREAKER_TIMEOUT_MS: 60000, // Try half-open after 60s
    CIRCUIT_BREAKER_SUCCESS_THRESHOLD: 3 // Close circuit after 3 successes in half-open
};
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
 * Main CopilotEdge class
 */
class CopilotEdge {
    constructor(config = {}) {
        this.cacheMaxSize = CONFIG.CACHE_SIZE_MB * 1024 * 1024;
        this.cacheCurrentSize = 0;
        // Circuit breaker state
        this.circuitBreaker = {
            state: 'closed',
            failures: 0,
            lastFailureTime: 0,
            successCount: 0
        };
        // Create secure getters for sensitive data - never store directly
        const apiKey = config.apiKey || process.env.CLOUDFLARE_API_TOKEN || '';
        const accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
        this.model = config.model || CONFIG.DEFAULT_MODEL;
        this.debug = config.debug || process.env.NODE_ENV === 'development';
        this.cacheTimeout = config.cacheTimeout || CONFIG.CACHE_TIMEOUT_MS; // 60 seconds
        this.maxRetries = config.maxRetries || CONFIG.MAX_RETRIES;
        this.rateLimit = config.rateLimit || CONFIG.RATE_LIMIT_PER_MIN; // requests per minute
        this.enableSensitiveContentRedaction = config.enableSensitiveContentRedaction || false;
        // Validate required fields
        if (!apiKey) {
            throw new ValidationError('API key is required. Set config.apiKey or CLOUDFLARE_API_TOKEN env var');
        }
        if (!accountId) {
            throw new ValidationError('Account ID is required. Set config.accountId or CLOUDFLARE_ACCOUNT_ID env var');
        }
        // Use closures to provide access without storing
        this.getApiToken = () => apiKey;
        this.getAccountId = () => accountId;
        // Initialize cache
        this.cache = new Map();
        this.requestCount = new Map();
        // Metrics tracking
        this.metrics = {
            totalRequests: 0,
            cacheHits: 0,
            errors: 0,
            avgLatency: 0,
            latencyCount: 0
        };
        if (this.debug) {
            console.log('[CopilotEdge] Initialized with:', {
                model: this.model,
                cacheTimeout: this.cacheTimeout,
                maxRetries: this.maxRetries,
                rateLimit: this.rateLimit,
                enableSensitiveContentRedaction: this.enableSensitiveContentRedaction,
                hasApiKey: !!apiKey,
                hasAccountId: !!accountId
            });
        }
    }
    /**
     * Generate hash for cache key using crypto
     */
    async hashRequest(obj) {
        const str = JSON.stringify(obj);
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex; // Use full hash to avoid collisions
    }
    /**
     * Get cached response if available (with LRU update)
     */
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            // Update last access time for proper LRU tracking
            cached.lastAccess = Date.now();
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
     * Save response to cache with proper LRU and memory management
     */
    saveToCache(key, data) {
        const dataStr = JSON.stringify(data);
        const size = new Blob([dataStr]).size;
        // Don't cache if single item exceeds max size
        if (size > this.cacheMaxSize) {
            if (this.debug) {
                console.log(`[CopilotEdge] Item too large to cache (${Math.round(size / 1024)}KB exceeds ${Math.round(this.cacheMaxSize / 1024)}KB limit)`);
            }
            return;
        }
        // Validate cache size to prevent corruption
        if (isNaN(this.cacheCurrentSize) || this.cacheCurrentSize < 0) {
            console.error('[CopilotEdge] Cache size corrupted, resetting');
            this.cacheCurrentSize = 0;
            this.cache.clear();
        }
        // Evict least recently used items if needed to make room
        const MAX_EVICTION_ITERATIONS = 1000; // Prevent infinite loop
        let iterations = 0;
        while (this.cacheCurrentSize + size > this.cacheMaxSize && this.cache.size > 0 && iterations < MAX_EVICTION_ITERATIONS) {
            iterations++;
            // Find least recently used item
            let lruKey = null;
            let lruTime = Date.now();
            for (const [key, item] of this.cache) {
                const accessTime = item.lastAccess || item.timestamp;
                if (accessTime < lruTime) {
                    lruTime = accessTime;
                    lruKey = key;
                }
            }
            if (lruKey) {
                const oldItem = this.cache.get(lruKey);
                if (oldItem && !isNaN(oldItem.size)) {
                    this.cacheCurrentSize = Math.max(0, this.cacheCurrentSize - oldItem.size);
                }
                this.cache.delete(lruKey);
                if (this.debug) {
                    console.log(`[CopilotEdge] Evicted LRU cache item: ${lruKey}`);
                }
            }
            else {
                // No item found to evict, break to prevent infinite loop
                break;
            }
        }
        if (iterations >= MAX_EVICTION_ITERATIONS) {
            console.error('[CopilotEdge] Cache eviction limit reached, clearing cache');
            this.cache.clear();
            this.cacheCurrentSize = 0;
        }
        // If updating existing entry, subtract old size first
        const existing = this.cache.get(key);
        if (existing) {
            this.cacheCurrentSize -= existing.size;
        }
        const now = Date.now();
        this.cache.set(key, {
            data,
            timestamp: now,
            size,
            lastAccess: now
        });
        this.cacheCurrentSize += size;
        if (this.debug) {
            console.log(`[CopilotEdge] Cache: ${this.cache.size} items, ${Math.round(this.cacheCurrentSize / 1024)}KB used`);
        }
    }
    /**
     * Check rate limit with atomic operations
     */
    checkRateLimit(clientId = 'default') {
        const now = Date.now();
        const minute = Math.floor(now / 60000);
        const key = `${clientId}-${minute}`;
        // Atomic increment and check
        const currentCount = this.requestCount.get(key) || 0;
        const newCount = currentCount + 1;
        // Check before incrementing to ensure atomicity
        if (currentCount >= this.rateLimit) {
            throw new APIError(`Rate limit exceeded (${this.rateLimit} req/min)`, 429);
        }
        // Only increment if under limit
        this.requestCount.set(key, newCount);
        // Clean old entries with bounds to prevent memory leak
        const entriesToDelete = [];
        let cleanupCount = 0;
        const MAX_CLEANUP = 100;
        for (const [k] of this.requestCount) {
            if (cleanupCount >= MAX_CLEANUP)
                break;
            const parts = k.split('-');
            if (parts.length >= 2) {
                const time = parseInt(parts[parts.length - 1]);
                if (!isNaN(time) && time < minute - 2) {
                    entriesToDelete.push(k);
                    cleanupCount++;
                }
            }
        }
        for (const k of entriesToDelete) {
            this.requestCount.delete(k);
        }
        // Prevent unbounded growth
        if (this.requestCount.size > 1000) {
            console.warn('[CopilotEdge] Rate limit map too large, clearing old entries');
            const keysToKeep = new Set();
            for (const [k] of this.requestCount) {
                const parts = k.split('-');
                if (parts.length >= 2) {
                    const time = parseInt(parts[parts.length - 1]);
                    if (!isNaN(time) && time >= minute - 1) {
                        keysToKeep.add(k);
                    }
                }
            }
            const entriesToKeep = new Map();
            for (const k of keysToKeep) {
                const value = this.requestCount.get(k);
                if (value !== undefined) {
                    entriesToKeep.set(k, value);
                }
            }
            this.requestCount = entriesToKeep;
        }
    }
    /**
     * Retry failed requests with exponential backoff
     */
    async retryWithBackoff(fn, context = 'request') {
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
                // Only retry on 5xx errors, 503, and 429 (rate limit)
                if (error instanceof APIError) {
                    const retryable = error.statusCode >= 500 || error.statusCode === 503 || error.statusCode === 429;
                    if (!retryable) {
                        throw error;
                    }
                }
                if (attempt < this.maxRetries - 1) {
                    const delay = Math.min(Math.pow(2, attempt) * 1000, CONFIG.MAX_BACKOFF_MS);
                    const jitter = Math.random() * CONFIG.BACKOFF_JITTER_MS;
                    if (this.debug) {
                        console.log(`[CopilotEdge] Retry ${attempt + 1}/${this.maxRetries} for ${context} after ${Math.round(delay + jitter)}ms...`);
                    }
                    await new Promise(resolve => setTimeout(resolve, delay + jitter));
                }
            }
        }
        this.metrics.errors++;
        throw lastError;
    }
    /**
     * Type guard for GraphQL request
     */
    isGraphQLRequest(body) {
        return body !== null &&
            typeof body === 'object' &&
            'operationName' in body &&
            body.operationName === 'generateCopilotResponse';
    }
    /**
     * Type guard for chat request
     */
    isChatRequest(body) {
        return body !== null &&
            typeof body === 'object' &&
            'messages' in body &&
            Array.isArray(body.messages);
    }
    /**
     * Check object depth to prevent deep nesting attacks
     */
    getObjectDepth(obj, currentDepth = 0) {
        if (currentDepth > CONFIG.MAX_OBJECT_DEPTH) {
            return currentDepth;
        }
        if (obj === null || typeof obj !== 'object') {
            return currentDepth;
        }
        let maxDepth = currentDepth;
        const values = Array.isArray(obj) ? obj : Object.values(obj);
        for (const value of values) {
            if (value !== null && typeof value === 'object') {
                const depth = this.getObjectDepth(value, currentDepth + 1);
                maxDepth = Math.max(maxDepth, depth);
            }
        }
        return maxDepth;
    }
    /**
     * Validate request body
     */
    validateRequest(body) {
        if (!body || typeof body !== 'object') {
            throw new ValidationError('Request body must be an object');
        }
        // Check request size
        const bodySize = new Blob([JSON.stringify(body)]).size;
        if (bodySize > CONFIG.MAX_REQUEST_SIZE_BYTES) {
            throw new ValidationError(`Request too large: ${bodySize} bytes exceeds ${CONFIG.MAX_REQUEST_SIZE_BYTES} bytes limit`);
        }
        // Check object depth
        if (this.getObjectDepth(body) > CONFIG.MAX_OBJECT_DEPTH) {
            throw new ValidationError(`Request object nesting too deep. Max depth: ${CONFIG.MAX_OBJECT_DEPTH}`);
        }
        // Check for GraphQL mutation
        if (this.isGraphQLRequest(body)) {
            if (!body.variables || !body.variables.data) {
                throw new ValidationError('Missing variables.data in GraphQL mutation');
            }
            // Validate GraphQL message array length
            if (body.variables.data.messages && body.variables.data.messages.length > CONFIG.MAX_MESSAGE_ARRAY_LENGTH) {
                throw new ValidationError(`Too many messages: ${body.variables.data.messages.length} exceeds limit of ${CONFIG.MAX_MESSAGE_ARRAY_LENGTH}`);
            }
            return;
        }
        // Check for direct chat format
        if (this.isChatRequest(body)) {
            if (!Array.isArray(body.messages)) {
                throw new ValidationError('messages must be an array');
            }
            // Validate message array length
            if (body.messages.length > CONFIG.MAX_MESSAGE_ARRAY_LENGTH) {
                throw new ValidationError(`Too many messages: ${body.messages.length} exceeds limit of ${CONFIG.MAX_MESSAGE_ARRAY_LENGTH}`);
            }
            for (const msg of body.messages) {
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
     * Sanitize messages for AI
     */
    sanitizeMessages(messages) {
        return messages.map(msg => {
            const original = String(msg.content);
            const truncated = original.slice(0, CONFIG.MESSAGE_MAX_LENGTH);
            if (original.length > CONFIG.MESSAGE_MAX_LENGTH) {
                // ALWAYS warn about truncation, not just in debug
                console.warn(`[CopilotEdge] WARNING: Message truncated from ${original.length} to ${CONFIG.MESSAGE_MAX_LENGTH} chars. Data loss occurred.`);
            }
            return {
                role: msg.role,
                content: truncated
            };
        });
    }
    /**
     * Check if messages contain sensitive content and redact if found
     */
    sanitizeForSensitiveContent(messages) {
        if (!this.enableSensitiveContentRedaction) {
            return { sanitized: messages, hasSensitive: false };
        }
        const patterns = [
            { regex: /api[_-]?key\s*[:=]\s*["']?([\w-]{20,})/gi, replacement: 'api_key: [REDACTED]' },
            { regex: /secret[_-]?key[\w-]{20,}/gi, replacement: '[KEY_REDACTED]' },
            { regex: /bearer\s+([\w-]{20,})/gi, replacement: 'Bearer [TOKEN_REDACTED]' },
            { regex: /password\s*[:=]\s*["']?(\S+)/gi, replacement: 'password: [REDACTED]' },
            { regex: /(aws[_-]?access[_-]?key[_-]?id\s*[:=]\s*["']?[A-Z0-9]{16,})/gi, replacement: '[AWS_KEY_REDACTED]' },
            { regex: /(aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*["']?[\w/+=]{30,})/gi, replacement: '[AWS_SECRET_REDACTED]' }
        ];
        let hasSensitive = false;
        const sanitized = messages.map(msg => {
            let content = String(msg.content || '');
            let wasRedacted = false;
            for (const pattern of patterns) {
                if (pattern.regex.test(content)) {
                    content = content.replace(pattern.regex, pattern.replacement);
                    wasRedacted = true;
                    hasSensitive = true;
                }
            }
            if (wasRedacted && this.debug) {
                console.warn('[CopilotEdge] Sensitive content detected and redacted');
            }
            return { ...msg, content };
        });
        return { sanitized, hasSensitive };
    }
    /**
     * Handle incoming requests
     * NOTE: Streaming is NOT supported. All responses are returned complete.
     */
    async handleRequest(body, clientId) {
        const start = performance.now();
        this.metrics.totalRequests++;
        try {
            // Validate request
            this.validateRequest(body);
            // Check rate limit with actual client ID if provided
            this.checkRateLimit(clientId);
            // Check cache
            const cacheKey = await this.hashRequest(body);
            const cached = this.getFromCache(cacheKey);
            if (cached) {
                const latency = Math.round(performance.now() - start);
                this.updateMetrics(latency);
                if (this.debug) {
                    console.log(`[CopilotEdge] Served from cache in ${latency}ms`);
                }
                return cached;
            }
            let result;
            // Handle different request formats
            if (this.isGraphQLRequest(body)) {
                result = await this.handleGraphQLMutation(body);
            }
            else if (this.isChatRequest(body)) {
                result = await this.handleDirectChat(body);
            }
            else {
                throw new ValidationError('Unsupported request format');
            }
            // Cache successful response
            this.saveToCache(cacheKey, result);
            const latency = Math.round(performance.now() - start);
            this.updateMetrics(latency);
            if (this.debug) {
                const ttfb = latency;
                const resultObj = result;
                const tokensOut = resultObj.choices?.[0]?.message?.content?.length ||
                    resultObj.data?.generateCopilotResponse?.messages?.[0]?.content?.[0]?.length || 0;
                console.log(`[CopilotEdge] Request completed`, {
                    ttfb_ms: ttfb,
                    total_ms: latency,
                    tokens_out: Math.floor(tokensOut / 4),
                    cache_hit: !!cached,
                    model: this.model,
                    abandoned: false,
                    location: 'edge'
                });
                this.logMetrics();
            }
            return result;
        }
        catch (error) {
            this.metrics.errors++;
            if (this.debug) {
                console.error('[CopilotEdge] Error:', error instanceof Error ? error.message : String(error));
            }
            throw error;
        }
    }
    /**
     * Handle CopilotKit GraphQL mutations
     */
    async handleGraphQLMutation(body) {
        const data = body.variables.data || body.variables;
        // Need at least some data to work with
        if (!data || Object.keys(data).length === 0) {
            return this.createDefaultResponse(data?.threadId);
        }
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
        // Sanitize for length and sensitive content
        const lengthSanitized = this.sanitizeMessages(conversationMessages);
        const { sanitized, hasSensitive } = this.sanitizeForSensitiveContent(lengthSanitized);
        if (hasSensitive && this.debug) {
            console.warn('[CopilotEdge] Request contained sensitive content that was redacted before sending to AI');
        }
        const response = await this.retryWithBackoff(async () => await this.callCloudflareAI(sanitized), 'Cloudflare AI');
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
    async handleDirectChat(body) {
        // Sanitize for length and sensitive content
        const lengthSanitized = this.sanitizeMessages(body.messages);
        const { sanitized, hasSensitive } = this.sanitizeForSensitiveContent(lengthSanitized);
        if (hasSensitive && this.debug) {
            console.warn('[CopilotEdge] Request contained sensitive content that was redacted before sending to AI');
        }
        const response = await this.retryWithBackoff(async () => await this.callCloudflareAI(sanitized), 'Cloudflare AI');
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
     * Check circuit breaker state
     */
    checkCircuitBreaker() {
        const now = Date.now();
        // Check if circuit should transition from open to half-open
        if (this.circuitBreaker.state === 'open') {
            if (now - this.circuitBreaker.lastFailureTime > CONFIG.CIRCUIT_BREAKER_TIMEOUT_MS) {
                this.circuitBreaker.state = 'half-open';
                this.circuitBreaker.successCount = 0;
                if (this.debug) {
                    console.log('[CopilotEdge] Circuit breaker transitioning to half-open');
                }
            }
            else {
                throw new APIError('Circuit breaker is open - service temporarily unavailable', 503);
            }
        }
    }
    /**
     * Record circuit breaker success
     */
    recordCircuitSuccess() {
        if (this.circuitBreaker.state === 'half-open') {
            this.circuitBreaker.successCount++;
            if (this.circuitBreaker.successCount >= CONFIG.CIRCUIT_BREAKER_SUCCESS_THRESHOLD) {
                this.circuitBreaker.state = 'closed';
                this.circuitBreaker.failures = 0;
                if (this.debug) {
                    console.log('[CopilotEdge] Circuit breaker closed - service recovered');
                }
            }
        }
        else if (this.circuitBreaker.state === 'closed') {
            // Reset failure count on success
            this.circuitBreaker.failures = 0;
        }
    }
    /**
     * Record circuit breaker failure
     */
    recordCircuitFailure() {
        this.circuitBreaker.failures++;
        this.circuitBreaker.lastFailureTime = Date.now();
        if (this.circuitBreaker.state === 'half-open') {
            // Immediately open on failure in half-open state
            this.circuitBreaker.state = 'open';
            if (this.debug) {
                console.log('[CopilotEdge] Circuit breaker opened - failure in half-open state');
            }
        }
        else if (this.circuitBreaker.failures >= CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
            this.circuitBreaker.state = 'open';
            if (this.debug) {
                console.log(`[CopilotEdge] Circuit breaker opened - ${this.circuitBreaker.failures} failures`);
            }
        }
    }
    /**
     * Call Cloudflare Workers AI with proper timeout handling and circuit breaker
     */
    async callCloudflareAI(messages) {
        // Check circuit breaker before making request
        this.checkCircuitBreaker();
        const baseURL = `https://api.cloudflare.com/client/v4/accounts/${this.getAccountId()}/ai/v1`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, CONFIG.REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(`${baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getApiToken()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    temperature: CONFIG.DEFAULT_TEMPERATURE,
                    max_tokens: CONFIG.DEFAULT_MAX_TOKENS,
                    stream: false // Cloudflare doesn't support streaming for this model
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
            // Record success for circuit breaker
            this.recordCircuitSuccess();
            return data.choices[0].message.content;
        }
        catch (error) {
            // Record failure for circuit breaker
            this.recordCircuitFailure();
            if (error instanceof Error && error.name === 'AbortError') {
                throw new APIError('Request timeout', 408);
            }
            throw error;
        }
        finally {
            clearTimeout(timeoutId);
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
     * Update performance metrics with running average
     */
    updateMetrics(latency) {
        // Calculate running average without storing all values
        const newCount = this.metrics.latencyCount + 1;
        const oldAvg = this.metrics.avgLatency;
        this.metrics.avgLatency = (oldAvg * this.metrics.latencyCount + latency) / newCount;
        this.metrics.latencyCount = newCount;
    }
    /**
     * Log current metrics
     */
    logMetrics() {
        const cacheRate = this.metrics.totalRequests > 0
            ? Math.round((this.metrics.cacheHits / this.metrics.totalRequests) * 100)
            : 0;
        console.log('[CopilotEdge] Metrics:', {
            totalRequests: this.metrics.totalRequests,
            cacheHitRate: `${cacheRate}%`,
            avgLatency: `${Math.round(this.metrics.avgLatency)}ms`,
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
                // Secure client identification for rate limiting
                // Use combination of IP and user agent for better fingerprinting
                const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
                    req.headers.get('x-real-ip') ||
                    req.headers.get('cf-connecting-ip') || // Cloudflare
                    'unknown';
                const userAgent = req.headers.get('user-agent') || 'unknown';
                // Create a hash of IP + User Agent for rate limiting
                const clientIdentifier = `${ip}-${userAgent}`;
                const encoder = new TextEncoder();
                const data = encoder.encode(clientIdentifier);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const clientId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
                
                const result = await this.handleRequest(body, clientId);
                return server_1.NextResponse.json(result, {
                    headers: {
                        'X-Powered-By': 'CopilotEdge',
                        'X-Cache': result.cached ? 'HIT' : 'MISS',
                        // Security headers
                        'X-Content-Type-Options': 'nosniff',
                        'X-Frame-Options': 'DENY',
                        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
                        'Content-Security-Policy': "default-src 'self'",
                        'Referrer-Policy': 'strict-origin-when-cross-origin'
                    }
                });
            }
            catch (error) {
                if (this.debug) {
                    console.error('[CopilotEdge] Handler error:', error);
                }
                const status = error instanceof APIError ? error.statusCode :
                    error instanceof ValidationError ? 400 : 500;
                // Sanitize error messages for production
                let errorMessage;
                if (process.env.NODE_ENV === 'production' && !this.debug) {
                    // Generic messages in production to avoid information disclosure
                    if (status === 400) {
                        errorMessage = 'Invalid request';
                    } else if (status === 401) {
                        errorMessage = 'Unauthorized';
                    } else if (status === 429) {
                        errorMessage = 'Too many requests';
                    } else if (status >= 500) {
                        errorMessage = 'Internal server error';
                    } else {
                        errorMessage = 'Request failed';
                    }
                } else {
                    // Full error messages in development
                    errorMessage = error instanceof Error ? error.message : String(error);
                }
                const errorType = error instanceof Error ? error.name : 'UnknownError';
                return server_1.NextResponse.json({
                    error: errorMessage,
                    type: errorType
                }, { status });
            }
        };
    }
    /**
     * Health check endpoint
     */
    getHealthStatus() {
        const metrics = this.getMetrics();
        const memoryUsage = process.memoryUsage();
        const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
        const checks = {
            cache: this.cache.size < 10000, // Cache not overloaded
            rateLimit: this.requestCount.size < 5000, // Rate limit map not overloaded
            circuitBreaker: this.circuitBreaker.state,
            memory: heapUsedPercent < 90 // Memory usage below 90%
        };
        // Determine overall health
        let status = 'healthy';
        if (checks.circuitBreaker === 'open' || !checks.memory) {
            status = 'unhealthy';
        }
        else if (checks.circuitBreaker === 'half-open' ||
            !checks.cache ||
            !checks.rateLimit ||
            metrics.errorRate > 0.1 // More than 10% errors
        ) {
            status = 'degraded';
        }
        return {
            status,
            checks,
            metrics,
            timestamp: new Date().toISOString()
        };
    }
    /**
     * Get current metrics
     */
    getMetrics() {
        return {
            totalRequests: this.metrics.totalRequests,
            cacheHits: this.metrics.cacheHits,
            cacheHitRate: this.metrics.totalRequests > 0
                ? (this.metrics.cacheHits / this.metrics.totalRequests) : 0,
            avgLatency: Math.round(this.metrics.avgLatency),
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
        this.cacheCurrentSize = 0;
        if (this.debug) {
            console.log('[CopilotEdge] Cache cleared');
        }
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
