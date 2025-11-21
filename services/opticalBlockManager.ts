import { decryptAESGCM } from './opticalCrypto';
import { decompress } from './opticalCompression';
import { BlockStore } from './opticalDB';
/**
 * Process a received block: decrypt, validate, decompress, store, and mark complete.
 * If checksum fails, returns false (should enqueue retransmit).
 */
export async function processReceivedBlock(
  block: BlockRecord,
  symKey: CryptoKey,
  blockStore: BlockStore
): Promise<boolean> {
  try {
    // Decrypt (ensure ArrayBuffer, not SharedArrayBuffer)
    const payloadCopy = new Uint8Array(block.payload.length);
    payloadCopy.set(block.payload, 0);
    const decrypted = await decryptAESGCM(
      payloadCopy.buffer,
      symKey,
      block.header.iv
    );
    // Validate checksum
    const checksum = await computeSHA256(decrypted);
    if (checksum !== block.header.checksum) {
      block.state = 'failed';
      block.lastError = 'Checksum mismatch';
      block.retransmitCount++;
      return false;
    }
    // Decompress
    const decompressed = await decompress(
      new Uint8Array(decrypted),
      block.header.compression
    );
    // Store in IndexedDB
    // Ensure decompressed is a plain ArrayBuffer
    const decompressedCopy = new Uint8Array(decompressed.length);
    decompressedCopy.set(decompressed, 0);
    const payloadCopy2 = new Uint8Array(block.payload.length);
    payloadCopy2.set(block.payload, 0);
    await blockStore.storeBlock({
      fileId: block.fileId,
      seq: block.seq,
      header: JSON.stringify(block.header),
      payload: payloadCopy2.buffer,
      state: block.state,
      decompressed: decompressedCopy.buffer,
    });
    block.state = 'completed';
    block.verified = true;
    return true;
  } catch (err) {
    block.state = 'failed';
    block.lastError = String(err);
    block.retransmitCount++;
    return false;
  }
}
import { encryptAESGCM, base64ToArrayBuffer } from './opticalCrypto';
/**
 * Create encrypted blocks from file data using AES-GCM and provided symmetric key.
 * Each block is compressed, then encrypted with a random IV.
 */
export async function createEncryptedBlocksFromFile(
  fileId: string,
  fileData: Uint8Array,
  symKey: CryptoKey,
  blockSizeBytes: number = 1024
): Promise<BlockRecord[]> {
  const blocks: BlockRecord[] = [];
  const totalBlocks = Math.ceil(fileData.length / blockSizeBytes);

  for (let seq = 0; seq < totalBlocks; seq++) {
    const start = seq * blockSizeBytes;
    const end = Math.min(start + blockSizeBytes, fileData.length);
    const blockData = fileData.slice(start, end);

    const compressionResult = await selectBestCompression(blockData);
    const comp = compressionResult.compressed;
    const compCopy = new Uint8Array(comp.byteLength);
    compCopy.set(comp, 0);
    const checksum = await computeSHA256(compCopy.buffer);

    // Encrypt compressed block
    const encrypted = await encryptAESGCM(compCopy.buffer, symKey);

    const header: BlockHeader = {
      protocol: 'opticalsend-v1',
      fileId,
      blockId: uuidv4(),
      seq,
      totalSeq: totalBlocks,
      payloadSize: encrypted.ciphertext.byteLength,
      rawSize: blockData.length,
      compression: compressionResult.type,
      encryption: 'AES-GCM',
      iv: encrypted.iv,
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
      payload: new Uint8Array(encrypted.ciphertext),
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
import type { BlockHeader, QRChunkFrame } from './opticalQR';
import { chunkBlockForQR } from './opticalQR';

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
    // Ensure we pass a proper ArrayBuffer (slice view) to computeSHA256
    const comp = compressionResult.compressed;
    // Create a contiguous ArrayBuffer copy to avoid SharedArrayBuffer or offset issues
    const compCopy = new Uint8Array(comp.byteLength);
    compCopy.set(comp, 0);
    const checksum = await computeSHA256(compCopy.buffer);

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
