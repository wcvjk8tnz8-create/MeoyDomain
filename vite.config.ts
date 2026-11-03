import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 前端产物输出到 dist/client，由 Cloudflare Workers [assets] 托管。
 * public/ 里的 css / img / favicon 会原样复制过去；
 * 旧的 14 个手写 .html 页面已全部迁移为 src/app/pages/*.tsx。
 */
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: { port: 5173, strictPort: false },
});
