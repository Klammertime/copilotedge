/**
 * CopilotEdge Reliability Monitor
 * Continuous monitoring script for production reliability
 */

import CopilotEdge from '../src/index';

interface HealthMetrics {
  timestamp: number;
  latency: number;
  success: boolean;
  error?: string;
  cacheHit: boolean;
  retryCount: number;
  memoryUsage: number;
}

interface HealthReport {
  healthy: boolean;
  uptime: number;
  successRate: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  cacheHitRate: number;
  errorRate: number;
  memoryTrend: 'stable' | 'growing' | 'critical';
  issues: string[];
  recommendations: string[];
}

class ReliabilityMonitor {
  private edge: CopilotEdge;
  private metrics: HealthMetrics[] = [];
  private startTime: number = Date.now();
  private maxMetrics: number = 1000;
  private thresholds = {
    successRate: 0.95,      // 95% success rate minimum
    avgLatency: 1000,       // 1 second average
    p95Latency: 3000,       // 3 seconds P95
    p99Latency: 5000,       // 5 seconds P99
    cacheHitRate: 0.30,     // 30% cache hit minimum
    errorRate: 0.05,        // 5% error rate maximum
    memoryGrowth: 50        // 50MB growth warning
  };

  constructor(config: any) {
    this.edge = new CopilotEdge(config);
    this.setupMockAPI();
  }

