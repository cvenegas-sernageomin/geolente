// GeoLente — mapa geológico en realidad aumentada sobre los cerros.
// Marco local: x = este, y = arriba, z = -norte (metros, relativo al origen). La cámara mira hacia -z cuando apunta al norte.
import * as THREE from 'three';
import { Line2 } from './vendor/three/lines/Line2.js';
import { LineMaterial } from './vendor/three/lines/LineMaterial.js';
import { LineGeometry } from './vendor/three/lines/LineGeometry.js';
import { LineSegments2 } from './vendor/three/lines/LineSegments2.js';
import { LineSegmentsGeometry } from './vendor/three/lines/LineSegmentsGeometry.js';
import { CATEGORIAS, datoMarino, contextoEdad, periodo, era, FALLA, svgFalla } from './contenido.js';
import { cargarMapas, pintarMapa, colorUnidad, dentroBorde } from './mapas.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const R_TIERRA = 6371000, REFRACCION = 0.13, FOV_DEF = 68;

const CFG = {
  alcance: +(leer('alcance') || 25000), nGrid: 481, tex: 2048, ojo: 1.7,
  fadeCerca: 220, fadeLejos: 600, opacidad: +(leer('opacidad') || 0.5),
  fovLargo: +(leer('fov') || FOV_DEF), // FOV de la cámara del teléfono en su lado largo (grados); se calibra en 🎯 paso 2
  fallas: leer('fallas') !== '0', etiquetas: leer('etiquetas') !== '0',
  perfil: leer('perfil') !== '0', cumbres: leer('cumbres') !== '0',
  capa: +(leer('capa') || 0), // 0 = mapa geológico, 1 = imagen satelital, 2 = satelital + geología
  detalle: leer('detalle') !== '0', pins: leer('pins') !== '0', // mapas detallados 1:50.000 y sus dataciones/fósiles
};

export const LUGARES = [
  { n: 'El Enladrillado · valle del Río Claro', ico: '🗺️', d: 'Desde el mirador de Altos de Lircay: el volcán Descabezado Grande y su lava en el valle, con el mapa geológico detallado 1:50.000.', lat: -35.6023, lon: -70.9744, rumbo: 92 },
  { n: 'Baños Morales · Cajón del Maipo', ico: '🌋', d: 'El volcán San José y el Morado a pocos kilómetros, con 13 unidades geológicas en 10 km a la redonda.', lat: -33.7925, lon: -70.0803, rumbo: 0 },
  { n: 'Alto Valle del Elqui · Coquimbo', ico: '🏜️', d: 'Cordillera desértica cerca de los 30°S: 13 unidades geológicas distintas en un radio de 10 km.', lat: -30.0500, lon: -70.0500, rumbo: 0 },
];

// ------------------------------------------------------------------ utilidades
function leer(k) { try { return localStorage.getItem('geolente:' + k); } catch { return null; } }
function guardar(k, v) { try { localStorage.setItem('geolente:' + k, v); } catch { } }
const nf1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const envolver = a => ((a % 360) + 540) % 360 - 180;
function fmtMa(ma) {
  if (ma < 0.001) return `${nf0.format(ma * 1e6)} años`;
  if (ma < 1) return `${nf0.format(ma * 1000)} mil años`;
  return `${nf1.format(ma)} millones de años`;
}
function fmtRango(u, corto) {
  if (!u.ma) return '';
  const [a, b] = u.ma;
  const num = x => x < 10 ? nf1.format(x) : nf0.format(x);
  if (b < 0.012) return a < 1 ? `últimos ${fmtMa(a)}` : `últimos ${num(a)} millones de años`;
  if (a < 1) return `hace ${fmtMa(a).replace(' mil años', '')}–${fmtMa(b)}`;
  if (corto) return `hace ${num(a)}–${num(b)} millones de años`;
  return `entre ${num(a)} y ${num(b)} millones de años atrás`;
}
const edadCorta = t => t.replace(/\s*\(.*?\)/g, '').replace(/-/g, '–').trim();
function fmtDist(m) { return m < 1000 ? `${nf0.format(m)} m` : `${nf1.format(m / 1000)} km`; }
function toast(t, ms = 3200) {
  const el = $('#toast'); el.textContent = t; el.classList.add('ver');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('ver'), ms);
}
function cargando(t) { const el = $('#cargando'); if (t) { el.querySelector('p').textContent = t; el.hidden = false; } else el.hidden = true; }

// ------------------------------------------------------------------ pantalla horizontal "virtual"
// Si la pantalla queda fija en vertical (PWA bloqueada o rotación automática apagada) y el teléfono se pone
// horizontal, la app gira ella misma la interfaz: VIRT = ángulo de pantalla simulado (0, 90 o -90).
let VIRT = 0;
const VW = () => VIRT ? innerHeight : innerWidth, VH = () => VIRT ? innerWidth : innerHeight;
function aVirtual(x, y) { return VIRT === 90 ? { x: y, y: innerWidth - x } : VIRT === -90 ? { x: innerHeight - y, y: x } : { x, y }; }
function fijarVirt(a) {
  if (a === VIRT) return;
  VIRT = a;
  document.body.classList.toggle('virt90', a === 90); document.body.classList.toggle('virt-90', a === -90);
  ajustarTamano();
}

// ------------------------------------------------------------------ proyección local
let O = null;
function setOrigen(lat, lon) {
  const f = lat * Math.PI / 180;
  O = { lat, lon, mLat: 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f), mLon: 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) };
}
const aEN = (lon, lat) => [(lon - O.lon) * O.mLon, (lat - O.lat) * O.mLat];
const aLL = (e, n) => [O.lon + e / O.mLon, O.lat + n / O.mLat];

// ------------------------------------------------------------------ relieve (teselas Terrarium)
const DEM = { z: 12, x0: 0, y0: 0, nx: 0, ny: 0, data: null, fallidas: 0 };
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };

