/* Service worker for הסל הזול.
   App shell: cache-first. Catalog data: network-first with cache fallback
   so a daily refresh is picked up when online, and the last catalog works offline.
*/
const SHELL = "ks-shop-shell-v3";
const DATA = "ks-shop-data-v1";
const SHELL_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL && k !== DATA)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isDataRequest(url) {
  return url.pathname.includes("/data/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isDataRequest(url)) {
    event.respondWith(networkFirst(req, DATA));
    return;
  }
  event.respondWith(cacheFirst(req, SHELL));
});

async function cacheFirst(req, bucket) {
  const cache = await caches.open(bucket);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    if (req.mode === "navigate") {
      const fallback = await cache.match("./index.html") || await cache.match("./");
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function networkFirst(req, bucket) {
  const cache = await caches.open(bucket);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
