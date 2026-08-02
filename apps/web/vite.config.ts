import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../../packages/shared/src", import.meta.url)),
    },
  },
  build: {
    outDir: "../api/public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/webhooks": "http://localhost:3000",
    },
  },
});
