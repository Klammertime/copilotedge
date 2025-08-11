/**
 * Quick test script to verify OpenAI OSS model support
 * Run with: node test/test-oss-models.js
 */

import CopilotEdge from '../dist/index.js';

// Test configuration
const TEST_CONFIG = {
  apiKey: process.env.CLOUDFLARE_API_TOKEN,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  debug: true
};

// Simple test message
const TEST_MESSAGE = {
  messages: [
    {
      role: 'user',
      content: 'Say "Hello from gpt-oss model!" and tell me which model you are.'
    }
  ]
};

async function testModel(modelName, description) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${modelName}: ${description}`);
  console.log('='.repeat(60));
  
  try {
    const edge = new CopilotEdge({
      ...TEST_CONFIG,
      model: modelName
    });
    
    console.log('✓ CopilotEdge instance created successfully');
    
    // Test the model
    console.log('→ Sending test request...');
    const start = Date.now();
    const response = await edge.handleRequest(TEST_MESSAGE);
    const duration = Date.now() - start;
    
    if (response?.choices?.[0]?.message?.content) {
      console.log(`✓ Response received in ${duration}ms`);
      console.log(`✓ Model response: "${response.choices[0].message.content}"`);
      console.log(`✓ Model: ${response.model || 'Not specified'}`);
    } else {
      console.log('✗ Invalid response structure:', response);
    }
    
    // Check metrics
    const metrics = edge.getMetrics();
    console.log(`✓ Metrics:`, metrics);
    
    return true;
  } catch (error) {
    console.error(`✗ Error testing ${modelName}:`, error.message);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Testing OpenAI OSS Models Support in CopilotEdge\n');
  
  // Check environment
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error('❌ Missing required environment variables:');
    console.error('   - CLOUDFLARE_API_TOKEN');
    console.error('   - CLOUDFLARE_ACCOUNT_ID');
    console.error('\nSet these before running tests.');
    process.exit(1);
  }
  
  const results = [];
  
  // Test gpt-oss-120b
  results.push({
    model: '@cf/openai/gpt-oss-120b',
    passed: await testModel('@cf/openai/gpt-oss-120b', '120B parameter model (80GB GPU)')
  });
  
  // Test gpt-oss-20b
  results.push({
    model: '@cf/openai/gpt-oss-20b',
    passed: await testModel('@cf/openai/gpt-oss-20b', '20B parameter model (16GB edge devices)')
  });
  
  // Test with fallback
  console.log(`\n${'='.repeat(60)}`);
  console.log('Testing Fallback Configuration');
  console.log('='.repeat(60));
  
  try {
    const edgeWithFallback = new CopilotEdge({
      ...TEST_CONFIG,
      model: '@cf/openai/gpt-oss-120b',
      fallback: '@cf/openai/gpt-oss-20b'
    });
    
    console.log('✓ Created instance with fallback configuration');
    console.log('  Primary: @cf/openai/gpt-oss-120b');
    console.log('  Fallback: @cf/openai/gpt-oss-20b');
    
    const response = await edgeWithFallback.handleRequest(TEST_MESSAGE);
    if (response?.choices?.[0]?.message?.content) {
      console.log('✓ Fallback configuration works');
      results.push({
        model: 'Fallback Config',
        passed: true
      });
    }
  } catch (error) {
    console.error('✗ Fallback configuration failed:', error.message);
    results.push({
      model: 'Fallback Config',
      passed: false
    });
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(result => {
    console.log(`${result.passed ? '✅' : '❌'} ${result.model}`);
  });
  
  console.log(`\nTotal: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. This might be due to:');
    console.log('- Models not yet available in your Cloudflare account');
    console.log('- API credentials issues');
    console.log('- Network connectivity');
    process.exit(1);
  } else {
    console.log('\n✨ All tests passed! OpenAI OSS models are working correctly.');
  }
}

// Run the tests
runTests().catch(console.error);