  private setupMockAPI() {
    // Mock API for testing
    let callCount = 0;
    global.fetch = async (url: string) => {
      callCount++;
      
      // Simulate various conditions
      const random = Math.random();
      
      // 5% failure rate
      if (random < 0.05) {
        throw new Error('Simulated API error');
      }
      
      // 10% slow responses
      if (random < 0.15) {
        await new Promise(r => setTimeout(r, 2000));
      } else {
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
      }
      
      // Region check
      if (url.includes('/client/v4')) {
        return { ok: true } as any;
      }
      
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: { content: `Response ${callCount}` }
          }]
        })
      } as any;
    };
  }

  async runHealthCheck(): Promise<HealthMetrics> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    let success = false;
    let error: string | undefined;
    let retryCount = 0;
    let cacheHit = false;

    try {
      // Alternate between cached and unique requests
      const useCache = Math.random() < 0.5;
      const content = useCache ? 'Cached request' : `Unique ${Date.now()}`;
      
      const result = await this.edge.handleRequest({
        messages: [{ role: 'user', content }]
      });
      
      success = true;
      cacheHit = result.cached || false;
      
      // Extract retry count from debug logs (in real scenario)
      retryCount = 0;
    } catch (e: any) {
      error = e.message;
      success = false;
    }

    const latency = Date.now() - startTime;
    const memoryUsage = process.memoryUsage().heapUsed - startMemory;

    const metric: HealthMetrics = {
      timestamp: Date.now(),
      latency,
      success,
      error,
      cacheHit,
      retryCount,
      memoryUsage
    };

    this.metrics.push(metric);
    
    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    return metric;
  }

  generateReport(): HealthReport {
    if (this.metrics.length === 0) {
      return {
        healthy: false,
        uptime: 0,
        successRate: 0,
        avgLatency: 0,
        p95Latency: 0,
        p99Latency: 0,
        cacheHitRate: 0,
        errorRate: 1,
        memoryTrend: 'stable',
        issues: ['No metrics available'],
        recommendations: ['Start monitoring']
      };
    }

    const uptime = Date.now() - this.startTime;
    const successfulRequests = this.metrics.filter(m => m.success);
    const failedRequests = this.metrics.filter(m => !m.success);
    const cachedRequests = this.metrics.filter(m => m.cacheHit);
    
    // Calculate success rate
    const successRate = successfulRequests.length / this.metrics.length;
    const errorRate = failedRequests.length / this.metrics.length;
    
    // Calculate latencies
    const latencies = successfulRequests.map(m => m.latency).sort((a, b) => a - b);
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length || 0;
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);
    const p95Latency = latencies[p95Index] || 0;
    const p99Latency = latencies[p99Index] || 0;
    
    // Calculate cache hit rate
    const cacheHitRate = cachedRequests.length / this.metrics.length;
    
    // Analyze memory trend
    const recentMemory = this.metrics.slice(-100).map(m => m.memoryUsage);
    const avgMemoryGrowth = recentMemory.length > 1 
      ? (recentMemory[recentMemory.length - 1] - recentMemory[0]) / recentMemory.length
      : 0;
    
    const memoryTrend: 'stable' | 'growing' | 'critical' = 
      avgMemoryGrowth > this.thresholds.memoryGrowth * 1024 * 1024 ? 'critical' :
      avgMemoryGrowth > this.thresholds.memoryGrowth * 1024 * 100 ? 'growing' :
      'stable';
    
    // Identify issues
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    if (successRate < this.thresholds.successRate) {
      issues.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
      recommendations.push('Investigate error patterns and implement retry logic');
    }
    
    if (avgLatency > this.thresholds.avgLatency) {
      issues.push(`High average latency: ${avgLatency.toFixed(0)}ms`);
      recommendations.push('Optimize API calls and consider caching strategy');
    }
    
    if (p95Latency > this.thresholds.p95Latency) {
      issues.push(`High P95 latency: ${p95Latency.toFixed(0)}ms`);
      recommendations.push('Investigate slow requests and add timeouts');
    }
    
    if (p99Latency > this.thresholds.p99Latency) {
      issues.push(`High P99 latency: ${p99Latency.toFixed(0)}ms`);
      recommendations.push('Implement circuit breaker for outlier requests');
    }
    
    if (cacheHitRate < this.thresholds.cacheHitRate) {
      issues.push(`Low cache hit rate: ${(cacheHitRate * 100).toFixed(1)}%`);
      recommendations.push('Review cache key generation and TTL settings');
    }
    
    if (errorRate > this.thresholds.errorRate) {
      issues.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
      recommendations.push('Implement error recovery and fallback mechanisms');
    }
    
    if (memoryTrend === 'critical') {
      issues.push('Memory leak detected');
      recommendations.push('Review cache eviction and cleanup processes');
    }
    
    // Check for specific error patterns
    const errorTypes = new Map<string, number>();
    failedRequests.forEach(m => {
      if (m.error) {
        errorTypes.set(m.error, (errorTypes.get(m.error) || 0) + 1);
      }
    });
    
    // Determine overall health
    const healthy = issues.length === 0;
    
    return {
      healthy,
      uptime,
      successRate,
      avgLatency,
      p95Latency,
      p99Latency,
      cacheHitRate,
      errorRate,
      memoryTrend,
      issues,
      recommendations
    };
  }

  async startContinuousMonitoring(intervalMs: number = 1000) {
    console.log('Starting CopilotEdge Reliability Monitor...');
    console.log('=' .repeat(50));
    
    let checkCount = 0;
    
    const runCheck = async () => {
      checkCount++;
      
      // Run health check
      const metric = await this.runHealthCheck();
      
      // Generate report every 10 checks
      if (checkCount % 10 === 0) {
        const report = this.generateReport();
        this.displayReport(report);
      }
      
      // Show live metrics every check
      this.displayLiveMetric(metric);
    };
    
    // Run checks continuously
    setInterval(runCheck, intervalMs);
    
    // Initial check
    await runCheck();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\nShutting down monitor...');
      const finalReport = this.generateReport();
      this.displayFinalReport(finalReport);
      process.exit(0);
    });
  }

  private displayLiveMetric(metric: HealthMetrics) {
    const status = metric.success ? '✅' : '❌';
    const cache = metric.cacheHit ? '💾' : '🔄';
    const latencyColor = metric.latency > 1000 ? '🟠' : '🟢';
    
    console.log(
      `[${new Date().toISOString()}] ${status} ${cache} ${latencyColor} ` +
      `${metric.latency}ms` +
      (metric.error ? ` | Error: ${metric.error}` : '')
    );
  }

  private displayReport(report: HealthReport) {
    console.log('\n' + '─' .repeat(50));
    console.log('HEALTH REPORT');
    console.log('─' .repeat(50));
    
    const healthIcon = report.healthy ? '✅' : '⚠️';
    console.log(`Status: ${healthIcon} ${report.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    console.log(`Uptime: ${Math.floor(report.uptime / 1000)}s`);
    
    console.log('\nMetrics:');
    console.log(`  Success Rate: ${(report.successRate * 100).toFixed(1)}%`);
    console.log(`  Error Rate: ${(report.errorRate * 100).toFixed(1)}%`);
    console.log(`  Cache Hit Rate: ${(report.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`  Avg Latency: ${report.avgLatency.toFixed(0)}ms`);
    console.log(`  P95 Latency: ${report.p95Latency.toFixed(0)}ms`);
    console.log(`  P99 Latency: ${report.p99Latency.toFixed(0)}ms`);
    console.log(`  Memory Trend: ${report.memoryTrend}`);
    
    if (report.issues.length > 0) {
      console.log('\n⚠️ Issues Detected:');
      report.issues.forEach(issue => console.log(`  - ${issue}`));
      
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach(rec => console.log(`  - ${rec}`));
    }
    
    console.log('─' .repeat(50));
  }

  private displayFinalReport(report: HealthReport) {
    console.log('\n' + '=' .repeat(50));
    console.log('FINAL RELIABILITY REPORT');
    console.log('=' .repeat(50));
    
    this.displayReport(report);
    
    // Calculate reliability score
    const scores = {
      success: Math.min(report.successRate / this.thresholds.successRate, 1) * 30,
      latency: Math.max(0, 1 - (report.avgLatency / this.thresholds.avgLatency)) * 20,
      p95: Math.max(0, 1 - (report.p95Latency / this.thresholds.p95Latency)) * 15,
      p99: Math.max(0, 1 - (report.p99Latency / this.thresholds.p99Latency)) * 10,
      cache: Math.min(report.cacheHitRate / this.thresholds.cacheHitRate, 1) * 15,
      errors: Math.max(0, 1 - (report.errorRate / this.thresholds.errorRate)) * 10
    };
    
    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    
    console.log('\nReliability Score Breakdown:');
    console.log(`  Success Rate: ${scores.success.toFixed(1)}/30`);
    console.log(`  Avg Latency: ${scores.latency.toFixed(1)}/20`);
    console.log(`  P95 Latency: ${scores.p95.toFixed(1)}/15`);
    console.log(`  P99 Latency: ${scores.p99.toFixed(1)}/10`);
    console.log(`  Cache Performance: ${scores.cache.toFixed(1)}/15`);
    console.log(`  Error Handling: ${scores.errors.toFixed(1)}/10`);
    console.log(`  ──────────────────────────`);
    console.log(`  TOTAL SCORE: ${totalScore.toFixed(1)}/100`);
    
    const grade = 
      totalScore >= 90 ? 'A' :
      totalScore >= 80 ? 'B' :
      totalScore >= 70 ? 'C' :
      totalScore >= 60 ? 'D' :
      'F';
    
    console.log(`  GRADE: ${grade}`);
    
    if (totalScore < 70) {
      console.log('\n🔴 CRITICAL: System reliability below acceptable threshold!');
      console.log('   DO NOT deploy to production without addressing issues.');
    } else if (totalScore < 85) {
      console.log('\n🟠 WARNING: System has reliability concerns.');
      console.log('   Address issues before high-traffic deployment.');
    } else {
      console.log('\n🟢 GOOD: System shows acceptable reliability.');
      console.log('   Continue monitoring in production.');
    }
    
    console.log('=' .repeat(50));
  }
}

// Main execution
if (require.main === module) {
  const monitor = new ReliabilityMonitor({
    apiKey: 'test-key',
    accountId: 'test-account',
    debug: false,
    cacheTimeout: 60000,
    maxRetries: 3,
    rateLimit: 60
  });
  
  // Start continuous monitoring
  monitor.startContinuousMonitoring(500); // Check every 500ms
  
  console.log('\nPress Ctrl+C to stop monitoring and generate final report...\n');
}

export default ReliabilityMonitor;