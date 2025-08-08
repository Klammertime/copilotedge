/**
 * Performance benchmarks for CopilotEdge
 * 
 * Run: node benchmarks/performance.js
 */

import { CopilotEdge } from '../dist/index.js';

// Configuration
const ITERATIONS = 100;
const CACHE_TEST_ITERATIONS = 50;

// Test messages of varying complexity
const testMessages = [
  { role: 'user', content: 'Hi' },
  { role: 'user', content: 'What is 2+2?' },
  { role: 'user', content: 'Explain quantum computing in simple terms.' },
  { role: 'user', content: 'Write a Python function to calculate fibonacci numbers.' }
];

class PerformanceBenchmark {
  constructor() {
    this.edge = new CopilotEdge({
      apiKey: process.env.CLOUDFLARE_API_TOKEN,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      debug: false
    });
    
    this.results = {
      withoutCache: [],
      withCache: [],
      cacheHitRate: 0,
      avgResponseTime: 0,
      p50: 0,
      p95: 0,
      p99: 0
    };
  }

  async runBenchmarks() {
    console.log('🚀 CopilotEdge Performance Benchmarks\n');
    console.log('=' .repeat(50));
    
    await this.testResponseTimes();
    await this.testCachePerformance();
    await this.testConcurrency();
    await this.testErrorRecovery();
    
    this.printResults();
  }

  async testResponseTimes() {
    console.log('\n📊 Testing Response Times...');
    const times = [];
    
    for (let i = 0; i < ITERATIONS; i++) {
      const message = testMessages[i % testMessages.length];
      const start = performance.now();
      
      try {
        await this.edge.handleRequest({ messages: [message] });
        const elapsed = performance.now() - start;
        times.push(elapsed);
        
        if ((i + 1) % 10 === 0) {
          process.stdout.write(`\r  Progress: ${i + 1}/${ITERATIONS}`);
        }
      } catch (error) {
        console.error('\n  Error:', error.message);
      }
    }
    
    this.results.withoutCache = times;
    this.calculatePercentiles(times);
    console.log('\n  ✅ Complete');
  }

  async testCachePerformance() {
    console.log('\n💾 Testing Cache Performance...');
    const times = [];
    let cacheHits = 0;
    
    // Clear cache first
    this.edge.clearCache();
    
    // Use same message to test caching
    const message = { role: 'user', content: 'What is the meaning of life?' };
    
    for (let i = 0; i < CACHE_TEST_ITERATIONS; i++) {
      const start = performance.now();
      
      try {
        const result = await this.edge.handleRequest({ messages: [message] });
        const elapsed = performance.now() - start;
        times.push(elapsed);
        
        if (result.cached) {
          cacheHits++;
        }
        
        if ((i + 1) % 10 === 0) {
          process.stdout.write(`\r  Progress: ${i + 1}/${CACHE_TEST_ITERATIONS} (Cache hits: ${cacheHits})`);
        }
      } catch (error) {
        console.error('\n  Error:', error.message);
      }
    }
    
    this.results.withCache = times;
    this.results.cacheHitRate = (cacheHits / CACHE_TEST_ITERATIONS) * 100;
    console.log('\n  ✅ Complete');
  }

  async testConcurrency() {
    console.log('\n⚡ Testing Concurrent Requests...');
    const concurrentRequests = 10;
    
    const start = performance.now();
    const promises = Array.from({ length: concurrentRequests }, (_, i) => 
      this.edge.handleRequest({
        messages: [{ role: 'user', content: `Request ${i}` }]
      })
    );
    
    try {
      await Promise.all(promises);
      const elapsed = performance.now() - start;
      console.log(`  ${concurrentRequests} concurrent requests completed in ${Math.round(elapsed)}ms`);
      console.log(`  Average per request: ${Math.round(elapsed / concurrentRequests)}ms`);
    } catch (error) {
      console.error('  Error:', error.message);
    }
    
    console.log('  ✅ Complete');
  }

  async testErrorRecovery() {
    console.log('\n🔄 Testing Error Recovery...');
    
    // Test with invalid config
    const edgeWithBadConfig = new CopilotEdge({
      apiKey: 'invalid-key',
      accountId: 'invalid-account',
      maxRetries: 2
    });
    
    const start = performance.now();
    try {
      await edgeWithBadConfig.handleRequest({
        messages: [{ role: 'user', content: 'Test' }]
      });
    } catch (error) {
      const elapsed = performance.now() - start;
      console.log(`  Error recovery completed in ${Math.round(elapsed)}ms`);
      console.log(`  Properly handled error: ${error.message.slice(0, 50)}...`);
    }
    
    console.log('  ✅ Complete');
  }

  calculatePercentiles(times) {
    const sorted = [...times].sort((a, b) => a - b);
    const len = sorted.length;
    
    this.results.avgResponseTime = times.reduce((a, b) => a + b, 0) / len;
    this.results.p50 = sorted[Math.floor(len * 0.5)];
    this.results.p95 = sorted[Math.floor(len * 0.95)];
    this.results.p99 = sorted[Math.floor(len * 0.99)];
  }

  printResults() {
    const metrics = this.edge.getMetrics();
    
    console.log('\n' + '=' .repeat(50));
    console.log('📈 BENCHMARK RESULTS\n');
    
    console.log('Response Times (without cache):');
    console.log(`  Average: ${Math.round(this.results.avgResponseTime)}ms`);
    console.log(`  P50: ${Math.round(this.results.p50)}ms`);
    console.log(`  P95: ${Math.round(this.results.p95)}ms`);
    console.log(`  P99: ${Math.round(this.results.p99)}ms`);
    
    if (this.results.withCache.length > 0) {
      const avgCached = this.results.withCache.reduce((a, b) => a + b, 0) / this.results.withCache.length;
      console.log('\nCache Performance:');
      console.log(`  Average (with cache): ${Math.round(avgCached)}ms`);
      console.log(`  Cache Hit Rate: ${this.results.cacheHitRate.toFixed(1)}%`);
      console.log(`  Speed Improvement: ${((this.results.avgResponseTime / avgCached - 1) * 100).toFixed(1)}%`);
    }
    
    console.log('\nOverall Metrics:');
    console.log(`  Total Requests: ${metrics.totalRequests}`);
    console.log(`  Cache Hits: ${metrics.cacheHits}`);
    console.log(`  Errors: ${metrics.errors}`);
    console.log(`  Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
    
    console.log('\n' + '=' .repeat(50));
    console.log('✅ Benchmarks Complete!\n');
  }
}

// Run benchmarks
async function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error('❌ Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables');
    process.exit(1);
  }
  
  const benchmark = new PerformanceBenchmark();
  await benchmark.runBenchmarks();
}

main().catch(console.error);