/**
 * OpticalDataChannel: WebRTC DataChannel helpers for Wi-Fi transfer
 *
 * Implements:
 * - DataChannel message routing (control vs binary)
 * - Backpressure handling (bufferedAmount monitoring)
 * - Block announcement and retransmit requests
 * - NACK/ACK protocol for verification
 */

export interface DataChannelMessage {
  type:
    | 'block-announcement'
    | 'nack'
    | 'ack'
    | 'frame-query'
    | 'frame-response'
    | 'heartbeat';
  seq?: number;
  blockId?: string;
  fileId?: string;
  size?: number;
  checksum?: string;
  reason?: string;
  payload?: ArrayBuffer;
}

export const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MB

/**
 * Wrap RTCDataChannel with backpressure handling and message routing
 */
export class DataChannelWrapper {
  private dc: RTCDataChannel;
  private onMessageCallback?: (msg: DataChannelMessage) => void;
  private onBinaryCallback?: (data: ArrayBuffer) => void;

  constructor(dc: RTCDataChannel) {
    this.dc = dc;
    this.dc.binaryType = 'arraybuffer';

    this.dc.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as DataChannelMessage;
          this.onMessageCallback?.(msg);
        } catch (e) {
          console.error('Failed to parse DataChannel message:', e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.onBinaryCallback?.(event.data);
      }
    });
  }

  onMessage(callback: (msg: DataChannelMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onBinary(callback: (data: ArrayBuffer) => void): void {
    this.onBinaryCallback = callback;
  }

  async sendMessage(msg: DataChannelMessage): Promise<void> {
    if (this.dc.readyState !== 'open') {
      throw new Error('DataChannel not open');
    }
    this.dc.send(JSON.stringify(msg));
  }

  async sendBinary(data: ArrayBuffer): Promise<void> {
    if (this.dc.readyState !== 'open') {
      throw new Error('DataChannel not open');
    }

    // Backpressure: wait if buffered amount is high
    while (this.dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    this.dc.send(data);
  }

  async sendNACK(
    fileId: string,
    blockId: string,
    seq: number,
    reason: string
  ): Promise<void> {
    await this.sendMessage({
      type: 'nack',
      fileId,
      blockId,
      seq,
      reason,
    });
  }

  async sendACK(seq: number, blockId: string): Promise<void> {
    await this.sendMessage({
      type: 'ack',
      seq,
      blockId,
    });
  }

  async sendBlockAnnouncement(
    seq: number,
    blockId: string,
    size: number,
    checksum: string
  ): Promise<void> {
    await this.sendMessage({
      type: 'block-announcement',
      seq,
      blockId,
      size,
      checksum,
    });
  }

  isOpen(): boolean {
    return this.dc.readyState === 'open';
  }

  getBufferedAmount(): number {
    return this.dc.bufferedAmount;
  }

  close(): void {
    this.dc.close();
  }

  onStateChange(callback: (state: RTCDataChannelState) => void): void {
    this.dc.addEventListener('statechange', () => {
      callback(this.dc.readyState);
    });
  }

  onError(callback: (error: RTCErrorEvent) => void): void {
    this.dc.addEventListener('error', callback);
  }
}

/**
 * Create WebRTC peer connection for local transfer
 */
export async function createPeerConnection(): Promise<RTCPeerConnection> {
  const config: RTCConfiguration = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['stun:stun1.l.google.com:19302'] },
    ],
  };

  return new RTCPeerConnection(config);
}

/**
 * Create data channel on peer connection
 */
export function createDataChannel(
  pc: RTCPeerConnection,
  label: string = 'opticalsend'
): RTCDataChannel {
  return pc.createDataChannel(label, {
    ordered: true,
  });
}

/**
 * Setup ICE candidate gathering
 */
export async function waitForICEGathering(
  pc: RTCPeerConnection
): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
    } else {
      const handleStateChange = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', handleStateChange);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', handleStateChange);
    }
  });
}
