import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built site works from any path (GitHub Pages project site included).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { target: "es2020", sourcemap: false },
  server: { port: 5173 },
});
