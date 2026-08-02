<script setup lang="ts">
import { onMounted, ref } from "vue";

const status = ref<"waiting" | "decrypting" | "done" | "error">("waiting");
const userName = ref<string | null>(null);
const locationId = ref<string | null>(null);
const rawUser = ref<unknown>(null);
const error = ref<string | null>(null);

// Matches the request/response message names from GoHighLevel/ghl-marketplace-app-template:
// the iframe asks the parent HighLevel frame for session info, parent replies with an
// encrypted payload.
function requestEncryptedPayload(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("No response from parent frame after 5s -- is this page loaded inside a HighLevel custom page iframe?"));
    }, 5000);

    window.addEventListener("message", function handleMessage(event: MessageEvent) {
      if (event.data?.message !== "REQUEST_USER_DATA_RESPONSE") return;
      clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      resolve(event.data.payload);
    });

    window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
  });
}

onMounted(async () => {
  try {
    const encryptedPayload = await requestEncryptedPayload();

    status.value = "decrypting";
    const res = await fetch("/api/auth/sso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedPayload }),
    });

    if (!res.ok) {
      throw new Error(`/api/auth/sso -> ${res.status} ${await res.text()}`);
    }

    const body = await res.json();
    userName.value = body.user?.userName ?? null;
    locationId.value = body.locationId ?? null;
    rawUser.value = body.user;
    status.value = "done";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    status.value = "error";
  }
});
</script>

<template>
  <main>
    <h1>SSO handshake spike</h1>
    <p>Status: {{ status }}</p>

    <template v-if="status === 'done'">
      <p>User name: {{ userName }}</p>
      <p>Location ID: {{ locationId }}</p>
      <pre>{{ JSON.stringify(rawUser, null, 2) }}</pre>
    </template>

    <template v-if="status === 'error'">
      <p>Error: {{ error }}</p>
    </template>
  </main>
</template>
