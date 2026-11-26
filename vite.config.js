import { defineConfig } from "vite";

export default defineConfig({
  // relative paths, so the built site works from any folder (GitHub Pages
  // serves it from /starship-pixel-flight/)
  base: "./",
  build: { chunkSizeWarningLimit: 4000 }, // Spark is a large library
});
