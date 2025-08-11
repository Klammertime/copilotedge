# Streaming Support

This document clarifies the current status of streaming responses in `copilotedge`.

---

## Current Status: No Streaming

**`copilotedge` does not support streaming responses.**

All responses from the `handleRequest` and `createCopilotedgeHandler` methods are returned as complete, non-streamed JSON objects.

## Why No Streaming? The Caching Trade-Off

The primary reason for this design choice is to enable the library's powerful **caching** feature. Caching is a core part of `copilotedge` that significantly reduces both latency and cost for repeated queries.

- **Caching requires a complete response:** To generate a reliable cache key and store a response, the entire response must be present.
- **Streams are unique:** A streaming response is a series of unique, unpredictable chunks. It's technically impossible to cache a stream in a way that would be useful for a subsequent, identical request.

We have prioritized the benefits of caching (cost savings and speed for repeated queries) over the real-time feel of streaming.

## How CopilotKit Handles This

The `@copilotkit/react-ui` components (like `<CopilotPopup>`) have excellent built-in loading states. When a request is being processed by `copilotedge`, the UI will automatically display a loading indicator, providing a smooth user experience even without streaming.

For the vast majority of chat-based use cases, this combination of fast, cached responses and clear loading indicators provides a highly responsive feel.