const LEJOS = 70000; // el horizonte real (la alta cordillera) suele estar a 40–70 km
let DEM2 = null;       // mosaico lejano, solo para perfil, cumbres y visibilidad
async function mosaico(z, R, progreso) {
  const [lonW, latS] = aLL(-R, -R), [lonE, latN] = aLL(R, R);
  const x0 = Math.floor(lon2tx(lonW, z)), x1 = Math.floor(lon2tx(lonE, z));
  const y0 = Math.floor(lat2ty(latN, z)), y1 = Math.floor(lat2ty(latS, z));
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, W = nx * 256;
  const data = new Float32Array(nx * ny * 65536).fill(NaN);
  let fallidas = 0;
  const trabajos = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) trabajos.push([tx, ty]);
  await Promise.all(trabajos.map(async ([tx, ty]) => {
    try {
      const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`);
      if (!r.ok) throw new Error(r.status);
      const png = await decodificarPNG(await r.arrayBuffer());
      const px = png.px, bpp = png.bpp;
      const ox = (tx - x0) * 256, oy = (ty - y0) * 256;
      for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
        const k = (j * 256 + i) * bpp;
        data[(oy + j) * W + ox + i] = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
      }
    } catch { fallidas++; }
    progreso?.();
  }));
  // tamaño de píxel en metros en el origen (para muestrear el perfil a esa resolución)
  const pxm = 40075016.7 * Math.cos(O.lat * Math.PI / 180) / 2 ** z / 256;
  return { z, x0, y0, nx, ny, data, fallidas, pxm, n: trabajos.length };
}
async function cargarDEM(A, progreso) {
  const zc = A > 30000 ? 11 : 12; // z12 ≈ 30 m (SRTM 1"): la forma de los cerros tiene que calzar
  const cuenta = (z, R) => { const [a, b] = aLL(-R, -R), [c, d] = aLL(R, R); return (Math.floor(lon2tx(c, z)) - Math.floor(lon2tx(a, z)) + 1) * (Math.floor(lat2ty(b, z)) - Math.floor(lat2ty(d, z)) + 1); };
  const total = cuenta(zc, A * 1.05) + cuenta(10, LEJOS * 1.02);
  let hechas = 0; const avance = () => progreso?.(++hechas / total);
  const [cerca, lejos] = await Promise.all([mosaico(zc, A * 1.05, avance), mosaico(10, LEJOS * 1.02, avance)]);
  Object.assign(DEM, cerca); DEM2 = lejos;
}
// Decodificador PNG mínimo (8 bits, RGB o RGBA). No se usa canvas.getImageData porque Brave (y otros navegadores
// con protección anti-huella) le suman ruido a los píxeles: en Terrarium ±1 en el rojo son ±256 m → "conos" en el relieve.
async function decodificarPNG(buf) {
  const dv = new DataView(buf), idat = [];
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  while (p + 8 <= buf.byteLength) {
    const len = dv.getUint32(p), tipo = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    if (tipo === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); bd = dv.getUint8(p + 16); ct = dv.getUint8(p + 17); }
    else if (tipo === 'IDAT') idat.push(new Uint8Array(buf, p + 8, len));
    else if (tipo === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error('PNG no soportado');
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const bpp = ct === 6 ? 4 : 3, st = w * bpp, out = new Uint8Array(h * st);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], src = y * (st + 1) + 1, o = y * st;
    for (let x = 0; x < st; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0, b = y ? out[o - st + x] : 0, c = x >= bpp && y ? out[o - st + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[o + x] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}
function muestrear(M, lon, lat) {
  if (!M) return NaN;
  const W = M.nx * 256, H = M.ny * 256;
  const fx = lon2tx(lon, M.z) * 256 - M.x0 * 256 - 0.5, fy = lat2ty(lat, M.z) * 256 - M.y0 * 256 - 0.5;
  if (fx < 0 || fy < 0 || fx > W - 1.001 || fy > H - 1.001) return NaN;
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, d = M.data;
  const a = d[j * W + i], b = d[j * W + i + 1], c = d[(j + 1) * W + i], e = d[(j + 1) * W + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
}
// primero el mosaico fino; fuera de él (o en una tesela fallida) el lejano
function elevLL(lon, lat) {
  let h = muestrear(DEM, lon, lat);
  if (!Number.isFinite(h)) h = muestrear(DEM2, lon, lat);
  return Number.isFinite(h) ? h : 0;
}
// altura en el marco local, con curvatura terrestre y refracción
function hLocal(e, n) {
  const [lon, lat] = aLL(e, n);
  return elevLL(lon, lat) - (1 - REFRACCION) * (e * e + n * n) / (2 * R_TIERRA);
}

// ------------------------------------------------------------------ datos geológicos
let UNI = null, INDICE = null, FALLAS = null, DECL = null, CUMBRES = [], MAPAS = null;
async function cargarBase() {
  const [u, i, f, d] = await Promise.all(['data/unidades.json', 'data/geo/index.json', 'data/fallas.json', 'data/declinacion.json']
    .map(p => fetch(p).then(r => r.json())));
  UNI = u; INDICE = new Set(i.teselas); FALLAS = f; DECL = d;
  try { CUMBRES = (await (await fetch('data/cumbres.json')).json()).c; } catch { CUMBRES = []; }
  try { MAPAS = await (await fetch('data/mapas/index.json')).json(); } catch { MAPAS = null; }
  // "S I" del mapa 1:1M = lagos y glaciares; se separan con el relieve (ver clasificarAguaHielo)
  UNI['S I·lago'] = { ...u['S I'], cod: 'S I·lago', cat: 'lago', titulo: 'Lago', edad: '', color: '#6FAFD9', desc: 'Cuerpo de agua: el mapa no asigna una unidad de roca.' };
  UNI['S I·glaciar'] = { ...u['S I'], cod: 'S I·glaciar', cat: 'glaciaractual', titulo: 'Glaciar', edad: '', color: '#E4F0F8', desc: 'Cuerpo de hielo: el mapa no asigna una unidad de roca.' };
  for (const x of FALLAS.f) x.n = (x.n || '').replace(/\*+/g, '').trim();
  // largo total y número de tramos por falla con nombre (el catálogo la divide en segmentos)
  const tot = new Map();
  for (const x of FALLAS.f) if (x.n) { const t = tot.get(x.n) || { km: 0, n: 0 }; t.km += x.km; t.n++; tot.set(x.n, t); }
  for (const x of FALLAS.f) if (x.n) { x.kmTotal = tot.get(x.n).km; x.tramos = tot.get(x.n).n; }
}
function declinacion(lat, lon) {
  const d = DECL; if (!d) return 0;
  const fy = Math.min(Math.max(lat - d.lat0, 0), d.d.length - 1.001), fx = Math.min(Math.max(lon - d.lon0, 0), d.d[0].length - 1.001);
  const j = fy | 0, i = fx | 0, v = fy - j, u = fx - i, g = d.d;
  return (g[j][i] * (1 - u) + g[j][i + 1] * u) * (1 - v) + (g[j + 1][i] * (1 - u) + g[j + 1][i + 1] * u) * v;
}
function decodificar(arr, q) {
  const out = new Float64Array(arr.length); let x = 0, y = 0;
  for (let k = 0; k < arr.length; k += 2) { x += arr[k]; y += arr[k + 1]; out[k] = x / q; out[k + 1] = y / q; }
  return out;
}
async function cargarGeologia(A) {
  const [lonW, latS] = aLL(-A, -A), [lonE, latN] = aLL(A, A);
  const claves = [];
  for (let ty = Math.floor(latS / 0.5); ty <= Math.floor(latN / 0.5); ty++)
    for (let tx = Math.floor(lonW / 0.5); tx <= Math.floor(lonE / 0.5); tx++)
      if (INDICE.has(`${ty}_${tx}`)) claves.push(`${ty}_${tx}`);
  const vistos = new Set(), polys = [];
  for (const js of await Promise.all(claves.map(k => fetch(`data/geo/${k}.json`).then(r => r.json())))) {
    for (const p of js.p) {
      if (vistos.has(p.id)) continue; vistos.add(p.id);
      const anillos = p.r.map(r => decodificar(r, js.q));
      const ex = anillos[0]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = 0; k < ex.length; k += 2) { x0 = Math.min(x0, ex[k]); x1 = Math.max(x1, ex[k]); y0 = Math.min(y0, ex[k + 1]); y1 = Math.max(y1, ex[k + 1]); }
      if (x1 < lonW || x0 > lonE || y1 < latS || y0 > latN) continue;
      polys.push({ cod: js.u[p.u], anillos, bb: [x0, y0, x1, y1], lab: [p.l[0] / js.q, p.l[1] / js.q], area: p.a });
    }
  }
  return polys;
}
// lago = plano; glaciar = con pendiente (se mide el rango de altura alrededor del punto interior)
function clasificarAguaHielo() {
  for (const p of ESC.polys) {
    if (p.cod !== 'S I') continue;
    const [lon, lat] = p.lab, d = 0.0025; let mn = 1e9, mx = -1e9;
    for (const [a, b] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
      const [e, n] = aEN(lon + a, lat + b);
      if (Math.abs(e) > CFG.alcance * 1.04 || Math.abs(n) > CFG.alcance * 1.04) continue;
      const h = elevLL(lon + a, lat + b); mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    p.cod = mx - mn < 12 && mx > -1e8 ? 'S I·lago' : 'S I·glaciar';
  }
}
function dentroAnillo(r, x, y) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function unidadEn(lon, lat) {
  // primero los mapas detallados (1:50.000); fuera de ellos, el 1:1M
  for (const p of ESC.polysDet) {
    const b = p.bb; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (!dentroAnillo(p.anillos[0], lon, lat)) continue;
    let hueco = false; for (let k = 1; k < p.anillos.length; k++) if (dentroAnillo(p.anillos[k], lon, lat)) { hueco = true; break; }
    if (!hueco) return p.cod;
  }
  for (const p of ESC.polys) {
    const b = p.bb; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (!dentroAnillo(p.anillos[0], lon, lat)) continue;
    let hueco = false; for (let k = 1; k < p.anillos.length; k++) if (dentroAnillo(p.anillos[k], lon, lat)) { hueco = true; break; }
    if (!hueco) return p.cod;
  }
  return null;
}

// ------------------------------------------------------------------ mapas detallados (1:50.000)
// Sus unidades se agregan a UNI con clave "<mapa>:<código>" para que etiquetas, mira, fichas y colección funcionen igual.
const NOM_FALLA = { inversa: 'inversa', normal: 'normal', sinistral: 'de rumbo sinistral', dextral: 'de rumbo dextral', rumbo: 'de rumbo', indet: 'indeterminada' };
const INF_FALLA = ['observada', 'inferida', 'cubierta'];
async function cargarDetalle(A) {
  ESC.det = []; ESC.polysDet = []; ESC.fallasDet = []; ESC.pins = [];
  if (!MAPAS || !CFG.detalle) return;
  const [w, s] = aLL(-A, -A), [e, n] = aLL(A, A);
  ESC.det = await cargarMapas(MAPAS, [w, s, e, n]);
  for (const M of ESC.det) {
    for (const [cod, u] of Object.entries(M.u)) {
      const clave = `${M.id}:${cod}`;
      UNI[clave] = {
        cod: clave, codigo: cod, cat: CATEGORIAS[u.cat] ? u.cat : 'sininfo', titulo: u.n || `Unidad ${cod}`, edad: u.e, pisos: u.pi, ma: u.ma, aprox: u.ap,
        color: colorUnidad(u), desc: [u.def, u.d].filter(Boolean).join(' · '), tipo: u.t, geocron: u.g, mapa: M.titulo, hoja: M.hoja,
        que: u.q, ver: u.v, dato: u.dt, facies: u.fa, edadGrande: u.eg, ref: u.ref,
      };
    }
    for (const p of M.polys) ESC.polysDet.push({ ...p, cod: `${M.id}:${p.cod}`, M });
    M.lf.forEach(l => ESC.fallasDet.push({ ...l, M }));
    M.pg.forEach(([lon, lat, txt, met, mat, lit, uni, sigla, ref]) => ESC.pins.push({ tipo: 'dat', lon, lat, txt, met, mat, lit, uni, sigla, ref, M }));
    M.pf.forEach(([lon, lat, tipo, loc, edad, ref]) => ESC.pins.push({ tipo: 'fos', lon, lat, txt: tipo, loc, edad, ref, M }));
  }
}
// ¿hay mapas detallados en la zona? (se calcula con el índice, aunque estén apagados)
function mapasEnZona() {
  if (!MAPAS || !O) return [];
  const A = CFG.alcance, [w, s] = aLL(-A, -A), [e, n] = aLL(A, A);
  return MAPAS.mapas.filter(m => m.bbox[2] > w && m.bbox[0] < e && m.bbox[3] > s && m.bbox[1] < n);
}
function actualizarInfoDetalle() {
  const hay = mapasEnZona();
  $('#detalle-info').textContent = hay.length ? hay.map(m => m.titulo).join(' · ') : 'no hay en esta zona';
  $('#c-detalle').disabled = !hay.length;
  $('#fila-detalle').classList.toggle('apagado', !hay.length);
  $('#c-pins').disabled = !hay.length || !CFG.detalle;
  $('#c-pins').closest('label').classList.toggle('apagado', !hay.length || !CFG.detalle);
}
// datos de una falla: índice numérico = catálogo CHAF; 'd<n>' = falla de un mapa detallado
const fallaDet = fi => typeof fi === 'string' ? ESC.fallasDet[+fi.slice(1)] : null;
function nombreFalla(fi) { const d = fallaDet(fi); return d ? d.n : FALLAS.f[fi].n; }

// ------------------------------------------------------------------ escena three.js
const ESC = { polys: [], polysDet: [], det: [], fallasDet: [], pins: [], fallas: [], cand: [], candF: [], listo: false, modo: 'explorar' };
let renderer, scene, camera, terrenoColor, terrenoProf, grupoFallas, texMapa, texSat = null, texVacia, texDet = [];

function iniciarThree() {
  texVacia = new THREE.DataTexture(new Uint8Array([138, 132, 120, 255]), 1, 1); texVacia.needsUpdate = true;
  renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 8, 110000);
  camera.rotation.order = 'YXZ';
  addEventListener('resize', ajustarTamano);
  ajustarTamano();
}
function ajustarTamano() {
  if (!renderer) return; // la cámara puede encenderse antes que el visor 3D
  const b = document.body.style; b.setProperty('--W', innerWidth + 'px'); b.setProperty('--H', innerHeight + 'px');
  const w = VW(), h = VH();
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = fovVertical();
  camera.updateProjectionMatrix();
  grupoFallas?.children.forEach(l => l.material.resolution.set(w, h));
  grupoPerfil?.children.forEach(l => l.material.resolution.set(w, h));
}
// FOV vertical visible en pantalla, a partir del FOV del lado largo del video y del recorte "cover".
function fovVertical() {
  if (ESC.modo !== 'ar') return CFG.fovExplorar || 60;
  const v = $('#cam'), sw = innerWidth, sh = innerHeight; // el video siempre se muestra en el marco real del teléfono
  let vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
  const esc = Math.max(sw / vw, sh / vh), dw = vw * esc, dh = vh * esc;
  const f = (Math.max(dw, dh) / 2) / Math.tan(CFG.fovLargo * Math.PI / 360);
  return 2 * Math.atan((VH() / 2) / f) * 180 / Math.PI;
}

const VS = `
varying vec2 vUv; varying float vDist; varying vec3 vN;
void main(){ vUv = uv; vN = normal; vec4 wp = modelMatrix * vec4(position,1.0);
  vDist = length(wp.xz - cameraPosition.xz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const FS = `
uniform sampler2D mapa, sat, det0, det1; uniform vec4 b0, b1; uniform float nDet;
uniform float opacidad, fadeCerca, fadeLejos, modoAR, soloProf, alcance, capa; uniform vec3 luz, cielo;
varying vec2 vUv; varying float vDist; varying vec3 vN;
// mapa detallado encima del 1:1M, dentro de su rectángulo b = (u0, v0, u1, v1)
float dA = 0.0;
vec4 encima(vec4 t, sampler2D d, vec4 b) {
  vec2 q = (vUv - b.xy) / (b.zw - b.xy);
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return t;
  vec4 c = texture2D(d, q); dA = max(dA, c.a);
  return vec4(mix(t.rgb, c.rgb, c.a), max(t.a, c.a));
}
void main(){
  if (modoAR > 0.5 && vDist < fadeCerca) discard;
  if (soloProf > 0.5) { gl_FragColor = vec4(0.0); return; }
  vec4 t = texture2D(mapa, vUv);
  if (nDet > 0.5) t = encima(t, det0, b0);
  if (nDet > 1.5) t = encima(t, det1, b1);
  float sh = clamp(dot(normalize(vN), luz), 0.0, 1.0);
  float fade = (modoAR > 0.5 ? smoothstep(fadeCerca, fadeLejos, vDist) : 1.0) * (1.0 - smoothstep(alcance*0.88, alcance, max(abs(vUv.x-0.5), abs(vUv.y-0.5))*2.0*alcance));
  vec3 s = texture2D(sat, vUv).rgb; // capas 1 y 2: foto satelital drapeada sobre el relieve (ya trae sus propias sombras)
  if (modoAR > 0.5) {
    if (capa > 0.5) {
      float a = opacidad * fade; if (a < 0.02) discard;
      gl_FragColor = vec4(capa > 1.5 ? mix(s, t.rgb, t.a * 0.5) : s, a);
      return;
    }
    float a = t.a * opacidad * fade; if (a < 0.02) discard;
    vec3 cc = mix(vec3(dot(t.rgb, vec3(0.299,0.587,0.114))), t.rgb, mix(0.82, 1.0, dA)); // el mapa detallado con sus colores originales
    gl_FragColor = vec4(cc, a);
  } else {
    vec3 base = vec3(0.60, 0.57, 0.52);
    vec3 tc = mix(vec3(dot(t.rgb, vec3(0.299,0.587,0.114))), t.rgb, mix(0.8, 1.0, dA));
    vec3 c = mix(base, tc, t.a * (0.35 + 0.65 * opacidad)) * mix(0.38 + 0.8 * sh, 0.62 + 0.45 * sh, dA); // sombreado más suave sobre el mapa detallado
    if (capa > 0.5) c = mix(s, tc, capa > 1.5 ? t.a * opacidad : 0.0) * (0.8 + 0.3 * sh);
    float niebla = smoothstep(alcance * 0.15, alcance * 1.1, vDist) * 0.55;
    gl_FragColor = vec4(mix(c, cielo, niebla), 1.0);
  }
}`;

function pintarTextura(A) {
  const S = CFG.tex, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const px = (lon, lat) => { const [e, n] = aEN(lon, lat); return [(e + A) / (2 * A) * S, (A - n) / (2 * A) * S]; };
  const trazar = p => {
    ctx.beginPath();
    for (const r of p.anillos) {
      for (let k = 0; k < r.length; k += 2) { const [x, y] = px(r[k], r[k + 1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath();
    }
  };
  // los sedimentos sueltos del fondo de valles (donde suele estar la ciudad) van más tenues: el protagonista es el cerro
  const TENUE = new Set(['aluvial', 'fluvial', 'playa', 'duna']);
  for (const p of ESC.polys) { ctx.globalAlpha = TENUE.has(UNI[p.cod].cat) ? 0.45 : 1; ctx.fillStyle = UNI[p.cod].color; trazar(p); ctx.fill('evenodd'); }
  ctx.globalAlpha = 1;
  // contactos: línea oscura con borde claro, para que se lean sobre la foto
  ctx.lineJoin = 'round';
  for (const [w, c] of [[S / 700, 'rgba(15,20,28,0.55)'], [S / 1800, 'rgba(255,255,255,0.85)']]) {
    ctx.lineWidth = w; ctx.strokeStyle = c;
    for (const p of ESC.polys) { trazar(p); ctx.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Un canvas por mapa detallado (máx. 2): cada uno cubre solo su hoja, así la resolución llega a ~5–7 m por píxel
function pintarDetalle(A) {
  const S = Math.min(4096, renderer.capabilities.maxTextureSize);
  return ESC.det.slice(0, 2).map(M => {
    const r = pintarMapa(M, A, aEN, S); if (!r) return null;
    const t = new THREE.CanvasTexture(r.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return { t, uv: r.uv, M };
  }).filter(Boolean);
}

// Imagen satelital (Esri World Imagery, CORS abierto): mosaico de teselas dibujado en el mismo cuadrado ±A que el mapa.
// Dentro de una tesela la diferencia entre Mercator y el marco local es despreciable, así que basta con drawImage por tesela.
async function cargarSatelite(A, gen) {
  const S = Math.min(4096, renderer.capabilities.maxTextureSize), mpp = 2 * A / S;
  const [lonW, latS] = aLL(-A, -A), [lonE, latN] = aLL(A, A);
  let z = Math.min(16, Math.max(10, Math.round(Math.log2(40075016.7 * Math.cos(O.lat * Math.PI / 180) / 256 / mpp))));
  const rango = z => [Math.floor(lon2tx(lonW, z)), Math.floor(lon2tx(lonE, z)), Math.floor(lat2ty(latN, z)), Math.floor(lat2ty(latS, z))];
  let [x0, x1, y0, y1] = rango(z);
  while ((x1 - x0 + 1) * (y1 - y0 + 1) > 300 && z > 10) [x0, x1, y0, y1] = rango(--z);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#8a8478'; ctx.fillRect(0, 0, S, S);
  const px = (lon, lat) => { const [e, n] = aEN(lon, lat); return [(e + A) / (2 * A) * S, (A - n) / (2 * A) * S]; };
  const tx2lon = x => x / 2 ** z * 360 - 180, ty2lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
  const tareas = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tareas.push([x, y]);
  let hechas = 0, fallidas = 0;
  await Promise.all(tareas.map(async ([x, y]) => {
    try {
      const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
      if (!r.ok) throw new Error(r.status);
      const img = await createImageBitmap(await r.blob());
      const [a, b] = px(tx2lon(x), ty2lat(y)), [c, d] = px(tx2lon(x + 1), ty2lat(y + 1));
      ctx.drawImage(img, a, b, c - a + 0.6, d - b + 0.6); img.close?.();
    } catch { fallidas++; }
    if (gen === generacion && ++hechas % 12 === 0) toast(`🛰️ Bajando imagen satelital… ${Math.round(hechas / tareas.length * 100)} %`, 1500);
  }));
  if (gen !== generacion) return;
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  texSat = t;
  for (const m of [terrenoColor, terrenoProf]) if (m) { m.material.uniforms.sat.value = t; m.material.uniforms.capa.value = CFG.capa; }
  toast(fallidas ? `🛰️ Imagen satelital lista (faltaron ${fallidas} de ${tareas.length} teselas)` : '🛰️ Imagen satelital lista · Esri, Maxar, Earthstar Geographics', 3500);
}
let cargandoSat = 0;
function fijarCapa(c) {
  CFG.capa = c; guardar('capa', c);
  document.querySelectorAll('#fondos [data-capa]').forEach(b => b.classList.toggle('activo', +b.dataset.capa === c));
  if (!terrenoColor) return;
  if (c > 0 && !texSat) {
    if (cargandoSat !== generacion) { cargandoSat = generacion; cargarSatelite(CFG.alcance, generacion).catch(e => { console.error(e); toast('No se pudo bajar la imagen satelital.'); }); }
    return;
  }
  for (const m of [terrenoColor, terrenoProf]) m.material.uniforms.capa.value = c;
}

function construirTerreno(A) {
  const N = CFG.nGrid, a = 0.4;
  const s = u => A * u * (a + (1 - a) * Math.abs(u)); // malla más densa cerca del observador
  const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const e = s(-1 + 2 * i / (N - 1)), n = s(-1 + 2 * j / (N - 1)), k = j * N + i;
    pos[k * 3] = e; pos[k * 3 + 1] = hLocal(e, n); pos[k * 3 + 2] = -n;
    uv[k * 2] = (e + A) / (2 * A); uv[k * 2 + 1] = (n + A) / (2 * A);
  }
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const k = j * N + i; idx.push(k, k + 1, k + N, k + 1, k + N + 1, k + N);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const uni = () => ({
    mapa: { value: texMapa }, sat: { value: texSat || texVacia }, capa: { value: texSat ? CFG.capa : 0 }, opacidad: { value: CFG.opacidad }, fadeCerca: { value: CFG.fadeCerca }, fadeLejos: { value: CFG.fadeLejos },
    det0: { value: texDet[0]?.t || texVacia }, det1: { value: texDet[1]?.t || texVacia }, nDet: { value: Math.min(2, texDet.length) },
    b0: { value: new THREE.Vector4(...(texDet[0]?.uv || [0, 0, 1, 1])) }, b1: { value: new THREE.Vector4(...(texDet[1]?.uv || [0, 0, 1, 1])) },
    modoAR: { value: ESC.modo === 'ar' ? 1 : 0 }, soloProf: { value: 0 }, alcance: { value: A },
    luz: { value: new THREE.Vector3(-0.5, 0.75, 0.45).normalize() }, cielo: { value: new THREE.Color(0xbfd6ea) },
  });
  // 1) pasada solo de profundidad: así solo se colorea la superficie más cercana (sin doble transparencia)
  const mProf = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: uni(), colorWrite: false });
  mProf.uniforms.soloProf.value = 1;
  const mColor = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: uni(), transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth });
  terrenoProf = new THREE.Mesh(g, mProf); terrenoProf.renderOrder = 0;
  terrenoColor = new THREE.Mesh(g, mColor); terrenoColor.renderOrder = 1;
  scene.add(terrenoProf, terrenoColor);
}
// Relieve lejano (hasta 70 km) solo para el modo explorar: fondo gris con niebla, para que el horizonte no flote en el cielo
let terrenoLejos = null;
function construirTerrenoLejano() {
  const N = 201, L = LEJOS * 0.97, a = 0.25;
  const s = u => L * u * (a + (1 - a) * Math.abs(u));
  const pos = new Float32Array(N * N * 3), idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const e = s(-1 + 2 * i / (N - 1)), n = s(-1 + 2 * j / (N - 1)), k = j * N + i;
    pos[k * 3] = e; pos[k * 3 + 1] = hLocal(e, n) - 25; pos[k * 3 + 2] = -n; // 25 m más abajo: el relieve fino manda donde se solapan
  }
  // hueco donde está el relieve fino: si no, en circos y quebradas el mosaico grueso (z10) asoma como manchas grises
  const H = CFG.alcance * 0.98, fuera = k => Math.abs(pos[k * 3]) > H || Math.abs(pos[k * 3 + 2]) > H;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const k = j * N + i;
    if (fuera(k) || fuera(k + 1) || fuera(k + N) || fuera(k + N + 1)) idx.push(k, k + 1, k + N, k + 1, k + N + 1, k + N);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const nor = g.attributes.normal, col = new Float32Array(N * N * 3), luz = new THREE.Vector3(-0.5, 0.75, 0.45).normalize(), cielo = new THREE.Color(0xbfd6ea);
  for (let k = 0; k < N * N; k++) {
    const sh = Math.max(0, nor.getX(k) * luz.x + nor.getY(k) * luz.y + nor.getZ(k) * luz.z);
    const f = Math.min(1, Math.hypot(pos[k * 3], pos[k * 3 + 2]) / L) * 0.75;
    const b = 0.42 + 0.55 * sh;
    col[k * 3] = (0.60 * b) * (1 - f) + cielo.r * f; col[k * 3 + 1] = (0.58 * b) * (1 - f) + cielo.g * f; col[k * 3 + 2] = (0.55 * b) * (1 - f) + cielo.b * f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  terrenoLejos = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
  terrenoLejos.renderOrder = -1;
  scene.add(terrenoLejos);
}
function actualizarModoShader() {
  if (!terrenoColor) return;
  const ar = ESC.modo === 'ar';
  terrenoColor.material.uniforms.modoAR.value = ar ? 1 : 0;
  terrenoColor.material.transparent = ar; terrenoColor.material.depthWrite = !ar;
  terrenoColor.material.needsUpdate = true;
  terrenoProf.visible = ar;
  if (terrenoLejos) terrenoLejos.visible = !ar;
  terrenoColor.material.uniforms.opacidad.value = CFG.opacidad;
}

const COLOR_ACT = { comprobada: 0xff2d55, probable: 0xff7a1a, posible: 0xffd21a };
function construirFallas(A) {
  grupoFallas = new THREE.Group(); grupoFallas.renderOrder = 2;
  ESC.fallas = []; ESC.candF = [];
  const q = FALLAS.q, lim = A * 0.98;
  const agregar = (ll, fi, color, discont, conEtiqueta, halo = 0x10141c) => {
      // densificar a ~40 m y colgar del relieve
      const pts = [];
      for (let k = 0; k < ll.length - 2; k += 2) {
        const [e0, n0] = aEN(ll[k], ll[k + 1]), [e1, n1] = aEN(ll[k + 2], ll[k + 3]);
        const d = Math.hypot(e1 - e0, n1 - n0), m = Math.max(1, Math.ceil(d / 40));
        for (let s = 0; s < m; s++) { const t = s / m; pts.push([e0 + (e1 - e0) * t, n0 + (n1 - n0) * t]); }
        if (k === ll.length - 4) pts.push([e1, n1]);
      }
      // cortar a los tramos dentro del área
      let tramo = [];
      const cerrar = () => {
        if (tramo.length >= 2) {
          const flat = []; for (const [e, n] of tramo) flat.push(e, hLocal(e, n) + 12, -n);
          const geo = new LineGeometry(); geo.setPositions(flat);
          const mat = new LineMaterial({ color, linewidth: 4.5, dashed: discont, dashSize: 220, gapSize: 140, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false });
          mat.resolution.set(VW(), VH());
          const l = new Line2(geo, mat); if (discont) l.computeLineDistances();
          l.renderOrder = 3; grupoFallas.add(l);
          const mh = new LineMaterial({ color: halo, linewidth: 8, transparent: true, opacity: 0.4, depthTest: true, depthWrite: false });
          mh.resolution.set(VW(), VH());
          const lh = new Line2(geo, mh); lh.renderOrder = 2; grupoFallas.add(lh);
          ESC.fallas.push({ fi, pts: tramo.slice() });
          if (conEtiqueta) for (let k = 0; k < tramo.length; k += 8) {
            const [e, n] = tramo[k];
            ESC.candF.push({ fi, pos: new THREE.Vector3(e, hLocal(e, n) + 12, -n) });
          }
        }
        tramo = [];
      };
      for (const p of pts) { if (Math.abs(p[0]) < lim && Math.abs(p[1]) < lim) tramo.push(p); else cerrar(); }
      cerrar();
  };
  FALLAS.f.forEach((f, fi) => {
    for (const enc of f.g) agregar(decodificar(enc, q), fi, COLOR_ACT[f.act] || 0xff7a1a, /inferida|cubierta|ciega/.test(f.tipo), true);
  });
  // fallas de los mapas detallados: blancas con borde oscuro (no son necesariamente activas); etiqueta solo si tienen nombre
  ESC.fallasDet.forEach((f, i) => agregar(f.ll, 'd' + i, 0xf4f1ea, f.i > 0, !!f.n, 0x000000));
  grupoFallas.visible = CFG.fallas;
  scene.add(grupoFallas);
}

// candidatos para etiquetas: grilla regular + punto interior de cada polígono
function construirCandidatos(A) {
  ESC.cand = [];
  const paso = A / 18;
  for (let n = -A + paso / 2; n < A; n += paso) for (let e = -A + paso / 2; e < A; e += paso) {
    if (Math.hypot(e, n) < 450) continue;
    const [lon, lat] = aLL(e, n), cod = unidadEn(lon, lat);
    if (cod) ESC.cand.push({ cod, pos: new THREE.Vector3(e, hLocal(e, n) + 18, -n), peso: 1 });
  }
  for (const p of [...ESC.polys, ...ESC.polysDet]) {
    const [e, n] = aEN(p.lab[0], p.lab[1]);
    if (Math.abs(e) > A * 0.95 || Math.abs(n) > A * 0.95 || Math.hypot(e, n) < 450) continue;
    if (!p.M && unidadEn(p.lab[0], p.lab[1]) !== p.cod) continue; // polígono 1:1M tapado por un mapa detallado
    ESC.cand.push({ cod: p.cod, pos: new THREE.Vector3(e, hLocal(e, n) + 18, -n), peso: 2 });
  }
}
// dataciones y fósiles de los mapas detallados: etiquetas propias sobre el punto
function prepararPins(A) {
  for (const p of ESC.pins) {
    const [e, n] = aEN(p.lon, p.lat);
    p.pos = Math.abs(e) < A * 0.97 && Math.abs(n) < A * 0.97 ? new THREE.Vector3(e, hLocal(e, n) + 10, -n) : null;
  }
}

// ------------------------------------------------------------------ perfil de los cerros (estilo PeakVisor)
// Para cada azimut (0,1°) se marcha hacia afuera por el relieve guardando el máximo ángulo de elevación.
// Cuando el terreno visible empieza a quedar oculto, el último punto visible es una cresta que tapa lo de atrás:
// esas crestas, unidas entre azimuts vecinos, son las líneas del perfil que se calzan con los cerros reales.
let grupoPerfil = null, perfilPos = null;
const MARGEN_OJO = 6, CERCA_IGNORADO = 200;
async function calcularPerfil(gen) {
  const c = camera.position.clone(), A = CFG.alcance, L = LEJOS * 0.97, NCOL = 3600, cols = new Array(NCOL);
  // se ignoran los primeros 200 m y se suma un margen al ojo: el DEM de 30 m cerca de uno (casas, errores de metros) taparía todo
  // un paso por píxel: ~30 m dentro del alcance (mosaico fino), ~130 m más allá (mosaico lejano)
  const ds = []; for (let d = 200; d < L * 1.42; d += d < A ? DEM.pxm * 0.9 : DEM2.pxm * 0.9) ds.push(d);
  const ojoY = c.y + MARGEN_OJO;
  for (let i0 = 0; i0 < NCOL; i0 += 120) {
    for (let i = i0; i < Math.min(NCOL, i0 + 120); i++) {
      const az = i / NCOL * 2 * Math.PI, se = Math.sin(az), co = Math.cos(az), pts = [];
      let maxT = -Infinity, vis = true, ult = null, cand = null, hondo = 0;
      // una cresta cuenta solo si lo que tapa queda al menos 25 m bajo la visual (evita el "ruido" de lomitas y del fondo de valle)
      const acepta = (cd, d) => cd && cd.d > 150 && hondo >= 25 && d > cd.d * 1.04;
      for (const d of ds) {
        const e = c.x + se * d, n = -c.z + co * d;
        if (Math.abs(e) > L || Math.abs(n) > L) break;
        const h = hLocal(e, n), t = (h - ojoY) / d;
        if (t >= maxT) {
          if (!vis && acepta(cand, d)) pts.push(cand);
          cand = null; maxT = t; vis = true; ult = { d, h, e, n, t };
        } else {
          if (vis) { cand = ult; vis = false; hondo = 0; }
          hondo = Math.max(hondo, (maxT - t) * d);
        }
      }
      if (!vis && acepta(cand, Infinity)) { cand.cielo = true; pts.push(cand); } // la última cresta es el horizonte
      cols[i] = pts;
    }
    await new Promise(r => setTimeout(r, 0));
    if (gen !== generacion) return;
  }
  // unir crestas de columnas vecinas con distancia y elevación parecidas
  for (let i = 0; i < NCOL; i++) {
    const sig = cols[(i + 1) % NCOL];
    for (const p of cols[i]) {
      let mejor = null, md = 1e9;
      for (const q of sig) {
        if (q.prev) continue;
        const rd = Math.abs(q.d - p.d) / p.d, dt = Math.abs(q.t - p.t);
        if (rd < 0.09 && dt < 0.012 && rd + dt * 8 < md) { md = rd + dt * 8; mejor = q; }
      }
      if (mejor) { p.next = mejor; mejor.prev = p; }
    }
  }
  // recorrer cadenas y descartar las cortas (< 0,8°)
  const pos = [], col = [], posC = [], colC = [];
  for (let i = 0; i < NCOL; i++) for (const p0 of cols[i]) {
    if (p0.prev || p0.hecho) continue;
    const cadena = [p0]; p0.hecho = true;
    let q = p0.next; while (q && !q.hecho) { q.hecho = true; cadena.push(q); q = q.next; }
    if (q === p0) cadena.push(p0); // vuelta completa (horizonte cerrado)
    if (cadena.length < 9) continue;
    for (let k = 0; k < cadena.length - 1; k++) {
      const a = cadena[k], b2 = cadena[k + 1], cielo = a.cielo && b2.cielo;
      const b = cielo ? 1 : Math.max(0.45, 1 - a.d / (LEJOS * 1.3)); // lo lejano, más tenue
      (cielo ? posC : pos).push(a.e, a.h + 2, -a.n, b2.e, b2.h + 2, -b2.n);
      (cielo ? colC : col).push(b, b, b, b, b, b);
    }
  }
  if (grupoPerfil) { scene.remove(grupoPerfil); grupoPerfil.traverse(x => { x.geometry?.dispose(); x.material?.dispose(); }); }
  grupoPerfil = new THREE.Group();
  for (const [P, C, ancho] of [[pos, col, 1.6], [posC, colC, 2.8]]) {
    if (!P.length) continue;
    const g = new LineSegmentsGeometry(); g.setPositions(P); g.setColors(C);
    // borde oscuro debajo de la línea blanca: se lee tanto sobre cielo claro como sobre roca oscura
    const mb = new LineMaterial({ color: 0x0b1018, linewidth: ancho + 2.4, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
    const m = new LineMaterial({ vertexColors: true, linewidth: ancho, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    for (const [mat, orden] of [[mb, 5], [m, 6]]) {
      mat.resolution.set(VW(), VH());
      const l = new LineSegments2(g, mat); l.renderOrder = orden; grupoPerfil.add(l);
    }
  }
  grupoPerfil.visible = CFG.perfil || calibrando;
  scene.add(grupoPerfil);
  perfilPos = c;
}

// Las coordenadas de GeoNames pueden estar corridas: cada cumbre se lleva al punto más alto del relieve cercano
// (radio en el 6º campo: 120 m OSM, 300 m GeoNames por defecto, 1,5 km volcanes agregados a mano).
function prepararCumbres(A) {
  ESC.cumbres = [];
  const puestas = [];
  for (const [lon, lat, ele, nombre, volcan, radio] of CUMBRES) {
    let [e, n] = aEN(lon, lat);
    if (Math.abs(e) > LEJOS * 0.95 || Math.abs(n) > LEJOS * 0.95) continue;
    const r = radio || 300, paso = Math.max(25, r / 14);
    let hm = hLocal(e, n), em = e, nm = n;
    for (let dy = -r; dy <= r; dy += paso) for (let dx = -r; dx <= r; dx += paso) {
      if (dx * dx + dy * dy > r * r) continue;
      const h = hLocal(e + dx, n + dy); if (h > hm) { hm = h; em = e + dx; nm = n + dy; }
    }
    if (Math.hypot(em, nm) < 250 || puestas.some(([a, b]) => Math.hypot(a - em, b - nm) < 150)) continue;
    puestas.push([em, nm]);
    const [lon2, lat2] = aLL(em, nm);
    ESC.cumbres.push({ nombre, volcan, lon: lon2, lat: lat2, ele: ele ?? Math.round(elevLL(lon2, lat2)), pos: new THREE.Vector3(em, hm + 6, -nm) });
  }
}

// ¿se ve el punto p desde la cámara? (marcha sobre el relieve)
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
function visible(p) {
  _c.copy(camera.position); _c.y += MARGEN_OJO;
  const d = _c.distanceTo(p), pasos = Math.min(400, Math.max(10, d / 120)), t0 = Math.min(0.5, CERCA_IGNORADO / d);
  for (let k = 1; k < pasos; k++) {
    const t = t0 + (k / pasos) * (0.985 - t0);
    _v.lerpVectors(_c, p, t);
    if (hLocal(_v.x, -_v.z) > _v.y + 4) return false;
  }
  return true;
}
function enPantalla(p, out) {
  _v.copy(p).project(camera);
  if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) return false;
  out.x = (_v.x + 1) / 2 * VW(); out.y = (1 - _v.y) / 2 * VH(); return true;
}

// ------------------------------------------------------------------ etiquetas
const ETQ = new Map(); // cod de unidad o '§'+nombre de falla -> {el, pos, w, h}
const FI_DE = new Map(); // '§'+nombre -> índice de un tramo de esa falla
const vistos = (() => { try { return JSON.parse(leer('vistos') || '{"u":{},"f":{}}'); } catch { return { u: {}, f: {} }; } })();
function marcarVisto(tipo, k) { if (!vistos[tipo][k]) { vistos[tipo][k] = Date.now(); guardar('vistos', JSON.stringify(vistos)); actualizarContador(); } }
function actualizarContador() {
  const n = Object.keys(vistos.u).length + Object.keys(vistos.f).length;
  $('#btn-coleccion b').textContent = n;
}

function htmlEtiqueta(cod) {
  const u = UNI[cod], c = CATEGORIAS[u.cat] || CATEGORIAS.sininfo;
  const nuevo = !vistos.u[cod];
  const nombre = u.cat === 'sininfo' && u.codigo ? `Unidad ${u.codigo}` : c.nombre;
  return `<div class="etq-caja"><span class="etq-ico">${c.ico}</span><span class="etq-txt"><b>${esc(nombre)}${u.codigo ? ` <em class="etq-cod">${esc(u.codigo)}</em>` : ''}</b>
    <small>${u.edadGrande ? esc(u.edadGrande) : u.ma ? esc(fmtRango(u, true)) + (u.edad ? ' · ' + esc(edadCorta(u.edad)) : '') : esc(c.lema)}</small></span>${nuevo ? '<i class="etq-nuevo">¡nuevo!</i>' : ''}</div>
    <div class="etq-palo"></div><div class="etq-punto"></div>`;
}
function htmlPin(p) {
  return p.tipo === 'dat'
    ? `<div class="etq-caja"><span class="etq-ico">⏳</span><span class="etq-txt"><b>${esc(p.txt)}</b><small>Datación ${esc(p.met || '')}${p.mat ? ' · ' + esc(p.mat.toLowerCase()) : ''}</small></span></div><div class="etq-palo"></div><div class="etq-punto"></div>`
    : `<div class="etq-caja"><span class="etq-ico">🐚</span><span class="etq-txt"><b>Fósil: ${esc(p.txt.toLowerCase())}</b><small>${esc(p.edad || p.loc || '')}</small></span></div><div class="etq-palo"></div><div class="etq-punto"></div>`;
}
function htmlEtiquetaFalla(fi) {
  const d = fallaDet(fi);
  if (d) return `<div class="etq-caja"><span class="etq-ico">⚡</span><span class="etq-txt"><b>${esc(d.n)}</b>
    <small>falla ${esc(NOM_FALLA[d.t])} · ${esc(INF_FALLA[d.i])}</small></span></div><div class="etq-palo"></div><div class="etq-punto"></div>`;
  const f = FALLAS.f[fi];
  return `<div class="etq-caja"><span class="etq-ico">⚡</span><span class="etq-txt"><b>${esc(f.n ? 'Falla ' + f.n : 'Falla activa')}</b>
    <small>${esc(f.s ? 'falla ' + f.s : 'falla')}${f.act ? ' · actividad ' + f.act : ''}</small></span></div><div class="etq-palo"></div><div class="etq-punto"></div>`;
}
function htmlCumbre(k) {
  const d = Math.hypot(k.pos.x - camera.position.x, k.pos.z - camera.position.z);
  return `<div class="etq-caja"><b>${k.volcan ? '🌋 ' : ''}${esc(k.nombre)}</b><small>${nf0.format(k.ele)} m · ${fmtDist(d)}</small></div><div class="etq-palo"></div>`;
}
function crearEtiqueta(clave, html, color, alTocar) {
  const el = document.createElement('div');
  el.className = 'etq' + (clave.startsWith('§') ? ' etq-falla' : clave.startsWith('▲') ? ' cum' : clave.startsWith('⌚') ? ' etq-pin' : '');
  el.style.setProperty('--c', color);
  el.innerHTML = html;
  el.addEventListener('click', ev => { ev.stopPropagation(); alTocar(); });
  $('#etiquetas').appendChild(el);
  requestAnimationFrame(() => el.classList.add('ver'));
  return { el, w: 0, h: 0, alto: 0 };
}

let ultimaSeleccion = 0;
const MAX_CAJAS = 2;
function seleccionarEtiquetas(t) {
  if (t - ultimaSeleccion < 280) return false; ultimaSeleccion = t;
  const quiero = new Map();
  if (CFG.etiquetas && ESC.listo) {
    const grupos = new Map(), sp = { x: 0, y: 0 };
    for (const c of ESC.cand) {
      if (!enPantalla(c.pos, sp)) continue;
      if (sp.y < 70 || sp.y > VH() - 150) continue;
      if (!visible(c.pos)) continue;
      let g = grupos.get(c.cod); if (!g) grupos.set(c.cod, g = { n: 0, sx: 0, sy: 0, lista: [] });
      g.n += c.peso; g.sx += sp.x * c.peso; g.sy += sp.y * c.peso; g.lista.push([c, sp.x, sp.y]);
    }
    const orden = [...grupos.entries()].filter(([, g]) => g.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, 7);
    for (const [cod, g] of orden) {
      const prev = ETQ.get(cod);
      let elegido = prev && g.lista.find(([c]) => c.pos === prev.pos);
      if (!elegido) {
        const mx = g.sx / g.n, my = g.sy / g.n;
        elegido = g.lista.reduce((m, it) => Math.hypot(it[1] - mx, it[2] - my) < Math.hypot(m[1] - mx, m[2] - my) ? it : m);
      }
      quiero.set(cod, elegido[0].pos);
    }
    if (CFG.cumbres && ESC.cumbres) {
      // cumbres: las más destacadas en pantalla (mayor ángulo de elevación), separadas al menos 90 px
      const vis = [], sp4 = { x: 0, y: 0 }, c0 = camera.position;
      ESC.cumbres.forEach((k, i) => {
        if (!enPantalla(k.pos, sp4) || sp4.y < 90 || sp4.y > VH() - 160) return;
        const d = Math.hypot(k.pos.x - c0.x, k.pos.z - c0.z);
        vis.push({ i, x: sp4.x, t: (k.pos.y - c0.y) / d, k });
      });
      vis.sort((a, b) => b.t - a.t);
      const puestas = [];
      for (const v of vis) {
        if (puestas.length >= 9) break;
        if (puestas.some(p => Math.abs(p.x - v.x) < 90)) continue;
        if (!visible(v.k.pos)) continue;
        puestas.push(v); quiero.set('▲' + v.i, v.k.pos);
      }
    }
    if (CFG.fallas) {
      // una etiqueta por falla con nombre (el catálogo divide muchas fallas en varios tramos)
      const cf = new Map(), sp2 = { x: 0, y: 0 };
      for (const c of ESC.candF) {
        if (!enPantalla(c.pos, sp2) || sp2.y < 70 || sp2.y > VH() - 150) continue;
        const clave = '§' + (nombreFalla(c.fi) || '#' + c.fi);
        const dc = Math.hypot(sp2.x - VW() / 2, sp2.y - VH() / 2);
        const prev = cf.get(clave);
        if (prev && prev.dc <= dc) continue;
        if (!visible(c.pos)) continue;
        cf.set(clave, { pos: c.pos, dc, fi: c.fi });
      }
      [...cf.entries()].sort((a, b) => a[1].dc - b[1].dc).slice(0, 3).forEach(([clave, v]) => {
        const prev = ETQ.get(clave), sp3 = { x: 0, y: 0 };
        const sigue = prev && prev.pos && enPantalla(prev.pos, sp3) && visible(prev.pos);
        quiero.set(clave, sigue ? prev.pos : v.pos);
        FI_DE.set(clave, v.fi);
      });
    }
    // dataciones y fósiles: los 4 más cercanos que se ven (a menos de 8 km), para no tapar el paisaje
    const sp5 = { x: 0, y: 0 }, c0 = camera.position, cerca = [];
    if (CFG.pins) ESC.pins.forEach((p, i) => {
      if (!p.pos) return;
      const d = Math.hypot(p.pos.x - c0.x, p.pos.z - c0.z);
      if (d > 8000 || !enPantalla(p.pos, sp5) || sp5.y < 70 || sp5.y > VH() - 150) return;
      cerca.push({ i, d });
    });
    cerca.sort((a, b) => a.d - b.d);
    let puestos = 0;
    for (const { i } of cerca) { if (puestos >= 4) break; if (!visible(ESC.pins[i].pos)) continue; quiero.set('⌚' + i, ESC.pins[i].pos); puestos++; }
    // a lo más MAX_CAJAS etiquetas con caja (unidades, fallas, dataciones): las más cercanas a la mira, para que se vea el mapa.
    // Las que ya están puestas tienen ventaja, así no saltan de un lado a otro al mover un poco el teléfono.
    const spc = { x: 0, y: 0 }, cx = VW() / 2, cy = VH() / 2;
    const cajas = [...quiero.entries()].filter(([k]) => !k.startsWith('▲')).map(([k, pos]) => {
      enPantalla(pos, spc);
      return { k, d: Math.hypot(spc.x - cx, spc.y - cy) * (ETQ.has(k) ? 0.6 : 1) };
    }).sort((a, b) => a.d - b.d);
    for (const { k } of cajas.slice(MAX_CAJAS)) quiero.delete(k);
  }
  for (const [k, e] of ETQ) if (!quiero.has(k)) { e.el.classList.remove('ver'); setTimeout(() => e.el.remove(), 300); ETQ.delete(k); }
  for (const [k, pos] of quiero) {
    let e = ETQ.get(k);
    if (!e) {
      if (k.startsWith('§')) { const fi = FI_DE.get(k); e = crearEtiqueta(k, htmlEtiquetaFalla(fi), '#ff5a36', () => abrirFichaFalla(fi)); }
      else if (k.startsWith('▲')) { const i = +k.slice(1); e = crearEtiqueta(k, htmlCumbre(ESC.cumbres[i]), '#fff', () => abrirFichaCumbre(i)); }
      else if (k.startsWith('⌚')) { const i = +k.slice(1), p = ESC.pins[i]; e = crearEtiqueta(k, htmlPin(p), p.tipo === 'dat' ? '#d4145a' : '#2f9e6e', () => abrirFichaPin(i)); }
      else e = crearEtiqueta(k, htmlEtiqueta(k), UNI[k].color, () => abrirFicha(k));
      ETQ.set(k, e);
    }
    e.pos = pos;
  }
  return true;
}
function posicionarEtiquetas(medir) {
  const colocadas = [], sp = { x: 0, y: 0 };
  // las fallas primero (menos), luego unidades en orden de inserción
  const prio = k => k.startsWith('▲') ? 2 : k.startsWith('§') || k.startsWith('⌚') ? 1 : 0;
  const lista = [...ETQ.entries()].sort((a, b) => prio(b[0]) - prio(a[0]));
  for (const [k, e] of lista) {
    if (!e.pos || !enPantalla(e.pos, sp)) { e.el.style.opacity = 0; continue; }
    if (!e.w || medir) { const c = e.el.querySelector('.etq-caja'); e.w = c.offsetWidth; e.h = c.offsetHeight; }
    const esCumbre = k.startsWith('▲');
    let alto = esCumbre ? 16 : 46, ok = false;
    // desplazamiento horizontal para que la caja no se salga de la pantalla (el palito sigue en el punto)
    const dx = sp.x - e.w / 2 < 8 ? 8 + e.w / 2 - sp.x : sp.x + e.w / 2 > VW() - 8 ? VW() - 8 - e.w / 2 - sp.x : 0;
    for (let intento = 0; intento < (esCumbre ? 1 : 4) && !ok; intento++, alto += e.h + 8) {
      const caja = { x0: sp.x + dx - e.w / 2, x1: sp.x + dx + e.w / 2, y0: sp.y - alto - e.h, y1: sp.y - alto };
      ok = caja.y0 > 64 && !colocadas.some(c => caja.x0 < c.x1 + 6 && caja.x1 > c.x0 - 6 && caja.y0 < c.y1 + 4 && caja.y1 > c.y0 - 4);
      if (ok) colocadas.push(caja);
    }
    if (!ok) { e.el.style.opacity = 0; continue; }
    e.el.style.opacity = '';
    e.el.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
    e.el.style.setProperty('--alto', alto + 'px');
    e.el.style.setProperty('--dx', dx + 'px');
  }
}

// ------------------------------------------------------------------ mira central
let ultimaMira = 0, miraActual = null;
function actualizarMira(t) {
  if (t - ultimaMira < 220 || !ESC.listo) return; ultimaMira = t;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), c = camera.position;
  let d = 40, hit = null, prevD = 0;
  while (d < CFG.alcance * 1.35) {
    const p = c.clone().addScaledVector(dir, d);
    if (Math.abs(p.x) > CFG.alcance || Math.abs(p.z) > CFG.alcance) break;
    if (hLocal(p.x, -p.z) > p.y) {
      let a = prevD, b = d; for (let k = 0; k < 10; k++) { const m = (a + b) / 2, q = c.clone().addScaledVector(dir, m); if (hLocal(q.x, -q.z) > q.y) b = m; else a = m; }
      hit = c.clone().addScaledVector(dir, b); break;
    }
    prevD = d; d += 15 + d * 0.012;
  }
  const el = $('#mirando');
  if (!hit) { // también cuenta el suelo cercano: mirar hacia abajo muestra la unidad a tus pies
    miraActual = null; el.classList.remove('activo');
    el.innerHTML = `<span class="mir-vacio">Apunta la mira ⊕ a un cerro para saber de qué está hecho</span>`;
    return;
  }
  const [lon, lat] = aLL(hit.x, -hit.z), cod = unidadEn(lon, lat), dist = Math.hypot(hit.x - c.x, hit.z - c.z);
  // ¿hay una falla cerca del punto?
  let falla = null, dmin = 160;
  for (const fr of ESC.fallas) for (const [e, n] of fr.pts) { const dd = Math.hypot(e - hit.x, n + hit.z); if (dd < dmin) { dmin = dd; falla = fr.fi; } }
  miraActual = { cod, falla };
  if (!cod && falla == null) { el.classList.remove('activo'); el.innerHTML = `<span class="mir-vacio">Sin datos del mapa en ese punto · ${fmtDist(dist)}</span>`; return; }
  el.classList.add('activo');
  const u = cod && UNI[cod], cat = u && (CATEGORIAS[u.cat] || CATEGORIAS.sininfo);
  el.style.setProperty('--c', u ? u.color : '#ff5a36');
  const donde = dist < 60 ? 'El suelo a tus pies' : `Estás mirando · a ${fmtDist(dist)}`;
  el.innerHTML = (u ? `<span class="mir-ico">${cat.ico}</span><span class="mir-txt"><small>${donde}</small>
      <b>${esc(u.cat === 'sininfo' && u.codigo ? 'Unidad ' + u.codigo : cat.nombre)}${u.codigo ? ` <em class="etq-cod">${esc(u.codigo)}</em>` : ''}</b><em>${esc(u.ma ? fmtRango(u, true) : cat.lema)}</em></span>` : `<span class="mir-ico">⚡</span><span class="mir-txt"><small>Estás mirando · a ${fmtDist(dist)}</small><b>Una falla</b></span>`)
    + (falla != null && u ? `<span class="mir-falla">⚡ falla cerca</span>` : '') + `<span class="mir-mas">›</span>`;
}

// ------------------------------------------------------------------ fichas
function calendario(ma) {
  const frac = 1 - ma / 4567;
  const seg = ma / 4567 * 365 * 86400; // segundos antes de la medianoche del 31 de diciembre
  if (seg < 86400) {
    const t = new Date(Date.UTC(2025, 11, 31, 24, 0, 0) - seg * 1000);
    return `el 31 de diciembre a las ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}${seg < 60 ? ':' + String(t.getUTCSeconds()).padStart(2, '0') : ''}`;
  }
  const dia = new Date(Date.UTC(2025, 0, 1) + frac * 365 * 86400000);
  return `el ${dia.getUTCDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][dia.getUTCMonth()]}`;
}
function barraAnio(ma) {
  const p = (1 - ma / 4567) * 100;
  const meses = 'EFMAMJJASOND'.split('').map(m => `<span>${m}</span>`).join('');
  return `<div class="anio"><div class="anio-meses">${meses}</div><div class="anio-marca" style="left:${p}%"></div></div>`;
}
function abrirFicha(cod) {
  const u = UNI[cod]; if (!u) return;
  const c = CATEGORIAS[u.cat] || CATEGORIAS.sininfo;
  const media = u.ma ? (u.ma[0] + u.ma[1]) / 2 : null;
  const dato = u.dato ?? (u.cat === 'marina' ? datoMarino(u) : c.dato);
  const que = u.que ?? c.que, ver = u.ver ?? c.ver;
  const joven = (u.cat === 'volcanica' && u.ma && u.ma[0] <= 2.6) ? '<p class="nota">Es volcanismo joven: algunos de estos volcanes pueden volver a entrar en erupción.</p>' : '';
  const det = !!u.codigo; // unidad de un mapa detallado 1:50.000
  const edadTxt = [u.edad, u.pisos ? `pisos ${u.pisos}` : ''].filter(Boolean).join(' · ');
  const gc = u.geocron && (u.geocron[0] || u.geocron[1]) ? `<p>Edades medidas en la unidad: ${[u.geocron[0], u.geocron[1]].filter(x => x != null).map(x => nf1.format(x)).join(' a ')} ${esc(u.geocron[2] || '')}.</p>` : '';
  $('#ficha-cuerpo').innerHTML = `
    <header class="fi-cab" style="--c:${u.color}"><span class="fi-ico">${c.ico}</span><div><small>${esc(u.cat === 'sininfo' && det ? 'Unidad geológica' : c.nombre)}${c.lema ? ' · ' + esc(c.lema) : ''}</small><h2>${esc(u.titulo)}</h2></div></header>
    ${u.ma ? `<section><h3>⏳ ¿Qué edad tiene?</h3><p class="grande">${esc(u.edadGrande || fmtRango(u))}</p>
      <p>${esc(edadTxt)} · era ${esc(era(media))}</p>${u.aprox ? '<p class="nota">Edad aproximada, deducida del código de la unidad: esta hoja del mapa todavía no trae su edad.</p>' : ''}${gc}
      <p>Si toda la historia de la Tierra (4.567 millones de años) fuera <b>un solo año</b>, esta roca se habría formado <b>${calendario(media)}</b>.</p>${barraAnio(media)}
      <p class="contexto">🌍 ${esc(contextoEdad(media))}</p></section>` : ''}
    ${que ? `<section><h3>🔎 ¿Qué es?</h3><p>${esc(que)}</p>${u.facies ? `<p class="nota">${esc(u.facies)}</p>` : ''}${joven}</section>` : ''}
    ${ver ? `<section><h3>👀 ¿Cómo reconocerla?</h3><p>${esc(ver)}</p></section>` : ''}
    ${dato ? `<section class="dato"><h3>💡 ¿Sabías que…?</h3><p>${esc(dato)}</p></section>` : ''}
    ${det ? `<section class="oficial"><h3>📖 Mapa geológico detallado</h3>${u.desc ? `<p>${esc(u.tipo ? u.tipo + ' · ' : '')}${esc(u.desc)}</p>` : ''}
      <p class="cod">Unidad <b>${esc(u.codigo)}</b> · ${esc(u.hoja)}, escala 1:50.000, SERNAGEOMIN</p>${u.ref ? `<p class="cod">Textos basados en: ${esc(u.ref.replace(/^Textos divulgativos redactados a partir de /, ''))}</p>` : ''}</section>
    <p class="aviso">Mapa detallado: los límites entre unidades tienen una precisión de decenas de metros.</p>`
    : `<section class="oficial"><h3>📖 Descripción del mapa oficial</h3><p>${esc(u.desc)}</p>
      <p class="cod">${u.cod.startsWith('S I') ? 'Lago o glaciar según el relieve' : `Unidad <b>${esc(u.cod)}</b>`} · Mapa Geológico de Chile 1:1.000.000, SERNAGEOMIN</p></section>
    <p class="aviso">A esta escala, los límites entre unidades pueden estar corridos varios cientos de metros respecto del terreno.</p>`}`;
  mostrarFicha();
  marcarVisto('u', cod);
  const e = ETQ.get(cod); if (e) e.el.querySelector('.etq-nuevo')?.remove();
}
function abrirFichaFalla(fi) {
  const d = fallaDet(fi);
  if (d) {
    const tipoTxt = d.t === 'normal' ? FALLA.tipos.normal : d.t === 'inversa' ? FALLA.tipos.inversa : /sinistral|dextral|rumbo/.test(d.t) ? FALLA.tipos.rumbo : '';
    const sentido = d.t === 'inversa' ? 'inversa' : d.t === 'normal' ? 'normal' : /sinistral|dextral|rumbo/.test(d.t) ? 'de rumbo' : '';
    $('#ficha-cuerpo').innerHTML = `
      <header class="fi-cab" style="--c:#3a3a3a"><span class="fi-ico">⚡</span><div><small>Falla geológica · mapa detallado</small><h2>${esc(d.n || 'Falla sin nombre')}</h2></div></header>
      <section><div class="chips"><span>Falla ${esc(NOM_FALLA[d.t])}</span><span>${esc(INF_FALLA[d.i][0].toUpperCase() + INF_FALLA[d.i].slice(1))}</span></div>
        <p>${d.i === 0 ? 'Se vio en terreno.' : d.i === 1 ? 'No se ve directamente: se deduce de las rocas a ambos lados.' : 'Está tapada por sedimentos más jóvenes.'}</p></section>
      <section><h3>🔎 ¿Qué es una falla?</h3><p>${esc(FALLA.que)}</p>${sentido ? svgFalla(sentido) : ''}${tipoTxt ? `<p>${esc(tipoTxt)}</p>` : ''}</section>
      <section class="oficial"><h3>📖 Fuente</h3><p>${esc(d.M.hoja)}, escala 1:50.000, SERNAGEOMIN. Que una falla aparezca en el mapa geológico no significa que esté activa hoy.</p></section>`;
    mostrarFicha();
    marcarVisto('f', d.n || 'det-' + fi);
    return;
  }
  const f = FALLAS.f[fi];
  const tipoTxt = f.s.startsWith('normal') ? FALLA.tipos.normal : f.s.startsWith('inversa') ? FALLA.tipos.inversa : f.s.startsWith('de rumbo') ? FALLA.tipos.rumbo : '';
  $('#ficha-cuerpo').innerHTML = `
    <header class="fi-cab" style="--c:#ff5a36"><span class="fi-ico">⚡</span><div><small>Falla activa · catálogo CHAF</small><h2>${esc(f.n ? 'Falla ' + f.n : 'Falla sin nombre')}</h2></div></header>
    <section><div class="chips">${f.s ? `<span>Falla ${esc(f.s)}</span>` : ''}${f.act ? `<span>Actividad ${esc(f.act)}</span>` : ''}${f.kmTotal || f.km ? `<span>${nf1.format(f.kmTotal || f.km)} km de largo${f.tramos > 1 ? ` (${f.tramos} tramos)` : ''}</span>` : ''}${f.tipo ? `<span>Tramo ${esc(f.tipo)}</span>` : ''}</div>
      ${f.sis ? `<p>Parte del <b>${esc(f.sis)}</b>.</p>` : ''}${f.edad ? `<p>Último movimiento registrado: ${esc(f.edad)}.</p>` : ''}${f.rec ? `<p>Evidencia: ${esc(f.rec)}.</p>` : ''}</section>
    <section><h3>🔎 ¿Qué es una falla?</h3><p>${esc(FALLA.que)}</p>${f.s ? svgFalla(f.s) : ''}${tipoTxt ? `<p>${esc(tipoTxt)}</p>` : ''}</section>
    <section class="dato"><h3>⚠️ ¿Qué significa que sea activa?</h3><p>${esc(FALLA.activa)}</p>${f.act ? `<p>${esc(FALLA.actividad[f.act] || '')}</p>` : ''}</section>
    <section class="oficial"><h3>📖 Fuente</h3><p>Catálogo de Fallas Activas de Chile (CHAF v1), Melnick, Maldonado y Contreras (2020), PANGAEA, CC BY 4.0.${f.ref ? ' Referencias: ' + esc(f.ref) + '.' : ''}</p></section>`;
  mostrarFicha();
  marcarVisto('f', f.n || 'falla-' + fi);
}
function abrirFichaCumbre(i) {
  const k = ESC.cumbres[i]; if (!k) return;
  const d = Math.hypot(k.pos.x - camera.position.x, k.pos.z - camera.position.z);
  const cod = unidadEn(k.lon, k.lat), u = cod && UNI[cod], c = u && (CATEGORIAS[u.cat] || CATEGORIAS.sininfo);
  $('#ficha-cuerpo').innerHTML = `
    <header class="fi-cab" style="--c:#8fa7c0"><span class="fi-ico">${k.volcan ? '🌋' : '⛰️'}</span><div><small>${k.volcan ? 'Volcán' : 'Cumbre'} · ${nf0.format(k.ele)} m de altura</small><h2>${esc(k.nombre)}</h2></div></header>
    <section><p class="grande">A ${fmtDist(d)} de ti</p></section>
    ${u ? `<section><h3>🪨 ¿De qué está hecha su cumbre?</h3>
      <button class="col-item" id="fi-roca"><i style="background:${u.color}"></i><span>${c.ico} <b>${esc(c.nombre)}</b><small>${esc(u.titulo)}${u.ma ? ' · ' + esc(fmtRango(u, true)) : ''}</small></span></button></section>` : ''}
    <section class="oficial"><p>Nombre y altura: © colaboradores de OpenStreetMap / GeoNames; posición ajustada al relieve. Roca: Mapa Geológico de Chile 1:1.000.000, SERNAGEOMIN.</p></section>`;
  if (u) $('#fi-roca').onclick = () => abrirFicha(cod);
  mostrarFicha();
}
const METODOS = {
  'U-Pb': 'mide cuánto uranio de un cristal de circón se ha transformado en plomo. Los circones se forman cuando el magma se enfría, así que fechan el nacimiento de la roca.',
  'Ar-Ar': 'mide el argón que se acumula al desintegrarse el potasio de la roca. Es de los métodos más precisos para fechar lavas y cenizas volcánicas.',
  'K-Ar': 'mide el argón que produce el potasio radiactivo de la roca. Es el método clásico para fechar rocas volcánicas.',
  'C14': 'mide el carbono-14 que queda en restos de plantas o carbón atrapados en el depósito. Sirve para los últimos ~50.000 años.',
};
function abrirFichaPin(i) {
  const p = ESC.pins[i]; if (!p) return;
  const d = p.pos ? Math.hypot(p.pos.x - camera.position.x, p.pos.z - camera.position.z) : null;
  if (p.tipo === 'dat') {
    const clave = Object.keys(METODOS).find(k => (p.met || '').replace(/[^A-Za-z0-9]/g, '').startsWith(k.replace(/[^A-Za-z0-9]/g, '')));
    $('#ficha-cuerpo').innerHTML = `
      <header class="fi-cab" style="--c:#d4145a"><span class="fi-ico">⏳</span><div><small>Datación radiométrica${d != null ? ' · a ' + fmtDist(d) : ''}</small><h2>${esc(p.txt)}</h2></div></header>
      <section><div class="chips">${p.met ? `<span>Método ${esc(p.met)}</span>` : ''}${p.mat ? `<span>${esc(p.mat)}</span>` : ''}${p.lit ? `<span>${esc(p.lit)}</span>` : ''}${p.uni ? `<span>Unidad ${esc(p.uni)}</span>` : ''}</div>
        <p>En este punto se tomó una muestra de roca y en el laboratorio se midió su edad: <b>${esc(p.txt.replace(/\bMa\b/, 'millones de años').replace(/\bka\b/, 'miles de años'))}</b>. El número después de ± es el margen de error.</p></section>
      ${clave ? `<section><h3>🔬 ¿Cómo se mide?</h3><p>El método ${esc(clave)} ${esc(METODOS[clave])}</p></section>` : ''}
      <section class="oficial"><h3>📖 Fuente</h3><p>${p.sigla ? `Muestra ${esc(p.sigla)}. ` : ''}${p.ref ? `${esc(p.ref)}. ` : ''}${esc(p.M.hoja)}, escala 1:50.000, SERNAGEOMIN.</p></section>`;
  } else {
    $('#ficha-cuerpo').innerHTML = `
      <header class="fi-cab" style="--c:#2f9e6e"><span class="fi-ico">🐚</span><div><small>Localidad fosilífera${d != null ? ' · a ' + fmtDist(d) : ''}</small><h2>${esc(p.txt)}</h2></div></header>
      <section>${p.loc ? `<p class="grande">${esc(p.loc)}</p>` : ''}${p.edad ? `<p>Edad de los fósiles: <b>${esc(p.edad)}</b>.</p>` : ''}
        <p>Los fósiles son restos o huellas de seres vivos que quedaron atrapados en la roca. Además de contar qué vivía aquí, permiten saber la edad de las capas que los contienen.</p></section>
      <section class="oficial"><h3>📖 Fuente</h3><p>${p.ref ? esc(p.ref) + '. ' : ''}${esc(p.M.hoja)}, escala 1:50.000, SERNAGEOMIN.</p></section>`;
  }
  mostrarFicha();
}
function mostrarFicha() { const el = $('#ficha'); el.hidden = false; el.scrollTop = 0; requestAnimationFrame(() => el.classList.add('abierta')); }
function cerrarFicha() { const el = $('#ficha'); el.classList.remove('abierta'); setTimeout(() => el.hidden = true, 250); }

function abrirColeccion() {
  const cods = Object.keys(vistos.u).filter(c => UNI[c]).sort((a, b) => (UNI[b].ma?.[0] || 0) - (UNI[a].ma?.[0] || 0));
  const eras = new Set(cods.map(c => UNI[c].ma ? era((UNI[c].ma[0] + UNI[c].ma[1]) / 2) : null).filter(Boolean));
  const medallas = [
    ['🔰', 'Primer descubrimiento', cods.length >= 1], ['🧭', 'Explorador: 5 unidades', cods.length >= 5],
    ['⏳', 'Viajero del tiempo: 3 eras', eras.size >= 3], ['⚡', 'Cazador de fallas', Object.keys(vistos.f).length >= 1],
    ['🦕', 'Mundo de dinosaurios (Mesozoico)', eras.has('Mesozoico')], ['🏔️', 'Geólogo/a de terreno: 12 unidades', cods.length >= 12],
  ];
  $('#ficha-cuerpo').innerHTML = `<header class="fi-cab" style="--c:#7cc4ff"><span class="fi-ico">🏅</span><div><small>Tu colección</small><h2>${cods.length} unidades · ${Object.keys(vistos.f).length} fallas</h2></div></header>
    <section class="medallas">${medallas.map(([i, n, ok]) => `<div class="med ${ok ? 'ok' : ''}"><span>${i}</span>${esc(n)}</div>`).join('')}</section>
    <section><h3>Unidades descubiertas (de la más antigua a la más joven)</h3>
    ${cods.length ? cods.map(c => { const u = UNI[c], k = CATEGORIAS[u.cat] || CATEGORIAS.sininfo; return `<button class="col-item" data-cod="${esc(c)}"><i style="background:${u.color}"></i><span>${k.ico} <b>${esc(k.nombre)}</b><small>${esc(u.titulo)} · ${esc(fmtRango(u, true))}</small></span></button>`; }).join('') : '<p>Todavía nada. Toca una etiqueta sobre un cerro para empezar tu colección.</p>'}</section>`;
  $('#ficha-cuerpo').querySelectorAll('.col-item').forEach(b => b.onclick = () => abrirFicha(b.dataset.cod));
  mostrarFicha();
}

// ------------------------------------------------------------------ sensores
const S = { qDisp: new THREE.Quaternion(), qObj: new THREE.Quaternion(), tiene: false, absoluto: false, iosOff: null, precision: null, yawUsuario: +(leer('yaw') || 0), pitchUsuario: +(leer('pitch') || 0), decl: 0 };
const zee = new THREE.Vector3(0, 0, 1), eul = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
function quatDispositivo(alpha, beta, gamma, orient, out) {
  eul.set(beta, alpha, -gamma, 'YXZ'); out.setFromEuler(eul); out.multiply(q1); out.multiply(q0.setFromAxisAngle(zee, -orient)); return out;
}
function rumboDe(q) { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q); return Math.atan2(f.x, -f.z) * 180 / Math.PI; }
const _qa = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qp = new THREE.Quaternion(), yAx = new THREE.Vector3(0, 1, 0), xAx = new THREE.Vector3(1, 0, 0);
const _qh = new THREE.Quaternion(), _uh = new THREE.Vector3();
function detectarHorizontal(ev, D, angReal) {
  if (ESC.modo !== 'ar' || angReal !== 0 || innerWidth > innerHeight) return fijarVirt(0); // el sistema ya rota la pantalla
  quatDispositivo(ev.alpha * D, ev.beta * D, ev.gamma * D, 0, _qh);
  _uh.set(0, 1, 0).applyQuaternion(_qh.invert()); // "arriba" del mundo visto desde el teléfono
  if (Math.hypot(_uh.x, _uh.y) < 0.5) return; // teléfono casi plano: se mantiene como está
  const giro = Math.atan2(_uh.x, _uh.y) / D; // 0 vertical, +90 con la parte de arriba hacia la izquierda
  if (Math.abs(envolver(giro - VIRT)) < 60) return; // histéresis: no parpadea cerca de 45°
  const a = Math.round(giro / 90) * 90;
  fijarVirt(a === 90 || a === -90 ? a : 0);
}
function onOrientacion(ev, absoluto) {
  if (ev.alpha == null) return;
  if (!absoluto && S.absoluto && ev.webkitCompassHeading == null) return; // ya tenemos la absoluta
  const D = Math.PI / 180, angReal = screen.orientation?.angle ?? window.orientation ?? 0;
  detectarHorizontal(ev, D, angReal);
  quatDispositivo(ev.alpha * D, ev.beta * D, ev.gamma * D, (angReal + VIRT) * D, _qa);
  let extra = 0;
  if (ev.webkitCompassHeading != null) { // iOS: alpha es relativo; se corrige con la brújula (solo con el teléfono vertical)
    const acc = ev.webkitCompassAccuracy; // grados de error; -1 = brújula sin calibrar
    if (ev.beta > 40 && ev.beta < 140 && !(acc < 0) && !S.iosCongelado) {
      const off = envolver(ev.webkitCompassHeading - rumboDe(_qa));
      S.iosN = (S.iosN || 0) + 1;
      const k = S.iosOff == null ? 1 : S.iosN < 40 ? 0.25 : acc > 25 ? 0.015 : 0.05; // al inicio converge rápido; luego suave
      S.iosOff = S.iosOff == null ? off : S.iosOff + envolver(off - S.iosOff) * k;
    }
    extra = S.iosOff ?? 0; S.precision = acc; S.absoluto = true;
  } else if (absoluto) S.absoluto = true;
  const yaw = -(extra + S.decl + S.yawUsuario) * D;
  _qy.setFromAxisAngle(yAx, yaw); _qp.setFromAxisAngle(xAx, S.pitchUsuario * D);
  S.qObj.copy(_qy).multiply(_qa).multiply(_qp);
  if (!S.tiene) {
    S.qDisp.copy(S.qObj);
    // si el aviso de "sin sensores" quedó abierto y los sensores llegaron después, se cierra solo
    if (!$('#ficha').hidden && $('#ficha-cuerpo .diag')) { cerrarFicha(); toast('🧭 Orientación activa: el dibujo sigue tus movimientos.'); }
  }
  S.tiene = true;
}
async function pedirPermisoOrientacion() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') throw new Error('orientación denegada');
  }
  if (S.escuchando) return;
  S.escuchando = true;
  if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', e => onOrientacion(e, true));
  addEventListener('deviceorientation', e => onOrientacion(e, !!e.absolute));
}
async function iniciarCamara() {
  const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  // Algunos teléfonos abren la cámara con zoom digital: sin zoom, el campo visual real se parece más al supuesto
  const tr = st.getVideoTracks()[0];
  try { const cap = tr.getCapabilities?.(); if (cap?.zoom && cap.zoom.min <= 1 && cap.zoom.max >= 1 && tr.getSettings().zoom !== 1) await tr.applyConstraints({ advanced: [{ zoom: 1 }] }); } catch { }
  const v = $('#cam'); v.srcObject = st; await v.play();
  v.addEventListener('loadedmetadata', ajustarTamano); v.addEventListener('resize', ajustarTamano); ajustarTamano();
}
function obtenerPosicion(precisa = true, espera = 25000) {
  return new Promise((ok, mal) => {
    if (!navigator.geolocation) return mal(new Error('Este navegador no tiene geolocalización.'));
    navigator.geolocation.getCurrentPosition(p => ok(p.coords), mal, { enableHighAccuracy: precisa, timeout: espera, maximumAge: precisa ? 10000 : 300000 });
  });
}
let vigilanciaGPS = null;
function vigilarGPS() {
  if (vigilanciaGPS != null) return;
  vigilanciaGPS = navigator.geolocation.watchPosition(p => {
    if (!ESC.listo || ESC.modo !== 'ar') return;
    const [e, n] = aEN(p.coords.longitude, p.coords.latitude);
    $('#gps').textContent = `± ${nf0.format(p.coords.accuracy)} m`;
    if (Math.hypot(e, n) > 2500) { toast('Te moviste bastante: recargando el mapa de este lugar…'); abrirEn(p.coords.latitude, p.coords.longitude, 'ar'); return; }
    if (Math.hypot(e - camera.position.x, n + camera.position.z) > 25) {
      camera.position.set(e, hLocal(e, n) + CFG.ojo, -n); actualizarPisando();
      if (!perfilPos || Math.hypot(perfilPos.x - e, perfilPos.z + n) > 60) calcularPerfil(generacion);
    }
  }, () => { }, { enableHighAccuracy: true, maximumAge: 5000 });
}

// ------------------------------------------------------------------ carga de un lugar
let generacion = 0;
// Rumbo con más relieve al frente: ventana de 90° con mayor ángulo de elevación medio del terreno (1,5–12 km)
function mejorRumbo() {
  const alt = hLocal(0, 0) + 25, por = new Array(180).fill(-90);
  for (let a = 0; a < 180; a++) for (let d = 1500; d <= 12000; d += 400) {
    const r = a * 2 * Math.PI / 180, ang = Math.atan2(hLocal(d * Math.sin(r), d * Math.cos(r)) - alt, d) * 180 / Math.PI;
    if (ang > por[a]) por[a] = ang;
  }
  let mejor = 0, mv = -1e9;
  for (let i = 0; i < 180; i++) { let s = 0; for (let k = 0; k < 45; k++) s += por[(i + k) % 180]; if (s > mv) { mv = s; mejor = i; } }
  return (mejor * 2 + 45) % 360;
}
async function abrirEn(lat, lon, modo, rumbo = 0, nombre = null) {
  const gen = ++generacion;
  ESC.listo = false; ESC.modo = modo;
  document.body.dataset.modo = modo;
  $('#inicio').hidden = true; $('#escena').hidden = false;
  if (!renderer) iniciarThree();
  for (const o of [terrenoColor, terrenoProf, grupoFallas, grupoPerfil, terrenoLejos]) if (o) { scene.remove(o); o.traverse?.(x => { x.geometry?.dispose(); x.material?.dispose(); }); }
  texMapa?.dispose(); texSat?.dispose(); texSat = null; cargandoSat = 0;
  for (const d of texDet) d.t.dispose(); texDet = [];
  for (const [, e] of ETQ) e.el.remove(); ETQ.clear();
  try {
    cargando('Cargando el mapa geológico…');
    if (!UNI) await cargarBase();
    setOrigen(lat, lon);
    S.decl = declinacion(lat, lon);
    const A = CFG.alcance;
    ESC.polys = await cargarGeologia(A);
    try { await cargarDetalle(A); } catch (e) { console.error(e); ESC.det = []; ESC.polysDet = []; ESC.fallasDet = []; ESC.pins = []; }
    if (gen !== generacion) return;
    if (!ESC.polys.length) {
      cargando(); toast('Por ahora GeoLente solo tiene el mapa de Chile. Prueba un lugar de ejemplo.', 6000);
      volverInicio(); return;
    }
    cargando('Cargando el relieve…');
    await cargarDEM(A, p => cargando(`Cargando el relieve… ${Math.round(p * 100)} %`));
    if (gen !== generacion) return;
    if (DEM.fallidas + (DEM2?.fallidas || 0)) toast(`No se pudieron bajar ${DEM.fallidas + (DEM2?.fallidas || 0)} teselas de relieve: puede haber zonas planas falsas.`);
    clasificarAguaHielo();
    cargando('Pintando los cerros…');
    await new Promise(r => setTimeout(r, 30));
    texMapa = pintarTextura(A);
    texDet = pintarDetalle(A);
    construirTerreno(A);
    if (CFG.capa) fijarCapa(CFG.capa);
    construirTerrenoLejano();
    construirFallas(A);
    construirCandidatos(A);
    prepararCumbres(A);
    prepararPins(A);
    camera.position.set(0, hLocal(0, 0) + (modo === 'ar' ? CFG.ojo : 25), 0); // explorar: vista de dron bajo, evita que el plano cercano corte el suelo
    if (modo !== 'ar') { VISTA.yaw = rumbo == null || rumbo === 0 && nombre ? mejorRumbo() : rumbo; VISTA.pitch = -2; }
    actualizarModoShader(); ajustarTamano();
    ESC.listo = true; cargando();
    calcularPerfil(gen);
    actualizarPisando();
    $('#lugar').textContent = modo === 'ar' ? 'Tu ubicación' : (nombre || LUGARES.find(l => Math.abs(l.lat - lat) < 1e-3 && Math.abs(l.lon - lon) < 1e-3)?.n || `${nf1.format(lat)}°, ${nf1.format(lon)}°`);
    if (!leer('visto-ayuda')) { mostrarAyuda(); guardar('visto-ayuda', '1'); }
    else if (texDet.length) toast(`🗺️ Mapa detallado 1:50.000 · ${texDet.map(d => d.M.titulo).join(' y ')} · SERNAGEOMIN`, 5000);
  } catch (err) {
    console.error(err); cargando(); toast('No se pudo cargar este lugar: ' + (err.message || err), 6000);
  }
}
function actualizarPisando() {
  const [lon, lat] = aLL(camera.position.x, -camera.position.z), cod = unidadEn(lon, lat), el = $('#pisando');
  if (!cod) { el.hidden = true; return; }
  const u = UNI[cod], c = CATEGORIAS[u.cat] || CATEGORIAS.sininfo;
  el.hidden = false; el.style.setProperty('--c', u.color);
  el.innerHTML = `<small>Estás parado sobre</small> ${c.ico} ${esc(c.nombre)}`;
  el.onclick = () => abrirFicha(cod);
}

// ------------------------------------------------------------------ bucle y controles
const VISTA = { yaw: 0, pitch: 0 };
function bucle(t) {
  requestAnimationFrame(bucle);
  if (!renderer || $('#escena').hidden) return;
  if (ESC.modo === 'ar') {
    if (S.tiene) { S.qDisp.slerp(S.qObj, 0.35); camera.quaternion.copy(S.qDisp); }
    else camera.rotation.set(VISTA.pitch * Math.PI / 180, -VISTA.yaw * Math.PI / 180, 0, 'YXZ'); // sin sensores: se apunta con el dedo
  } else {
    camera.rotation.set(VISTA.pitch * Math.PI / 180, -VISTA.yaw * Math.PI / 180, 0, 'YXZ');
  }
  if (ESC.listo) {
    renderer.render(scene, camera);
    const nueva = seleccionarEtiquetas(t); posicionarEtiquetas(nueva); actualizarMira(t);
    const rumbo = (rumboDe(camera.quaternion) + 360) % 360;
    rosaCompas.setAttribute('transform', `rotate(${-rumbo.toFixed(1)} 160 170)`);
    actualizarCompasNum(rumbo);
    $('#brujula').textContent = `${['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(rumbo / 45) % 8]} ${nf0.format(rumbo)}°`;
  }
}

// Brújula parcial: círculo de radio 160 centrado en (160,170); solo asoma el arco superior y gira con el rumbo
const rosaCompas = $('#compas-rosa');
(function dibujarCompas() {
  const NS = 'http://www.w3.org/2000/svg', R = 160, cx = 160, cy = 170; let s = '';
  for (let d = 0; d < 360; d += 5) {
    const g = d % 45 === 0, len = g ? 14 : d % 15 === 0 ? 9 : 5, a = d * Math.PI / 180;
    s += `<line class="c-tk${g ? ' g' : ''}" x1="${cx + Math.sin(a) * R}" y1="${cy - Math.cos(a) * R}" x2="${cx + Math.sin(a) * (R - len)}" y2="${cy - Math.cos(a) * (R - len)}"/>`;
  }
  ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'].forEach((t, i) => {
    const a = i * 45 * Math.PI / 180, r = R - 30, x = cx + Math.sin(a) * r, y = cy - Math.cos(a) * r;
    s += `<text class="${t === 'N' ? 'n' : t.length > 1 ? 's' : ''}" x="${x}" y="${y + 5}" transform="rotate(${i * 45} ${x} ${y})">${t}</text>`;
  });
  rosaCompas.innerHTML = s;
})();

let calibrando = false;
const PUNTOS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
function actualizarCompasNum(rumbo) {
  const n = $('#compas-num'); if (ESC.modo !== 'ar') { n.hidden = true; return; }
  n.hidden = false;
  n.firstChild.textContent = `${nf0.format(rumbo)}° ${PUNTOS[Math.round(rumbo / 45) % 8]}`;
  let aviso = '';
  if (S.tiene && S.iosOff == null && S.precision != null) aviso = 'Levanta el teléfono a la vertical para fijar el norte';
  else if (S.precision < 0) aviso = 'Brújula sin calibrar: dibuja un ∞ en el aire';
  else if (S.precision > 25) aviso = `Brújula imprecisa (±${nf0.format(S.precision)}°): toca para calibrar`;
  else if (S.tiene && !S.absoluto) aviso = 'Sin brújula absoluta: toca para calibrar';
  if (n.lastChild.textContent !== aviso) n.lastChild.textContent = aviso;
}
// Calibración rápida: el usuario pone la mira sobre una cumbre que reconoce y la toca en la lista;
// se corrige el rumbo (y la inclinación) para que el dibujo calce con ella.
function cumbresCercanasAMira() {
  if (!ESC.cumbres) return [];
  const c0 = camera.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const rumbo = Math.atan2(f.x, -f.z) * 180 / Math.PI;
  const out = [];
  ESC.cumbres.forEach((k, i) => {
    const dx = k.pos.x - c0.x, dn = -(k.pos.z - c0.z), d = Math.hypot(dx, dn);
    if (d < 1200 || !k.nombre) return;
    const rb = Math.atan2(dx, dn) * 180 / Math.PI, dr = envolver(rb - rumbo);
    if (Math.abs(dr) > 40) return;
    const el = Math.atan2(k.pos.y - c0.y, d) * 180 / Math.PI;
    out.push({ i, k, d, dr, el, dv: el - Math.asin(f.y) * 180 / Math.PI });
  });
  out.sort((a, b) => (Math.abs(a.dr) + Math.abs(a.dv) * 0.5) - (Math.abs(b.dr) + Math.abs(b.dv) * 0.5));
  const res = [];
  for (const o of out) { if (res.length >= 5) break; if (visible(o.k.pos)) res.push(o); }
  return res;
}
let _ultLista = '';
const CHIP_ALTURA = '<button class="chip escala" data-escala="1">↕ Altura<small>sin cumbre</small></button>';
function refrescarListaCalibracion() {
  if (!calibrando || calibPaso !== 1) return;
  const l = cumbresCercanasAMira();
  const clave = l.map(o => o.i).join(',');
  if (clave === _ultLista) return; _ultLista = clave;
  $('#calib-lista').innerHTML = l.length
    ? l.map(o => `<button class="chip" data-i="${o.i}">${esc(o.k.nombre)}<small>${nf0.format(o.d / 1000)} km</small></button>`).join('') + CHIP_ALTURA
    : '<span class="vacio">No veo cumbres con nombre hacia donde apuntas. Gira un poco.</span>' + CHIP_ALTURA;
}
function calibrarConCumbre(i) {
  const o = cumbresCercanasAMira().find(x => x.i === i); if (!o) return;
  S.yawUsuario = envolver(S.yawUsuario + o.dr);
  S.pitchUsuario = Math.max(-15, Math.min(15, S.pitchUsuario + o.dv));
  S.iosCongelado = S.iosOff != null; // en iPhone, el giroscopio mantiene el ajuste sin que la brújula lo desarme
  guardar('yaw', S.yawUsuario.toFixed(2)); guardar('pitch', S.pitchUsuario.toFixed(2));
  // La cumbre queda en la mira. Su ángulo sobre la horizontal sale de la distancia en planta y el desnivel
  // (con curvatura y refracción), así que es un ancla fija: el paso 2 escala el dibujo alrededor de ella.
  const dh = o.k.pos.y - camera.position.y;
  $('#calib-ref').textContent = `${o.k.nombre}: ${fmtDist(o.d)} en planta, ${dh >= 0 ? '+' : '−'}${nf0.format(Math.abs(dh))} m → ${nf1.format(o.el)}° sobre la horizontal. Queda fija en la mira ⊕.`;
  pasoEscala();
  toast(`🎯 Rumbo calibrado con ${o.k.nombre} (corrección de ${nf0.format(Math.abs(o.dr))}°). Ahora ajusta la altura.`, 4000);
}
// Paso 2: el tamaño angular del relieve depende del campo visual de la cámara, que cambia entre teléfonos
// (lente, zoom digital, recorte del video). Se expresa como "relieve ×N" respecto del valor por defecto.
let calibPaso = 1;
const relieveX = () => Math.tan(FOV_DEF * Math.PI / 360) / Math.tan(CFG.fovLargo * Math.PI / 360);
function fijarRelieve(x) {
  x = Math.max(0.6, Math.min(4, x));
  CFG.fovLargo = 2 * Math.atan(Math.tan(FOV_DEF * Math.PI / 360) / x) * 180 / Math.PI;
  $('#r-fov').value = CFG.fovLargo; guardar('fov', CFG.fovLargo.toFixed(2)); ajustarTamano();
  $('#calib-x').textContent = '×' + nf1.format(x);
}
function pasoEscala(sinCumbre) {
  calibPaso = 2; document.body.classList.add('calib-escala');
  if (sinCumbre) $('#calib-ref').textContent = 'Mejor si antes fijas una cumbre en el paso 1: el dibujo se estira alrededor de la mira ⊕. ';
  $('#calib-x').textContent = '×' + nf1.format(relieveX());
}
function instalarGestos() {
  const el = $('#escena'); let arr = null, pinza = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.etq, button, #ficha, .panel, #mirando, #pisando, #compas, #calib-panel, .dial-op')) return;
    const conSensores = ESC.modo === 'ar' && S.tiene;
    const q = aVirtual(e.clientX, e.clientY);
    arr = { x: q.x, y: q.y, yaw: conSensores ? S.yawUsuario : VISTA.yaw, pitch: conSensores ? S.pitchUsuario : VISTA.pitch, x0: relieveX() };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!arr) return;
    if (!innerHeight) return;
    const q = aVirtual(e.clientX, e.clientY);
    const gpp = camera.fov / VH(); // grados por píxel
    const dx = (q.x - arr.x) * gpp, dy = (q.y - arr.y) * gpp;
    if (ESC.modo === 'ar' && calibrando && calibPaso === 2) {
      fijarRelieve(arr.x0 * Math.exp(-(q.y - arr.y) / 260)); // hacia arriba = relieve más alto
    } else if (ESC.modo === 'ar' && S.tiene) {
      if (!calibrando) return;
      S.yawUsuario = arr.yaw - dx; S.pitchUsuario = arr.pitch - dy;
    } else {
      VISTA.yaw = (arr.yaw - dx + 360) % 360; VISTA.pitch = Math.max(-45, Math.min(45, arr.pitch + dy));
    }
  });
  const fin = () => { if (arr && ESC.modo === 'ar' && S.tiene && calibrando && calibPaso === 1) { guardar('yaw', S.yawUsuario.toFixed(2)); guardar('pitch', S.pitchUsuario.toFixed(2)); } arr = null; };
  el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
  el.addEventListener('wheel', e => {
    if (ESC.modo === 'ar') return;
    CFG.fovExplorar = Math.max(15, Math.min(80, (CFG.fovExplorar || 60) * (e.deltaY > 0 ? 1.08 : 0.92))); ajustarTamano();
  }, { passive: true });
  el.addEventListener('touchstart', e => { if (e.touches.length === 2) pinza = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), f: CFG.fovExplorar || 60, fl: CFG.fovLargo }; }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!pinza || e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), r = pinza.d / d;
    if (ESC.modo === 'ar') { if (calibrando || !S.tiene) { CFG.fovLargo = Math.max(18, Math.min(110, pinza.fl * r)); $('#r-fov').value = CFG.fovLargo; ajustarTamano(); if (calibPaso === 2) $('#calib-x').textContent = '×' + nf1.format(relieveX()); } }
    else { CFG.fovExplorar = Math.max(15, Math.min(80, pinza.f * r)); ajustarTamano(); }
  }, { passive: true });
  el.addEventListener('touchend', () => { if (pinza) guardar('fov', CFG.fovLargo); pinza = null; });
}
// Transparencia de la capa: el deslizador de ⚙️ Opciones y el dial lateral muestran el mismo valor (opacidad 0,15–0,95)
const OP_MIN = 0.15, OP_MAX = 0.95;
function fijarOpacidad(v) {
  v = Math.min(OP_MAX, Math.max(OP_MIN, Math.round(v * 100) / 100));
  CFG.opacidad = v; guardar('opacidad', v); $('#r-opacidad').value = v;
  if (terrenoColor) terrenoColor.material.uniforms.opacidad.value = calibrando ? Math.min(0.2, v) : v;
  const f = (v - OP_MIN) / (OP_MAX - OP_MIN), d = $('#dial-op');
  d.querySelector('.d-relleno').style.height = f * 100 + '%';
  d.querySelector('.d-perilla').style.bottom = f * 100 + '%';
  $('#dial-val').textContent = Math.round(v * 100) + ' %';
  d.setAttribute('aria-valuenow', Math.round(v * 100));
}
// arrastre relativo (sirve igual con la interfaz girada en horizontal): subir = capa más fuerte; tocar la pista salta ahí
function instalarDialOpacidad() {
  const d = $('#dial-op'), pista = d.querySelector('.d-pista'); let ini = null;
  d.addEventListener('pointerdown', e => {
    e.stopPropagation(); d.setPointerCapture(e.pointerId); d.classList.add('arrastrando');
    const q = aVirtual(e.clientX, e.clientY);
    let v0 = CFG.opacidad;
    if (e.target.closest('.d-pista') && !e.target.closest('.d-perilla')) {
      const r = pista.getBoundingClientRect(), c = aVirtual(r.left + r.width / 2, r.top + r.height / 2);
      fijarOpacidad(OP_MIN + (0.5 + (c.y - q.y) / pista.offsetHeight) * (OP_MAX - OP_MIN)); v0 = CFG.opacidad;
    }
    ini = { y: q.y, v: v0 };
  });
  d.addEventListener('pointermove', e => {
    if (!ini) return;
    const q = aVirtual(e.clientX, e.clientY);
    fijarOpacidad(ini.v + (ini.y - q.y) / pista.offsetHeight * (OP_MAX - OP_MIN));
  });
  const fin = () => { ini = null; d.classList.remove('arrastrando'); };
  d.addEventListener('pointerup', fin); d.addEventListener('pointercancel', fin);
  d.addEventListener('keydown', e => {
    const k = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[e.key];
    if (k) { e.preventDefault(); fijarOpacidad(CFG.opacidad + k); }
  });
}
function alternarCalibrar(on = !calibrando) {
  calibrando = on; document.body.classList.toggle('calibrando', on);
  calibPaso = 1; document.body.classList.remove('calib-escala');
  if (grupoPerfil) grupoPerfil.visible = CFG.perfil || on;
  if (terrenoColor) terrenoColor.material.uniforms.opacidad.value = on ? Math.min(0.2, CFG.opacidad) : CFG.opacidad;
  $('#btn-calibrar').classList.toggle('activo', on);
  _ultLista = '';
  clearInterval(alternarCalibrar.t);
  if (on) { refrescarListaCalibracion(); alternarCalibrar.t = setInterval(refrescarListaCalibracion, 350); }
}
function mostrarAyuda() {
  $('#ficha-cuerpo').innerHTML = `<header class="fi-cab" style="--c:#7cc4ff"><span class="fi-ico">🧭</span><div><small>Cómo usar GeoLente</small><h2>Lee los cerros como un geólogo</h2></div></header>
    <section><ol class="pasos">
      <li><b>Apunta a los cerros.</b> Los colores muestran de qué roca está hecho cada cerro, según el mapa geológico oficial.</li>
      <li><b>Toca una etiqueta</b> para saber qué es, cuántos millones de años tiene y cómo reconocerla.</li>
      <li><b>Usa la mira ⊕</b> del centro: te dice qué estás mirando y a qué distancia.</li>
      <li><b>Las líneas blancas dibujan el perfil de los cerros</b> (el horizonte y las crestas). Si no calzan con lo que ves, toca <b>🎯 Ajustar</b>: primero elige una cumbre que reconozcas (fija el rumbo) y luego estira el dibujo ↕ hasta que la línea tenga la altura real del cordón. Cada cámara ve un ángulo distinto, y el ajuste queda guardado en tu teléfono.</li>
      <li><b>Las líneas rojas, naranjas y amarillas son fallas activas.</b> Las punteadas están inferidas o cubiertas.</li>
      <li>La brújula del teléfono puede fallar cerca de autos, rejas o edificios: por eso existe el ajuste.</li>
    </ol></section>
    <section class="leyenda-edades"><h3>Colores por edad</h3>
      <div class="ley"><i style="background:#FFF2AE"></i>Cuaternario (0–2,6 Ma)</div><div class="ley"><i style="background:#FFFF00"></i>Neógeno (2,6–23 Ma)</div>
      <div class="ley"><i style="background:#FDB46C"></i>Paleógeno (23–66 Ma)</div><div class="ley"><i style="background:#8CCD57"></i>Cretácico (66–145 Ma)</div>
      <div class="ley"><i style="background:#42AED0"></i>Jurásico (145–201 Ma)</div><div class="ley"><i style="background:#983999"></i>Triásico (201–252 Ma)</div>
      <div class="ley"><i style="background:#67A599"></i>Paleozoico (252–539 Ma)</div><div class="ley"><i style="background:#E8485A"></i>Rocas intrusivas (rojos: más oscuro, más antiguo)</div>
      <p class="aviso">Ma = millones de años. Los colores siguen la carta cronoestratigráfica internacional.</p></section>
    <section class="oficial"><h3>Fuentes</h3><p>Mapa Geológico de Chile 1:1.000.000 (SERNAGEOMIN, 2003) · Mapas geológicos detallados 1:50.000 de Río Claro y Central Los Cipreses, Región del Maule (SERNAGEOMIN) · Catálogo de Fallas Activas de Chile CHAF v1 (Melnick, Maldonado y Contreras, 2020; CC BY 4.0) · Nombres de cumbres: © colaboradores de OpenStreetMap (ODbL) y GeoNames (CC BY 4.0) · Relieve: teselas Terrarium (AWS Open Data, SRTM y otros) · Declinación magnética: WMM2025 (NOAA/BGS).</p>
    <p class="aviso">Herramienta de divulgación: no reemplaza las cartas geológicas ni estudios de peligros geológicos.</p></section>`;
  mostrarFicha();
}
function volverInicio() {
  $('#escena').hidden = true; $('#inicio').hidden = false; ESC.listo = false;
  const v = $('#cam'); v.srcObject?.getTracks().forEach(t => t.stop()); v.srcObject = null;
}

