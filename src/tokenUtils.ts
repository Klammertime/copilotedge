/**
 * Token counting and cost calculation utilities for CopilotEdge
 */

import { getEncoding, Tiktoken } from 'js-tiktoken';

/**
 * Model pricing configuration (per 1M tokens)
 */
export const MODEL_PRICING = {
  // Cloudflare Workers AI models (estimated)
  '@cf/meta/llama-3.1-8b-instruct': { input: 0.5, output: 1.5 },
  '@cf/meta/llama-3.1-70b-instruct': { input: 2.7, output: 3.5 },
  '@cf/meta/llama-3-8b-instruct': { input: 0.5, output: 1.5 },
  '@cf/mistral/mistral-7b-instruct': { input: 0.5, output: 1.5 },
  '@cf/microsoft/phi-2': { input: 0.3, output: 0.9 },
  '@cf/google/gemma-7b-it': { input: 0.5, output: 1.5 },
  '@cf/qwen/qwen1.5-7b-chat-awq': { input: 0.5, output: 1.5 },
  '@cf/tinyllama/tinyllama-1.1b-chat-v1.0': { input: 0.2, output: 0.6 },
  
  // OpenAI models (actual pricing)
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gpt-3.5-turbo-16k': { input: 3, output: 4 },
  
  // Default pricing for unknown models
  'default': { input: 1, output: 2 }
};

/**
 * Token counter class with model-specific encoding
 */
export class TokenCounter {
  private encoder: Tiktoken;
  private modelName: string;
  
  constructor(modelName?: string) {
    this.modelName = modelName || 'default';
    
    // Use cl100k_base encoding (GPT-3.5/4 compatible) as default
    // For Llama models, this gives a reasonable approximation
    this.encoder = getEncoding('cl100k_base');
  }
  
  /**
   * Count tokens in a text string
   */
  countTokens(text: string): number {
    if (!text) return 0;
    
    try {
      const tokens = this.encoder.encode(text);
      return tokens.length;
    } catch (error) {
      // Fallback to character-based estimation
      console.warn('[TokenCounter] Failed to encode text, using fallback estimation:', error);
      return Math.ceil(text.length / 4);
    }
  }
  
  /**
   * Count tokens in a message array
   */
  countMessageTokens(messages: Array<{ role: string; content: string }>): number {
    if (!messages || messages.length === 0) return 0;
    
    let totalTokens = 0;
    
    for (const message of messages) {
      // Count role tokens (approximately 1 token)
      totalTokens += 1;
      
      // Count content tokens
      if (message.content) {
        totalTokens += this.countTokens(message.content);
      }
      
      // Add message separator tokens (approximately 3 tokens per message)
      totalTokens += 3;
    }
    
    // Add base prompt tokens (approximately 3 tokens)
    totalTokens += 3;
    
    return totalTokens;
  }
  
  /**
   * Calculate cost for token usage
   */
  calculateCost(inputTokens: number, outputTokens: number, modelName?: string): {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  } {
    const model = modelName || this.modelName;
    const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING] || MODEL_PRICING.default;
    
    // Convert from per-million to actual cost
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const totalCost = inputCost + outputCost;
    
    return {
      inputCost: parseFloat(inputCost.toFixed(6)),
      outputCost: parseFloat(outputCost.toFixed(6)),
      totalCost: parseFloat(totalCost.toFixed(6))
    };
  }
  
  /**
   * Free the encoder to prevent memory leaks
   */
  free(): void {
    // js-tiktoken doesn't require explicit cleanup
    // The encoder will be garbage collected when no longer referenced
  }
}

/**
 * Singleton instance for reuse
 */
let defaultCounter: TokenCounter | null = null;

/**
 * Get or create a default token counter
 */
export function getTokenCounter(modelName?: string): TokenCounter {
  if (!defaultCounter || modelName) {
    // Create new counter if needed
    defaultCounter = new TokenCounter(modelName);
  }
  return defaultCounter;
}

/**
 * Estimate tokens for quick calculations (without encoding)
 */
export function estimateTokens(text: string): number {
  // Rule of thumb: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(6)}`;
  } else if (cost < 1) {
    return `$${cost.toFixed(4)}`;
  } else {
    return `$${cost.toFixed(2)}`;
  }
}