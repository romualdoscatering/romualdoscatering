/* Romualdo's Staff app: lets phones install /app as a home-screen app.
   It caches nothing on purpose, so the team always gets the latest version and live data. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;   // let the browser handle everything else normally
  e.respondWith(fetch(e.request).catch(() => new Response('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px Arial,sans-serif;background:#14213f;color:#fff;display:grid;place-items:center;height:95vh;margin:0;text-align:center;padding:20px"><div><h2 style="font-family:Georgia,serif">You\'re offline</h2><p>Romualdo\'s staff app needs the internet.<br>Check the Wi-Fi or data, then pull down to refresh.</p></div>', { headers: { 'Content-Type': 'text/html' } })));
});
