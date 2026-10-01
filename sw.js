// GeoLente: caché propia. Comparte origen con otras PWAs en github.io, así que SOLO borra cachés "geolente-*".
// GitHub Pages cambia la ETag de TODOS los archivos en cada publicación (mtime-tamaño), aunque no cambien:
// por eso los datos y las librerías van en una caché aparte que se usa primero y solo se renueva al subir DATOS.
const VER = 'geolente-v29';        // código de la app (html, css, js): subir en cada publicación
const DATOS = 'geolente-datos-1';  // data/ y vendor/: subir SOLO cuando cambie algún archivo de esas carpetas
const CACHE_GEO = 'geolente-geo', CACHE_DEM = 'geolente-dem', CACHE_SAT = 'geolente-sat';
const SHELL = ['./', 'index.html', 'estilo.css', 'app.js', 'contenido.js', 'mapas.js', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];
const PESADOS = ['vendor/three/three.module.min.js', 'vendor/three/three.core.js', 'vendor/three/lines/Line2.js', 'vendor/three/lines/LineGeometry.js',
  'vendor/three/lines/LineMaterial.js', 'vendor/three/lines/LineSegments2.js', 'vendor/three/lines/LineSegmentsGeometry.js',
  'data/unidades.json', 'data/fallas.json', 'data/declinacion.json', 'data/geo/index.json', 'data/cumbres.json', 'data/localidades.json',
  'data/mapas/index.json', 'data/mapas/rc.json', 'data/mapas/cc.json'];
const esMia = k => k.startsWith('geolente-');
const TIEMPO_RED = 3500;  // en terreno con mala señal no se espera más que esto por el código nuevo

self.addEventListener('install', e => e.waitUntil((async () => {
  await (await caches.open(VER)).addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
  // los datos solo se bajan si faltan (con DATOS sin cambios, una versión nueva baja ~250 kB y no ~3 MB)
  const c = await caches.open(DATOS);
  await Promise.all(PESADOS.map(async u => { if (!(await c.match(u))) try { await c.add(new Request(u, { cache: 'reload' })); } catch {} }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => esMia(k) &&
  ((k.startsWith('geolente-v') && k !== VER) || (k.startsWith('geolente-datos-') && k !== DATOS))).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));

const primeroCache = (nombre, req) => caches.open(nombre).then(async c => {
  const hit = await c.match(req, { ignoreSearch: true }); if (hit) return hit;
  const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const local = u.origin === location.origin;
  const runtime = u.hostname === 's3.amazonaws.com' && u.pathname.startsWith('/elevation-tiles-prod/') ? CACHE_DEM
    : u.hostname === 'server.arcgisonline.com' && u.pathname.includes('/World_Imagery/') ? CACHE_SAT
    : local && u.pathname.includes('/data/geo/') && !u.pathname.endsWith('/index.json') ? CACHE_GEO
    : local && (u.pathname.includes('/data/') || u.pathname.includes('/vendor/')) ? DATOS : null;
  if (runtime) { e.respondWith(primeroCache(runtime, e.request)); return; }
  if (!local) return;
  // código: primero red (para recibir actualizaciones) pero con tiempo límite; si no, la copia guardada
  // cache: 'no-cache' = revalidar con el servidor (GitHub Pages deja 10 min de caché HTTP y se servía código viejo)
  e.respondWith((async () => {
    const red = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) { const copia = r.clone(); caches.open(VER).then(c => c.put(e.request, copia)); } return r; });
    const guardada = await caches.match(e.request, { ignoreSearch: true });
    if (!guardada) return red;
    return Promise.race([red.catch(() => guardada), new Promise(ok => setTimeout(() => ok(guardada), TIEMPO_RED))]);
  })());
});
