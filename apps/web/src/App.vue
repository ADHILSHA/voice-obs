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
  <AppShell />
</template>