// Traduce el error de cada paso a algo que el usuario pueda arreglar
function motivo(err, paso) {
  const n = err?.name || '', m = err?.message || String(err || '');
  if (paso === 'gps') {
    if (err?.code === 1) return 'Permiso de ubicación denegado. Toca el candado junto a la dirección → Permisos → Ubicación → Permitir. Revisa también en Ajustes del teléfono que Chrome tenga permiso de ubicación.';
    if (err?.code === 2) return 'Ubicación no disponible: enciende la Ubicación (GPS) del teléfono.';
    if (err?.code === 3) return 'El GPS no respondió a tiempo. Sal al aire libre y activa la ubicación precisa.';
    return m;
  }
  if (n === 'NotAllowedError' || /denied|denegad/i.test(m)) return paso === 'camara'
    ? 'Permiso de cámara denegado. Toca el candado junto a la dirección → Permisos → Cámara → Permitir. En incógnito, Chrome vuelve a preguntar cada vez y puede bloquear si antes se cerró el aviso.'
    : 'Permiso de sensores de movimiento denegado.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No se encontró una cámara.';
  if (n === 'NotReadableError') return 'La cámara está ocupada por otra aplicación: ciérrala e intenta de nuevo.';
  return m;
}
function mostrarDiagnostico(d, fatal) {
  const fila = (ico, nombre, v) => `<li class="diag-${v === 'ok' ? 'ok' : v === 'aviso' ? 'aviso' : 'mal'}"><b>${v === 'ok' ? '✅' : v === 'aviso' ? '⚠️' : '❌'} ${ico} ${nombre}</b>${v === 'ok' ? '' : `<span>${esc(d[nombre + '_txt'] || v)}</span>`}</li>`;
  $('#ficha-cuerpo').innerHTML = `<header class="fi-cab" style="--c:${fatal ? '#ff5a36' : '#ffd21a'}"><span class="fi-ico">🩺</span><div><small>Revisión de la realidad aumentada</small><h2>${fatal ? 'No se pudo iniciar' : 'Funciona, con limitaciones'}</h2></div></header>
    <section><ul class="diag">${fila('📷', 'Cámara', d.Cámara)}${fila('📍', 'Ubicación', d.Ubicación)}${fila('🧭', 'Orientación', d.Orientación)}</ul>
    <p class="aviso">Navegador: ${esc(d.nav)}</p></section>
    <section class="diag-acciones"><button class="btn primario" id="diag-reintentar">Reintentar</button>${fatal ? '<button class="btn" id="diag-explorar">Usar un lugar de ejemplo</button>' : ''}</section>`;
  $('#diag-reintentar').onclick = () => { cerrarFicha(); empezarAR(); };
  if (fatal) $('#diag-explorar').onclick = () => { cerrarFicha(); const l = LUGARES[0]; abrirEn(l.lat, l.lon, 'explorar', l.rumbo || null, l.n); };
  mostrarFicha();
}
async function empezarAR() {
  const btn = $('#btn-ar'); btn.disabled = true;
  const ua = navigator.userAgent;
  const d = { nav: (navigator.brave ? 'Brave' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'otro') + (isSecureContext ? '' : ' · sin https') };
  try {
    // 1) sensores (en iPhone el permiso debe pedirse primero, dentro del toque). No es fatal.
    try { await pedirPermisoOrientacion(); d.Orientación = 'pendiente'; }
    catch (e) { d.Orientación = 'mal'; d.Orientación_txt = motivo(e, 'sensores'); }
    // 2) cámara. No es fatal: sin cámara se sigue sobre fondo oscuro.
    cargando('Pidiendo acceso a la cámara…');
    try {
      if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('La cámara requiere una conexión segura (https).');
      await iniciarCamara(); d.Cámara = 'ok';
    } catch (e) { console.error(e); d.Cámara = 'mal'; d.Cámara_txt = motivo(e, 'camara'); }
    // 3) GPS: primero preciso; si no responde, uno aproximado (antena/wifi)
    cargando('Buscando tu ubicación…');
    let c = null;
    try { c = await obtenerPosicion(true, 15000); }
    catch (e1) {
      cargando('El GPS tarda: probando una ubicación aproximada…');
      try { c = await obtenerPosicion(false, 12000); } catch (e2) { d.Ubicación_txt = motivo(e2.code === 3 && e1.code !== 3 ? e1 : e2, 'gps'); }
    }
    if (!c) {
      cargando(); d.Ubicación = 'mal';
      if (d.Orientación === 'pendiente') d.Orientación = 'ok';
      const v = $('#cam'); v.srcObject?.getTracks().forEach(t => t.stop()); v.srcObject = null;
      mostrarDiagnostico(d, true); return;
    }
    d.Ubicación = c.accuracy > 200 ? 'aviso' : 'ok';
    if (c.accuracy > 200) d.Ubicación_txt = `Ubicación aproximada (± ${nf0.format(c.accuracy)} m): el dibujo puede quedar corrido. Activa la ubicación precisa.`;
    ESC.modo = 'ar';
    await abrirEn(c.latitude, c.longitude, 'ar');
    $('#gps').textContent = `± ${nf0.format(c.accuracy)} m`;
    vigilarGPS();
    setTimeout(async () => {
      if (d.Orientación !== 'mal') {
        if (!S.tiene) {
          const brave = await navigator.brave?.isBrave?.().catch(() => false);
          d.Orientación = 'aviso';
          d.Orientación_txt = brave ? 'Brave bloquea los sensores de movimiento: apunta arrastrando con el dedo o abre GeoLente en Chrome (sin incógnito).'
            : 'El navegador no entrega los sensores de movimiento (en Chrome: candado → Permisos → Sensores de movimiento). Mientras, apunta arrastrando con el dedo.';
          VISTA.pitch = 0;
        } else if (!S.absoluto) { d.Orientación = 'aviso'; d.Orientación_txt = 'Hay sensores pero no brújula absoluta: alinea con 🎯 Ajustar.'; }
        else d.Orientación = 'ok';
      }
      if (d.Cámara !== 'ok' || d.Orientación !== 'ok' || d.Ubicación !== 'ok') mostrarDiagnostico(d, false);
    }, 4000);
  } catch (err) {
    console.error(err); cargando();
    volverInicio();
    toast('No se pudo iniciar la realidad aumentada: ' + (err.message || err), 8000);
  } finally { btn.disabled = false; }
}

