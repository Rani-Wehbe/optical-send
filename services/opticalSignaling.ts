/**
 * OpticalSignaling: Local WebSocket signaling stub for DataChannel setup
 *
 * For demo/local testing: enables P2P connection without external TURN servers.
 * Production: replace with STUN/TURN config or production signaling server.
 */

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'ping' | 'pong';
  peerId: string;
  targetPeerId?: string;
  sdp?: string;
  candidate?: RTCIceCandidate;
  timestamp: number;
}

export class SignalingClient {
  private ws?: WebSocket;
  private peerId: string;
  private onMessageCallback?: (msg: SignalingMessage) => void;
  private onErrorCallback?: (err: Error) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(peerId: string, signalingUrl: string = 'ws://localhost:8765') {
    this.peerId = peerId;
    this.connect(signalingUrl);
  }

  private connect(url: string): void {
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log(`[Signaling] Connected as ${this.peerId}`);
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as SignalingMessage;
          this.onMessageCallback?.(msg);
        } catch (e) {
          console.error('[Signaling] Failed to parse message:', e);
        }
      };

      this.ws.onerror = (event) => {
        const err = new Error('WebSocket error');
        console.error('[Signaling] Error:', err);
        this.onErrorCallback?.(err);
      };

      this.ws.onclose = () => {
        console.log('[Signaling] Disconnected');
        this.attemptReconnect(url);
      };
    } catch (e) {
      const err = new Error(`Failed to connect: ${e}`);
      this.onErrorCallback?.(err);
    }
  }

  private attemptReconnect(url: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.pow(2, this.reconnectAttempts) * 1000;
      console.log(`[Signaling] Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(url), delay);
    } else {
      const err = new Error('Max reconnect attempts reached');
      this.onErrorCallback?.(err);
    }
  }

  onMessage(callback: (msg: SignalingMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onError(callback: (err: Error) => void): void {
    this.onErrorCallback = callback;
  }

  async sendMessage(msg: Omit<SignalingMessage, 'peerId' | 'timestamp'>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const fullMsg: SignalingMessage = {
      ...msg,
      peerId: this.peerId,
      timestamp: Date.now(),
    };
    this.ws.send(JSON.stringify(fullMsg));
  }

  async sendOffer(targetPeerId: string, sdp: string): Promise<void> {
    await this.sendMessage({
      type: 'offer',
      targetPeerId,
      sdp,
    });
  }

  async sendAnswer(targetPeerId: string, sdp: string): Promise<void> {
    await this.sendMessage({
      type: 'answer',
      targetPeerId,
      sdp,
    });
  }

  async sendIceCandidate(targetPeerId: string, candidate: RTCIceCandidate): Promise<void> {
    await this.sendMessage({
      type: 'ice-candidate',
      targetPeerId,
      candidate,
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
}

/**
 * Local signaling server stub (for browser-based demo).
 * In production, run this on a dedicated server (Node.js, Go, etc.).
 */
export class LocalSignalingServer {
  private peers: Map<string, WebSocket> = new Map();
  private messageQueues: Map<string, SignalingMessage[]> = new Map();

  handleConnection(peerId: string, send: (data: string) => void): void {
    this.peers.set(peerId, { send } as any);
    this.messageQueues.set(peerId, []);

    // Send queued messages
    const queue = this.messageQueues.get(peerId) || [];
    queue.forEach((msg) => send(JSON.stringify(msg)));
    this.messageQueues.set(peerId, []);
  }

  handleMessage(msg: SignalingMessage): void {
    const { targetPeerId, type } = msg;
    if (!targetPeerId) return;

    const targetPeer = this.peers.get(targetPeerId);
    if (targetPeer) {
      targetPeer.send(JSON.stringify(msg));
    } else {
      // Queue message for later delivery
      const queue = this.messageQueues.get(targetPeerId) || [];
      queue.push(msg);
      this.messageQueues.set(targetPeerId, queue);
    }
  }

  disconnectPeer(peerId: string): void {
    this.peers.delete(peerId);
    this.messageQueues.delete(peerId);
  }
}
