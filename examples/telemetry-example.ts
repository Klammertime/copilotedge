/**
 * OpenTelemetry Integration Example for CopilotEdge
 * 
 * This example demonstrates how to set up CopilotEdge with OpenTelemetry
 * for production observability, including tracing, metrics, and error tracking.
 */

import { CopilotEdge } from 'copilotedge';

// Example 1: Basic Telemetry Setup
const basicTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml
  
  // Enable telemetry with minimal configuration
  telemetry: {
    enabled: true,
    serviceName: 'my-ai-service'
  }
});

// Example 2: Production Configuration with OTLP
const productionTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml
  
  telemetry: {
    enabled: true,
    
    // OTLP collector endpoint (e.g., Grafana Cloud, Datadog, New Relic)
    endpoint: 'https://otlp-gateway.grafana.net/otlp',
    
    // Service identification
    serviceName: 'copilotedge-production',
    serviceVersion: '1.0.0',
    environment: 'production',
    
    // Authentication headers for your collector
    headers: {
      'Authorization': `Basic ${Buffer.from(`${process.env.GRAFANA_USER}:${process.env.GRAFANA_API_KEY}`).toString('base64')}`
    },
    
    // Custom attributes added to all spans
    attributes: {
      'deployment.region': 'us-east-1',
      'team': 'ai-platform',
      'cost.center': 'engineering'
    },
    
    // Sample 10% of requests in production for cost efficiency
    samplingRate: 0.1,
    
    // Export configuration
    exporters: {
      otlp: true,
      console: false // Disable console logging in production
    }
  }
});

// Example 3: Development Configuration with Console Export
const developmentTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml
  debug: true,
  
  telemetry: {
    enabled: true,
    serviceName: 'copilotedge-dev',
    environment: 'development',
    
    // Enable debug logging for telemetry
    debug: true,
    
    // Log spans to console for debugging
    exporters: {
      console: true,
      otlp: false
    },
    
    // Sample everything in development
    samplingRate: 1.0
  }
});

// Example 4: Local Jaeger Setup
const jaegerTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml
  
  telemetry: {
    enabled: true,
    
    // Local Jaeger endpoint
    endpoint: 'http://localhost:4318/v1/traces',
    
    serviceName: 'copilotedge-local',
    environment: 'local',
    
    exporters: {
      otlp: true,
      console: true // Also log to console for debugging
    }
  }
});

// Example 5: Custom Exporter for Analytics
const customExporterTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml
  
  telemetry: {
    enabled: true,
    serviceName: 'copilotedge-analytics',
    
    exporters: {
      custom: (span: any) => {
        // Send telemetry data to your custom analytics system
        console.log('Custom telemetry export:', {
          name: span.name,
          duration: span.duration,
          attributes: span.attributes,
          events: span.events,
          status: span.status
        });
        
        // Example: Send to your analytics API
        // await fetch('https://analytics.example.com/spans', {
        //   method: 'POST',
        //   body: JSON.stringify(span)
        // });
      }
    }
  }
});

// Example 6: Cloudflare Workers Configuration
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const copilot = new CopilotEdge({
      model: '@cf/meta/llama-3.1-8b-instruct',
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      
      telemetry: {
        enabled: true,
        
        // Use environment variables for configuration
        endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
        serviceName: env.OTEL_SERVICE_NAME || 'copilotedge-worker',
        environment: env.ENVIRONMENT || 'production',
        
        // Use Workers secrets for auth
        headers: {
          'x-api-key': env.TELEMETRY_API_KEY
        },
        
        // Lower sampling in production Workers
        samplingRate: env.ENVIRONMENT === 'production' ? 0.01 : 1.0,
        
        attributes: {
          'worker.version': env.WORKER_VERSION || 'unknown',
          'cf.colo': request.cf?.colo || 'unknown',
          'cf.country': request.cf?.country || 'unknown'
        }
      },
      
      // Enable KV and DO with telemetry
      kvNamespace: env.COPILOT_KV,
      conversationDO: env.CONVERSATIONS,
      enableConversations: true
    });
    
    // Handle the request with automatic telemetry
    const handler = copilot.createNextHandler();
    return handler(request);
  }
};

// Example 7: Testing Telemetry Locally with Docker
/*
To test with Jaeger locally:

1. Start Jaeger using Docker:
   docker run -d --name jaeger \
     -e COLLECTOR_OTLP_ENABLED=true \
     -p 16686:16686 \
     -p 4318:4318 \
     jaegertracing/all-in-one:latest

2. Configure CopilotEdge:
   const copilot = new CopilotEdge({
     telemetry: {
       enabled: true,
       endpoint: 'http://localhost:4318/v1/traces',
       serviceName: 'copilotedge-test'
     }
   });

3. View traces at: http://localhost:16686
*/

