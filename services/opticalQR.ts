/**
 * OpticalQR: QR generation, chunking, handshake frame creation
 *
 * Implements:
 * - High-quality QR generation with byte mode (qrcode library)
 * - Block-to-QR chunking for large payloads
 * - Handshake frame creation (sender/receiver)
 * - Frame reassembly helpers
 */

import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

// QR capacity in bytes (conservative estimate for version 40, ECC H)
export const MAX_QR_BYTES = 2953;
export const QR_CHUNK_SAFETY_FACTOR = 0.6;

export interface BlockHeader {
  protocol: string;
  fileId: string;
  blockId: string;
  seq: number;
  totalSeq: number;
  payloadSize: number;
  rawSize: number;
  compression: 'gzip' | 'brotli' | 'none';
  encryption: string;
  iv: string;
  kdf: string;
  checksum: string;
  timestamp: string;
}

export interface QRChunkFrame {
  type: 'chunk';
  frameType: 'chunk';
  fileId: string;
  blockId: string;
  seq: number;
  chunkIndex: number;
  chunkCount: number;
  chunkSize: number;
  checksum: string;
  payload: string; // base64-encoded binary
}

export interface BlockFrame {
  type: 'block';
  header: BlockHeader;
  payload: string; // base64-encoded binary
}

export interface HandshakeFrame {
  type: 'handshake';
  role: 'sender' | 'receiver';
  fileSessionId: string;
  pubKey: string;
  nonce: string;
  offeredCompression: string[];
  supportedBlockSizes: number[];
  timestamp: string;
  ack?: boolean;
  requestedOptions?: {
    blockSize: number;
    preferCompression: string;
  };
}

/**
 * Calculate safe QR chunk size based on max capacity and safety factor
 */
export function calculateSafeQRChunkSize(): number {
  return Math.floor(MAX_QR_BYTES * QR_CHUNK_SAFETY_FACTOR);
}

/**
 * Split block into QR chunks if necessary
 * Each chunk is a JSON frame with base64-encoded payload
 */
export function chunkBlockForQR(
  header: BlockHeader,
  payload: Uint8Array,
  maxChunkBytes: number = calculateSafeQRChunkSize()
): QRChunkFrame[] {
  // Estimate: header JSON + overhead + base64 expansion (~4/3)
  const headerJson = JSON.stringify(header);
  const estimatedHeaderSize = headerJson.length + 200;
  const availablePerChunk = Math.floor((maxChunkBytes - estimatedHeaderSize) * 0.75);

  if (payload.length <= availablePerChunk) {
    // Fits in single frame
    return [
      {
        type: 'chunk',
        frameType: 'chunk',
        fileId: header.fileId,
        blockId: header.blockId,
        seq: header.seq,
        chunkIndex: 0,
        chunkCount: 1,
        chunkSize: payload.length,
        checksum: header.checksum,
        payload: uint8ArrayToBase64(payload),
      },
    ];
  }

  // Split into multiple chunks
  const chunks: QRChunkFrame[] = [];
  const chunkCount = Math.ceil(payload.length / availablePerChunk);

  for (let i = 0; i < chunkCount; i++) {
    const start = i * availablePerChunk;
    const end = Math.min(start + availablePerChunk, payload.length);
    chunks.push({
      type: 'chunk',
      frameType: 'chunk',
      fileId: header.fileId,
      blockId: header.blockId,
      seq: header.seq,
      chunkIndex: i,
      chunkCount,
      chunkSize: end - start,
      checksum: header.checksum,
      payload: uint8ArrayToBase64(payload.slice(start, end)),
    });
  }

  return chunks;
}

/**
 * Render QR frame to canvas
 */
export async function renderQRToCanvas(
  frame: QRChunkFrame | BlockFrame | HandshakeFrame,
  canvasElement: HTMLCanvasElement,
  options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }
): Promise<void> {
  const frameJson = JSON.stringify(frame);

  await QRCode.toCanvas(canvasElement, frameJson, {
    errorCorrectionLevel: options?.errorCorrectionLevel || 'H',
    type: 'image/png',
    quality: 0.95,
    margin: 1,
    width: canvasElement.width,
  });
}

/**
 * Create handshake QR frame for sender
 */
export function createSenderHandshakeFrame(
  pubKeyBase64: string,
  supportedBlockSizes: number[] = [calculateSafeQRChunkSize(), 512, 1024]
): HandshakeFrame {
  return {
    type: 'handshake',
    role: 'sender',
    fileSessionId: uuidv4(),
    pubKey: pubKeyBase64,
    nonce: uint8ArrayToBase64(crypto.getRandomValues(new Uint8Array(16))),
    offeredCompression: ['gzip', 'none'],
    supportedBlockSizes,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create handshake response QR frame for receiver
 */
export function createReceiverHandshakeFrame(
  fileSessionId: string,
  pubKeyBase64: string,
  blockSize: number,
  preferCompression: string
): HandshakeFrame {
  return {
    type: 'handshake',
    role: 'receiver',
    fileSessionId,
    pubKey: pubKeyBase64,
    nonce: uint8ArrayToBase64(crypto.getRandomValues(new Uint8Array(16))),
    offeredCompression: ['gzip', 'none'],
    supportedBlockSizes: [blockSize],
    timestamp: new Date().toISOString(),
    ack: true,
    requestedOptions: {
      blockSize,
      preferCompression,
    },
  };
}

// ============ Utility functions ============

export function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.byteLength; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
