# Changelog

All notable changes to CopilotEdge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.5] – 2025-08-09

### Fixed
- **Critical**: Replaced weak 32-bit hash function with SHA-256 to prevent cache collisions
- **Critical**: Eliminated memory leaks in retry logic and timer management
  - Added proper timer cleanup in sleep() method with try/finally
  - Track active timers in a Set for lifecycle management
  - Replace AbortSignal.timeout with AbortController for better cleanup
- **Security**: Added comprehensive request size limits to prevent DoS attacks
  - Maximum request size (default 1MB)
  - Maximum message count (default 100)
  - Individual message size limits (default 10KB)
  - Object depth validation to prevent deeply nested payloads

### Added
- New `destroy()` method to clean up all resources (timers, caches, circuit breaker)
- Configurable DoS protection parameters (maxRequestSize, maxMessages, maxMessageSize, maxObjectDepth)
- Comprehensive test coverage for memory leak prevention
- Comprehensive test coverage for DoS protection

### Changed
- Enhanced `clearCache()` to also clear cache locks
- Improved error messages for request validation

## [0.2.3] – 2025-08-08

### Fixed
- Update CI badge to point to correct workflow
- Only run unit tests in CI (integration tests need real credentials)

## [0.2.2] – 2025-08-08

### Added
- Deterministic loading UX with staged loaders
- Typewriter effect for responses under 600 chars
- CE_FAKE_TYPEWRITER env flag for A/B testing
- Frontend telemetry with ce:latency events
- Server-side ttfb_ms metrics in debug mode
- Streaming worker example for SSE hybrid approach
- A/B test script for performance testing
- CI smoke tests for error handling

### Fixed
- Integration tests now include miniflare dependency

## [0.2.1] – 2025-08-08

### Breaking
- Removed `X-Contained-Sensitive` header (security risk).
- Sensitive content detection disabled by default; opt-in via `enableInternalSensitiveLogging` (was `detectSensitiveContent`).

### Added
- New models: gpt-oss-120b, gpt-oss-20b, Llama 3.3, Mistral Small 2503, Gemma 3.
- `benchmarks.md` with real-world results and methodology.
- Detailed error mapping (status codes and retry guidance).
- Security & Privacy best-practices section.
- Cloudflare Pages Functions example.
- Miniflare integration tests.
- Model update strategy documentation.

### Changed
- Removed marketing claims ("7× faster / 90% cheaper"), replaced with benchmarks.
- Updated model list and pricing (Aug 2025).
- Toned down README language.
- Expanded error handling and security config examples.

### Fixed
- Sensitive content detection no longer exposed in headers.
- Model pricing aligned with current Cloudflare rates.

## [0.2.0] – 2025-08-07

### Added
- Sensitive content detection for API keys, passwords, and tokens.
- `X-Contained-Sensitive` header to flag sensitive requests.
- Privacy monitoring for sensitive data sent to cloud services.
- `containsSensitiveContent()` method (7 pattern checks).

### Technical
- Header tracking implemented without affecting routing.
- Maintains full backward compatibility.

## [0.1.0] – 2025-08-07

### Initial Release
- First adapter linking CopilotKit to Cloudflare Workers AI.
- Automatic edge region selection.
- Request caching (60s TTL).
- Retry with exponential backoff and jitter.
- API-key–only configuration.
- Debug mode with performance metrics.
- Input validation and sanitization.
- Built-in metrics and rate limiting (60 requests/min).
- Comprehensive TypeScript types and JSDoc.
- Full test suite (~80% coverage).
- Detailed documentation and examples.

### Performance
- Support for all Cloudflare Workers AI models.
- Original benchmarks (now outdated).

### Security
- Request validation for GraphQL and chat formats.
- Message sanitization (4,000 char limit).
- Rate limiting to prevent abuse.
- Error masking to avoid information leakage.

### Developer Experience
- Zero-config setup.
- Works with Next.js App Router.
- Compatible with CopilotKit 1.9.x.
- ESM and CommonJS support.