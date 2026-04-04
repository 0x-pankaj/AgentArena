type WSMessage =
  | { type: 'connected'; clientId: string; subscriptions: string[] }
  | { type: 'subscribed'; channel: string }
  | { type: 'unsubscribed'; channel: string }
  | { type: 'feed_event'; data: any }
  | { type: 'leaderboard_update'; data: any }
  | { type: 'position_update'; data: any }
  | { type: 'price_update'; data: any }
  | { type: 'agent_decision'; data: any };

type WSListener = (message: WSMessage) => void;

const getWsUrl = () => {
  if (process.env.EXPO_PUBLIC_WS_URL) {
    return process.env.EXPO_PUBLIC_WS_URL;
  }
  if (__DEV__) {
    return 'ws://10.0.2.2:3002';
  }
  return 'wss://ws.agentarena.dev';
};

//
//   if (process.env.EXPO_PUBLIC_API_URL) {
//   return process.env.EXPO_PUBLIC_API_URL;
// }
// if (__DEV__) {
//   return 'http://10.0.2.2:3001';
// }
// return 'https://api.agentarena.dev';
// };


class WSClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WSListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private maxReconnectDelay = 30_000;
  private subscriptions = new Set<string>();
  private isConnecting = false;
  private isDestroyed = false;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  connect() {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN || this.isDestroyed) return;
    this.isConnecting = true;

    const url = getWsUrl();
    console.log('[WS] Connecting to', url);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err);
      this.isConnecting = false;
      this.scheduleReconnect();
      return;
    }

    // Add connection timeout (10 seconds)
    this.connectionTimeout = setTimeout(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        console.error('[WS] Connection timeout after 10s');
        this.ws?.close();
        this.isConnecting = false;
        this.scheduleReconnect();
      }
    }, 10_000);

    this.ws.onopen = () => {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      console.log('[WS] Connected');
      this.isConnecting = false;
      this.reconnectAttempts = 0;

      // Re-subscribe to all channels
      for (const channel of this.subscriptions) {
        this.send({ action: 'subscribe', channel });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WSMessage;
        for (const listener of this.listeners) {
          listener(message);
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      console.log('[WS] Disconnected');
      this.isConnecting = false;
      if (!this.isDestroyed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error: any) => {
      console.error('[WS] Error:', error?.message ?? 'WebSocket error');
      this.isConnecting = false;
    };
  }

  disconnect() {
    this.isDestroyed = true;
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(channel: string) {
    this.subscriptions.add(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ action: 'subscribe', channel });
    }
  }

  unsubscribe(channel: string) {
    this.subscriptions.delete(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ action: 'unsubscribe', channel });
    }
  }

  addListener(listener: WSListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.isDestroyed) return;
    
    // Stop reconnecting after max attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached. Stopping.');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    console.log(`[WS] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }
}

export const wsClient = new WSClient();
export type { WSMessage };
