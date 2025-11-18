/**
 * Unit tests for OpticalBlockManager module
 *
 * Tests:
 * - Block creation from file data
 * - Block reassembly in correct order
 * - Missing block detection
 * - Progress tracking
 * - Out-of-order delivery handling
 */

import { describe, it, expect } from 'vitest';
import {
  createBlocksFromFile,
  ReceivedBlockTracker,
  SendQueue,
} from '../services/opticalBlockManager';
import { computeSHA256, stringToArrayBuffer } from '../services/opticalCrypto';

describe('OpticalBlockManager', () => {
  describe('Block Creation', () => {
    it('should create blocks from file data', async () => {
      const fileData = new Uint8Array(5000);
      crypto.getRandomValues(fileData);

      const blocks = await createBlocksFromFile('test-file-id', fileData, 1024);

      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].seq).toBe(0);
      expect(blocks[blocks.length - 1].totalSeq).toBe(blocks.length);
    });

    it('should create single block for small files', async () => {
      const fileData = new Uint8Array(512);
      crypto.getRandomValues(fileData);

      const blocks = await createBlocksFromFile('small-file', fileData, 1024);

      expect(blocks.length).toBe(1);
      expect(blocks[0].seq).toBe(0);
      expect(blocks[0].totalSeq).toBe(1);
    });

    it('should have correct header format', async () => {
      const fileData = new Uint8Array(2048);
      const blocks = await createBlocksFromFile('test-file', fileData, 1024);

      const header = blocks[0].header;
      expect(header.protocol).toBe('opticalsend-v1');
      expect(header.fileId).toBe('test-file');
      expect(header.blockId).toBeDefined();
      expect(header.seq).toBe(0);
      expect(header.totalSeq).toBe(2);
      expect(header.compression).toMatch(/gzip|none|brotli/);
      expect(header.encryption).toBe('AES-GCM');
      expect(header.checksum).toBeDefined();
      expect(header.checksum.length).toBe(64); // hex checksum
    });

    it('should have unique block IDs', async () => {
      const fileData = new Uint8Array(5000);
      const blocks = await createBlocksFromFile('multi-block', fileData, 1024);

      const ids = blocks.map((b) => b.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('ReceivedBlockTracker', () => {
    it('should track received blocks', async () => {
      const tracker = new ReceivedBlockTracker(5);

      expect(tracker.isComplete()).toBe(false);
      expect(tracker.getMissingSequences()).toEqual([0, 1, 2, 3, 4]);

      const block = {
        fileId: 'test',
        seq: 0,
        decompressed: new Uint8Array([1, 2, 3]),
        checksum: 'abc123',
        timestamp: new Date(),
      };

      tracker.addBlock(0, block);

      expect(tracker.isComplete()).toBe(false);
      expect(tracker.getMissingSequences()).toEqual([1, 2, 3, 4]);
    });

    it('should detect completion', async () => {
      const tracker = new ReceivedBlockTracker(3);

      for (let seq = 0; seq < 3; seq++) {
        tracker.addBlock(seq, {
          fileId: 'test',
          seq,
          decompressed: new Uint8Array([seq]),
          checksum: `check${seq}`,
          timestamp: new Date(),
        });
      }

      expect(tracker.isComplete()).toBe(true);
      expect(tracker.getMissingSequences()).toEqual([]);
    });

    it('should reassemble file in correct order', async () => {
      const tracker = new ReceivedBlockTracker(3);

      // Add blocks out of order
      const blocks = [
        { data: new Uint8Array([3, 3, 3]), seq: 2 },
        { data: new Uint8Array([1, 1, 1]), seq: 0 },
        { data: new Uint8Array([2, 2, 2]), seq: 1 },
      ];

      for (const block of blocks) {
        tracker.addBlock(block.seq, {
          fileId: 'test',
          seq: block.seq,
          decompressed: block.data,
          checksum: `check${block.seq}`,
          timestamp: new Date(),
        });
      }

      const reassembled = tracker.reassembleFile();
      expect(reassembled).toEqual(
        new Uint8Array([1, 1, 1, 2, 2, 2, 3, 3, 3])
      );
    });

    it('should return null if not complete', async () => {
      const tracker = new ReceivedBlockTracker(3);

      tracker.addBlock(0, {
        fileId: 'test',
        seq: 0,
        decompressed: new Uint8Array([1]),
        checksum: 'check0',
        timestamp: new Date(),
      });

      const result = tracker.reassembleFile();
      expect(result).toBeNull();
    });

    it('should track progress', async () => {
      const tracker = new ReceivedBlockTracker(10);

      tracker.addBlock(0, {
        fileId: 'test',
        seq: 0,
        decompressed: new Uint8Array([1]),
        checksum: 'check0',
        timestamp: new Date(),
      });

      const progress = tracker.getProgress();
      expect(progress.completed).toBe(1);
      expect(progress.total).toBe(10);
      expect(progress.percentage).toBe(10);
    });
  });

  describe('SendQueue', () => {
    it('should manage block queue', async () => {
      const queue = new SendQueue();
      const fileData = new Uint8Array(3000);
      const blocks = await createBlocksFromFile('test', fileData, 1024);

      for (const block of blocks) {
        queue.add(block);
      }

      const progress = queue.getProgress();
      expect(progress.total).toBe(blocks.length);
      expect(progress.sent).toBe(0);
      expect(progress.completed).toBe(0);
    });

    it('should track block states', async () => {
      const queue = new SendQueue();
      const fileData = new Uint8Array(2000);
      const blocks = await createBlocksFromFile('test', fileData, 1024);

      queue.add(blocks[0]);
      queue.add(blocks[1]);

      queue.markSent(0, 'qr');
      queue.markCompleted(1);

      const all = queue.getAll();
      expect(all[0].sentOverQR).toBe(true);
      expect(all[1].state).toBe('completed');
    });
  });

  describe('Integration Test: Full Block Cycle', () => {
    it('should handle complete block creation, fragmentation, and reassembly', async () => {
      // Create original file
      const originalData = new Uint8Array(10000);
      crypto.getRandomValues(originalData);

      // Create blocks
      const blocks = await createBlocksFromFile(
        'integration-test',
        originalData,
        2048
      );

      // Simulate reassembly
      const tracker = new ReceivedBlockTracker(blocks.length);

      // Add blocks (simulating receive in random order)
      const indices = blocks.map((_, i) => i).sort(() => Math.random() - 0.5);

      for (const idx of indices) {
        // Decompress each block's payload
        const decompressed = blocks[idx].payload; // In real scenario, would decompress

        tracker.addBlock(idx, {
          fileId: 'integration-test',
          seq: idx,
          decompressed,
          checksum: blocks[idx].header.checksum,
          timestamp: new Date(),
        });
      }

      // Verify complete and reassembled data size
      expect(tracker.isComplete()).toBe(true);

      const reassembled = tracker.reassembleFile();
      expect(reassembled?.length).toBeGreaterThan(0);
    });
  });
});
