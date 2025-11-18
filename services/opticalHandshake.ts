/**
 * OpticalHandshake helpers
 *
 * - QR-handshake helpers: initiate sender frame, respond as receiver, finalize at sender
 * - Uses ECDH P-256, nonces, and HKDF via opticalCrypto
 *
 * Expected flow (QR):
 * 1. Sender: generate keypair + nonce, create senderFrame (uses opticalQR.createSenderHandshakeFrame)
 * 2. Receiver: scan senderFrame -> generate keypair + nonce -> compute shared secret -> derive salt = SHA256(senderNonce || receiverNonce)
 *    -> derive symmetric key -> create responseFrame (contains receiver pubkey + ack)
 * 3. Sender: scan responseFrame -> compute shared secret -> derive same salt -> derive symmetric key
 */

import {
  generateECDHKeyPair,
  exportPublicKeyBase64,
  importPublicKeyBase64,
  deriveSharedSecret,
  deriveSymmetricKey,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  computeSHA256,
  stringToArrayBuffer,
} from './opticalCrypto';
import { createReceiverHandshakeFrame } from './opticalQR';

export interface SenderHandshakeState {
  keyPair: { publicKey: CryptoKey; privateKey: CryptoKey } | null;
  pubKeyBase64?: string;
  nonceBase64?: string;
  fileSessionId?: string;
}

export interface ReceiverHandshakeResult {
  responseFrame: any;
  symKey: CryptoKey;
  receiverKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey };
  receiverPubKeyBase64: string;
  receiverNonceBase64: string;
}

/**
 * Generate a base64 nonce
 */
export function generateNonceBase64(bytes = 16): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (let i = 0; i < arr.byteLength; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

/**
 * Derive salt buffer as SHA-256(senderNonce || receiverNonce)
 */
export async function deriveSaltFromNonces(
  senderNonceBase64: string,
  receiverNonceBase64: string
): Promise<ArrayBuffer> {
  const a = base64ToArrayBuffer(senderNonceBase64);
  const b = base64ToArrayBuffer(receiverNonceBase64);
  const concat = new Uint8Array(a.byteLength + b.byteLength);
  concat.set(new Uint8Array(a), 0);
  concat.set(new Uint8Array(b), a.byteLength);
  const hash = await computeSHA256(concat.buffer);
  // convert hex string to ArrayBuffer
  const hex = hash;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

/**
 * Receiver: given a scanned senderFrame object, produce a responseFrame and symmetric key
 */
export async function respondToSenderFrame(senderFrame: any): Promise<ReceiverHandshakeResult> {
  // senderFrame must contain pubKey and nonce
  if (!senderFrame || senderFrame.type !== 'handshake' || senderFrame.role !== 'sender') {
    throw new Error('Invalid sender handshake frame');
  }

  const senderPubBase64 = senderFrame.pubKey;
  const senderNonceBase64 = senderFrame.nonce;
  const sessionId = senderFrame.fileSessionId;

  // Create receiver ephemeral keypair
  const receiverKeyPair = await generateECDHKeyPair();
  const receiverPubKeyBase64 = await exportPublicKeyBase64(receiverKeyPair.publicKey);
  const receiverNonceBase64 = generateNonceBase64(16);

  // Compute shared secret
  const senderPubKey = await importPublicKeyBase64(senderPubBase64);
  const sharedSecret = await deriveSharedSecret(receiverKeyPair.privateKey, senderPubKey);

  // Derive salt from nonces
  const salt = await deriveSaltFromNonces(senderNonceBase64, receiverNonceBase64);

  // Derive symmetric key
  // salt is ArrayBuffer already
  const symKey = await deriveSymmetricKey(sharedSecret, salt as ArrayBuffer);

  // Create response frame
  const responseFrame = createReceiverHandshakeFrame(
    sessionId,
    receiverPubKeyBase64,
    senderFrame.supportedBlockSizes?.[0] || 1024,
    senderFrame.offeredCompression?.[0] || 'gzip'
  );

  // Inject receiver nonce so sender can compute salt. Spec allows including nonce in handshake frame.
  (responseFrame as any).nonce = receiverNonceBase64;

  return {
    responseFrame,
    symKey,
    receiverKeyPair,
    receiverPubKeyBase64,
    receiverNonceBase64,
  };
}

/**
 * Sender: finalize handshake given original sender state and scanned response frame
 */
export async function finalizeSenderHandshake(
  senderKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey },
  senderNonceBase64: string,
  responseFrame: any
): Promise<CryptoKey> {
  if (!responseFrame || responseFrame.type !== 'handshake' || responseFrame.role !== 'receiver') {
    throw new Error('Invalid receiver handshake frame');
  }

  const receiverPubBase64 = responseFrame.pubKey;
  const receiverNonceBase64 = responseFrame.nonce;

  const receiverPubKey = await importPublicKeyBase64(receiverPubBase64);
  const sharedSecret = await deriveSharedSecret(senderKeyPair.privateKey, receiverPubKey);

  const salt = await deriveSaltFromNonces(senderNonceBase64, receiverNonceBase64);

  // salt is ArrayBuffer already
  const symKey = await deriveSymmetricKey(sharedSecret, salt as ArrayBuffer);

  return symKey;
}
