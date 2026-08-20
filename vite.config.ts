import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // pnpm store paths encode peer deps (e.g. .pnpm/zustand@x_react@y/...),
          // so match the package name after the LAST /node_modules/ segment.
          const marker = "node_modules/";
          const idx = id.lastIndexOf(marker);
          if (idx === -1) return undefined;
          const parts = id.slice(idx + marker.length).split("/");
          const pkg = parts[0].startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : parts[0];
          if (pkg === "react" || pkg === "react-dom" || pkg === "scheduler") return "vendor-react";
          if (pkg.startsWith("@tauri-apps/")) return "vendor-tauri";
          if (pkg === "zustand") return "vendor-zustand";
          if (pkg === "pdfjs-dist" || pkg === "mammoth") return "vendor-docs";
          // realtime-js + its two runtime deps (@supabase/phoenix, tslib) —
          // lazily imported by realtimeService, so it stays off the initial load.
          if (pkg.startsWith("@supabase/")) return "vendor-realtime";
          return undefined;
        },
      },
    },
  },
}));
