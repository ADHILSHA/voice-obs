<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  isEstimate?: boolean;
}>();
</script>

<template>
  <div class="rounded-md border border-gray-200 bg-white p-4">
    <div class="text-xs font-medium uppercase tracking-wide text-gray-500">
      {{ label }}
      <span v-if="isEstimate" class="normal-case text-gray-400">(est.)</span>
    </div>
    <div class="mt-1 text-2xl font-semibold text-gray-900">{{ value }}</div>
  </div>
</template>
