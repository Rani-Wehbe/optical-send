# OpticalSend Prototype

A browser-based file transfer system using QR codes and Wi-Fi for fast, encrypted, lossless local network transfers. This implementation follows the official OpticalSend specification exactly.

## 🎯 Features

- **Dual-channel transfer**: QR codes + WebRTC DataChannel simultaneously
- **End-to-end encryption**: ECDH P-256 key agreement + AES-256-GCM
- **Lossless verification**: Per-block checksums with automatic retransmission
- **Smart compression**: Auto-selecting gzip compression per-block
- **Browser-first**: No native apps required
- **Resilient**: Resume interrupted transfers via IndexedDB
- **Debug overlay**: Real-time metrics and status tracking

## 🏗️ Architecture

### Core Modules

```
services/
├── opticalCrypto.ts          # ECDH P-256, HKDF-SHA256, AES-GCM
├── opticalCompression.ts     # Gzip/none auto-selection
├── opticalQR.ts              # QR generation, chunking, handshake
├── opticalScanner.ts         # Camera capture + jsQR scanning
├── opticalBlockManager.ts    # Block queueing, creation, reassembly
├── opticalDataChannel.ts     # WebRTC DataChannel + backpressure
└── opticalDB.ts              # IndexedDB persistence + recovery

components/
├── OpticalHandshake.vue      # ECDH handshake UI
├── OpticalSender.vue         # File selection & transfer
└── OpticalReceiver.vue       # Camera scanning & reception
```

### Block Format (Specification)

Each block contains a JSON header + encrypted payload:

```json
{
  "protocol": "opticalsend-v1",
  "fileId": "<uuidv4>",
  "blockId": "<uuidv4>",
  "seq": 0,
  "totalSeq": 10,
  "payloadSize": 1024,
  "rawSize": 2048,
  "compression": "gzip",
  "encryption": "AES-GCM",
  "iv": "<base64-12-bytes>",
  "kdf": "ECDH-P256",
  "checksum": "<sha256-hex>",
  "timestamp": "<iso8601>"
}
```

**Payload Structure**: `encrypted(compressed(file_data))`

### Handshake Flow (QR-based)

#### Sender → Receiver (QR Frame 1)
```json
{
  "type": "handshake",
  "role": "sender",
  "fileSessionId": "<uuid>",
  "pubKey": "<base64-sender-ecdh-pubkey>",
  "nonce": "<random>",
  "offeredCompression": ["gzip", "none"],
  "supportedBlockSizes": [1771, 512, 1024],
  "timestamp": "<iso8601>"
}
```

#### Receiver → Sender (QR Frame 2)
```json
{
  "type": "handshake",
  "role": "receiver",
  "fileSessionId": "<uuid>",
  "pubKey": "<base64-receiver-ecdh-pubkey>",
  "ack": true,
  "requestedOptions": {
    "blockSize": 1024,
    "preferCompression": "gzip"
  }
}
```

Both peers then:
1. Derive shared secret via ECDH
2. Derive symmetric AES-256-GCM key via HKDF-SHA256
3. Begin block transfer

## 🚀 Getting Started

### Installation

```bash
cd /Users/raniwehbe/Desktop/optical-send
pnpm install
```

### Development

```bash
pnpm run dev
```

Opens at `http://localhost:3000`

### Build

```bash
pnpm run build
```

### Testing

```bash
pnpm run test
```

Runs all unit tests for crypto, compression, and block reassembly.

## 📋 E2E Demo (Manual Testing)

### Scenario: Transfer a 5MB file over QR + Wi-Fi

#### Device A (Sender)
1. Open `http://localhost:3000` in browser
2. Ensure button shows **📤 Sender** (click if needed)
3. Click **▶ Start Handshake**
4. A QR code appears on screen

#### Device B (Receiver)
1. Open `http://localhost:3000` on another device/tab
2. Click **📥 Receiver**
3. Position camera to scan the sender's QR code
4. Green checkmark appears when scan complete

#### Back to Device A
1. Camera automatically scans receiver's response QR (or waits for Wi-Fi fallback)
2. Handshake complete, symmetric key derived
3. Select file (drag & drop or click)
4. Click **▶ Start Transfer**

#### Device B
- Camera continuously scans QR frames
- Blocks display as they arrive
- Missing blocks requested over Wi-Fi
- Progress bar updates
- On completion: **Download** button appears

### Testing Block Loss Simulation

To verify retransmission:
1. During transfer, cover receiver's camera
2. App detects missing blocks via timeout
3. Missing blocks requested over DataChannel
4. Transfer completes despite QR loss

## 🔐 Security Details

### Cryptography Stack