// Example 8: Grafana Cloud Integration
const grafanaCloudTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml
  
  telemetry: {
    enabled: true,
    
    // Grafana Cloud OTLP endpoint (replace with your stack)
    endpoint: 'https://otlp-gateway-prod-us-central-0.grafana.net/otlp/v1/traces',
    
    serviceName: 'copilotedge',
    environment: 'production',
    
    // Grafana Cloud authentication
    headers: {
      'Authorization': `Basic ${Buffer.from(
        `${process.env.GRAFANA_INSTANCE_ID}:${process.env.GRAFANA_API_TOKEN}`
      ).toString('base64')}`
    },
    
    // Production sampling
    samplingRate: 0.1,
    
    attributes: {
      'service.namespace': 'ai-platform',
      'service.instance.id': process.env.DYNO || 'local'
    }
  }
});

// Example 9: Datadog APM Integration
const datadogTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml
  
  telemetry: {
    enabled: true,
    
    // Datadog OTLP endpoint
    endpoint: 'https://ingest.datadoghq.com/v1/traces',
    
    serviceName: 'copilotedge',
    serviceVersion: process.env.DD_VERSION || '1.0.0',
    environment: process.env.DD_ENV || 'production',
    
    headers: {
      'DD-API-KEY': process.env.DD_API_KEY!
    },
    
    attributes: {
      'dd.trace.origin': 'copilotedge',
      'dd.trace.sample_rate': '0.1'
    },
    
    samplingRate: 0.1
  }
});

// Example 10: Conditional Telemetry Based on Environment
const conditionalTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-8b-instruct',
  apiKey: env.CLOUDFLARE_API_TOKEN, // From wrangler.toml
  accountId: env.CLOUDFLARE_ACCOUNT_ID, // From wrangler.toml
  
  telemetry: process.env.NODE_ENV === 'production' ? {
    enabled: true,
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: 'copilotedge',
    environment: 'production',
    samplingRate: 0.05, // 5% sampling in production
    headers: {
      'Authorization': `Bearer ${process.env.TELEMETRY_TOKEN}`
    }
  } : {
    enabled: true,
    serviceName: 'copilotedge-dev',
    environment: 'development',
    exporters: {
      console: true // Console only in development
    }
  }
});

// Example 11: Cost Tracking and Monitoring (NEW in v0.8.0!)
const costTrackingTelemetry = new CopilotEdge({
  model: '@cf/meta/llama-3.1-70b-instruct', // Larger model for cost demo
  apiKey: env.CLOUDFLARE_API_TOKEN,
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  
  telemetry: {
    enabled: true,
    
    // Auto-discovery: Will use these env vars if endpoint not specified:
    // - COPILOTEDGE_TELEMETRY_ENDPOINT
    // - COPILOTEDGE_DASHBOARD_URL
    endpoint: process.env.COPILOTEDGE_TELEMETRY_ENDPOINT || 
              'https://dash.copilotedge.io/otlp',
    
    serviceName: 'copilotedge-cost-tracking',
    environment: 'production',
    
    // Track costs for budget monitoring
    attributes: {
      'budget.team': 'ai-platform',
      'budget.project': 'customer-support',
      'budget.monthly_limit_usd': '1000'
    },
    
    // Sample everything to capture all costs
    samplingRate: 1.0,
    
    exporters: {
      otlp: true
    }
  }
});

/*
The telemetry will now include these cost tracking attributes:
- ai.tokens.input: Actual input token count (using tiktoken)
- ai.tokens.output: Actual output token count  
- ai.tokens.total: Combined token usage
- ai.cost.input_usd: Cost for input tokens in USD
- ai.cost.output_usd: Cost for output tokens in USD
- ai.cost.total_usd: Total request cost in USD
- correlation.id: Unique identifier for request tracking
- conversation.id: Track multi-turn conversations
- user.id: User-level cost attribution

Use these metrics to:
1. Monitor AI spending in real-time
2. Set up cost alerts when approaching budget limits
3. Identify expensive queries or users
4. Optimize model selection based on cost/performance
5. Generate cost reports by team/project/user
*/

// Export for use in your application
export {
  basicTelemetry,
  productionTelemetry,
  developmentTelemetry,
  jaegerTelemetry,
  costTrackingTelemetry,
  customExporterTelemetry,
  grafanaCloudTelemetry,
  datadogTelemetry,
  conditionalTelemetry
};