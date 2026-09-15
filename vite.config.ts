import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import aitDevtools from "@apps-in-toss/devtools/unplugin";

// base "./" so the built site works from any path (GitHub Pages project site included).
export default defineConfig({
  plugins: [aitDevtools.vite(), react()],
  base: "./",
  build: { target: "es2020", sourcemap: false },
  server: { port: 5173 },
});
