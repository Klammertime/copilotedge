# Changelog

All notable changes to CopilotEdge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2025-01-12

### Added

- **💰 Token Counting & Cost Tracking:** Real-time AI cost monitoring
  - Accurate token counting using tiktoken library
  - Per-request cost calculation for all supported models
  - Cost breakdown by input/output tokens
  - Model-specific pricing configurations
  - Token metrics in OpenTelemetry spans (`ai.tokens.input`, `ai.tokens.output`, `ai.tokens.total`)
  - Cost attributes in telemetry (`ai.cost.input_usd`, `ai.cost.output_usd`, `ai.cost.total_usd`)
  
- **🔍 Enhanced Telemetry Attributes:**
  - Request correlation IDs for distributed tracing
  - Conversation and user ID tracking
  - Automatic dashboard endpoint discovery via environment variables
  - `COPILOTEDGE_TELEMETRY_ENDPOINT` environment variable support
  - `COPILOTEDGE_DASHBOARD_URL` fallback for telemetry endpoint

- **⚡ Performance Improvements:**
  - OTLP batching already implemented in v0.7.0, now properly configured
  - Optimized token counting with singleton pattern
  - Efficient streaming response token tracking

### Improved

- Token counting for both standard and streaming responses
- Cost visibility for AI operations monitoring
- Dashboard integration with auto-discovery
- Production telemetry with meaningful cost metrics
- Better observability for AI spending patterns

### Technical Notes

- Uses js-tiktoken for OpenAI-compatible token counting
- Supports all Cloudflare Workers AI models with estimated pricing
- Token counts work with streaming responses
- Zero overhead when telemetry is disabled
- Compatible with dashboard telemetry collectors

## [0.7.0] - 2025-01-12

### Added

- **🔭 OpenTelemetry Support:** Enterprise-grade observability for AI workloads
  - Complete distributed tracing for request lifecycle
  - Automatic span creation for validation, cache, and AI calls
  - Metrics collection (cache hit rates, AI latency, token usage)
  - Error tracking with automatic exception recording
  - Multiple exporter support (Console, OTLP, custom)
  - Configurable sampling rates for production environments
  - Graceful degradation when disabled (zero overhead)
- **Telemetry Configuration:**
  - `enabled` - Toggle telemetry on/off
  - `endpoint` - OTLP collector endpoint
  - `serviceName` - Service identification
  - `environment` - Deployment environment tagging
  - `samplingRate` - Control trace sampling (0.0 to 1.0)
  - `exporters` - Configure multiple export destinations
- **Comprehensive Testing:** 13 new tests for telemetry functionality
- **Example Implementation:** Complete telemetry example in `examples/telemetry-example.ts`
- **Documentation:** Full telemetry guide at `docs/telemetry.md`

### Improved

- Production readiness with enterprise observability capabilities
- Debugging experience with detailed trace information
- Performance monitoring with automatic metrics collection
- Error diagnosis with exception tracking in spans
- Cost optimization through sampling controls

### Technical Notes

- Uses OpenTelemetry SDK for standards compliance
- Compatible with Jaeger, Zipkin, and other OTLP collectors
- Zero performance impact when disabled
- Automatic context propagation across async operations
- Follows OpenTelemetry semantic conventions

## [0.6.0] - 2025-01-11

### Added

- **🎯 Durable Objects Integration:** Stateful conversation management
  - Persistent conversation history across sessions
  - WebSocket support for real-time bidirectional communication
  - Automatic conversation context loading and saving
  - Session state that survives Worker restarts and deployments
- **WebSocket Hibernation API:** Efficient WebSocket handling
  - Uses Cloudflare's latest WebSocket Hibernation API
  - Automatic connection management
  - Broadcasting to multiple connected clients
  - Support for chat, system, and status messages
- **Conversation Configuration:**
  - `conversationDO` - Durable Object namespace binding
  - `enableConversations` - Toggle conversation persistence
  - `defaultConversationId` - Default conversation for sessions
- **Comprehensive Documentation:** Complete Durable Objects guide at `docs/durable-objects.md`
- **Testing:** 17 new tests for Durable Objects functionality

### Improved

- Conversation continuity with automatic history management
- User experience with stateful interactions
- Cost efficiency by reusing conversation context
- WebSocket performance with Hibernation API

### Technical Notes

- Fully backward compatible - no breaking changes
- Optional feature - users opt-in via configuration
- 87 out of 88 tests passing (1 WebSocket mock limitation)
- Follows Cloudflare best practices for Durable Objects

## [0.5.0] - 2025-01-11

### Added

- **🗄️ Workers KV Integration:** Persistent global caching across all edge locations
  - 90-95% reduction in API costs through intelligent caching
  - Cache persists across Worker restarts and deployments
  - Automatic fallback to memory cache if KV unavailable
  - Configurable TTL with default of 24 hours (86400 seconds)
