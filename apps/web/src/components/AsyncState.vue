<script setup lang="ts">
// Used by every list view (BUILD_SPEC §7: "every list view has explicit loading,
// empty and error states. Empty states say what to do next, not 'no data'" --
// hence emptyMessage is required, not defaulted to something generic).
defineProps<{
  status: "loading" | "empty" | "error" | "ready";
  error?: string | null;
  emptyMessage: string;
}>();
</script>

<template>
  <div v-if="status === 'loading'" class="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-500">
    Loading…
  </div>
  <div v-else-if="status === 'error'" class="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-700">
    {{ error ?? "Something went wrong." }}
  </div>
  <div v-else-if="status === 'empty'" class="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-500">
    {{ emptyMessage }}
  </div>
  <slot v-else />
</template>
