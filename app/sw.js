/* Romualdo's Staff app — service worker
   Makes /app open fast on phones and installable as a home-screen app.
   · Business data (Supabase) is NEVER cached: every number on screen is live.
   · The app's own files are kept on the phone so it opens instantly, even on weak signal.
     Files with ?v= in their name never change (a new version gets a new name), so they are served from the phone.
     index.html and other files are fetched fresh first and only fall back to the phone's copy when offline.
   · The in-app "Update now" bar still appears whenever a new version is published. */
const CACHE = 'rom-staff-v2';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png', '../assets/logo.png'];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const OFFLINE = `<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font:16px Arial,sans-serif;background:#14213f;color:#fff;display:grid;place-items:center;height:95vh;margin:0;text-align:center;padding:20px"><div><h2 style="font-family:Georgia,serif">You're offline</h2><p>You're still signed in. Check the Wi-Fi or data, then pull down or tap below.</p><button onclick="location.reload()" style="font:inherit;padding:12px 22px;border:0;border-radius:10px;background:#e2c77e;color:#14213f;font-weight:700">Try again</button></div>`;

// Fresh first, with a time limit so a weak signal doesn't leave a blank screen
async function networkFirst(req, ms) {
  const c = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' }) || (req.mode === 'navigate' && await c.match('./'));
    if (hit) return hit;
    if (req.mode === 'navigate') return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html' } });
    throw e;
  }
}
// From the phone first; versioned files never change. Old versions of the same file are cleared out.
async function cacheFirst(req) {
  const c = await caches.open(CACHE), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    const u = new URL(req.url);
    if (u.searchParams.has('v')) for (const k of await c.keys()) { const o = new URL(k.url); if (o.pathname === u.pathname && o.search !== u.search) c.delete(k); }
    c.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                                   // saves always go straight to the server
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, 4000));
    if (u.searchParams.has('check')) return;                          // the "new version?" check must be live
    if (u.searchParams.has('v')) return e.respondWith(cacheFirst(req));
    return e.respondWith(networkFirst(req, 6000));
  }
  if (CDN.test(req.url)) return e.respondWith(cacheFirst(req));       // pinned sign-in library + fonts
  // everything else (Supabase data, logins) goes to the network untouched
});
