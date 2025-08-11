// Base DurableObject class for compatibility
// In Cloudflare Workers runtime, this will be overridden by the native implementation
export class BaseDurableObject {
  ctx: DurableObjectState;
  env: any;
  
  constructor(ctx: DurableObjectState, env: any) {
    this.ctx = ctx;
    this.env = env;
  }
}

// Use the global DurableObject if available (Cloudflare Workers runtime)
// Otherwise use our base implementation (for testing)
const DurableObject = (globalThis as any).DurableObject || BaseDurableObject;

interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket): void;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  put<T = unknown>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  deleteAll(): Promise<void>;
  list<T = unknown>(options?: { start?: string; end?: string; prefix?: string; reverse?: boolean; limit?: number }): Promise<Map<string, T>>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}

/**
 * Interface for conversation state
 */
export interface ConversationState {
  conversationId: string;
  userId?: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }>;
  context: Record<string, any>;
  createdAt: number;
  lastActivity: number;
  totalTokens: number;
  model?: string;
}

/**
 * Interface for WebSocket message types
 */
export interface WSMessage {
  type: 'chat' | 'system' | 'error' | 'status';
  content?: string;
  role?: 'user' | 'assistant';
  error?: string;
  status?: 'thinking' | 'streaming' | 'complete';
  metadata?: Record<string, any>;
}

/**
 * ConversationDO - Durable Object for managing stateful conversations
 * 
 * Features:
 * - Persistent conversation history
 * - WebSocket support for real-time streaming
 * - State management across sessions
 * - Automatic cleanup of inactive conversations
 */