| Operation | Algorithm | Library |
|-----------|-----------|---------|
| Key Exchange | ECDH P-256 | Web Crypto SubtleCrypto |
| Key Derivation | HKDF-SHA256 | Web Crypto SubtleCrypto |
| Symmetric Encryption | AES-256-GCM | Web Crypto SubtleCrypto |
| Checksums | SHA-256 | Web Crypto SubtleCrypto |
| Optional Signing | ECDSA P-256 | Web Crypto SubtleCrypto |

### Key Properties

- **Per-block IVs**: 12-byte random IV for each AES-GCM operation (96 bits)
- **Per-file key**: One symmetric key per file, derived via HKDF
- **IV Reuse Prevention**: Each block gets unique IV (never reuse IV with same key)
- **Tag Length**: 128 bits (16 bytes) AES-GCM authentication tag
- **No Persistence**: Symmetric keys held in memory only (unless user opts in)

## 📦 Transfer Details

### Block Sizing

**Auto-detection** on handshake:
- QR capacity test: Measure max bytes camera can reliably scan
- Safety factor: 60% of max to account for noise
- Default range: 512–1771 bytes per QR

### Chunking

If block > QR capacity:
1. Split into `m` QR-chunks
2. Each chunk gets header with `chunkIndex`, `chunkCount`
3. Receiver reassembles chunks into block
4. Block then decrypted & decompressed

### Flow Control (Backpressure)

- DataChannel monitored: if `bufferedAmount > 1 MB`, sender pauses
- QR transmission continues independently
- Resume when buffer drains

### Retransmission Policy

- **Max attempts**: 5 per block
- **Priority**: DataChannel (faster) > QR (fallback)
- **NACK format**: `{type:"nack", fileId, blockId, seq, reason}`
- **After max attempts**: Block marked `skipped`, transfer continues
- **Final check**: Full-file SHA-256 verified at end

## 🛠️ Module Reference

### `opticalCrypto.ts`

**Key Functions**:
- `generateECDHKeyPair()` → ECDHKeyPair
- `exportPublicKeyBase64(key)` → string
- `deriveSharedSecret(privKey, pubKey)` → ArrayBuffer
- `deriveSymmetricKey(sharedSecret, salt)` → CryptoKey
- `encryptAESGCM(data, key)` → EncryptedBlock
- `decryptAESGCM(ciphertext, key, iv)` → ArrayBuffer
- `computeSHA256(data)` → hex string

**Unit Tests**: `opticalCrypto.test.ts`
- ✅ ECDH keypair generation
- ✅ Identical shared secrets on both sides
- ✅ HKDF symmetric key derivation
- ✅ AES-GCM encryption/decryption
- ✅ SHA-256 checksums
- ✅ Full handshake integration

### `opticalCompression.ts`

**Key Functions**:
- `compress(data, algorithm)` → Uint8Array
- `decompress(data, algorithm)` → Uint8Array
- `selectBestCompression(data)` → CompressionResult

**Algorithms**:
- `gzip`: Pako (deflate)
- `none`: Passthrough
- `brotli`: Reserved for future

**Unit Tests**: `opticalCompression.test.ts`
- ✅ Gzip round-trip
- ✅ Auto-selection heuristic (>5% savings threshold)
- ✅ Incompressible data fallback

### `opticalQR.ts`

**Key Functions**:
- `createSenderHandshakeFrame(pubKey)` → HandshakeFrame
- `createReceiverHandshakeFrame(sessionId, pubKey, ...)` → HandshakeFrame
- `chunkBlockForQR(header, payload)` → QRChunkFrame[]
- `renderQRToCanvas(frame, canvas)` → Promise<void>

**QR Library**: `qrcode` (v1.5.3)
- Error correction: H (high)
- Mode: Byte (binary)
- Max capacity: ~2953 bytes

### `opticalScanner.ts`

**Key Class**: `CameraScanner`
- `initialize(videoElement)` → Promise<void>
- `start(onScan)` → void
- `stop()` → void
- `getMetrics()` → {framesPerSecond, totalFrames}
- `toggleTorch(on)` → Promise<void>

**Scanner Library**: `jsqr` (v1.4.0)
- Continuous frame capture
- Real-time FPS metrics
- Torch/flashlight support

### `opticalBlockManager.ts`

**Key Functions**:
- `createBlocksFromFile(fileId, data, blockSize)` → BlockRecord[]
- `getQRChunksForBlock(block, maxChunkBytes)` → QRChunkFrame[]

**Key Classes**:
- `ReceivedBlockTracker`: Manages received blocks, detects missing
- `SendQueue`: Manages block transmission state

