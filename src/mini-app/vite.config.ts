import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:" + (process.env.PORT || "3000"),
    },
  },
});