export class ConversationDO extends DurableObject {
  private state: ConversationState;
  private connections: Set<WebSocket>;
  private env: any;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.env = env;
    this.connections = new Set();
    this.state = {
      conversationId: crypto.randomUUID(),
      messages: [],
      context: {},
      createdAt: Date.now(),
      lastActivity: Date.now(),
      totalTokens: 0,
    };
  }

  /**
   * Initialize or restore conversation state
   */
  async initialize(): Promise<void> {
    const stored = await this.ctx.storage.get('conversation') as ConversationState | undefined;
    if (stored) {
      this.state = stored;
    }
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // Handle different endpoints
    switch (url.pathname) {
      case '/messages':
        return this.handleMessages(request);
      case '/state':
        return this.handleState(request);
      case '/clear':
        return this.handleClear();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  /**
   * Handle WebSocket upgrade request
   */
  private handleWebSocketUpgrade(_request: Request): Response {
    const webSocketPair = new (globalThis as any).WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept the WebSocket using Hibernation API
    this.ctx.acceptWebSocket(server as WebSocket);
    
    // Track connection
    this.connections.add(server as WebSocket);

    // Send initial state to new connection
    const initMessage: WSMessage = {
      type: 'system',
      content: 'Connected to conversation',
      metadata: {
        conversationId: this.state.conversationId,
        messageCount: this.state.messages.length,
        model: this.state.model,
      },
    };
    (server as WebSocket).send(JSON.stringify(initMessage));

    return new Response(null, {
      status: 101,
      webSocket: client as WebSocket,
    } as any);
  }

  /**
   * Handle WebSocket messages using Hibernation API
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = typeof message === 'string' 
        ? JSON.parse(message) 
        : JSON.parse(new TextDecoder().decode(message as ArrayBuffer));
      
      const wsMessage = data as WSMessage;

      switch (wsMessage.type) {
        case 'chat':
          await this.handleChatMessage(ws, wsMessage);
          break;
        case 'system':
          await this.handleSystemMessage(ws, wsMessage);
          break;
        default:
          ws.send(JSON.stringify({
            type: 'error',
            error: `Unknown message type: ${wsMessage.type}`,
          }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format',
      }));
    }
  }

  /**
   * Handle WebSocket close event
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.connections.delete(ws);
    console.log(`WebSocket closed: code=${code}, reason=${reason}, clean=${wasClean}`);
    
    // If no more connections and conversation is old, schedule cleanup
    if (this.connections.size === 0) {
      const inactiveTime = Date.now() - this.state.lastActivity;
      if (inactiveTime > 24 * 60 * 60 * 1000) { // 24 hours
        // Set alarm to clean up after 1 hour of inactivity
        await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
      }
    }
  }

  /**
   * Handle WebSocket errors
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
    ws.close(1011, 'WebSocket error occurred');
  }

  /**
   * Handle chat messages from WebSocket
   */
  private async handleChatMessage(ws: WebSocket, message: WSMessage): Promise<void> {
    if (!message.content || !message.role) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Chat message must include content and role',
      }));
      return;
    }

    // Add message to conversation history
    const chatMessage = {
      role: message.role,
      content: message.content,
      timestamp: Date.now(),
    };
    
    this.state.messages.push(chatMessage);
    this.state.lastActivity = Date.now();
    
    // Persist state
    await this.saveState();

    // Broadcast to all connected clients
    this.broadcast({
      type: 'chat',
      role: message.role,
      content: message.content,
      metadata: {
        timestamp: chatMessage.timestamp,
        messageCount: this.state.messages.length,
      },
    });

    // If this was a user message, notify that we're processing
    if (message.role === 'user') {
      this.broadcast({
        type: 'status',
        status: 'thinking',
      });
    }
  }

  /**
   * Handle system messages from WebSocket
   */
  private async handleSystemMessage(ws: WebSocket, message: WSMessage): Promise<void> {
    switch (message.content) {
      case 'get_history':
        ws.send(JSON.stringify({
          type: 'system',
          content: 'history',
          metadata: {
            messages: this.state.messages,
            totalTokens: this.state.totalTokens,
          },
        }));
        break;
      case 'clear_history':
        this.state.messages = [];
        this.state.totalTokens = 0;
        await this.saveState();
        ws.send(JSON.stringify({
          type: 'system',
          content: 'history_cleared',
        }));
        break;
      default:
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown system command: ${message.content}`,
        }));
    }
  }

  /**
   * Handle HTTP messages endpoint
   */
  private async handleMessages(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      await this.initialize();
      return Response.json({
        conversationId: this.state.conversationId,
        messages: this.state.messages,
        totalTokens: this.state.totalTokens,
      });
    }

    if (request.method === 'POST') {
      const body = await request.json() as any;
      
      // Add new message
      if (body.role && body.content) {
        const message = {
          role: body.role,
          content: body.content,
          timestamp: Date.now(),
        };
        
        this.state.messages.push(message);
        this.state.lastActivity = Date.now();
        
        if (body.tokens) {
          this.state.totalTokens += body.tokens;
        }
        
        await this.saveState();
        
        // Broadcast to WebSocket connections
        this.broadcast({
          type: 'chat',
          role: body.role,
          content: body.content,
          metadata: {
            timestamp: message.timestamp,
            tokens: body.tokens,
          },
        });
        
        return Response.json({ success: true, message });
      }
      
      return new Response('Invalid message format', { status: 400 });
    }

    return new Response('Method not allowed', { status: 405 });
  }

  /**
   * Handle state endpoint
   */
  private async handleState(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      await this.initialize();
      return Response.json(this.state);
    }

    if (request.method === 'PUT') {
      const updates = await request.json() as Partial<ConversationState>;
      
      // Update allowed fields
      if (updates.userId !== undefined) this.state.userId = updates.userId;
      if (updates.context !== undefined) this.state.context = { ...this.state.context, ...updates.context };
      if (updates.model !== undefined) this.state.model = updates.model;
      
      this.state.lastActivity = Date.now();
      await this.saveState();
      
      return Response.json({ success: true, state: this.state });
    }

    return new Response('Method not allowed', { status: 405 });
  }

  /**
   * Handle clear endpoint
   */
  private async handleClear(): Promise<Response> {
    this.state.messages = [];
    this.state.totalTokens = 0;
    this.state.context = {};
    this.state.lastActivity = Date.now();
    
    await this.saveState();
    
    // Notify WebSocket connections
    this.broadcast({
      type: 'system',
      content: 'conversation_cleared',
    });
    
    return Response.json({ success: true });
  }

  /**
   * Broadcast message to all connected WebSocket clients
   */
  private broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.connections) {
      try {
        ws.send(data);
      } catch (error) {
        console.error('Failed to send to WebSocket:', error);
        this.connections.delete(ws);
      }
    }
  }

  /**
   * Save conversation state to storage
   */
  private async saveState(): Promise<void> {
    await this.ctx.storage.put('conversation', this.state);
  }

  /**
   * Handle alarm for cleanup
   */
  async alarm(): Promise<void> {
    // Check if conversation is still inactive
    const inactiveTime = Date.now() - this.state.lastActivity;
    
    if (inactiveTime > 24 * 60 * 60 * 1000 && this.connections.size === 0) {
      // Clear old conversation data
      console.log(`Cleaning up inactive conversation: ${this.state.conversationId}`);
      await this.ctx.storage.deleteAll();
    } else if (this.connections.size === 0) {
      // Schedule another check in 1 hour
      await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    }
  }
}

/**
 * Helper to get or create a conversation DO
 */
export function getConversationDO(env: any, conversationId?: string): any {
  const id = conversationId 
    ? env.CONVERSATION_DO.idFromName(conversationId)
    : env.CONVERSATION_DO.newUniqueId();
  
  return env.CONVERSATION_DO.get(id);
}