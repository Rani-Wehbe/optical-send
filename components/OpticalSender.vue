<template>
  <div class="space-y-6">
    <!-- Role & Handshake -->
    <OpticalHandshake
      @handshake-complete="onHandshakeComplete"
    />

    <!-- File Selection -->
    <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:bg-blue-50 transition bg-white"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop.prevent="handleDrop"
      :class="{ 'bg-blue-50': isDragging }"
    >
      <input
        ref="fileInput"
        type="file"
        multiple
        @change="handleFileSelect"
        class="hidden"
      />
      <label @click="() => fileInput?.click()" class="cursor-pointer block">
        <div class="text-4xl mb-2">📁</div>
        <div class="font-semibold mb-2">Drag files here or click to select</div>
        <div class="text-sm text-gray-500">
          Supports any file type. Will be compressed and encrypted.
        </div>
      </label>
    </div>

    <!-- Selected Files -->
    <div
      v-if="selectedFiles.length > 0"
      class="bg-blue-50 border border-blue-200 rounded-lg p-4"
    >
      <h3 class="font-semibold mb-2">📋 Selected Files:</h3>
      <ul class="space-y-1">
        <li v-for="(file, idx) in selectedFiles" :key="idx" class="text-sm">
          📄 {{ file.name }} ({{ formatBytes(file.size) }})
        </li>
      </ul>
      <div class="mt-3 text-sm text-blue-700 font-semibold">
        Total: {{ formatBytes(totalSize) }}
      </div>
    </div>

    <!-- Start Transfer Button -->
    <button
      v-if="selectedFiles.length > 0 && handshakeComplete"
      @click="startTransfer"
      :disabled="isTransferring"
      class="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg font-bold hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
    >
      <span v-if="!isTransferring">▶ Start Transfer</span>
      <span v-else>⏳ Transferring... ({{ transferProgress }}%)</span>
    </button>

    <!-- Block Queue Debug -->
    <div v-if="isTransferring" class="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <h3 class="font-semibold mb-2">📊 Transfer Progress</h3>
      <div class="space-y-2 text-sm">
        <div>Blocks Created: {{ blockStats.total }}</div>
        <div>Sent: {{ blockStats.sent }}</div>
        <div>Completed: {{ blockStats.completed }}</div>
        <div>Failed: {{ blockStats.failed }}</div>
      </div>
      <div class="mt-3 bg-white rounded p-2 border border-gray-300">
        <div class="w-full bg-gray-200 rounded-full h-2">
          <div
            class="bg-green-500 h-2 rounded-full transition-all"
            :style="{ width: transferProgress + '%' }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import OpticalHandshake from './OpticalHandshake.vue';
import { createBlocksFromFile, SendQueue } from '~/services/opticalBlockManager';
import { encryptAESGCM, deriveSymmetricKey, deriveSharedSecret, importPublicKeyBase64, base64ToArrayBuffer } from '~/services/opticalCrypto';

const fileInput = ref<HTMLInputElement>();
const selectedFiles = ref<File[]>([]);
const isDragging = ref(false);
const isTransferring = ref(false);
const handshakeComplete = ref(false);
const transferProgress = ref(0);
const sendQueue = ref<SendQueue>(new SendQueue());

const blockStats = computed(() => sendQueue.value.getProgress());

const totalSize = computed(() => {
  return selectedFiles.value.reduce((sum, f) => sum + f.size, 0);
});

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

const handleFileSelect = (e: Event) => {
  const input = e.target as HTMLInputElement;
  if (input.files) {
    selectedFiles.value = Array.from(input.files);
  }
};

const handleDrop = (e: DragEvent) => {
  isDragging.value = false;
  if (e.dataTransfer?.files) {
    selectedFiles.value = Array.from(e.dataTransfer.files);
  }
};

const onHandshakeComplete = (pubKey: string, sessionId: string) => {
  handshakeComplete.value = true;
  console.log('Handshake complete. Ready to transfer.', { pubKey, sessionId });
};

const startTransfer = async () => {
  try {
    isTransferring.value = true;

    for (const file of selectedFiles.value) {
      const fileBuffer = await file.arrayBuffer();
      const fileData = new Uint8Array(fileBuffer);

      // Create blocks (without encryption for now, will add in full implementation)
      const blocks = await createBlocksFromFile(
        crypto.getRandomValues(new Uint8Array(16)).toString(),
        fileData,
        1024
      );

      for (const block of blocks) {
        sendQueue.value.add(block);
      }

      // Simulate transfer
      for (let i = 0; i < blocks.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        transferProgress.value = Math.round(((i + 1) / blocks.length) * 100);
        sendQueue.value.markCompleted(i);
      }
    }

    console.log('Transfer complete!');
  } catch (error) {
    console.error('Transfer failed:', error);
  } finally {
    isTransferring.value = false;
  }
};
</script>
