<script setup lang="ts">
import { useSessionStore } from "../stores/session";

const session = useSessionStore();
</script>

<template>
  <div>
    <p>Status: {{ session.status }}</p>
    <p v-if="session.locationId">Location: {{ session.locationId }}</p>
    <p v-if="session.error">Error: {{ session.error }}</p>
  </div>
</template>
