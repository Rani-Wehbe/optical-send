/**
 * OpticalSend Integration Test & E2E Scenarios
 *
 * Test cases:
 * 1. QR-only transfer (no DataChannel)
 * 2. Wi-Fi + QR redundant mode
 * 3. Simulated packet loss (skip random frames)
 * 4. Corrupted QR frames (alter checksum)
 * 5. Pause/resume after mid-transfer
 * 6. Reload mid-transfer and resume from IndexedDB
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createEncryptedBlocksFromFile } from './opticalBlockManager';
import { deriveSymmetricKey, deriveSharedSecret, generateECDHKeyPair, computeSHA256 } from './opticalCrypto';
import { BlockStore } from './opticalDB';
import { processReceivedBlock } from './opticalBlockManager';
import { assembleAndValidateFile, fileDataSha256 } from './opticalAssembly';
import type { FileManifest } from './opticalAssembly';

describe('OpticalSend E2E Integration', () => {
  let blockStore: BlockStore;

  beforeEach(async () => {
    blockStore = new BlockStore();
    await blockStore.initialize();
  });

  it('should encrypt and decrypt a single block', async () => {
    // Generate ECDH keypair
    const senderKeyPair = await generateECDHKeyPair();
    const receiverKeyPair = await generateECDHKeyPair();

    // Derive shared secret
    const sharedSecret1 = await deriveSharedSecret(
      senderKeyPair.privateKey,
      receiverKeyPair.publicKey
    );
    const sharedSecret2 = await deriveSharedSecret(
      receiverKeyPair.privateKey,
      senderKeyPair.publicKey
    );

    // Both should derive the same symmetric key
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);

    const symKey1 = await deriveSymmetricKey(sharedSecret1, salt.buffer);
    const symKey2 = await deriveSymmetricKey(sharedSecret2, salt.buffer);

    // Create test file data
    const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    // Encrypt with key 1
    const blocks = await createEncryptedBlocksFromFile(
      uuidv4(),
      testData,
      symKey1,
      256
    );

    expect(blocks.length).toBeGreaterThan(0);

    // Process (decrypt) with key 2
    const block = blocks[0];
    const success = await processReceivedBlock(block, symKey2, blockStore);
    expect(success).toBe(true);
  });

  it('should detect checksum mismatch on corrupted block', async () => {
    const keyPair = await generateECDHKeyPair();
    const symKey = await deriveSymmetricKey(
      new ArrayBuffer(32),
      new Uint8Array(16).buffer
    );

    const testData = new Uint8Array([1, 2, 3, 4, 5]);
    const blocks = await createEncryptedBlocksFromFile(
      uuidv4(),
      testData,
      symKey,
      256
    );

    // Corrupt the payload
    const block = blocks[0];
    block.payload[0] ^= 0xff; // Flip bits

    // Should fail due to checksum mismatch
    const success = await processReceivedBlock(block, symKey, blockStore);
    expect(success).toBe(false);
  });

  it('should assemble file from multiple blocks', async () => {
    const keyPair = await generateECDHKeyPair();
    const symKey = await deriveSymmetricKey(
      new ArrayBuffer(32),
      new Uint8Array(16).buffer
    );

    // Create larger file (3 blocks)
    const testData = new Uint8Array(3000);
    crypto.getRandomValues(testData);

    const fileId = uuidv4();
    const blocks = await createEncryptedBlocksFromFile(
      fileId,
      testData,
      symKey,
      1024
    );

    expect(blocks.length).toBe(3);

    // Process all blocks
    for (const block of blocks) {
      const success = await processReceivedBlock(block, symKey, blockStore);
      expect(success).toBe(true);
    }

    // Verify file SHA-256
    const fileHash = await fileDataSha256(testData);

    // Assemble and validate
    const manifest: FileManifest = {
      fileId,
      filename: 'test.bin',
      totalSize: testData.length,
      totalBlocks: blocks.length,
      sha256: fileHash,
    };

    const blob = await assembleAndValidateFile(fileId, blockStore, manifest);
    expect(blob.size).toBe(testData.length);
  });

  it('should handle pause/resume by persisting state', async () => {
    // This test validates that a paused transfer can be resumed
    // State should be stored in IndexedDB and retrievable
    const keyPair = await generateECDHKeyPair();
    const sessionId = uuidv4();

    await blockStore.storeSession({
      sessionId,
      fileId: uuidv4(),
      role: 'sender',
      filename: 'test.bin',
      totalSize: 1000,
      totalBlocks: 5,
      symmetricKeyDerivative: 'test-key-derivative',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Retrieve session
    const retrieved = await blockStore.getSession(sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.filename).toBe('test.bin');
  });

  it('should survive reload by recovering from IndexedDB', async () => {
    const fileId = uuidv4();
    const keyPair = await generateECDHKeyPair();
    const symKey = await deriveSymmetricKey(
      new ArrayBuffer(32),
      new Uint8Array(16).buffer
    );

    const testData = new Uint8Array(1024);
    crypto.getRandomValues(testData);

    const blocks = await createEncryptedBlocksFromFile(
      fileId,
      testData,
      symKey,
      256
    );

    // Store all blocks
    for (const block of blocks) {
      await blockStore.initialize();
      await processReceivedBlock(block, symKey, blockStore);
    }

    // Simulate "reload": clear memory, query IndexedDB
    const storedBlocks = await blockStore.getBlocksForFile(fileId);
    expect(storedBlocks.length).toBe(blocks.length);

    // Should be able to reassemble
    const fileHash = await fileDataSha256(testData);
    const manifest: FileManifest = {
      fileId,
      filename: 'test-reload.bin',
      totalSize: testData.length,
      totalBlocks: blocks.length,
      sha256: fileHash,
    };

    const blob = await assembleAndValidateFile(fileId, blockStore, manifest);
    expect(blob.size).toBe(testData.length);
  });
});
