/**
 * CopilotEdge with Durable Objects Example
 * 
 * This example demonstrates how to use Durable Objects for stateful
 * conversation management with CopilotEdge.
 */

import { 
  createCopilotEdgeHandler, 
  ConversationDO,
  type DurableObjectNamespace,
  type KVNamespace 
} from 'copilotedge';

// Export the Durable Object class so Cloudflare can instantiate it
export { ConversationDO };

/**
 * Environment bindings
 */
export interface Env {
  // Required for CopilotEdge
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  
  // Durable Object namespace binding
  CONVERSATION_DO: DurableObjectNamespace;
  
  // Optional: KV for additional caching
  COPILOT_CACHE?: KVNamespace;
}

/**
 * Main Worker handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Serve a simple chat UI at the root
    if (url.pathname === '/') {
      return new Response(getChatUI(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    // Handle WebSocket connections for real-time chat
    if (request.headers.get('Upgrade') === 'websocket') {
      // Extract conversation ID from path or use default
      const conversationId = url.pathname.slice(1) || 'default-chat';
      
      // Get the Durable Object instance
      const doId = env.CONVERSATION_DO.idFromName(conversationId);
      const conversationStub = env.CONVERSATION_DO.get(doId);
      
      // Forward the WebSocket request to the Durable Object
      return conversationStub.fetch(request);
    }
    
    // Handle regular HTTP API requests
    const handler = createCopilotEdgeHandler({
      // API credentials
      apiKey: env.CLOUDFLARE_API_TOKEN,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      
      // Enable Durable Objects for conversation persistence
      conversationDO: env.CONVERSATION_DO,
      enableConversations: true,
      defaultConversationId: 'default-session',
      
      // Optional: Use a powerful model
      model: '@cf/openai/gpt-oss-120b',
      fallback: '@cf/meta/llama-3.1-8b-instruct',
      
      // Optional: Enable streaming
      stream: true,
      
      // Optional: Add KV caching
      kvNamespace: env.COPILOT_CACHE,
      kvCacheTTL: 86400, // 24 hours
      
      // Enable debug logging in development
      debug: process.env.NODE_ENV === 'development',
    });
    
    return handler(request);
  }
};

/**
 * Simple chat UI for testing
 */
function getChatUI(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CopilotEdge Chat with Durable Objects</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    .chat-container {
      background: white;
      border-radius: 10px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      width: 90%;
      max-width: 500px;
      height: 600px;
      display: flex;
      flex-direction: column;
    }
    
    .chat-header {
      background: #7c3aed;
      color: white;
      padding: 20px;
      border-radius: 10px 10px 0 0;
    }
    
    .chat-header h1 {
      font-size: 1.5rem;
      margin-bottom: 5px;
    }
    
    .chat-header p {
      opacity: 0.9;
      font-size: 0.9rem;
    }
    
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: #f9fafb;
    }
    
    .message {
      margin-bottom: 15px;
      display: flex;
      align-items: flex-start;
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .message.user {
      justify-content: flex-end;
    }
    
    .message-content {
      max-width: 70%;
      padding: 10px 15px;
      border-radius: 10px;
      word-wrap: break-word;
    }
    
    .message.user .message-content {
      background: #7c3aed;
      color: white;
    }
    
    .message.assistant .message-content {
      background: white;
      color: #333;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    
    .message.system {
      justify-content: center;
    }
    
    .message.system .message-content {
      background: #fbbf24;
      color: #78350f;
      font-size: 0.9rem;
      max-width: 90%;
    }
    
    .chat-input {
      display: flex;
      padding: 20px;
      background: white;
      border-radius: 0 0 10px 10px;
      border-top: 1px solid #e5e7eb;
    }
    
    .chat-input input {
      flex: 1;
      padding: 10px 15px;
      border: 1px solid #d1d5db;
      border-radius: 25px;
      outline: none;
      font-size: 1rem;
    }
    
    .chat-input input:focus {
      border-color: #7c3aed;
    }
    
    .chat-input button {
      margin-left: 10px;
      padding: 10px 20px;
      background: #7c3aed;
      color: white;
      border: none;
      border-radius: 25px;
      cursor: pointer;
      font-size: 1rem;
      transition: background 0.2s;
    }
    
    .chat-input button:hover {
      background: #6d28d9;
    }
    
    .chat-input button:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    
    .status {
      padding: 5px 10px;
      font-size: 0.8rem;
      color: #6b7280;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="chat-header">
      <h1>CopilotEdge Chat</h1>
      <p>Powered by Durable Objects & Cloudflare Workers AI</p>
    </div>
    
    <div class="chat-messages" id="messages">
      <div class="message system">
        <div class="message-content">
          Connected to conversation. Your chat history is preserved!
        </div>
      </div>
    </div>
    
    <div class="status" id="status">Ready</div>
    
    <div class="chat-input">
      <input 
        type="text" 
        id="input" 
        placeholder="Type your message..."
        autofocus
      />
      <button id="send">Send</button>
    </div>
  </div>
  
  <script>
    // Generate unique conversation ID or use existing
    const conversationId = localStorage.getItem('conversationId') || 
                          'chat-' + Date.now();
    localStorage.setItem('conversationId', conversationId);
    
    // Connect to WebSocket
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(protocol + '//' + location.host + '/' + conversationId);
    
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const status = document.getElementById('status');
    
    // WebSocket event handlers
    ws.onopen = () => {
      status.textContent = 'Connected';
      sendBtn.disabled = false;
      
      // Request conversation history
      ws.send(JSON.stringify({
        type: 'system',
        content: 'get_history'
      }));
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'chat':
          addMessage(data.role, data.content);
          break;
          
        case 'status':
          status.textContent = data.status === 'thinking' ? 'AI is thinking...' : 'Ready';
          break;
          
        case 'system':
          if (data.content === 'history' && data.metadata?.messages) {
            // Clear and reload history
            messages.innerHTML = '';
            data.metadata.messages.forEach(msg => {
              addMessage(msg.role, msg.content);
            });
          }
          break;
          
        case 'error':
          addMessage('system', 'Error: ' + data.error);
          break;
      }
    };
    
    ws.onerror = (error) => {
      status.textContent = 'Connection error';
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      status.textContent = 'Disconnected - Refresh to reconnect';
      sendBtn.disabled = true;
    };
    
    // Add message to chat
    function addMessage(role, content) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message ' + role;
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = content;
      
      messageDiv.appendChild(contentDiv);
      messages.appendChild(messageDiv);
      messages.scrollTop = messages.scrollHeight;
    }
    
    // Send message
    function sendMessage() {
      const text = input.value.trim();
      if (!text) return;
      
      // Add user message to UI
      addMessage('user', text);
      
      // Send to WebSocket
      ws.send(JSON.stringify({
        type: 'chat',
        role: 'user',
        content: text
      }));
      
      input.value = '';
      status.textContent = 'AI is thinking...';
    }
    
    // Event listeners
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  </script>
</body>
</html>
  `;
}