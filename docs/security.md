# Security & Privacy

Critical security considerations for production deployments.

## Quick Security Checklist

- [ ] API credentials in environment variables, not code
- [ ] `debug: false` in production
- [ ] `enableInternalSensitiveLogging: false` always in production
- [ ] Rate limiting enabled and configured
- [ ] HTTPS only endpoints
- [ ] No sensitive data in cache keys
- [ ] Error messages sanitized
- [ ] Regular dependency updates

## Data Handling

### What CopilotEdge Does NOT Do

- ❌ **No data persistence** - Nothing stored beyond cache TTL
- ❌ **No user tracking** - No analytics or user identification
- ❌ **No data sharing** - Your data only goes to Cloudflare
- ❌ **No logging by default** - Content not logged unless debug enabled
- ❌ **No external services** - Only communicates with Cloudflare

### What CopilotEdge DOES Do

- ✅ **Memory caching** - Responses cached for TTL duration (default 60s)
- ✅ **Request validation** - Input sanitization and size limits
- ✅ **Error masking** - Internal errors never exposed to clients
- ✅ **Rate limiting** - Prevents abuse and DoS attacks

## Recommended Production Configuration

```typescript
const handler = createCopilotEdgeHandler({
  // Required - from environment
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  
  // Security settings
  debug: false,                           // NEVER true in production
  enableInternalSensitiveLogging: false,  // NEVER true in production
  
  // Conservative limits
  rateLimit: 30,                          // Lower limit for production
  cacheTimeout: 30000,                    // Shorter cache for sensitive data
  maxRetries: 2,                          // Limit retry attempts
  
  // Use stable model
  model: '@cf/meta/llama-3.1-8b-instruct'
});
```

## API Key Security

### Environment Variables

**Never hardcode API keys:**

```typescript
// ❌ WRONG - Never do this
const handler = createCopilotEdgeHandler({
  apiKey: 'sk_live_abc123...',  // EXPOSED!
  accountId: 'acc_123...'
});

// ✅ CORRECT - Use environment variables
const handler = createCopilotEdgeHandler({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID
});
```

### Secure Storage

**.env.local** (Next.js):
```bash
# Never commit this file
CLOUDFLARE_API_TOKEN=your-token-here
CLOUDFLARE_ACCOUNT_ID=your-account-here
```

**.gitignore**:
```
.env.local
.env*.local
```

### Key Rotation

Regularly rotate API keys:

```bash
# 1. Generate new token in Cloudflare dashboard
# 2. Update environment variable
# 3. Deploy with new token
# 4. Revoke old token
```

## Sensitive Content Detection

### ⚠️ WARNING: Development Only

The sensitive content detection feature is for development debugging ONLY:

```typescript
// ⚠️ DEVELOPMENT ONLY - NEVER IN PRODUCTION
const handler = createCopilotEdgeHandler({
  enableInternalSensitiveLogging: true  // DANGER!
});
```

### Why It's Dangerous

1. **Logs actual secrets** - May write API keys to logs
2. **Creates audit trail** - Sensitive data in monitoring systems
3. **Compliance violations** - May violate GDPR/CCPA
4. **Security exposure** - Logs might be accessible to many people

### Safe Alternative

Instead of detection, prevent sensitive content:

```typescript
// Input sanitization
function sanitizeInput(message) {
  // Remove potential secrets
  const patterns = [
    /sk_[a-zA-Z0-9]{32,}/g,  // API keys
    /[a-zA-Z0-9]{40}/g,       // Tokens
    /password\s*[:=]\s*\S+/gi // Passwords
  ];
  
  let sanitized = message;
  patterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  });
  
  return sanitized;
}

// Use in request
const sanitizedMessages = messages.map(msg => ({
  ...msg,
  content: sanitizeInput(msg.content)
}));
```

## Headers and Metadata

### Headers Never Forwarded

CopilotEdge strips sensitive headers:

```typescript
// These are never sent upstream:
- Authorization
- Cookie
- Set-Cookie
- X-API-Key
- X-Auth-Token
```

### Response Headers

Safe headers returned to client:

