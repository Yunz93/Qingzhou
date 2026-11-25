import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const backendAddress = `127.0.0.1:${Number(process.env.PORT ?? 4310)}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@qingzhou/protocol": path.resolve(__dirname, "../../packages/protocol/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    watch: process.env.QINGZHOU_STABLE === "1" ? null : undefined,
    proxy: {
      "/ws": { target: `ws://${backendAddress}`, ws: true },
      "/api": { target: `http://${backendAddress}` },
      "/uploads": { target: `http://${backendAddress}` },
      "/health": { target: `http://${backendAddress}` },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
