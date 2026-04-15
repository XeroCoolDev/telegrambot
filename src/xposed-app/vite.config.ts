import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd() + "/../..", "");
  const apiPort = env.PORT || "3000";

  return {
    plugins: [vue()],
    base: "/",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      port: 5174,
      host: true,
      allowedHosts: true,
      proxy: {
        "/xposed": `http://localhost:${apiPort}`,
      },
    },
  };
});
