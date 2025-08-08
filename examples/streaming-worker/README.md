# Streaming Worker Example

Hybrid approach: Use SSE for long-form content while keeping CopilotEdge for cached short responses.

## Setup

```bash
npm install -g wrangler
cd examples/streaming-worker
wrangler dev
```

## Usage

```javascript
const eventSource = new EventSource('http://localhost:8787');
eventSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  console.log('Token:', data.token);
};
```

## Production Deploy

```bash
wrangler deploy
```