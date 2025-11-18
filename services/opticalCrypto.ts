/**
 * OpticalCrypto: ECDH P-256, HKDF-SHA256, AES-256-GCM using Web Crypto SubtleCrypto
 *
 * Implements:
 * - ECDH P-256 ephemeral key generation
 * - ECDH shared secret derivation
 * - HKDF-SHA256 key derivation
 * - AES-256-GCM encryption/decryption with per-block IVs
 * - SHA-256 checksums
 * - Base64 encoding/decoding for transmission
 */

export interface ECDHKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface EncryptedBlock {
  ciphertext: ArrayBuffer;
  iv: string; // base64
}

/**
 * Generate an ephemeral ECDH P-256 keypair
 */
export async function generateECDHKeyPair(): Promise<ECDHKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

/**
 * Export public key to base64 for transmission in QR/handshake
 */
export async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', publicKey);
  return arrayBufferToBase64(exported);
}

/**
 * Import a base64-encoded public key
 */
export async function importPublicKeyBase64(base64: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    'raw',
    buffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/**
 * Derive shared secret via ECDH
 */
export async function deriveSharedSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
}

/**
 * Derive AES-256-GCM symmetric key from shared secret using HKDF-SHA256
 */
export async function deriveSymmetricKey(
  sharedSecret: ArrayBuffer,
  salt: ArrayBuffer,
  info: string = 'opticalsend-v1'
): Promise<CryptoKey> {
  // Import shared secret as HMAC key
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // HKDF-Extract
  const prk = await crypto.subtle.sign('HMAC', hmacKey, salt);

  // HKDF-Expand (for 32 bytes of AES-256 key material)
  const expandHmacKey = await crypto.subtle.importKey(
    'raw',
    prk,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const infoBuffer = new TextEncoder().encode(info);
  const t1 = await crypto.subtle.sign('HMAC', expandHmacKey, infoBuffer);
  const keyMaterial = new Uint8Array(t1).slice(0, 32);

  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-256-GCM
 * @returns { ciphertext, iv (base64) }
 */
export async function encryptAESGCM(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<EncryptedBlock> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return {
    ciphertext,
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * Decrypt data with AES-256-GCM
 */
export async function decryptAESGCM(
  ciphertext: ArrayBuffer,
  key: CryptoKey,
  ivBase64: string
): Promise<ArrayBuffer> {
  const iv = base64ToArrayBuffer(ivBase64);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
}

/**
 * Compute SHA-256 checksum of data
 */
export async function computeSHA256(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToHex(hash);
}

/**
 * ECDSA P-256 sign header (optional, for integrity verification)
 */
export async function signWithECDSA(
  privateKey: CryptoKey,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  return crypto.subtle.sign('ECDSA', privateKey, data);
}

/**
 * ECDSA P-256 verify signature
 */
export async function verifyWithECDSA(
  publicKey: CryptoKey,
  signature: ArrayBuffer,
  data: ArrayBuffer
): Promise<boolean> {
  return crypto.subtle.verify('ECDSA', publicKey, signature, data);
}

// ============ Utility functions ============

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

export function stringToArrayBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

export function arrayBufferToString(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}
