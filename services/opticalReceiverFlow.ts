/**
 * OpticalReceiverFlow: Complete receiver pipeline
 *
 * Implements:
 * - Block reassembly from QR/DataChannel
 * - Decryption, validation, decompression
 * - NACK sending for failed blocks
 * - Progress tracking
 * - File assembly and download
 */

import { v4 as uuidv4 } from 'uuid';
import { processReceivedBlock, ReceivedBlockTracker } from './opticalBlockManager';
import type { BlockRecord, ReceivedBlockRecord } from './opticalBlockManager';
import { DataChannelWrapper } from './opticalDataChannel';
import { BlockStore } from './opticalDB';
import { TransferTracker, getTransferStats } from './opticalTransfer';
import type { TransferSession } from './opticalTransfer';
import { assembleAndValidateFile, downloadBlob, type FileManifest } from './opticalAssembly';

export interface ReceiverPipeline {
  sessionId: string;
  fileId: string;
  filename: string;
  totalSize: number;
  totalBlocks: number;
  tracker: TransferTracker;
  blockStore: BlockStore;
  dataChannel?: DataChannelWrapper;
  symKey: CryptoKey;
  ecdhPublicKeyBase64: string;
  blockTracker: ReceivedBlockTracker;
  isPaused: boolean;
  isStopped: boolean;
  manifest?: FileManifest;
}

/**
 * Initialize receiver pipeline
 */
export async function initializeReceiverPipeline(
  fileId: string,
  filename: string,
  totalSize: number,
  totalBlocks: number,
  symKey: CryptoKey,
  ecdhPublicKeyBase64: string,
  blockStore: BlockStore
): Promise<ReceiverPipeline> {
  const sessionId = uuidv4();

  const tracker = new TransferTracker({
    sessionId,
    fileId,
    filename,
    totalSize,
    totalBlocks,
    role: 'receiver',
    state: 'active',
    blocksCompleted: 0,
    blocksFailed: 0,
    retransmitCount: 0,
    startTime: Date.now(),
  });

  tracker.setEcdhPublicKeyAndFingerprint(ecdhPublicKeyBase64);

  return {
    sessionId,
    fileId,
    filename,
    totalSize,
    totalBlocks,
    tracker,
    blockStore,
    symKey,
    ecdhPublicKeyBase64,
    blockTracker: new ReceivedBlockTracker(totalBlocks),
    isPaused: false,
    isStopped: false,
  };
}

/**
 * Process received block: decrypt, validate, decompress, store
 */
export async function processReceivedBlockInPipeline(
  block: BlockRecord,
  pipeline: ReceiverPipeline,
  dataChannel?: DataChannelWrapper
): Promise<boolean> {
  const success = await processReceivedBlock(block, pipeline.symKey, pipeline.blockStore);

  if (success) {
    pipeline.tracker.markBlockCompleted();
    const receivedRecord: ReceivedBlockRecord = {
      fileId: block.fileId,
      seq: block.seq,
      decompressed: new Uint8Array(),  // Will be populated from IndexedDB
      checksum: block.header.checksum,
      timestamp: new Date(),
    };
    pipeline.blockTracker.addBlock(block.seq, receivedRecord);
  } else {
    pipeline.tracker.markBlockFailed();
    pipeline.tracker.recordRetransmit();

    // Send NACK via DataChannel if available
    if (dataChannel) {
      try {
        await dataChannel.sendNACK(
          block.fileId,
          block.id,
          block.seq,
          block.lastError || 'Failed to process block'
        );
      } catch (err) {
        console.error('Failed to send NACK:', err);
      }
    }
  }

  return success;
}

/**
 * Finalize receiver: assemble file and offer download
 */
export async function finalizeReceiverTransfer(
  pipeline: ReceiverPipeline,
  manifest: FileManifest
): Promise<void> {
  pipeline.manifest = manifest;
  pipeline.tracker.setState('pending', 'Assembling file...');

  try {
    const blob = await assembleAndValidateFile(
      pipeline.fileId,
      pipeline.blockStore,
      manifest,
      (current, total) => {
        console.log(`Assembling: ${current}/${total}`);
      }
    );

    downloadBlob(blob, manifest.filename);
    pipeline.tracker.setState('completed');
    console.log('Transfer complete. File downloaded.');
  } catch (err) {
    pipeline.tracker.setState('failed', String(err));
    console.error('Failed to finalize transfer:', err);
    throw err;
  }
}

/**
 * Pause receiver
 */
export function pauseReceiver(pipeline: ReceiverPipeline): void {
  pipeline.isPaused = true;
  pipeline.tracker.pause();
}

/**
 * Resume receiver
 */
export function resumeReceiver(pipeline: ReceiverPipeline): void {
  pipeline.isPaused = false;
  pipeline.tracker.resume();
}

/**
 * Stop receiver
 */
export function stopReceiver(pipeline: ReceiverPipeline): void {
  pipeline.isStopped = true;
  pipeline.tracker.setState('completed');
}

/**
 * Get current receiver stats
 */
export function getReceiverStats(pipeline: ReceiverPipeline) {
  return getTransferStats(pipeline.tracker);
}
