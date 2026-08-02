import { defineStore } from "pinia";
import { ref } from "vue";
import { postSsoLogin } from "../api/client";

// Matches the request/response message names from GoHighLevel/ghl-marketplace-app-template.
function requestEncryptedPayload(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          "No response from parent frame after 5s -- is this page loaded inside a HighLevel custom page iframe?",
        ),
      );
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

// In-memory only, no localStorage/cookies -- the iframe context is hostile to them.
// A reload re-runs the handshake from scratch.
export const useSessionStore = defineStore("session", () => {
  const token = ref<string | null>(null);
  const user = ref<Record<string, unknown> | null>(null);
  const locationId = ref<string | null>(null);
  const status = ref<"idle" | "establishing" | "ready" | "error">("idle");
  const error = ref<string | null>(null);

  async function establishSession(): Promise<void> {
    status.value = "establishing";
    error.value = null;
    try {
      const encryptedPayload = await requestEncryptedPayload();
      const response = await postSsoLogin(encryptedPayload);
      token.value = response.token;
      user.value = response.user;
      locationId.value = response.locationId;
      status.value = "ready";
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      status.value = "error";
    }
  }

  return { token, user, locationId, status, error, establishSession };
});