// ------------------------------------------------------------------ buscador de localidades
let LOCALIDADES = null;
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function iniciarBuscador() {
  const q = $('#q'), res = $('#q-res'); let lista = [];
  const cargar = async () => {
    if (LOCALIDADES) return;
    try { const j = await (await fetch('data/localidades.json')).json(); LOCALIDADES = { r: j.r, l: j.l.map(x => ({ n: x[0], lat: x[1], lon: x[2], r: j.r[x[3]], k: norm(x[0]) })) }; } catch { LOCALIDADES = { r: [], l: [] }; }
  };
  const buscar = async () => {
    const t = norm(q.value); if (t.length < 2) { res.hidden = true; return; }
    await cargar();
    const ini = [], med = [];
    for (const x of LOCALIDADES.l) { // ya vienen ordenadas por población
      const i = x.k.indexOf(t); if (i < 0) continue;
      (i === 0 || x.k[i - 1] === ' ' ? ini : med).push(x);
      if (ini.length >= 8) break;
    }
    lista = ini.concat(med).slice(0, 8);
    res.hidden = false;
    res.innerHTML = lista.length ? lista.map((x, i) => `<button data-i="${i}">${esc(x.n)}<small>${esc(x.r)}</small></button>`).join('') : '<span class="vacio">No encontré esa localidad. Prueba con otra escritura.</span>';
  };
  q.addEventListener('input', buscar);
  q.addEventListener('focus', cargar, { once: true });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && lista[0]) { e.preventDefault(); ir(lista[0]); } });
  const ir = x => { q.blur(); res.hidden = true; abrirEn(x.lat, x.lon, 'explorar', null, `${x.n} · ${x.r}`); };
  res.onclick = e => { const b = e.target.closest('[data-i]'); if (b) ir(lista[+b.dataset.i]); };
}

