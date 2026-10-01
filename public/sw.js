/*
 * 오프라인 실행용 서비스 워커
 * ------------------------------------------------------------
 * 한 번 접속하면 인터넷이 끊겨도 에디터를 열 수 있게 파일을 저장해 둡니다.
 *  - 페이지(index.html): 네트워크 먼저 → 실패하면 저장된 것
 *  - 빌드 파일(assets/…, 이름에 해시가 붙어 바뀌지 않음): 저장된 것 먼저
 *  - 다른 주소(예: Codex 브리지 127.0.0.1)는 건드리지 않습니다.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `pixel-editor-${VERSION}`;
const CORE = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pixel-editor-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.includes('/assets/') || CORE.some((c) => url.pathname.endsWith(c.slice(1))))) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
