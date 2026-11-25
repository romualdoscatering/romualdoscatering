/* Romualdo's Time Clock: lets the reception tablet install /hr as a home-screen app,
   and keeps a copy of the clock page so it still opens if the internet drops
   (punches made offline are saved on the tablet and sent later, as before).
   Always tries the internet first, so updates arrive straight away. */
const CACHE = 'rc-hr-v1';
const SHELL = ['./', 'icons/icon-192.png', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;          // the time-clock server and fonts go straight to the internet
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put('./', c)); return res; })
      .catch(() => caches.match('./').then(m => m || new Response('<h2 style="font-family:Arial">No internet. Check the Wi-Fi, then reopen the Time Clock.</h2>', { headers: { 'Content-Type': 'text/html' } }))));
  }
});
