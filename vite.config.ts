import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import aitDevtools from "@apps-in-toss/devtools/unplugin";

/**
 * Promotion payouts depend on one build flag. A typo ("LIVE", "true") used to
 * fall back to TEST_ codes without a word, so a release could ship paying
 * nothing. Only "", "test" and "live" are accepted, and every build says which
 * one it is.
 */
function promotionModeGuard(value: string | undefined): Plugin {
  const mode = value ?? "";
  return {
    name: "ssok-promotion-mode",
    apply: "build",
    configResolved() {
      if (!["", "test", "live"].includes(mode)) {
        throw new Error(`VITE_PROMOTION_MODE must be "live", "test" or unset – got ${JSON.stringify(mode)}`);
      }
      const label = mode === "live" ? "LIVE – real payouts" : "TEST_ codes only";
      console.log(`\n  [ssok] promotion mode: ${label}\n`);
    },
  };
}

// base "./" so the built site works from any path (GitHub Pages project site included).
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  return {
    plugins: [promotionModeGuard(env.VITE_PROMOTION_MODE), aitDevtools.vite(), react()],
    base: "./",
    build: { target: "es2020", sourcemap: false },
    server: { port: 5173 },
  };
});
