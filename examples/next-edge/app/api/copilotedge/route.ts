import { NextRequest } from 'next/server';
import { CopilotEdge } from 'copilotedge';

// Initialize CopilotEdge with configuration
const copilotEdge = new CopilotEdge({
  openaiApiKey: process.env.OPENAI_API_KEY!,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  googleGenerativeAiApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  openaiCompatible: process.env.OPENAI_COMPATIBLE_API_URL
    ? {
        apiBase: process.env.OPENAI_COMPATIBLE_API_URL,
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY,
      }
    : undefined,
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  cloudflareAi: process.env.CF_ACCOUNT_ID
    ? {
        accountId: process.env.CF_ACCOUNT_ID,
        apiToken: process.env.CF_API_TOKEN!,
      }
    : undefined,
});

// Handle POST requests for chat completions
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Process the request through CopilotEdge
    const response = await copilotEdge.process(body);
    
    // Return the response
    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error processing request:', error);
    
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          type: 'api_error',
        },
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

// Handle OPTIONS requests for CORS
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}