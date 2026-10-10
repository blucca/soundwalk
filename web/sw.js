/* SoundWalk keeps the application and open model on this device for offline use. */
const CACHE = 'soundwalk-v0.1.1';
const SHELL = [
  './', './index.html', './styles.css', './app.mjs', './audio.mjs',
  './model-worker.js', './recorder-worklet.js', './manifest.webmanifest',
  './assets/icon.svg', './assets/poster.svg', './assets/fonts/dm-sans-latin.woff2', './about.html'
];
const MODEL = [
  './vendor/tf.min.js', './model/model.json', './model/labels.json',
  './model/group1-shard1of4.bin', './model/group1-shard2of4.bin',
  './model/group1-shard3of4.bin', './model/group1-shard4of4.bin',
  './audio/sea-waves.wav'
];
const REQUIRED = [...SHELL, ...MODEL];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('soundwalk-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.location.href).pathname)) return;
  // Browser-managed media delivery preserves byte-range playback and seeking.
  if (event.request.destination === 'video' || event.request.headers.has('range')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.status === 200 && response.type === 'basic') await cache.put(event.request, response.clone());
    return response;
  })());
});

async function status(cache) {
  const hits = await Promise.all(REQUIRED.map(path => cache.match(path)));
  return { type: 'status', ready: hits.every(Boolean), cached: hits.filter(Boolean).length, total: REQUIRED.length, version: CACHE };
}
self.addEventListener('message', event => {
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      if (event.data.type === 'WARM_CACHE') {
        let completed = 0;
        for (const path of REQUIRED) {
          if (!await cache.match(path)) {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`Offline download failed (${response.status}).`);
            await cache.put(path, response);
          }
          port.postMessage({ type: 'progress', completed: ++completed, total: REQUIRED.length });
        }
      }
      port.postMessage(await status(cache));
    } catch (error) { port.postMessage({ type: 'error', message: error.message }); }
  })());
});
