import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // 多页面入口配置
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        screenshot: path.resolve(__dirname, "screenshot.html"),
      },
      output: {
        manualChunks: {
          // 将 Monaco Editor 分离为独立 chunk
          'monaco-editor': ['monaco-editor'],
          '@monaco-editor/react': ['@monaco-editor/react'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  // Vite options tailored for Tauri development and specific to this project
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    open: true,  // 禁止自动打开浏览器
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
