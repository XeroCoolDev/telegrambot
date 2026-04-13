import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd() + "/../..", "");
  const apiPort = env.PORT || "3000";

  return {
    plugins: [vue()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      host: true,
      allowedHosts: true,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
  };
});
