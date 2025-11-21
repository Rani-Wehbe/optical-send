<template>
  <div class="border rounded-lg p-6 bg-gradient-to-br from-blue-50 to-purple-50 mb-6">
    <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
      <span>🤝</span>
      <span>Handshake</span>
    </h2>

    <p class="text-sm text-gray-600 mb-4">
      Start a handshake to establish connection and derive encryption keys.
    </p>

    <div class="space-y-4">
      <!-- Mode Selection -->
      <div class="flex gap-4 mb-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            v-model="selectedMode"
            type="radio"
            value="qr"
            class="w-4 h-4"
          />
          <span class="text-sm">📱 QR Code (camera-based, no network needed)</span>
        </label>
      </div>

      <!-- Handshake Button -->
      <button
        @click="startHandshake"
        :disabled="isHandshaking"
        class="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg font-bold hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        <span v-if="!isHandshaking">▶ Start Handshake</span>
        <span v-else>⏳ Handshaking...</span>
      </button>

      <!-- Handshake QR Display -->
      <div
        v-if="handshakeQR && showQR"
        class="bg-white rounded-lg p-4 border-2 border-gray-300"
      >
        <div class="text-sm font-semibold mb-3">
          📸 Show this QR code to receiver
        </div>
        <canvas
          ref="qrCanvas"
          :width="300"
          :height="300"
          class="w-full border-2 border-gray-300 rounded-lg mx-auto"
        />
        <div class="text-xs text-gray-500 mt-3 text-center">
          Session ID: {{ sessionId?.slice(0, 8) }}...
        </div>
        <div class="mt-4">
          <label class="block text-sm font-semibold mb-2">Paste receiver response JSON (or camera scan result)</label>
          <textarea v-model="responseJson" rows="4" class="w-full border rounded p-2 text-xs font-mono" placeholder='{"type":"handshake", "role":"receiver", ...}'></textarea>
          <div class="flex gap-2 mt-2">
            <button @click="finalizeHandshake" :disabled="isFinalizing" class="px-4 py-2 bg-green-600 text-white rounded">Finalize Handshake</button>
            <button @click="() => { responseJson = '' }" class="px-4 py-2 bg-gray-200 rounded">Clear</button>
          </div>
        </div>
      </div>

      <!-- Status Messages -->
      <div v-if="statusMessage" class="text-sm" :class="statusClass">
        {{ statusMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { generateECDHKeyPair, exportPublicKeyBase64, arrayBufferToBase64 } from '~/services/opticalCrypto';
import { createSenderHandshakeFrame, renderQRToCanvas } from '~/services/opticalQR';
import { finalizeSenderHandshake } from '~/services/opticalHandshake';

const emit = defineEmits<{
  'handshake-complete': [pubKey: string, sessionId: string, symKeyBase64?: string];
}>();

const selectedMode = ref<'qr'>('qr');
const isHandshaking = ref(false);
const handshakeQR = ref<string | null>(null);
const showQR = ref(false);
const sessionId = ref<string | null>(null);
const statusMessage = ref<string>('');
const qrCanvas = ref<HTMLCanvasElement>();

const statusClass = computed(() => {
  if (statusMessage.value.includes('Error')) {
    return 'text-red-600 bg-red-50 p-2 rounded';
  }
  if (statusMessage.value.includes('Complete')) {
    return 'text-green-600 bg-green-50 p-2 rounded';
  }
  return 'text-blue-600 bg-blue-50 p-2 rounded';
});

const startHandshake = async () => {
  try {
    isHandshaking.value = true;
    statusMessage.value = 'Generating ECDH keypair...';

    // Generate ephemeral ECDH keypair
    const keyPair = await generateECDHKeyPair();
    senderKeyPair.value = keyPair;
    const pubKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

    // Create handshake frame
    const frame = createSenderHandshakeFrame(pubKeyBase64);
    sessionId.value = frame.fileSessionId;
    senderNonceBase64.value = (frame as any).nonce;

    handshakeQR.value = JSON.stringify(frame);
    showQR.value = true;

    // Render QR
    if (qrCanvas.value) {
      statusMessage.value = 'Rendering QR code...';
      await renderQRToCanvas(frame, qrCanvas.value);
      statusMessage.value =
        'Handshake QR ready! Show this to receiver to scan.';
    }

    // Emit handshake info (no symmetric key yet)
    emit('handshake-complete', pubKeyBase64, frame.fileSessionId);
  } catch (error) {
    statusMessage.value = `Error: ${String(error)}`;
    console.error('Handshake failed:', error);
  } finally {
    isHandshaking.value = false;
  }
};

// Response paste + finalize
const responseJson = ref('');
const isFinalizing = ref(false);
const senderKeyPair = ref<any | null>(null);
const senderNonceBase64 = ref<string | null>(null);

const finalizeHandshake = async () => {
  if (!senderKeyPair.value) {
    statusMessage.value = 'Error: no sender keypair available';
    return;
  }
  if (!responseJson.value) {
    statusMessage.value = 'Paste receiver response JSON before finalizing';
    return;
  }

  try {
    isFinalizing.value = true;
    statusMessage.value = 'Finalizing handshake...';

    const responseFrame = JSON.parse(responseJson.value);
    const symKey = await finalizeSenderHandshake(senderKeyPair.value, senderNonceBase64.value || '', responseFrame);

    // Export symmetric key raw -> base64
    const raw = await crypto.subtle.exportKey('raw', symKey);
    const symKeyBase64 = arrayBufferToBase64(raw as ArrayBuffer);

    statusMessage.value = 'Handshake complete — symmetric key derived.';
    // Emit handshake-complete with symmetric key base64 attached
    emit('handshake-complete', await exportPublicKeyBase64(senderKeyPair.value.publicKey), sessionId.value || '', symKeyBase64);
  } catch (err) {
    console.error('Finalize handshake failed:', err);
    statusMessage.value = `Error finalizing handshake: ${String(err)}`;
  } finally {
    isFinalizing.value = false;
  }
};
</script>
