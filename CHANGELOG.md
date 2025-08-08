# Changelog

All notable changes to CopilotEdge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2025-08-08

### Breaking Changes
- **Security**: `X-Contained-Sensitive` header removed from responses for security reasons
- **Security**: Sensitive content detection now disabled by default (opt-in via `detectSensitiveContent` config)

### Added
- Support for new OpenAI open-weight models (gpt-oss-120b, gpt-oss-20b) - August 2025 release
- Support for Llama 3.3, Mistral Small 2503, and Gemma 3 models
- Comprehensive benchmarks documentation with methodology (`benchmarks.md`)
- Detailed error mapping with status codes and retry guidance
- Security & Privacy section with best practices
- Cloudflare Pages Functions deployment example
- Integration tests using Miniflare
- Model update strategy documentation
- Explicit streaming support documentation (not currently supported)

### Changed
- Removed unsubstantiated "7× faster / 90% cheaper" claims - replaced with methodology
- Updated model list to reflect August 2025 availability
- Toned down marketing language throughout README
- Improved error handling documentation with failure scenarios
- Enhanced configuration examples with security recommendations
- Updated pricing to reflect current Cloudflare pricing ($0.011/1k neurons)

### Fixed
- Sensitive content detection security vulnerability (no longer exposed in headers)
- Marketing claims now properly substantiated with methodology
- Model pricing updated to current rates

### Documentation
- Added recommended production configuration
- Added model deprecation handling examples
- Added cache effectiveness guidance
- Added performance testing instructions

## [0.2.0] - 2025-01-31

### Added
- 🔒 **Sensitive Content Detection** - Detects API keys, passwords, tokens in requests
- 📊 **X-Contained-Sensitive Header** - Tracks when sensitive content is detected
- 🛡️ **Privacy Monitoring** - Monitor when sensitive data is being sent to cloud services

### Technical
- Added `containsSensitiveContent()` method to detect 7 patterns of sensitive data
- Added header tracking without changing routing behavior
- Maintains 100% backward compatibility

## [0.1.0] - 2025-01-31

### Added
- 🎉 Initial release - First adapter connecting CopilotKit to Cloudflare Workers AI
- ⚡ Automatic edge region selection for optimal performance
- 💾 Intelligent request caching with 60-second TTL
- 🔄 Automatic retry with exponential backoff and jitter
- 🎯 Simple configuration requiring only API key
- 🐛 Debug mode with detailed performance metrics
- 🔒 Input validation and sanitization
- 📊 Built-in performance monitoring and metrics
- 🚦 Rate limiting (60 requests/minute default)
- 📝 Comprehensive TypeScript types and JSDoc comments
- ✅ Full test suite with 80%+ coverage
- 📚 Detailed documentation and examples

### Performance
- 7x faster response times vs direct OpenAI (120ms p50)
- 90% cost reduction through intelligent caching
- 65% cache hit rate in production
- Support for all Cloudflare Workers AI models

### Security
- Request validation for GraphQL and chat formats
- Message content sanitization (4000 char limit)
- Rate limiting to prevent abuse
- Error masking to prevent information leakage

### Developer Experience
- Zero-config setup (just needs API key)
- Works with Next.js App Router out of the box
- Compatible with CopilotKit 1.9.x
- ES modules and CommonJS support

## Future Releases

### [0.2.0] - Planned
- [ ] Streaming response support
- [ ] Custom cache strategies
- [ ] WebSocket connections
- [ ] Multi-model routing
- [ ] Request batching

### [0.3.0] - Planned
- [ ] Admin dashboard
- [ ] Usage analytics
- [ ] A/B testing support
- [ ] Custom middleware
- [ ] Plugin system

---

For more details, see the [GitHub releases](https://github.com/Klammertime/copilotedge/releases) page.