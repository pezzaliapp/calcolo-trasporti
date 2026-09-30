/* Service worker: online legge SEMPRE i file più recenti da GitHub (saltando ogni cache),
   offline usa l'ultima copia salvata. */
const CACHE = "calcolo-trasporti-v11";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./versione.json",
  "./data/listini.json", "./data/pallet.json", "./data/groupage.json",
  "./data/articoli.json", "./data/geo.json", "./data/gasolio.json",
  "./analisi.html", "./analisi.js", "./vendor/xlsx.mini.min.js",
  "./fonts/barlow-latin-400-normal.woff2", "./fonts/barlow-latin-500-normal.woff2",
  "./fonts/barlow-latin-600-normal.woff2", "./fonts/barlow-latin-700-normal.woff2",
  "./fonts/barlow-condensed-latin-600-normal.woff2", "./fonts/barlow-condensed-latin-700-normal.woff2",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];
const bust = (u) => { const x = new URL(u, self.location.href); x.searchParams.set("v", Date.now()); return x.href; };
const clean = (u) => { const x = new URL(u, self.location.href); x.search = ""; return x.href; };

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (u) => {
      try { const r = await fetch(bust(u), { cache: "no-store" }); if (r.ok) await c.put(clean(u), r); } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data?.type === "SKIP_WAITING") self.skipWaiting(); });

async function networkFirst(req) {
  const key = clean(req.url);
  try {
    const fresh = await fetch(bust(req.url), { cache: "no-store" });
    if (fresh.ok) { const c = await caches.open(CACHE); c.put(key, fresh.clone()); }
    return fresh;
  } catch {
    return (await caches.match(key, { ignoreSearch: true })) || Response.error();
  }
}
async function cacheFirst(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) { const c = await caches.open(CACHE); c.put(clean(req.url), r.clone()); }
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    const page = /analisi\.html$/.test(url.pathname) ? "./analisi.html" : "./index.html";
    e.respondWith(networkFirst(new Request(new URL(page, self.location.href).href)));
    return;
  }
  const p = url.pathname;
  if (/\.(html|js|css|json|webmanifest)$/.test(p) || p.endsWith("/")) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(cacheFirst(req));                         // font e icone
});
