import { Suspense, lazy, useEffect, useState } from 'react';
import App from './App';

/**
 * 최소 라우터. 라이브러리를 쓰지 않는다.
 *
 * 화면이 둘뿐이고(비교 화면 / 관리 화면), 라우터를 넣으면 초기 번들이
 * 그만큼 커진다(§10.2 번들 예산 200KB). 필요해지면 그때 갈아끼운다.
 *
 * 이 앱은 도메인의 /docdiff 아래에 붙지만 프록시가 그 prefix 를 떼고 넘긴다.
 * 두 경우 모두 받아들여야 배포 구성이 바뀌어도 안 깨진다.
 */
const AdminPage = lazy(() => import('./AdminPage').then((m) => ({ default: m.AdminPage })));

const MOUNT = '/docdiff';

export function currentRoute(pathname: string): 'admin' | 'compare' {
  let p = pathname;
  if (p === MOUNT) p = '/';
  else if (p.startsWith(MOUNT + '/')) p = p.slice(MOUNT.length);
  p = p.replace(/\/+$/, '') || '/';
  return p === '/admin' ? 'admin' : 'compare';
}

/** 새로고침 없이 이동한다. 링크가 새 창을 열지 않게 이걸 쓴다. */
export function navigate(to: string): void {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function Routes() {
  const [route, setRoute] = useState(() => currentRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(currentRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (route === 'admin') {
    return (
      <Suspense fallback={<p className="mx-auto max-w-4xl px-6 py-12 text-sm">관리 화면 불러오는 중…</p>}>
        <AdminPage />
      </Suspense>
    );
  }
  return <App />;
}
