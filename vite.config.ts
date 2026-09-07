import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // 상대경로 자산. 어떤 경로에 마운트해도(예: /docdiff) 그대로 동작한다.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: {
    // Comlink 워커는 ESM 이어야 top-level await / dynamic import 가 동작한다.
    format: 'es',
  },
  build: {
    target: 'es2022',
    // manualChunks 는 쓰지 않는다. 형식별 파서는 동적 import 로만 갈라지고,
    // 수동으로 청크를 묶으면 오히려 초기 로드에 끌려 들어온다.
  },
});
