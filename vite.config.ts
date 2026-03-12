import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Vite options tailored for Tauri development and specific to this project
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    open: false,  // 禁止自动打开浏览器
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
