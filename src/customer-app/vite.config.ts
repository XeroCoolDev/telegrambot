import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  base: "/c/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    allowedHosts: true,
    proxy: {
      "/customer": "http://localhost:" + (process.env.PORT || "3000"),
    },
  },
});
