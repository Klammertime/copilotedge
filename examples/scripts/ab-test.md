# A/B Test Script

## Setup
```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account"
```

## Test 1: Short prompt (cache miss)
```bash
curl -X POST http://localhost:3000/api/copilotedge \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}' \
  -w "\nTime: %{time_total}s\n"
```

## Test 2: Short prompt (cache hit)
```bash
# Run same command again immediately
curl -X POST http://localhost:3000/api/copilotedge \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}' \
  -w "\nTime: %{time_total}s\n"
```

## Test 3: Long prompt
```bash
curl -X POST http://localhost:3000/api/copilotedge \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Write a 500 word essay about clouds"}]}' \
  -w "\nTime: %{time_total}s\n"
```

## Monitoring
- Watch browser console for `[CE] ttfb_ms` logs
- Count abandons: Close tab if response takes >2s
- Record: cache hit/miss, ttfb_ms, total time

## Test 4: Streaming Response (v0.4.0+)
```bash
curl -X POST http://localhost:3000/api/copilotedge \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Tell me a story"}],"stream":true}' \
  -N
```

## Test 5: Conversation with ID (v0.6.0+)
```bash
# First message in conversation
curl -X POST http://localhost:3000/api/copilotedge \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"test-123","messages":[{"role":"user","content":"My name is Alice"}]}' \
  -w "\nTime: %{time_total}s\n"

# Second message (should remember context)
curl -X POST http://localhost:3000/api/copilotedge \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"test-123","messages":[{"role":"user","content":"What is my name?"}]}' \
  -w "\nTime: %{time_total}s\n"
```

## Expected Results
- Cache miss: 200-500ms
- Cache hit: <20ms  
- Abandon rate: <5% for prompts under 100 chars
- Streaming: ~200ms to first token
- Conversation context: Preserved across requests