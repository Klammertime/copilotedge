# Supported Models

Complete guide to available models and keeping them up-to-date.

## Current Models (August 2025)

| Model | Description | Context | Speed | Cost |
|-------|-------------|---------|-------|------|
| `@cf/meta/llama-3.1-8b-instruct` | **Default** - Balanced performance | 8K | Fast | $0.011/1k neurons |
| `@cf/meta/llama-3.3-70b-instruct` | Latest Llama, speculative decoding | 8K | Medium | $0.011/1k neurons |
| `@cf/openai/gpt-oss-120b` | OpenAI production model | 32K | Slower | $0.011/1k neurons |
| `@cf/openai/gpt-oss-20b` | OpenAI low-latency model | 32K | Fast | $0.011/1k neurons |
| `@cf/mistral/mistral-small-2503` | Vision capable, long context | 128K | Medium | $0.011/1k neurons |
| `@cf/google/gemma-3` | Multilingual, 140+ languages | 128K | Medium | $0.011/1k neurons |

**Note**: OpenAI's open-weight models were added August 5, 2025 through Cloudflare's Day 0 partnership.

## Model Selection Guide

### For General Chat
```typescript
model: '@cf/meta/llama-3.1-8b-instruct'  // Default, well-balanced
```

### For Code Generation
```typescript
model: '@cf/openai/gpt-oss-20b'  // Optimized for code tasks
```

### For Long Context
```typescript
model: '@cf/mistral/mistral-small-2503'  // 128K context window
```

### For Multilingual
```typescript
model: '@cf/google/gemma-3'  // 140+ languages
```

### For Maximum Intelligence
```typescript
model: '@cf/openai/gpt-oss-120b'  // Most capable
```

## Checking Available Models

### Query Cloudflare API

```bash
# Get all text generation models
curl https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/models/search \
  -H "Authorization: Bearer {api_token}" \
  | jq '.result[] | select(.task.name=="Text Generation") | {name: .name, description: .description}'
```

### Test a New Model

```javascript
import CopilotEdge from 'copilotedge';

const edge = new CopilotEdge({
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  model: '@cf/new-provider/new-model',
  debug: true
});

// Test request
try {
  const result = await edge.handleRequest({
    messages: [{ role: 'user', content: 'Test message' }]
  });
  console.log('Model works!', result);
} catch (error) {
  console.error('Model not available:', error);
}
```

## Model Deprecation Handling

### Implement Fallback Logic

```typescript
const PRIMARY_MODEL = '@cf/meta/llama-3.3-70b-instruct';
const FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct';

let currentModel = PRIMARY_MODEL;

const createHandler = (model) => 
  createCopilotEdgeHandler({
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    model
  });

// Try primary model first
let handler = createHandler(currentModel);

// In your API route
export async function POST(req) {
  try {
    return await handler(req);
  } catch (error) {
    if (error.statusCode === 404 && currentModel === PRIMARY_MODEL) {
      // Model not found, switch to fallback
      console.warn(`Model ${PRIMARY_MODEL} not found, using fallback`);
      currentModel = FALLBACK_MODEL;
      handler = createHandler(currentModel);
      return await handler(req);
    }
    throw error;
  }
}
```

### Graceful Model Migration

```typescript
// models.config.js
export const MODEL_CONFIG = {
  preferred: [
    '@cf/openai/gpt-oss-120b',      // Try first
    '@cf/meta/llama-3.3-70b-instruct', // Fallback 1
    '@cf/meta/llama-3.1-8b-instruct'   // Fallback 2 (always available)
  ]
};

// Auto-select best available model
async function selectModel() {
  for (const model of MODEL_CONFIG.preferred) {
    try {
      const edge = new CopilotEdge({ model, /* ... */ });
      await edge.testFeatures();
      console.log(`Using model: ${model}`);
      return model;
    } catch (error) {
      console.warn(`Model ${model} not available`);
    }
  }
  throw new Error('No models available');
}
```

## Staying Up-to-Date

### Monitor Cloudflare Announcements

- [Cloudflare Blog](https://blog.cloudflare.com/tag/workers-ai/) - New model announcements
- [Workers AI Docs](https://developers.cloudflare.com/workers-ai/models/) - Official model list
- [Discord Community](https://discord.cloudflare.com) - Early access and discussions

### Automated Model List Updates

Create a script to check for new models:

```javascript
// scripts/check-models.js
async function checkModels() {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`
      }
    }
  );
  
  const data = await response.json();
  const textModels = data.result
    .filter(m => m.task?.name === 'Text Generation')
    .map(m => ({
      name: m.name,
      description: m.description,
      properties: m.properties
    }));
  
  console.log('Available models:', JSON.stringify(textModels, null, 2));
  
  // Compare with documented models
  const documented = [
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3.3-70b-instruct',
    // ... etc
  ];
  
  const newModels = textModels.filter(m => !documented.includes(m.name));
  if (newModels.length > 0) {
    console.warn('New models found:', newModels);
  }
}

checkModels();
```

### CI Check for Model List Age

Add to your CI pipeline:

```yaml
- name: Check model list freshness
  run: |
    LAST_UPDATED=$(grep -E "August 2025" docs/models.md)
    if [ -z "$LAST_UPDATED" ]; then
      echo "❌ Model list needs updating"
      exit 1
    fi
```

## Model Performance Characteristics

### Latency Comparison

| Model | Cold Start | Warm p50 | Warm p95 |
|-------|------------|----------|----------|
| llama-3.1-8b | ~300ms | ~120ms | ~200ms |
| gpt-oss-20b | ~400ms | ~150ms | ~250ms |
| gpt-oss-120b | ~600ms | ~300ms | ~500ms |
| mistral-small | ~350ms | ~140ms | ~230ms |

### Token Limits

| Model | Max Input | Max Output | Total |
|-------|-----------|------------|-------|
| llama-3.1-8b | 7K | 1K | 8K |
| gpt-oss-20b | 31K | 1K | 32K |
| gpt-oss-120b | 31K | 1K | 32K |
| mistral-small | 127K | 1K | 128K |
| gemma-3 | 127K | 1K | 128K |

## Pricing

All models currently use the same pricing structure:
- **Workers AI**: $0.011 per 1,000 neurons
- **Free tier**: Included in both Free and Paid Workers plans
- **No per-model pricing differences** (as of August 2025)

Note: Pricing may change. Check [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) for updates.