**Unit Tests**: `opticalBlockManager.test.ts`
- ✅ Block creation from file
- ✅ Out-of-order reassembly
- ✅ Missing block detection
- ✅ Progress tracking

### `opticalDataChannel.ts`

**Key Class**: `DataChannelWrapper`
- `sendMessage(msg)` → Promise<void>
- `sendBinary(data)` → Promise<void> (with backpressure)
- `sendNACK(fileId, blockId, seq, reason)` → Promise<void>
- `sendACK(seq, blockId)` → Promise<void>

**Control Messages**:
```typescript
type: 'block-announcement' | 'nack' | 'ack' | 'frame-query' | 'heartbeat'
```

### `opticalDB.ts`

**Key Class**: `BlockStore`
- `initialize()` → Promise<void>
- `storeBlock(block)` → Promise<void>
- `getBlocksForFile(fileId)` → Promise<StoredBlock[]>
- `storeSession(session)` → Promise<void>
- `getSession(sessionId)` → Promise<StoredSession | undefined>

**Data Stores**:
- `blocks`: Indexed by (fileId, seq)
- `sessions`: Indexed by sessionId

## 🧪 Test Coverage

Run all tests:
```bash
pnpm run test
```

### Test Files

1. **opticalCrypto.test.ts** (8 tests)
   - ECDH key generation and export/import
   - Shared secret derivation (both sides identical)
   - Symmetric key HKDF derivation
   - AES-GCM round-trip encryption
   - SHA-256 checksums
   - Full handshake integration

2. **opticalCompression.test.ts** (5 tests)
   - Gzip compression and decompression
   - Auto-selection heuristic
   - Incompressible data handling
   - Compression ratio calculation

3. **opticalBlockManager.test.ts** (9 tests)
   - Block creation from file
   - ReceivedBlockTracker: in-order and out-of-order reassembly
   - Missing block detection
   - SendQueue state management
   - Full cycle integration test

### Running Specific Tests

```bash
pnpm run test -- opticalCrypto.test.ts
pnpm run test -- opticalCompression.test.ts
pnpm run test -- opticalBlockManager.test.ts
```

## 📊 Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| QR FPS | 30+ | Continuous scanning |
| Block/sec (QR only) | 2–5 | Depends on QR complexity |
| Block/sec (QR + Wi-Fi) | 10–20 | Parallel dual channels |
| Latency (handshake) | <1 sec | QR scan + parse |
| Max block size | 1771 bytes | QR capacity × 0.6 safety |
| Compression ratio | >5% | Threshold for using gzip |

## 🐛 Debug Mode

**Browser DevTools**:
- Open Inspector → Console
- All errors logged with `[OpticalSend]` prefix
- Metrics printed every second during transfer

**Debug Panel** (right sidebar):
- Real-time role indicator
- Camera/WebRTC/IndexedDB availability status
- Current timestamp

## 🔄 Resume & Recovery

If page reloads during transfer:

1. **Receiver** opens app → queries IndexedDB for stored blocks
2. **Sender** initiates new handshake
3. **Exchange**: Receiver sends list of already-received seq numbers
4. **Resume**: Sender skips completed blocks, resends missing only

*Implementation note*: Resume protocol in `opticalDataChannel.ts` and `opticalDB.ts`

## 📝 Edge Cases Handled

✅ **No camera**: Fall back to Wi-Fi DataChannel only
✅ **No Wi-Fi**: Fall back to QR scanning only
✅ **QR frame lost**: Automatic NACK request over DataChannel
✅ **Decryption failure**: Retry up to 5 times, then skip block
✅ **Large files**: Automatic chunking into 1024-byte blocks
✅ **Small incompressible files**: Stored raw (no gzip overhead)
✅ **Page reload**: IndexedDB recovery on next open

## 🚧 Future Enhancements

- [ ] Brotli compression support
- [ ] ECDSA header signatures
- [ ] Passphrase mode (PBKDF2 key derivation)
- [ ] TURN server support for NAT traversal
- [ ] Mobile app wrapper (React Native)
- [ ] Batch file transfers
- [ ] Priority block queueing
- [ ] Adaptive block sizing based on measured throughput

## 📄 License

MIT

## 📚 References

- [RFC 3394: ECDH](https://tools.ietf.org/html/rfc3394)
- [RFC 5869: HKDF](https://tools.ietf.org/html/rfc5869)
- [NIST SP 800-38D: GCM](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [Web Crypto API](https://www.w3.org/TR/WebCryptoAPI/)
- [WebRTC DataChannel](https://www.w3.org/TR/webrtc/)
- [QR Code Standard (ISO/IEC 18004)](https://www.iso.org/standard/62115.html)

---

**Built with ❤️ for fast, private, local file transfers**
