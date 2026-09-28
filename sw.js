// GeoLente: caché propia. Comparte origen con otras PWAs en github.io, así que SOLO borra cachés "geolente-*".
const VER = 'geolente-v2';
const CACHE_APP = VER, CACHE_GEO = 'geolente-geo', CACHE_DEM = 'geolente-dem';
const APP = ['./', 'index.html', 'estilo.css', 'app.js', 'contenido.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/three/three.module.min.js', 'vendor/three/three.core.js', 'vendor/three/lines/Line2.js', 'vendor/three/lines/LineGeometry.js',
  'vendor/three/lines/LineMaterial.js', 'vendor/three/lines/LineSegments2.js', 'vendor/three/lines/LineSegmentsGeometry.js',
  'data/unidades.json', 'data/fallas.json', 'data/declinacion.json', 'data/geo/index.json', 'data/cumbres.json'];
const esMia = k => k.startsWith('geolente-');
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE_APP).then(c => c.addAll(APP)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(
  ks.filter(k => esMia(k) && k.startsWith('geolente-v') && k !== CACHE_APP).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const runtime = u.hostname === 's3.amazonaws.com' && u.pathname.startsWith('/elevation-tiles-prod/') ? CACHE_DEM
    : (u.origin === location.origin && u.pathname.includes('/data/geo/')) ? CACHE_GEO : null;
  if (runtime) {
    e.respondWith(caches.open(runtime).then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r;
    }));
    return;
  }
  if (u.origin !== location.origin) return;
  // app: primero red (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copia = r.clone(); caches.open(CACHE_APP).then(c => c.put(e.request, copia)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
