/**
 * OpticalSenderFlow: Complete sender pipeline
 *
 * Implements:
 * - File to encrypted blocks
 * - Block queueing and transmission via QR/DataChannel
 * - NACK handling and retransmit
 * - Progress tracking and stats
 */

import { v4 as uuidv4 } from 'uuid';
import { createEncryptedBlocksFromFile, SendQueue } from './opticalBlockManager';
import type { BlockRecord } from './opticalBlockManager';
import { chunkBlockForQR, renderQRToCanvas } from './opticalQR';
import { DataChannelWrapper } from './opticalDataChannel';
import { BlockStore } from './opticalDB';
import { TransferTracker, getTransferStats } from './opticalTransfer';
import type { TransferSession } from './opticalTransfer';
import { fileDataSha256 } from './opticalAssembly';

export interface SenderPipeline {
  sessionId: string;
  fileId: string;
  filename: string;
  totalSize: number;
  totalBlocks: number;
  blocks: BlockRecord[];
  sendQueue: SendQueue;
  tracker: TransferTracker;
  blockStore: BlockStore;
  dataChannel?: DataChannelWrapper;
  symKey: CryptoKey;
  ecdhPublicKeyBase64: string;
  isPaused: boolean;
  isStopped: boolean;
}

/**
 * Create sender pipeline from files
 */
export async function initializeSenderPipeline(
  files: File[],
  symKey: CryptoKey,
  ecdhPublicKeyBase64: string,
  blockStore: BlockStore
): Promise<SenderPipeline> {
  const sessionId = uuidv4();
  let totalSize = 0;
  let totalBlocks = 0;
  const allBlocks: BlockRecord[] = [];

  for (const file of files) {
    const fileId = uuidv4();
    const fileBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(fileBuffer);

    // Create encrypted blocks
    const blocks = await createEncryptedBlocksFromFile(
      fileId,
      fileData,
      symKey,
      1024 // blockSizeBytes
    );

    allBlocks.push(...blocks);
    totalSize += file.size;
    totalBlocks += blocks.length;
  }

  const tracker = new TransferTracker({
    sessionId,
    fileId: uuidv4(),
    filename: files.map((f) => f.name).join(', '),
    totalSize,
    totalBlocks,
    role: 'sender',
    state: 'active',
    blocksCompleted: 0,
    blocksFailed: 0,
    retransmitCount: 0,
    startTime: Date.now(),
  });

  tracker.setEcdhPublicKeyAndFingerprint(ecdhPublicKeyBase64);

  return {
    sessionId,
    fileId: allBlocks[0]?.fileId || uuidv4(),
    filename: files.map((f) => f.name).join(', '),
    totalSize,
    totalBlocks,
    blocks: allBlocks,
    sendQueue: new SendQueue(),
    tracker,
    blockStore,
    symKey,
    ecdhPublicKeyBase64,
    isPaused: false,
    isStopped: false,
  };
}

/**
 * Send block via QR (renders to canvas)
 */
export async function sendBlockViaQR(
  block: BlockRecord,
  canvasElement: HTMLCanvasElement
): Promise<void> {
  const chunks = chunkBlockForQR(block.header, block.payload, 256);

  for (const chunk of chunks) {
    await renderQRToCanvas(chunk, canvasElement);
    // Hold QR frame for ~500ms for scanning
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Send block via DataChannel (fast path)
 */
export async function sendBlockViaDataChannel(
  block: BlockRecord,
  dataChannel: DataChannelWrapper
): Promise<void> {
  try {
    // Send block announcement
    await dataChannel.sendBlockAnnouncement(
      block.seq,
      block.id,
      block.payload.length,
      block.header.checksum
    );

    // Send payload (ensure plain ArrayBuffer)
    const payloadCopy = new Uint8Array(block.payload.length);
    payloadCopy.set(block.payload, 0);
    await dataChannel.sendBinary(payloadCopy.buffer);
    block.sentOverWiFi = true;
  } catch (err) {
    console.error('Failed to send via DataChannel:', err);
  }
}

/**
 * Handle NACK from receiver: resend block
 */
export async function handleNACK(
  fileId: string,
  blockId: string,
  seq: number,
  reason: string,
  pipeline: SenderPipeline,
  canvas?: HTMLCanvasElement
): Promise<void> {
  const block = pipeline.blocks.find((b) => b.id === blockId);
  if (!block) {
    console.warn(`Block ${blockId} not found`);
    return;
  }

  console.log(`[NACK] Block ${seq}: ${reason}. Retransmitting.`);
  pipeline.tracker.recordRetransmit();
  block.retransmitCount++;
  block.attempts++;

  // Retry via DataChannel if available, otherwise QR
  if (pipeline.dataChannel) {
    await sendBlockViaDataChannel(block, pipeline.dataChannel);
  } else if (canvas) {
    await sendBlockViaQR(block, canvas);
  }
}

/**
 * Pause sender
 */
export function pauseSender(pipeline: SenderPipeline): void {
  pipeline.isPaused = true;
  pipeline.tracker.pause();
}

/**
 * Resume sender
 */
export function resumeSender(pipeline: SenderPipeline): void {
  pipeline.isPaused = false;
  pipeline.tracker.resume();
}

/**
 * Stop sender
 */
export function stopSender(pipeline: SenderPipeline): void {
  pipeline.isStopped = true;
  pipeline.tracker.setState('completed');
}

/**
 * Get current sender stats
 */
export function getSenderStats(pipeline: SenderPipeline) {
  return getTransferStats(pipeline.tracker);
}
