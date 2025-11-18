/**
 * Unit tests for OpticalCrypto module
 *
 * Tests:
 * - ECDH keypair generation
 * - Public key export/import
 * - Shared secret derivation (identical on both sides)
 * - Symmetric key derivation via HKDF
 * - AES-GCM encryption/decryption
 * - SHA-256 checksums
 */

import { describe, it, expect } from 'vitest';
import {
  generateECDHKeyPair,
  exportPublicKeyBase64,
  importPublicKeyBase64,
  deriveSharedSecret,
  deriveSymmetricKey,
  encryptAESGCM,
  decryptAESGCM,
  computeSHA256,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  stringToArrayBuffer,
  arrayBufferToString,
} from '../services/opticalCrypto';

describe('OpticalCrypto', () => {
  describe('ECDH Keypair Generation', () => {
    it('should generate valid ECDH P-256 keypairs', async () => {
      const kp = await generateECDHKeyPair();
      expect(kp.publicKey).toBeDefined();
      expect(kp.privateKey).toBeDefined();
      expect(kp.publicKey.type).toBe('public');
      expect(kp.privateKey.type).toBe('private');
    });
  });

  describe('Public Key Export/Import', () => {
    it('should export and import public keys', async () => {
      const kp = await generateECDHKeyPair();
      const base64 = await exportPublicKeyBase64(kp.publicKey);

      expect(typeof base64).toBe('string');
      expect(base64.length > 0).toBe(true);

      const importedKey = await importPublicKeyBase64(base64);
      expect(importedKey).toBeDefined();
      expect(importedKey.type).toBe('public');
    });
  });

  describe('ECDH Shared Secret', () => {
    it('should derive identical shared secrets on both sides', async () => {
      const kpSender = await generateECDHKeyPair();
      const kpReceiver = await generateECDHKeyPair();

      // Sender derives shared secret with receiver's public key
      const sharedSender = await deriveSharedSecret(
        kpSender.privateKey,
        kpReceiver.publicKey
      );

      // Receiver derives shared secret with sender's public key
      const sharedReceiver = await deriveSharedSecret(
        kpReceiver.privateKey,
        kpSender.publicKey
      );

      const senderBase64 = arrayBufferToBase64(sharedSender);
      const receiverBase64 = arrayBufferToBase64(sharedReceiver);

      expect(senderBase64).toBe(receiverBase64);
    });
  });

  describe('Symmetric Key Derivation (HKDF)', () => {
    it('should derive identical symmetric keys from same shared secret', async () => {
      // Create a test shared secret
      const sharedSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;
      const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;

      // Derive keys on both "sides"
      const key1 = await deriveSymmetricKey(sharedSecret, salt);
      const key2 = await deriveSymmetricKey(sharedSecret, salt);

      // Both should work for encryption/decryption
      const testData = stringToArrayBuffer('Hello, World!');
      const encrypted = await encryptAESGCM(testData, key1);
      const decrypted = await decryptAESGCM(
        encrypted.ciphertext,
        key2,
        encrypted.iv
      );

      expect(arrayBufferToString(decrypted)).toBe('Hello, World!');
    });
  });

  describe('AES-GCM Encryption/Decryption', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const sharedSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;
      const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
      const key = await deriveSymmetricKey(sharedSecret, salt);

      const plaintext = stringToArrayBuffer('Test message for encryption');
      const encrypted = await encryptAESGCM(plaintext, key);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.ciphertext.byteLength > 0).toBe(true);

      const decrypted = await decryptAESGCM(
        encrypted.ciphertext,
        key,
        encrypted.iv
      );

      expect(arrayBufferToString(decrypted)).toBe('Test message for encryption');
    });

    it('should produce different ciphertexts with different IVs', async () => {
      const sharedSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;
      const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
      const key = await deriveSymmetricKey(sharedSecret, salt);

      const plaintext = stringToArrayBuffer('Same message');
      const encrypted1 = await encryptAESGCM(plaintext, key);
      const encrypted2 = await encryptAESGCM(plaintext, key);

      // Different IVs should produce different ciphertexts
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(
        arrayBufferToBase64(encrypted1.ciphertext)
      ).not.toBe(arrayBufferToBase64(encrypted2.ciphertext));

      // Both should decrypt to same plaintext
      const decrypted1 = await decryptAESGCM(
        encrypted1.ciphertext,
        key,
        encrypted1.iv
      );
      const decrypted2 = await decryptAESGCM(
        encrypted2.ciphertext,
        key,
        encrypted2.iv
      );

      expect(arrayBufferToString(decrypted1)).toBe('Same message');
      expect(arrayBufferToString(decrypted2)).toBe('Same message');
    });
  });

  describe('SHA-256 Checksum', () => {
    it('should compute consistent SHA-256 checksums', async () => {
      const data1 = stringToArrayBuffer('test data');
      const data2 = stringToArrayBuffer('test data');
      const data3 = stringToArrayBuffer('different data');

      const checksum1 = await computeSHA256(data1);
      const checksum2 = await computeSHA256(data2);
      const checksum3 = await computeSHA256(data3);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).not.toBe(checksum3);
      expect(checksum1.length).toBe(64); // hex string
    });
  });

  describe('Base64 Encoding/Decoding', () => {
    it('should encode and decode ArrayBuffer correctly', () => {
      const original = crypto.getRandomValues(new Uint8Array(32));
      const encoded = arrayBufferToBase64(original.buffer);
      const decoded = base64ToArrayBuffer(encoded);
      const decodedArray = new Uint8Array(decoded);

      expect(decodedArray).toEqual(original);
    });

    it('should handle string encoding correctly', () => {
      const original = 'Hello, World! 🌍';
      const buffer = stringToArrayBuffer(original);
      const result = arrayBufferToString(buffer);

      expect(result).toBe(original);
    });
  });

  describe('Integration Test: Full Handshake Flow', () => {
    it('should complete a full ECDH handshake with symmetric key derivation', async () => {
      // Sender side
      const senderKeyPair = await generateECDHKeyPair();
      const senderPubKey = await exportPublicKeyBase64(senderKeyPair.publicKey);

      // Receiver side
      const receiverKeyPair = await generateECDHKeyPair();
      const receiverPubKey = await exportPublicKeyBase64(
        receiverKeyPair.publicKey
      );

      // Both derive shared secret
      const senderImportedReceiverPub = await importPublicKeyBase64(
        receiverPubKey
      );
      const receiverImportedSenderPub = await importPublicKeyBase64(senderPubKey);

      const sharedSender = await deriveSharedSecret(
        senderKeyPair.privateKey,
        senderImportedReceiverPub
      );
      const sharedReceiver = await deriveSharedSecret(
        receiverKeyPair.privateKey,
        receiverImportedSenderPub
      );

      // Both derive same salt and symmetric key
      const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;

      const senderSymKey = await deriveSymmetricKey(sharedSender, salt);
      const receiverSymKey = await deriveSymmetricKey(sharedReceiver, salt);

      // Test that they can communicate securely
      const message = stringToArrayBuffer(
        'Secure message from sender to receiver'
      );
      const encrypted = await encryptAESGCM(message, senderSymKey);
      const decrypted = await decryptAESGCM(
        encrypted.ciphertext,
        receiverSymKey,
        encrypted.iv
      );

      expect(arrayBufferToString(decrypted)).toBe(
        'Secure message from sender to receiver'
      );
    });
  });
});
