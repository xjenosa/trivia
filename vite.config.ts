import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Three pages (phone, 3D arena, 2D screen) plus the Worker and its Durable Object,
// all under one dev server.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  server: { port: 5173, strictPort: true },
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            index: resolve(import.meta.dirname, "index.html"),
            host: resolve(import.meta.dirname, "host.html"),
            "host/2d": resolve(import.meta.dirname, "host/2d.html"),
          },
        },
      },
    },
  },
});
