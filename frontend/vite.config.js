import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // react in its own chunk: app edits stop invalidating the framework
        // bytes in browser caches (assets are served immutable)
        manualChunks: { vendor: ["react", "react-dom"] },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
