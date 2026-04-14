import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd() + "/../..", "");
  const apiPort = env.PORT || "3000";

  return {
    plugins: [vue()],
    base: "/c/",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      port: 5174,
      host: true,
      allowedHosts: true,
      proxy: {
        "/customer": `http://localhost:${apiPort}`,
      },
    },
  };
});