// ------------------------------------------------------------------ interfaz
function iniciarUI() {
  $('#lugares').innerHTML = LUGARES.map((l, i) => `<button data-i="${i}"><span class="t-ico">${l.ico}</span><span><b>${esc(l.n)}</b><small>${esc(l.d)}</small></span></button>`).join('');
  $('#lugares').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { const l = LUGARES[+b.dataset.i]; abrirEn(l.lat, l.lon, 'explorar', l.rumbo || null, l.n); } };
  iniciarBuscador();
  $('#btn-ar').onclick = empezarAR;
  $('#btn-explorar-aqui').onclick = async () => {
    try { cargando('Buscando tu ubicación…'); const c = await obtenerPosicion(); abrirEn(c.latitude, c.longitude, 'explorar', 0); }
    catch { cargando(); toast('No se pudo obtener tu ubicación. Elige un lugar de ejemplo.'); }
  };
  $('#btn-volver').onclick = volverInicio;
  $('#btn-ayuda').onclick = mostrarAyuda;
  $('#btn-coleccion').onclick = abrirColeccion;
  $('#btn-calibrar').onclick = () => alternarCalibrar();
  $('#compas').onclick = () => { if (ESC.modo === 'ar') alternarCalibrar(); };
  $('#calib-lista').onclick = e => { const b = e.target.closest('[data-i], [data-escala]'); if (!b) return; if (b.dataset.escala) pasoEscala(true); else calibrarConCumbre(+b.dataset.i); };
  $('#calib-escala').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'calib-listo') { alternarCalibrar(false); toast(`🎯 Listo: relieve ×${nf1.format(relieveX())}. Queda guardado en este teléfono.`, 4000); return; }
    fijarRelieve(relieveX() * (+b.dataset.x > 0 ? 1.05 : 1 / 1.05));
  };
  // paneles laterales: uno a la vez
  const panel = id => {
    for (const [p, b] of [['#capas', '#btn-capa'], ['#ajustes', '#btn-ajustes']]) {
      const abrir = p === id && !$(p).classList.contains('abierto');
      $(p).classList.toggle('abierto', abrir); $(b).classList.toggle('activo', abrir); $(b).setAttribute('aria-expanded', abrir);
    }
  };
  $('#btn-ajustes').onclick = () => panel('#ajustes');
  $('#btn-capa').onclick = () => { actualizarInfoDetalle(); panel('#capas'); };
  $('#escena').addEventListener('pointerdown', e => { if (!e.target.closest('.panel, .lateral')) panel(null); });
  $('#ficha-cerrar').onclick = cerrarFicha;
  $('#ficha').addEventListener('click', e => { if (e.target.id === 'ficha') cerrarFicha(); });
  $('#mirando').onclick = () => { if (!miraActual) return; if (miraActual.cod) abrirFicha(miraActual.cod); else if (miraActual.falla != null) abrirFichaFalla(miraActual.falla); };
  const rOp = $('#r-opacidad'); rOp.value = CFG.opacidad;
  rOp.oninput = () => fijarOpacidad(+rOp.value);
  instalarDialOpacidad(); fijarOpacidad(CFG.opacidad);
  const rFov = $('#r-fov'); rFov.value = CFG.fovLargo;
  rFov.oninput = () => { CFG.fovLargo = +rFov.value; guardar('fov', rFov.value); ajustarTamano(); };
  const cF = $('#c-fallas'); cF.checked = CFG.fallas;
  cF.onchange = () => { CFG.fallas = cF.checked; guardar('fallas', cF.checked ? '1' : '0'); if (grupoFallas) grupoFallas.visible = CFG.fallas; };
  const cE = $('#c-etiquetas'); cE.checked = CFG.etiquetas;
  cE.onchange = () => { CFG.etiquetas = cE.checked; guardar('etiquetas', cE.checked ? '1' : '0'); };
  const cP = $('#c-perfil'); cP.checked = CFG.perfil;
  cP.onchange = () => { CFG.perfil = cP.checked; guardar('perfil', cP.checked ? '1' : '0'); if (grupoPerfil) grupoPerfil.visible = CFG.perfil || calibrando; };
  const cC = $('#c-cumbres'); cC.checked = CFG.cumbres;
  cC.onchange = () => { CFG.cumbres = cC.checked; guardar('cumbres', cC.checked ? '1' : '0'); };
  $('#fondos').onclick = e => { const b = e.target.closest('[data-capa]'); if (b) fijarCapa(+b.dataset.capa); };
  fijarCapa(CFG.capa);
  const cD = $('#c-detalle'); cD.checked = CFG.detalle;
  cD.onchange = () => { CFG.detalle = cD.checked; guardar('detalle', cD.checked ? '1' : '0'); actualizarInfoDetalle(); if (O) abrirEn(O.lat, O.lon, ESC.modo, VISTA.yaw); };
  const cPi = $('#c-pins'); cPi.checked = CFG.pins;
  cPi.onchange = () => { CFG.pins = cPi.checked; guardar('pins', cPi.checked ? '1' : '0'); actualizarInfoDetalle(); };
  const sA = $('#s-alcance'); sA.value = CFG.alcance;
  sA.onchange = () => { CFG.alcance = +sA.value; guardar('alcance', sA.value); if (O) abrirEn(O.lat, O.lon, ESC.modo, VISTA.yaw); };
  $('#btn-reset').onclick = () => { S.yawUsuario = 0; S.pitchUsuario = 0; S.iosCongelado = false; CFG.fovLargo = FOV_DEF; rFov.value = FOV_DEF; guardar('yaw', 0); guardar('pitch', 0); guardar('fov', FOV_DEF); ajustarTamano(); toast('Ajuste restablecido.'); };
  actualizarContador();
  instalarGestos();
  requestAnimationFrame(bucle);

  const sim = params.get('sim');
  if (sim) { const [la, lo, ru] = sim.split(',').map(Number); abrirEn(la, lo, 'explorar', ru || 0); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
}
// ------------------------------------------------------------------ instalar como app (igual que GeoParqueMet)
// La invitación queda visible mientras no esté instalada; si el navegador no ofrece su diálogo
// (iPhone, o Chrome tras un rechazo previo) se muestran los pasos manuales con una flecha al menú.
const INSTALADA = ['standalone', 'fullscreen'].some(m => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
const ES_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let pedidoInstalar = null, instaladaAhora = false;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalar = e; mostrarInstalar(); });
addEventListener('appinstalled', () => { pedidoInstalar = null; instaladaAhora = true; mostrarInstalar(); cerrarFicha(); toast('¡Listo! Abre GeoLente desde el nuevo ícono de tu teléfono.', 8000); });
function mostrarInstalar() {
  const ver = !INSTALADA && !instaladaAhora;
  document.querySelectorAll('.btn-instalar').forEach(b => b.hidden = !ver);
}
const CAB_INSTALAR = `<header class="fi-cab" style="--c:#2f8cff"><span class="fi-ico">📲</span><div><small>Recomendado</small><h2>Instala GeoLente en tu teléfono</h2></div></header>
  <section><p>Queda como una app: se abre en pantalla completa, sin la barra del navegador, y el mapa de los lugares que visites queda guardado para usarlo sin señal.</p></section>`;
