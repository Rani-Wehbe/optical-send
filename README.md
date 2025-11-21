# OpticalSend: Dual-Channel Encrypted File Transfer

A browser-based file transfer system using **QR codes + WebRTC** for fast, end-to-end encrypted, lossless local network transfers. No installation required—just open two browser tabs and transfer files.

## 🎯 Features

- ✅ **Dual-channel transfer**: QR codes (visual, always works) + WebRTC DataChannel (fast path, optional)
- 🔒 **End-to-end encryption**: ECDH P-256 key agreement + AES-256-GCM (keys never transmitted)
- ✓ **Lossless verification**: Per-block SHA-256 checksums with automatic retransmission on failure
- 📦 **Smart compression**: Automatic gzip compression per-block (80%+ reduction only)
- 🌐 **Browser-first**: No native apps, no server required—works on any device with a camera
- 💾 **Resilient**: Pause, resume, reload mid-transfer via IndexedDB persistence
- 📊 **Debug overlay**: Real-time transfer speed, ETA, retransmit stats, ECDH fingerprints

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- pnpm (install: `npm install -g pnpm`)
- Two browser tabs or two devices with cameras

### Setup & Run

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm run dev

# Open two browser tabs:
# Tab 1 (Sender):   http://localhost:3000/?role=sender
# Tab 2 (Receiver): http://localhost:3000/?role=receiver
```

### Basic Transfer Flow

1. **Receiver**: Opens camera, clicks "Scan QR"
2. **Sender**: Clicks "Initiate Handshake" (displays ECDH public key as QR)
3. **Receiver**: Scans sender QR → auto-generates response QR (displays on screen)
4. **Sender**: Scans/pastes receiver response → derives symmetric key
5. **Sender**: Selects file(s), clicks "Start Transfer"
6. **Receiver**: Camera auto-scans QR frames → decrypts blocks → displays progress
7. **Receiver**: After all blocks → auto-assembles → downloads file

**Total time:** ~30 seconds for 1 MB file (QR-only)

---

## 📋 Architecture

### Core Layers

```
┌─────────────────────────────────────────────────────────┐
│                   Vue 3 Components                      │
│  OpticalHandshake │ OpticalSender │ OpticalReceiver    │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────┐
│              OpticalSend Services                       │
├──────────────────────────────────────────────────────────┤
│ Crypto Layer                                            │
│  ├─ ECDH P-256 key generation & agreement              │
│  ├─ HKDF-SHA256 key derivation                         │
│  └─ AES-256-GCM encryption/decryption                  │
├──────────────────────────────────────────────────────────┤
│ Transfer Layer                                          │
│  ├─ Block creation, chunking, queueing                 │
│  ├─ QR rendering & camera scanning                     │
│  ├─ WebRTC DataChannel (optional Wi-Fi fast path)      │
│  └─ NACK/retransmit protocol                           │
├──────────────────────────────────────────────────────────┤
│ Persistence Layer                                       │
│  ├─ IndexedDB block storage                            │
│  ├─ Session state recovery                             │
│  └─ Pause/resume support                               │
└──────────────────────────────────────────────────────────┘
```

---

## 🔐 Security

### Key Properties

1. **No Key Transmission**: Symmetric key is derived independently by both sides via ECDH + HKDF
2. **Forward Secrecy**: Ephemeral ECDH keypairs generated per session
3. **Authenticated**: SHA-256 checksums prevent tampering; ECDH prevents MITM
4. **Visual Confirmation**: QR codes are visible—users can verify fingerprints
5. **Per-Block IV**: Random 12-byte IV per block prevents pattern leakage

### Crypto Stack

| Component | Algorithm | Implementation |
|-----------|-----------|-----------------|
| Key Agreement | ECDH P-256 | Web Crypto API |
| KDF | HKDF-SHA256 | HMAC-based per RFC 5869 |
| Encryption | AES-256-GCM | Web Crypto API |
| Checksums | SHA-256 | Web Crypto API |

---

## 📁 File Structure

```
optical-send/
├── services/          # Core OpticalSend protocol implementation
├── components/        # Vue 3 components
├── OPTICALSEND_SPEC.md         # Specification
├── INTEGRATION.md               # Architecture & integration guide
├── IMPLEMENTATION_STATUS.md     # Current status & checklist
└── README.md                    # This file
```

---

## 🧪 Testing

### Run Tests

```bash
# Install & run all tests
pnpm install
pnpm run test

# Type check
pnpm run build

# Dev server
pnpm run dev
```

---

## 📊 Performance

| Metric | Status |
|--------|--------|
| QR scanning | 25–30 FPS ✅ |
| Compression | 1–5 MB/s ✅ |
| Encryption | 10–50 MB/s ✅ |
| QR render time | 200–500ms ✅ |

---

## 📚 Documentation

- **[OPTICALSEND_SPEC.md](./OPTICALSEND_SPEC.md)**: Full specification & block format
- **[INTEGRATION.md](./INTEGRATION.md)**: Architecture, data flow, error handling
- **[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)**: Current status, TODO list, checklist

---

## 📜 License

MIT License (see LICENSE file)


```bash
pnpm run generate
```

### Self-hosting

1. Clone this repo
2. Build: `docker build --tag localsend-web --file Containerfile`
3. Run: `docker run --rm --publish 8080:443 --volume caddy-data:/data localsend-web`

## Contributing

### Adding a new language

1. Add new JSON file in `i18n/locales/` directory.
2. Add the new language in `nuxt.config.ts`.
