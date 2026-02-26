import { renderToString } from "@tinyst/jsx";
import { defineConfig } from "vite";
import { virtualHTML } from "./src/main";

export default defineConfig(({ mode }) => ({
  build: {
    // for debug
    minify: false,
    modulePreload: false,

    outDir: "dist_tests",
  },

  server: {
    host: "127.0.0.1",

    hmr: {
      port: 51730,
    },
  },

  plugins: [
    virtualHTML({
      onGetEntries() {
        const entries: Record<string, string> = {
          "templates/page1.html": "tests/page1.tsx",
          "templates/page2.html": "tests/page2.tsx",
        };

        return entries;
      },

      onGetHTML({ module }) {
        return renderToString(module.default());
      },
    }),
  ],
}));
