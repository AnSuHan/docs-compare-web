import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/** 이 앱이 붙는 경로. 도메인의 이 아래에 마운트된다. */
const MOUNT = '/docdiff';

/**
 * 프록시가 마운트 prefix 를 떼서 넘기는지 아닌지에 상관없이 동작하게 한다.
 *
 * 실제로 이 서비스의 nginx 는 라우팅을 막 저장했을 때는 prefix 를 그대로 넘기다가,
 * 재동기화된 뒤에는 떼고 넘겼다. 그 사이에 배포가 통째로 죽었다(무한 리디렉트).
 * 앱이 양쪽을 다 받아주면 그 차이가 장애가 되지 않는다.
 */
const tolerateMountPrefix: PluginOption = {
  name: 'tolerate-mount-prefix',
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? '/';
      if (url === MOUNT) req.url = '/';
      else if (url.startsWith(MOUNT + '/')) req.url = url.slice(MOUNT.length);
      next();
    });
  },
};

export default defineConfig({
  /**
   * 상대경로 자산. 배포에서 이게 유일하게 맞는 값이다.
   *
   * 브라우저는 prefix 를 붙여 요청해야 하고(그래야 프록시가 이 앱으로 보낸다)
   * 앱은 루트 기준으로 서빙해야 한다. './' 가 정확히 그렇다 — index.html 이
   * `./assets/...` 를 가리키므로 브라우저는 /docdiff/assets/... 를 요청한다.
   *
   * '/docdiff/' 로 박으면 프록시가 prefix 를 뗄 때 앱이 다시 /docdiff/ 로
   * 리디렉트해 무한 루프가 된다. '/' 로 두면 브라우저가 /assets/... 를 요청해
   * 루트에 붙은 다른 앱으로 새어 나간다.
   */
  base: './',
  plugins: [react(), tailwindcss(), tolerateMountPrefix],
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
});
