import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * 이 앱은 서비스 도메인의 /docdiff 아래에 마운트된다.
 * 리버스 프록시가 prefix 를 떼지 않고 그대로 넘기므로, 빌드 산출물과
 * preview 서버가 같은 prefix 를 알고 있어야 자산이 404 나지 않는다.
 * 개발 서버(npm run dev)만 루트로 둔다.
 */
const MOUNT = '/docdiff/';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? MOUNT : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: {
    // Comlink 워커는 ESM 이어야 top-level await / dynamic import 가 동작한다.
    format: 'es',
  },
  preview: {
    // 배포 플랫폼이 이 앱을 vite_static 으로 잡아 `vite preview` 로 띄운다.
    // preview 는 알지 못하는 Host 헤더를 기본 차단하므로(403 "not allowed"),
    // 서비스 도메인을 허용해야 한다. dist 만 내보내는 공개 정적 사이트라
    // 도메인이 바뀔 때마다 깨지지 않도록 열어 둔다.
    host: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    // manualChunks 는 쓰지 않는다. 형식별 파서는 동적 import 로만 갈라지고,
    // 수동으로 청크를 묶으면 오히려 초기 로드에 끌려 들어온다.
  },
}));
