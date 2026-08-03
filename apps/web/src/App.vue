<script setup lang="ts">
import { onMounted } from "vue";
import AppShell from "./components/AppShell.vue";
import { useSessionStore } from "./stores/session";

const session = useSessionStore();

onMounted(() => {
  session.establishSession();
});
</script>

<template>
  <!--
    Views fire their own API calls on mount, and apiFetch reads session.token
    at call time -- if router-view rendered before the SSO handshake resolved,
    every first-load request would go out with no Authorization header at all
    and 401 ("Missing session token"), not just render stale data.
  -->
  <div
    v-if="session.status === 'idle' || session.status === 'establishing'"
    class="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500"
  >
    Connecting to HighLevel…
  </div>
  <div
    v-else-if="session.status === 'error'"
    class="flex min-h-screen items-center justify-center bg-gray-50 p-6"
  >
    <div class="max-w-md rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {{ session.error }}
    </div>
  </div>
  <AppShell v-else />
</template>