function hojaInstalar(cuerpo, flecha) {
  $('#ficha-cuerpo').innerHTML = CAB_INSTALAR + cuerpo + (flecha ? `<div class="flecha-instalar ${flecha}" aria-hidden="true">${flecha.startsWith('arriba') ? '⬆' : '⬇'}</div>` : '');
  mostrarFicha();
  $('#ficha-cuerpo').querySelectorAll('.cerrar-hoja').forEach(b => b.onclick = cerrarFicha);
  $('#hoja-instalar')?.addEventListener('click', () => { cerrarFicha(); instalar(); });
}
const ICO_COMPARTIR = '<svg class="ico-compartir" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M8 10H6v11h12V10h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const pasos = l => `<section><ol class="pasos-inst">${l.map(x => `<li><span>${x}</span></li>`).join('')}</ol></section>
  <section class="diag-acciones"><button class="btn primario cerrar-hoja">Entendido</button></section>`;
function instalar() {
  if (pedidoInstalar) {
    pedidoInstalar.prompt();
    pedidoInstalar.userChoice.then(r => { if (r.outcome === 'accepted') instaladaAhora = true; }).finally(() => { pedidoInstalar = null; mostrarInstalar(); });
    return;
  }
  const ua = navigator.userAgent;
  if (ES_IOS) {
    const chrome = /CriOS/.test(ua), ipad = /ipad/i.test(ua) || navigator.platform === 'MacIntel';
    hojaInstalar(pasos([
      chrome ? `Toca el botón <b>Compartir</b> ${ICO_COMPARTIR} junto a la barra de direcciones` : `Toca el botón <b>Compartir</b> ${ICO_COMPARTIR} de Safari`,
      'Desliza y elige <b>«Agregar a pantalla de inicio»</b> ➕', 'Abre <b>GeoLente</b> desde el nuevo ícono']), ipad || chrome ? 'arriba' : 'abajo');
    return;
  }
  const samsung = /SamsungBrowser/.test(ua), firefox = /Firefox/.test(ua), movil = /Android/.test(ua), brave = !!navigator.brave;
  const l = samsung ? ['Toca el menú <b>≡</b> abajo a la derecha', 'Elige <b>«Agregar página a»</b> y luego <b>«Pantalla de inicio»</b>', 'Abre <b>GeoLente</b> desde el nuevo ícono']
    : firefox ? ['Toca el menú <b>⋮</b> del navegador', 'Elige <b>«Instalar»</b> o <b>«Agregar a pantalla de inicio»</b>', 'Abre <b>GeoLente</b> desde el nuevo ícono']
    : movil ? [`Toca el menú <b>⋮</b> ${brave ? 'de Brave' : 'arriba a la derecha de Chrome'}`, 'Elige <b>«Instalar aplicación»</b> o <b>«Agregar a la pantalla principal»</b>', 'Confirma con <b>Instalar</b> y abre <b>GeoLente</b> desde el nuevo ícono']
    : ['En la barra de direcciones toca el ícono <b>Instalar</b> 🖥️⬇ (a la derecha)', 'O abre el menú <b>⋮</b> → <b>«Transmitir, guardar y compartir»</b> → <b>«Instalar página como app»</b>', 'Confirma con <b>Instalar</b>'];
  hojaInstalar(pasos(l), samsung ? 'abajo derecha' : movil && !brave ? 'arriba derecha' : '');
}
// Al abrir (una vez por visita) se ofrece instalar
function ofrecerInstalar() {
  if (INSTALADA || instaladaAhora || params.get('sim')) return;
  try { if (sessionStorage.getItem('geolente:ofrecido')) return; sessionStorage.setItem('geolente:ofrecido', '1'); } catch { }
  setTimeout(() => {
    if (!$('#ficha').hidden || !$('#escena').hidden) return;
    if (pedidoInstalar) hojaInstalar(`<section class="diag-acciones"><button class="btn primario" id="hoja-instalar">📲 Instalar ahora</button><button class="btn cerrar-hoja">Ahora no</button></section>`);
    else instalar();
  }, 1500);
}

iniciarUI();
document.querySelectorAll('.btn-instalar').forEach(b => b.onclick = instalar);
mostrarInstalar();
ofrecerInstalar();

// para pruebas desde la consola
window.GeoLente = { get DEM2() { return DEM2; }, get DEM() { return DEM; }, calcularPerfil: () => calcularPerfil(generacion), get grupoPerfil() { return grupoPerfil; }, _orient: (a, b, g, abs = true, extra = {}) => onOrientacion({ alpha: a, beta: b, gamma: g, ...extra }, abs), rumboDe, ESC, CFG, VISTA, S, abrirEn, abrirFicha, abrirFichaFalla, abrirColeccion, get FALLAS() { return FALLAS; }, unidadEn: (lat, lon) => unidadEn(lon, lat), hLocal, get camera() { return camera; } };