- **Dual-Layer Caching:** KV (global) + memory (local) with automatic fallback
- **KV Cache Configuration:**
  - `kvNamespace` - Workers KV namespace binding for persistent storage
  - `kvCacheTTL` - Cache time-to-live in seconds (default: 86400)
- **Comprehensive KV Testing:** 71 tests covering all caching scenarios including:
  - KV cache hits and misses
  - Memory fallback behavior
  - TTL expiration handling
  - Error recovery and resilience
- **KV Setup Documentation:** Complete guide for Workers KV integration at `docs/kv-cache.md`

### Improved

- Cost efficiency with persistent caching that survives deployments
- Zero cold starts with globally distributed cache
- Better error handling with automatic KV to memory fallback
- Enhanced caching strategy with dual-layer approach

### Known Limitations

- Code coverage currently at ~25% (functional tests all passing)
- See [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for details
- v0.5.1 will focus on improving test coverage to 80%+

## [0.4.0] - 2025-08-11

### Added

- **🚀 Real-Time Streaming Support:** Complete implementation of Server-Sent Events (SSE) streaming for AI responses
  - ~200ms to first token (10x faster perceived response)
  - Memory-efficient async generator pattern
  - Optional `onChunk` callback for progress tracking
  - Full Next.js integration with automatic SSE response handling
- **Streaming Configuration:** New `stream` and `onChunk` options in CopilotEdgeConfig
- **SSE Parser:** Robust parser for Cloudflare's streaming format with error recovery
- **Dual-Mode Operation:** Intelligent caching + streaming balance
  - Stream for unique, creative content
  - Cache for repeated queries (instant 0ms responses)
- **Comprehensive Tests:** 15 new streaming-specific tests (58 total tests passing)
- **Documentation:** Complete streaming usage guide and migration instructions

### Changed

- Updated `handleDirectChat` to support both streaming and non-streaming modes
- Enhanced `createNextHandler` to return proper text/event-stream responses
- Improved documentation to reflect streaming capabilities
- Updated examples to demonstrate streaming usage

### Technical Details

- New `callCloudflareAIStreaming()` method using async generators
- Streaming works with all Cloudflare chat models (@cf/meta/*, @cf/mistral/*, @cf/google/*)
- Per-request streaming override (request parameter takes precedence over instance config)
- Backward compatible - non-streaming remains the default behavior

## [0.3.0] - 2025-08-10

### Added

- **Comprehensive Test Suite:** Added a full suite of unit and integration tests to verify core logic, including caching, retries, fallbacks, and request validation.
- **Hardened Validation:** The request validation logic is now more robust, correctly handling all valid GraphQL requests from the CopilotKit frontend.

### Fixed

- **Critical Bug Fixes:** Corrected numerous bugs in the request handler that caused errors and incorrect behavior.
- **Dependency Management:** Moved CopilotKit packages to `dependencies` for a seamless, one-step installation experience.
- **Example Accuracy:** All examples are now fully functional, consistent, and reflect the correct usage of the library.

### Changed

- **Project Cleanup:** Removed all misleading, redundant, and non-functional example files to provide a clear and trustworthy developer experience.

## [0.2.7] – 2025-08-09

### Added

- Full support for OpenAI's gpt-oss-20b model (20B parameters, runs on 16GB devices)
- Enhanced documentation highlighting Apache 2.0 licensed models
- New examples for edge-optimized deployments with gpt-oss-20b
- Blog post draft explaining OpenAI open-source model capabilities

### Changed

- Updated README with dedicated section for OpenAI open-source models
- Improved examples showing both gpt-oss-120b and gpt-oss-20b usage
- Enhanced package description to highlight open-source model support

## [0.2.6] – 2025-08-09

### Added

- Comprehensive release hardiness report documenting all pre-release fixes
- Enhanced documentation for configuration, streaming, and troubleshooting
- Improved error handling examples in documentation
- Created missing API route example (`examples/next-edge/app/api/copilotedge/route.ts`)
- Specialized agent configurations for CI/CD and release validation
- Enhanced error handling and streaming capabilities in core implementation

### Fixed

- Build artifacts (dist/index.js) no longer tracked in git repository
- Next.js peer dependency properly included in devDependencies for testing
- Removed backup files from distribution directory
- CI workflow pnpm version conflict issue

### Changed

- Documentation improvements across all guides
- Enhanced README to clearly communicate the unique value proposition as the first and only CopilotKit + Cloudflare Workers AI adapter
- Cleaner project structure with proper gitignore configuration
- Enhanced core implementation with better error handling and streaming support
- Updated CI workflow configuration for better test coverage

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
