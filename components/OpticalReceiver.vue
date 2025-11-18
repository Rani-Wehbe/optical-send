<template>
  <div class="space-y-6">
    <!-- Camera Scanner -->
    <div class="border rounded-lg p-4 bg-white">
      <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
        <span>📸</span>
        <span>Scanner</span>
      </h2>

      <div v-if="cameraError" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
        {{ cameraError }}
      </div>

      <!-- Video Element -->
      <div class="relative w-full aspect-square bg-black rounded-lg overflow-hidden mb-4">
        <video
          ref="videoElement"
          class="w-full h-full object-cover"
          :style="{
            filter: `brightness(${brightness}%) contrast(${contrast}%)`,
          }"
        />
        <div class="absolute bottom-4 left-4 bg-black bg-opacity-60 text-white px-3 py-1 rounded text-sm">
          {{ metrics.framesPerSecond.toFixed(1) }} FPS
        </div>
      </div>

      <!-- Brightness & Contrast Controls -->
      <div class="space-y-3 mb-4">
        <div>
          <label class="block text-sm font-semibold mb-2">
            Brightness: {{ brightness }}%
          </label>
          <input
            v-model.number="brightness"
            type="range"
            min="50"
            max="150"
            class="w-full"
          />
        </div>

        <div>
          <label class="block text-sm font-semibold mb-2">
            Contrast: {{ contrast }}%
          </label>
          <input
            v-model.number="contrast"
            type="range"
            min="50"
            max="200"
            class="w-full"
          />
        </div>
      </div>

      <!-- Torch Button -->
      <button
        @click="toggleTorch"
        class="w-full px-4 py-2 rounded-lg font-semibold transition"
        :class="torchOn ? 'bg-yellow-500 text-white' : 'bg-gray-300 text-gray-700'"
      >
        🔦 Torch {{ torchOn ? 'ON' : 'OFF' }}
      </button>
    </div>

  <!-- Scan Results -->
    <div v-if="scannedFrames.length > 0" class="bg-green-50 border border-green-200 rounded-lg p-4">
      <h3 class="font-semibold mb-2">✅ Scanned Frames: {{ scannedFrames.length }}</h3>
      <ul class="space-y-1 text-sm">
        <li v-for="(frame, idx) in scannedFrames.slice(-5)" :key="idx">
          📱 {{ frame.substring(0, 50) }}...
        </li>
      </ul>
    </div>

    <!-- Handshake Response QR (when responding) -->
    <div v-if="responseVisible" class="bg-white rounded-lg p-4 border border-gray-300">
      <h3 class="font-semibold mb-2">↩️ Handshake Response QR</h3>
      <div class="text-sm text-gray-600 mb-2">Show this QR to the sender so it can complete the handshake.</div>
      <canvas ref="responseCanvas" width="300" height="300" class="w-full border-2 border-gray-300 rounded-lg mx-auto" />
    </div>

    <!-- Received Blocks -->
    <div v-if="receivedBlocks.length > 0" class="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <h3 class="font-semibold mb-2">📦 Received Blocks: {{ receivedBlocks.length }}</h3>
      <div class="text-sm text-blue-700">
        Progress: {{ ((receivedBlocks.length / totalBlocks) * 100).toFixed(1) }}%
        <span v-if="totalBlocks > 0">({{ receivedBlocks.length }}/{{ totalBlocks }})</span>
      </div>
      <div v-if="totalBlocks > 0" class="mt-2 bg-white rounded p-2 border border-blue-300">
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div
            class="bg-blue-500 h-2 rounded-full transition-all"
            :style="{ width: ((receivedBlocks.length / totalBlocks) * 100) + '%' }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { CameraScanner } from '~/services/opticalScanner';
import { respondToSenderFrame } from '~/services/opticalHandshake';
import { renderQRToCanvas } from '~/services/opticalQR';

const videoElement = ref<HTMLVideoElement>();
const brightness = ref(100);
const contrast = ref(100);
const torchOn = ref(false);
const cameraError = ref('');
const scannedFrames = ref<string[]>([]);
const receivedBlocks = ref<any[]>([]);
const totalBlocks = ref(0);
const responseCanvas = ref<HTMLCanvasElement>();
const responseVisible = ref(false);
const receiverSymKey = ref<CryptoKey | null>(null);

const metrics = ref({
  framesPerSecond: 0,
  totalFrames: 0,
});

let scanner: CameraScanner | null = null;
let metricsInterval: NodeJS.Timeout | null = null;

const toggleTorch = async () => {
  if (scanner) {
    torchOn.value = !torchOn.value;
    try {
      await scanner.toggleTorch(torchOn.value);
    } catch (error) {
      console.warn('Torch control failed:', error);
      torchOn.value = !torchOn.value; // revert on failure
    }
  }
};

onMounted(async () => {
  if (!videoElement.value) {
    cameraError.value = 'Video element not found';
    return;
  }

  try {
    scanner = new CameraScanner();
    await scanner.initialize(videoElement.value);

    // Start scanning
    scanner.start(async (result) => {
      scannedFrames.value.push(result.data);

      // Try to parse as a frame
      try {
        const frame = JSON.parse(result.data);
        if (frame.type === 'block' || frame.type === 'chunk') {
          receivedBlocks.value.push(frame);
          if (frame.header?.totalSeq) {
            totalBlocks.value = frame.header.totalSeq;
          }
        } else if (frame.type === 'handshake' && frame.role === 'sender') {
          console.log('Handshake (sender) frame received:', frame);

          try {
            // Respond to sender with our ephemeral key + nonce and derive symmetric key
            const resp = await respondToSenderFrame(frame);
            receiverSymKey.value = resp.symKey;

            // Render response QR for sender to scan
            responseVisible.value = true;
            await renderQRToCanvas(resp.responseFrame, responseCanvas.value!);

            console.log('Responded to handshake and rendered response QR');
          } catch (err) {
            console.error('Failed to respond to sender handshake:', err);
          }
        } else if (frame.type === 'handshake') {
          console.log('Handshake frame received (non-sender):', frame);
        }
      } catch (e) {
        // Not valid JSON, skip
      }
    });

    // Update metrics every second
    metricsInterval = setInterval(() => {
      if (scanner) {
        metrics.value = scanner.getMetrics();
      }
    }, 1000);
  } catch (error) {
    cameraError.value = `Failed to initialize camera: ${String(error)}`;
    console.error('Camera init error:', error);
  }
});

onUnmounted(() => {
  if (scanner) {
    scanner.stop();
  }
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }
});
</script>
