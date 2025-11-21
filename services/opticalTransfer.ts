/**
 * OpticalTransfer: Transfer state, progress tracking, pause/resume
 *
 * Implements:
 * - Transfer session state (pending, active, paused, completed, failed)
 * - Progress tracking per block
 * - Pause/resume state persistence
 * - ECDH fingerprint computation for UI display
 */

import { arrayBufferToHex, computeSHA256 } from './opticalCrypto';

export type TransferState = 'pending' | 'active' | 'paused' | 'completed' | 'failed';

export interface TransferSession {
  sessionId: string;
  fileId: string;
  filename: string;
  totalSize: number;
  totalBlocks: number;
  role: 'sender' | 'receiver';
  state: TransferState;
  blocksCompleted: number;
  blocksFailed: number;
  retransmitCount: number;
  startTime: number;
  pausedTime?: number;
  completedTime?: number;
  ecdhPublicKeyBase64?: string;
  ecdhFingerprint?: string; // SHA-256 of public key
  errorReason?: string;
}

export class TransferTracker {
  private session: TransferSession;
  private startTime: number;
  private pauseStartTime?: number;

  constructor(session: TransferSession) {
    this.session = session;
    this.startTime = Date.now();
  }

  getSession(): TransferSession {
    return this.session;
  }

  setState(state: TransferState, errorReason?: string): void {
    this.session.state = state;
    if (errorReason) {
      this.session.errorReason = errorReason;
    }
    if (state === 'completed') {
      this.session.completedTime = Date.now();
    }
  }

  pause(): void {
    this.session.state = 'paused';
    this.pauseStartTime = Date.now();
    this.session.pausedTime = this.pauseStartTime;
  }

  resume(): void {
    this.session.state = 'active';
    if (this.pauseStartTime) {
      const pauseDuration = Date.now() - this.pauseStartTime;
      this.startTime += pauseDuration;
    }
  }

  markBlockCompleted(): void {
    this.session.blocksCompleted++;
  }

  markBlockFailed(): void {
    this.session.blocksFailed++;
  }

  recordRetransmit(): void {
    this.session.retransmitCount++;
  }

  getElapsedSeconds(): number {
    return (Date.now() - this.startTime) / 1000;
  }

  getTransferSpeedMBps(): number {
    const elapsedSecs = this.getElapsedSeconds();
    if (elapsedSecs === 0) return 0;
    const transferredBytes = (this.session.blocksCompleted / this.session.totalBlocks) *
      this.session.totalSize;
    const transferredMB = transferredBytes / (1024 * 1024);
    return transferredMB / elapsedSecs;
  }

  getEstimatedTimeRemainingSeconds(): number {
    const speed = this.getTransferSpeedMBps();
    if (speed === 0) return 0;
    const remainingBlocks = this.session.totalBlocks - this.session.blocksCompleted;
    const remainingBytes = (remainingBlocks / this.session.totalBlocks) *
      this.session.totalSize;
    const remainingMB = remainingBytes / (1024 * 1024);
    return (remainingMB / speed);
  }

  getProgressPercent(): number {
    return Math.round(
      ((this.session.blocksCompleted - this.session.blocksFailed) /
        this.session.totalBlocks) *
        100
    );
  }

  setEcdhPublicKeyAndFingerprint(
    publicKeyBase64: string,
    publicKeyArrayBuffer?: ArrayBuffer
  ): void {
    this.session.ecdhPublicKeyBase64 = publicKeyBase64;
    if (publicKeyArrayBuffer) {
      computeSHA256(publicKeyArrayBuffer).then((fingerprint) => {
        this.session.ecdhFingerprint = fingerprint.substring(0, 16);
      });
    }
  }
}

/**
 * Format transfer statistics for UI display
 */
export interface TransferStats {
  progressPercent: number;
  blocksCompleted: number;
  blocksFailed: number;
  totalBlocks: number;
  elapsedSeconds: number;
  speedMBps: number;
  etaSeconds: number;
  retransmitCount: number;
  ecdhFingerprint?: string;
  state: TransferState;
}

export function getTransferStats(tracker: TransferTracker): TransferStats {
  const session = tracker.getSession();
  return {
    progressPercent: tracker.getProgressPercent(),
    blocksCompleted: session.blocksCompleted,
    blocksFailed: session.blocksFailed,
    totalBlocks: session.totalBlocks,
    elapsedSeconds: Math.round(tracker.getElapsedSeconds()),
    speedMBps: tracker.getTransferSpeedMBps(),
    etaSeconds: Math.round(tracker.getEstimatedTimeRemainingSeconds()),
    retransmitCount: session.retransmitCount,
    ecdhFingerprint: session.ecdhFingerprint,
    state: session.state,
  };
}