```typescript
{
  'X-Powered-By': 'CopilotEdge',
  'X-Cache': 'HIT' | 'MISS',
  'Content-Type': 'application/json'
}
```

## Rate Limiting

### Purpose

- Prevent abuse and DoS attacks
- Control costs
- Ensure fair usage

### Configuration

```typescript
// Development - more permissive
const devHandler = createCopilotEdgeHandler({
  rateLimit: 120  // 120 requests per minute
});

// Production - more restrictive
const prodHandler = createCopilotEdgeHandler({
  rateLimit: 30   // 30 requests per minute
});

// High-security - very restrictive
const secureHandler = createCopilotEdgeHandler({
  rateLimit: 10   // 10 requests per minute
});
```

### Client Identification

Rate limiting is per "client" (simplified IP-based):

```typescript
// Future enhancement: better client identification
const clientId = request.headers.get('CF-Connecting-IP') || 
                request.headers.get('X-Forwarded-For') || 
                'default';
```

## Error Information Disclosure

### Safe Error Messages

CopilotEdge sanitizes errors:

```typescript
// Internal error (contains sensitive info)
throw new Error(`Database connection failed: mongodb://user:pass@host`);

// What client sees (sanitized)
{
  "error": "Internal service error",
  "type": "APIError"
}
```

### Debug Mode Risks

Never enable debug in production:

```typescript
// Debug mode may expose:
- API endpoints
- Response times
- Cache keys
- Region information
- Internal errors
```

## Cache Security

### Cache Key Generation

Cache keys are hashed:

```typescript
// Original request
{ messages: [{ role: 'user', content: 'secret data' }] }

// Cache key (hashed)
'a7b9c3d2'  // Not reversible
```

### Cache Isolation

- Cache is per-instance (not shared between deployments)
- Memory-only (not persisted)
- Cleared on restart
- No cross-tenant access

## Network Security

### HTTPS Only

Always use HTTPS endpoints:

```typescript
// ✅ Correct
https://api.cloudflare.com

// ❌ Never use HTTP
http://api.cloudflare.com
```

### Edge Security

Benefits of Cloudflare's edge:

- DDoS protection
- TLS termination
- Geographic distribution
- Automatic security updates

## Compliance Considerations

### GDPR/CCPA

- No personal data storage
- Data processing only (no retention)
- Right to deletion (cache expires automatically)
- No third-party sharing

### Audit Logging

For compliance, implement your own audit logging:

```typescript
function auditLog(event, details) {
  // Log to your audit system
  console.log({
    timestamp: new Date().toISOString(),
    event,
    details,
    // Don't log message content
    userId: details.userId,
    requestId: details.requestId
  });
}

// Usage
auditLog('api_request', {
  userId: getUserId(request),
  requestId: generateRequestId(),
  // Not logging actual messages
});
```

## Security Best Practices

### 1. Principle of Least Privilege

```typescript
// Cloudflare API token permissions:
// ✅ Only grant required permissions:
- Workers AI: Read
- Account: Read

// ❌ Don't grant unnecessary permissions:
- Workers: Write
- DNS: Write
```

### 2. Defense in Depth

Layer security measures:

1. Rate limiting
2. Input validation
3. Error sanitization
4. HTTPS only
5. Environment variables
6. Regular updates

### 3. Security Monitoring

```typescript
// Monitor for suspicious patterns
function detectSuspiciousActivity(request) {
  const suspicious = [
    /\bexec\b/i,        // Command execution
    /\bdrop\s+table/i,  // SQL injection
    /<script/i,         // XSS attempts
  ];
  
  const content = JSON.stringify(request);
  return suspicious.some(pattern => pattern.test(content));
}

if (detectSuspiciousActivity(request)) {
  console.warn('Suspicious activity detected');
  // Log and potentially block
}
```

### 4. Regular Security Updates

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Fix vulnerabilities
npm audit fix
```

## Incident Response

If you suspect a security issue:

1. **Rotate API keys immediately**
2. **Check Cloudflare audit logs**
3. **Review application logs**
4. **Notify affected users if required**
5. **Report issues to security@anthropic.com**

## Security Resources

- [Cloudflare Security Docs](https://developers.cloudflare.com/fundamentals/security/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)