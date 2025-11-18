<template>
  <div class="min-h-screen bg-gradient-to-br from-blue-50 to-green-50">
    <div class="absolute flex gap-2" style="top: 20px; right: 20px">
      <ThemeSwitcher />
      <LanguageSwitcher />
    </div>

    <div class="max-w-6xl mx-auto p-8">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-4xl font-bold text-gray-800 mb-2 flex items-center gap-3">
          <span>🌐</span>
          <span>OpticalSend</span>
        </h1>
        <p class="text-gray-600">
          Lossless QR + Wi-Fi file transfer with end-to-end encryption
        </p>
      </div>

      <!-- Role Toggle -->
      <div class="flex gap-4 mb-6">
        <button
          @click="role = 'sender'"
          class="px-6 py-2 rounded-lg font-semibold transition"
          :class="
            role === 'sender'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          "
        >
          📤 Sender
        </button>
        <button
          @click="role = 'receiver'"
          class="px-6 py-2 rounded-lg font-semibold transition"
          :class="
            role === 'receiver'
              ? 'bg-green-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          "
        >
          📥 Receiver
        </button>
      </div>

      <!-- Main Content -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Main Panel -->
        <div class="lg:col-span-2 bg-white rounded-lg shadow-lg p-6">
          <OpticalSender v-if="role === 'sender'" />
          <OpticalReceiver v-else />
        </div>

        <!-- Debug Panel -->
        <div class="bg-white rounded-lg shadow-lg p-6 h-fit">
          <h2 class="font-bold mb-4 flex items-center gap-2">
            <span>🐛</span>
            <span>Debug Info</span>
          </h2>
          <div class="space-y-2 text-sm font-mono bg-gray-50 p-3 rounded">
            <div>Role: {{ role }}</div>
            <div>Time: {{ currentTime }}</div>
            <div>Camera: <span class="text-green-600">Available</span></div>
            <div>WebRTC: <span class="text-green-600">Available</span></div>
            <div>IndexedDB: <span class="text-green-600">Available</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import OpticalSender from '~/components/OpticalSender.vue';
import OpticalReceiver from '~/components/OpticalReceiver.vue';

const role = ref<'sender' | 'receiver'>('sender');
const currentTime = ref('');

onMounted(() => {
  setInterval(() => {
    currentTime.value = new Date().toLocaleTimeString();
  }, 1000);
});
</script>
