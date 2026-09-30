/* Service worker: l'app funziona anche offline; online legge sempre i file più recenti. */
const CACHE = "calcolo-trasporti-v7";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest",
  "./data/listini.json", "./data/pallet.json", "./data/groupage.json",
  "./data/articoli.json", "./data/geo.json", "./data/gasolio.json",
  "./fonts/barlow-latin-400-normal.woff2", "./fonts/barlow-latin-500-normal.woff2",
  "./fonts/barlow-latin-600-normal.woff2", "./fonts/barlow-latin-700-normal.woff2",
  "./fonts/barlow-condensed-latin-600-normal.woff2", "./fonts/barlow-condensed-latin-700-normal.woff2",
  "./analisi.html", "./analisi.js", "./vendor/xlsx.mini.min.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (u) => {
      try { const r = await fetch(new Request(u, { cache: "reload" })); if (r.ok) await c.put(u, r); } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    const cl = await self.clients.matchAll({ type: "window" });
    cl.forEach((c) => c.postMessage({ type: "SW_UPDATED" }));
  })());
});

self.addEventListener("message", (e) => { if (e.data?.type === "SKIP_WAITING") self.skipWaiting(); });

async function networkFirst(req) {
  try {
    const fresh = await fetch(req, { cache: "no-store" });
    if (fresh.ok) { const c = await caches.open(CACHE); c.put(req, fresh.clone()); }
    return fresh;
  } catch {
    return (await caches.match(req, { ignoreSearch: true })) || Response.error();
  }
}
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has("_")) return;                 // controllo versione: sempre in rete
  if (req.mode === "navigate") { e.respondWith(networkFirst(new Request("./index.html"))); return; }
  const p = url.pathname;
  if (/\.(html|js|css|json|webmanifest)$/.test(p) || p.endsWith("/")) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(cacheFirst(req));                         // font e icone
});
