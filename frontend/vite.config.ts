import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { createGateway, readConfig } from "./server/gateway.ts";

export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    {
      name: "flagwa-server-gateway",
      configureServer(server) {
        server.middlewares.use(createGateway(readConfig()));
      },
      configurePreviewServer(server) {
        server.middlewares.use(createGateway(readConfig()));
      },
    },
  ],
  server: { port: 5173, host: "0.0.0.0" },
  build: { target: "es2022", sourcemap: false },
});
