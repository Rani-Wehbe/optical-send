<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { CameraScanner } from '~/services/opticalScanner';
import { respondToSenderFrame } from '~/services/opticalHandshake';
import { renderQRToCanvas } from '~/services/opticalQR';
import { BlockStore } from '~/services/opticalDB';
import {
  initializeReceiverPipeline,
  processReceivedBlockInPipeline,
  getReceiverStats,
} from '~/services/opticalReceiverFlow';
import type { ReceiverPipeline } from '~/services/opticalReceiverFlow';

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
const receiverPipeline = ref<ReceiverPipeline | null>(null);
const blockStore = ref(new BlockStore());

let scanner: CameraScanner | null = null;
let metricsInterval: NodeJS.Timeout | null = null;

const metrics = ref({
  framesPerSecond: 0,
  decodedFrames: 0,
  failedDecodes: 0,
});

const toggleTorch = async () => {
  if (!scanner) return;

  try {
    torchOn.value = !torchOn.value;
    await scanner.toggleTorch(torchOn.value);
  } catch (err) {
    console.warn('Torch toggle failed:', err);
    torchOn.value = !torchOn.value; // revert
  }
};

onMounted(async () => {
  await blockStore.value.initialize();

  if (!videoElement.value) {
    cameraError.value = 'Video element not found';
    return;
  }

  try {
    scanner = new CameraScanner(videoElement.value, () => {
      metrics.value.decodedFrames++;
    });

    await scanner.initialize(videoElement.value);

    scanner.start(async (result) => {
      scannedFrames.value.push(result.data);

      try {
        const frame = JSON.parse(result.data);

        // Block frames
        if (frame.type === 'block' || frame.type === 'chunk') {
          receivedBlocks.value.push(frame);

          if (frame.header?.totalSeq) {
            totalBlocks.value = frame.header.totalSeq;
          }
          return;
        }

        // Handshake response
        if (frame.type === 'handshake' && frame.role === 'sender') {
          const resp = await respondToSenderFrame(frame);
          receiverSymKey.value = resp.symKey;

          if (resp.symKey) {
            receiverPipeline.value = await initializeReceiverPipeline(
              frame.fileId || 'unknown',
              'received-file',
              0,
              frame.totalSeq || 0,
              resp.symKey,
              resp.receiverPublicKeyBase64,
              blockStore.value
            );
          }

          responseVisible.value = true;
          await renderQRToCanvas(resp.responseFrame, responseCanvas.value!);
        }
      } catch (err) {
        // Not JSON, ignore silently
      }
    });

    metricsInterval = setInterval(() => {
      if (scanner) metrics.value = scanner.getMetrics();
    }, 1000);
  } catch (error) {
    cameraError.value = `Failed to initialize camera: ${String(error)}`;
    console.error('Camera init error:', error);
  }
});

onUnmounted(() => {
  scanner?.stop();
  if (metricsInterval) clearInterval(metricsInterval);
  blockStore.value.close();
});
</script>