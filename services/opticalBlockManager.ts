/**
 * OpticalBlockManager: Block creation, queueing, reassembly
 *
 * Implements:
 * - Block creation from file data with compression + encryption
 * - Block state tracking (pending, sending, completed, failed)
 * - Retransmit management
 * - Received block tracking and reassembly
 */

import { v4 as uuidv4 } from 'uuid';
import { computeSHA256 } from './opticalCrypto';
import { selectBestCompression } from './opticalCompression';
import { BlockHeader, QRChunkFrame, chunkBlockForQR } from './opticalQR';

export type BlockState =
  | 'pending'
  | 'queued'
  | 'sending'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface BlockRecord {
  id: string;
  fileId: string;
  seq: number;
  totalSeq: number;
  header: BlockHeader;
  payload: Uint8Array; // encrypted compressed payload
  state: BlockState;
  attempts: number;
  sentOverQR: boolean;
  sentOverWiFi: boolean;
  verified: boolean;
  lastError?: string;
  retransmitCount: number;
}

export interface ReceivedBlockRecord {
  fileId: string;
  seq: number;
  decompressed: Uint8Array; // final decrypted, decompressed bytes
  checksum: string;
  timestamp: Date;
}

/**
 * Create blocks from file data.
 * Divides file into blocks, compresses, and prepares for encryption.
 */
export async function createBlocksFromFile(
  fileId: string,
  fileData: Uint8Array,
  blockSizeBytes: number = 1024
): Promise<BlockRecord[]> {
  const blocks: BlockRecord[] = [];
  const totalBlocks = Math.ceil(fileData.length / blockSizeBytes);

  for (let seq = 0; seq < totalBlocks; seq++) {
    const start = seq * blockSizeBytes;
    const end = Math.min(start + blockSizeBytes, fileData.length);
    const blockData = fileData.slice(start, end);

    const compressionResult = await selectBestCompression(blockData);
    const checksum = await computeSHA256(compressionResult.compressed.buffer);

    const header: BlockHeader = {
      protocol: 'opticalsend-v1',
      fileId,
      blockId: uuidv4(),
      seq,
      totalSeq: totalBlocks,
      payloadSize: compressionResult.compressed.length,
      rawSize: blockData.length,
      compression: compressionResult.type,
      encryption: 'AES-GCM',
      iv: '', // Will be set during encryption
      kdf: 'ECDH-P256',
      checksum,
      timestamp: new Date().toISOString(),
    };

    blocks.push({
      id: header.blockId,
      fileId,
      seq,
      totalSeq: totalBlocks,
      header,
      payload: compressionResult.compressed,
      state: 'pending',
      attempts: 0,
      sentOverQR: false,
      sentOverWiFi: false,
      verified: false,
      retransmitCount: 0,
    });
  }

  return blocks;
}

/**
 * Chunk blocks for QR transmission
 */
export function getQRChunksForBlock(
  block: BlockRecord,
  maxChunkBytes: number
): QRChunkFrame[] {
  return chunkBlockForQR(block.header, block.payload, maxChunkBytes);
}

/**
 * Track received blocks and detect missing
 */
export class ReceivedBlockTracker {
  private received: Map<number, ReceivedBlockRecord> = new Map();
  private totalExpected: number;

  constructor(totalBlocks: number) {
    this.totalExpected = totalBlocks;
  }

  addBlock(seq: number, data: ReceivedBlockRecord): void {
    this.received.set(seq, data);
  }

  getMissingSequences(): number[] {
    const missing: number[] = [];
    for (let seq = 0; seq < this.totalExpected; seq++) {
      if (!this.received.has(seq)) {
        missing.push(seq);
      }
    }
    return missing;
  }

  isComplete(): boolean {
    return this.received.size === this.totalExpected;
  }

  getBlocksInOrder(): Uint8Array[] {
    const blocks: Uint8Array[] = [];
    for (let seq = 0; seq < this.totalExpected; seq++) {
      const block = this.received.get(seq);
      if (block) {
        blocks.push(block.decompressed);
      }
    }
    return blocks;
  }

  reassembleFile(): Uint8Array | null {
    if (!this.isComplete()) {
      return null;
    }

    const blocks = this.getBlocksInOrder();
    const totalLength = blocks.reduce((sum, b) => sum + b.length, 0);
    const reassembled = new Uint8Array(totalLength);

    let offset = 0;
    for (const block of blocks) {
      reassembled.set(block, offset);
      offset += block.length;
    }

    return reassembled;
  }

  getProgress(): { completed: number; total: number; percentage: number } {
    return {
      completed: this.received.size,
      total: this.totalExpected,
      percentage: Math.round((this.received.size / this.totalExpected) * 100),
    };
  }
}

/**
 * Send queue manager for blocks pending transmission
 */
export class SendQueue {
  private queue: Map<number, BlockRecord> = new Map();
  private currentIndex = 0;

  add(block: BlockRecord): void {
    this.queue.set(block.seq, block);
  }

  getNext(): BlockRecord | undefined {
    if (this.currentIndex < this.queue.size) {
      return this.queue.get(this.currentIndex);
    }
    return undefined;
  }

  markSent(seq: number, medium: 'qr' | 'wifi'): void {
    const block = this.queue.get(seq);
    if (block) {
      if (medium === 'qr') {
        block.sentOverQR = true;
      } else {
        block.sentOverWiFi = true;
      }
      block.state = 'queued';
      block.attempts++;
    }
  }

  markCompleted(seq: number): void {
    const block = this.queue.get(seq);
    if (block) {
      block.state = 'completed';
      block.verified = true;
    }
  }

  markFailed(seq: number, error: string): void {
    const block = this.queue.get(seq);
    if (block) {
      block.state = 'failed';
      block.lastError = error;
    }
  }

  getProgress(): {
    sent: number;
    completed: number;
    failed: number;
    total: number;
  } {
    let sent = 0;
    let completed = 0;
    let failed = 0;

    this.queue.forEach((block) => {
      if (block.state === 'completed') completed++;
      else if (block.state === 'failed') failed++;
      else if (block.sentOverQR || block.sentOverWiFi) sent++;
    });

    return {
      sent,
      completed,
      failed,
      total: this.queue.size,
    };
  }

  getAll(): BlockRecord[] {
    return Array.from(this.queue.values());
  }

  clear(): void {
    this.queue.clear();
    this.currentIndex = 0;
  }
}
