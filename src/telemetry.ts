/**
 * OpenTelemetry instrumentation for CopilotEdge
 * Provides distributed tracing and metrics for production observability
 */

/**
 * Span names used throughout the application
 */
export const SpanNames = {
  REQUEST: 'copilotedge.request',
  VALIDATION: 'copilotedge.validation',
  CACHE_LOOKUP: 'copilotedge.cache.lookup',
  CACHE_WRITE: 'copilotedge.cache.write',
  AI_CALL: 'copilotedge.ai.call',
  AI_RETRY: 'copilotedge.ai.retry',
  RESPONSE: 'copilotedge.response',
  DO_FETCH: 'copilotedge.durable_object.fetch',
  DO_SAVE: 'copilotedge.durable_object.save',
  KV_READ: 'copilotedge.kv.read',
  KV_WRITE: 'copilotedge.kv.write'
} as const;

import { 
  trace, 
  context, 
  SpanStatusCode, 
  Span, 
  SpanKind,
  Tracer,
  Attributes,
  DiagConsoleLogger,
  DiagLogLevel,
  diag
} from '@opentelemetry/api';

import { 
  BasicTracerProvider, 
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  BatchSpanProcessor,
  Sampler,
  AlwaysOnSampler,
  AlwaysOffSampler,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

/**
 * Telemetry configuration options
 */
export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;  // Deployment environment (production, staging, development)
  exportInterval?: number;
  headers?: Record<string, string>;
  attributes?: Record<string, string>;
  samplingRate?: number;
  exporters?: {
    console?: boolean;
    otlp?: boolean;
    custom?: (spans: Span[]) => void;
  };
  debug?: boolean;
  // Batch configuration for OTLP exporter
  batchConfig?: {
    maxQueueSize?: number;        // Maximum number of spans to queue (default: 100)
    maxExportBatchSize?: number;  // Maximum batch size for export (default: 50)
    batchSize?: number;           // Alias for maxExportBatchSize
    exportTimeoutMillis?: number; // Timeout for export operations (default: 30000)
    batchTimeoutMs?: number;      // Alias for scheduledDelayMillis (how often to export)
  };
}

/**
 * Simplified metrics interface for telemetry
 */
export interface TelemetryMetrics {
  cacheHits: number;
  cacheMisses: number;
  requestCount: number;
  errorCount: number;
  averageLatency: number;
  tokensProcessed: number;
}

/**
 * Span attributes for CopilotEdge
 */
export interface CopilotSpanAttributes extends Attributes {
  'copilot.model'?: string;
  'copilot.provider'?: string;
  'copilot.cache_hit'?: boolean;
  'copilot.cache_type'?: 'memory' | 'kv';
  'copilot.streaming'?: boolean;
  'copilot.conversation_id'?: string;
  'copilot.request_size'?: number;
  'copilot.response_size'?: number;
  'copilot.tokens.input'?: number;
  'copilot.tokens.output'?: number;
  'copilot.retry_count'?: number;
  'copilot.fallback_used'?: boolean;
  // New AI-specific attributes
  'ai.tokens.input'?: number;
  'ai.tokens.output'?: number;
  'ai.tokens.total'?: number;
  'ai.cost.input_usd'?: number;
  'ai.cost.output_usd'?: number;
  'ai.cost.total_usd'?: number;
  'ai.cost.estimated'?: boolean;
  // Dashboard-specific metrics
  'dashboard.user_id'?: string;
  'dashboard.session_id'?: string;
  'dashboard.request_source'?: string;
  'dashboard.api_version'?: string;
  'dashboard.cost_savings_usd'?: number; // Savings from cache hits
  'dashboard.carbon_saved_grams'?: number; // Environmental impact from cache
  // Correlation IDs
  'correlation.id'?: string;
  'conversation.id'?: string;
  'user.id'?: string;
}

/**
 * Telemetry manager for CopilotEdge
 */
export class TelemetryManager {
  private tracer: Tracer | null = null;
  private provider: BasicTracerProvider | null = null;
  private config: TelemetryConfig;
  private activeSpans: Map<string, Span> = new Map();
  private metrics: TelemetryMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    requestCount: 0,
    errorCount: 0,
    averageLatency: 0,
    tokensProcessed: 0
  };
  
  constructor(config: TelemetryConfig) {
    // Auto-discovery of telemetry endpoint
    const autoConfig = {
      ...config,
      endpoint: config.endpoint || 
                process.env.COPILOTEDGE_TELEMETRY_ENDPOINT || 
                process.env.COPILOTEDGE_DASHBOARD_URL ||
                (config.enabled ? 'https://dash.copilotedge.io/otlp' : undefined)
    };
    
    this.config = autoConfig;
    
    if (autoConfig.enabled) {
      this.initialize();
    }
  }
  
  /**
   * Initialize OpenTelemetry
   */
  private initialize(): void {
    try {
      // Set up debug logging if enabled
      if (this.config.debug) {
        diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
      }
      
      // Create tracer provider with resource attributes
      this.provider = new BasicTracerProvider({
        sampler: this.createSampler()
      });
      
      // Set up span processors using internal API
      this.setupSpanProcessors();
      
      // Register the provider globally
      trace.setGlobalTracerProvider(this.provider);
      
      // Get a tracer
      this.tracer = trace.getTracer(
        this.config.serviceName || 'copilotedge',
        this.config.serviceVersion || '0.8.0'
      );
    } catch (error) {
      console.error('[Telemetry] Initialization failed:', error);
      // Disable telemetry on initialization failure
      this.config.enabled = false;
    }
  }
  
  /**
   * Create sampler based on configuration
   */
  private createSampler(): Sampler {
    if (this.config.samplingRate === undefined || this.config.samplingRate === 1) {
      return new AlwaysOnSampler();
    }
    
    if (this.config.samplingRate === 0) {
      return new AlwaysOffSampler();
    }
    
    // Use parent-based sampling with ratio for partial sampling
    return new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(this.config.samplingRate)
    });
  }
  
  /**
   * Set up span processors for exporters
   * Uses internal API to work around Workers limitations
   */
  private setupSpanProcessors(): void {
    if (!this.provider) return;
    
    const processors: any[] = [];
    
    // Console exporter for debugging
    if (this.config.exporters?.console) {
      const consoleExporter = new ConsoleSpanExporter();
      processors.push(new SimpleSpanProcessor(consoleExporter));
    }
    
    // OTLP exporter for production
    if (this.config.exporters?.otlp !== false && this.config.endpoint) {
      try {
        const otlpExporter = new OTLPTraceExporter({
          url: this.config.endpoint,
          headers: this.config.headers,
          timeoutMillis: this.config.exportInterval || 10000
        });
        
        // Support both naming conventions for batch configuration
        const batchSize = this.config.batchConfig?.maxExportBatchSize || 
                         this.config.batchConfig?.batchSize || 
                         50;
        const batchTimeout = this.config.batchConfig?.batchTimeoutMs || 
                           this.config.exportInterval || 
                           10000;
        
        processors.push(new BatchSpanProcessor(otlpExporter, {
          maxQueueSize: this.config.batchConfig?.maxQueueSize || 100,
          maxExportBatchSize: batchSize,
          scheduledDelayMillis: batchTimeout,
          exportTimeoutMillis: this.config.batchConfig?.exportTimeoutMillis || 30000
        }));
      } catch (error) {
        console.error('[Telemetry] Failed to create OTLP exporter:', error);
      }
    }
    
    // If we have processors, set them up using the internal API
    if (processors.length > 0) {
      const providerInternal = this.provider as any;
      
      // Create a composite processor that delegates to all configured processors
      const compositeProcessor = {
        forceFlush: () => Promise.all(processors.map(p => p.forceFlush?.() || Promise.resolve())),
        onStart: (span: any, parentContext: any) => {
          processors.forEach(p => p.onStart?.(span, parentContext));
        },
        onEnd: (span: any) => {
          processors.forEach(p => p.onEnd?.(span));
        },
        shutdown: () => Promise.all(processors.map(p => p.shutdown?.() || Promise.resolve()))
      };
      
      // Replace the default processor
      providerInternal._activeSpanProcessor = compositeProcessor;
    }
  }
  
  /**
   * Start a new span
   */
  startSpan(name: string, options?: {
    kind?: SpanKind;
    attributes?: CopilotSpanAttributes;
    parentSpan?: Span;
  }): Span | null {
    if (!this.config.enabled || !this.tracer) {
      return null;
    }
    
    try {
      const parentContext = options?.parentSpan 
        ? trace.setSpan(context.active(), options.parentSpan)
        : context.active();
      
      const span = this.tracer.startSpan(name, {
        kind: options?.kind || SpanKind.INTERNAL,
        attributes: {
          ...this.config.attributes,
          ...options?.attributes
        }
      }, parentContext);
      
      this.activeSpans.set(name, span);
      return span;
    } catch (error) {
      if (this.config.debug) {
        console.error('[Telemetry] Failed to start span:', error);
      }
      return null;
    }
  }
  
  /**
   * End a span
   */
  endSpan(name: string, status?: { code: SpanStatusCode; message?: string }): void {
    if (!this.config.enabled) return;
    
    const span = this.activeSpans.get(name);
    if (!span) return;
    
    try {
      if (status) {
        span.setStatus(status);
      }
      
      span.end();
      this.activeSpans.delete(name);
    } catch (error) {
      if (this.config.debug) {
        console.error('[Telemetry] Failed to end span:', error);
      }
    }
  }
  
  /**
   * Add event to current span
   */
  addEvent(name: string, eventName: string, attributes?: Attributes): void {
    if (!this.config.enabled) return;
    
    const span = this.activeSpans.get(name);
    if (!span) return;
    
    try {
      span.addEvent(eventName, attributes);
    } catch (error) {
      if (this.config.debug) {
        console.error('[Telemetry] Failed to add event:', error);
      }
    }
  }
  
  /**
   * Set attributes on current span
   */
  setAttributes(name: string, attributes: CopilotSpanAttributes): void {
    if (!this.config.enabled) return;
    
    const span = this.activeSpans.get(name);
    if (!span) return;
    
    try {
      span.setAttributes(attributes);
    } catch (error) {
      if (this.config.debug) {
        console.error('[Telemetry] Failed to set attributes:', error);
      }
    }
  }
  
  /**
   * Record an error on the span
   */
  recordError(name: string, error: Error): void {
    if (!this.config.enabled) return;
    
    const span = this.activeSpans.get(name);
    if (!span) return;
    
    try {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    } catch (err) {
      if (this.config.debug) {
        console.error('[Telemetry] Failed to record error:', err);
      }
    }
  }
  
  /**
   * Execute a function within a span context
   */
  async withSpan<T>(
    name: string,
    fn: () => Promise<T>,
    options?: {
      kind?: SpanKind;
      attributes?: CopilotSpanAttributes;
      parentSpan?: Span;
    }
  ): Promise<T> {
    if (!this.config.enabled) {
      return fn();
    }
    
    const span = this.startSpan(name, options);
    
    try {
      const result = await fn();
      if (span) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        this.activeSpans.delete(name);
      }
      return result;
    } catch (error) {
      if (span) {
        span.recordException(error as Error);
        span.setStatus({ 
          code: SpanStatusCode.ERROR, 
          message: (error as Error).message 
        });
        span.end();
        this.activeSpans.delete(name);
      }
      throw error;
    }
  }
  
  /**
   * Update telemetry metrics
   */
  updateMetrics(update: Partial<TelemetryMetrics>): void {
    if (!this.config.enabled) return;
    
    Object.assign(this.metrics, update);
    
    // Calculate average latency
    if (update.averageLatency !== undefined && this.metrics.requestCount > 0) {
      const currentTotal = this.metrics.averageLatency * (this.metrics.requestCount - 1);
      this.metrics.averageLatency = (currentTotal + update.averageLatency) / this.metrics.requestCount;
    }
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): TelemetryMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Force flush all pending spans
   */
  async flush(): Promise<void> {
    if (!this.provider) return;
    
    try {
      await this.provider.forceFlush();
    } catch (error) {
      if (this.config.debug) {
        console.error('[Telemetry] Failed to flush:', error);
      }
    }
  }
  
  /**
   * Shutdown telemetry gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.provider) return;
    
    try {
      // End all active spans
      for (const [, span] of this.activeSpans) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      }
      this.activeSpans.clear();
      
      // Shutdown the provider
      await this.provider.shutdown();
    } catch (error) {
      if (this.config.debug) {
        console.error('[Telemetry] Failed to shutdown:', error);
      }
    }
  }
}