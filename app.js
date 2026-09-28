// GeoLente — mapa geológico en realidad aumentada sobre los cerros.
// Marco local: x = este, y = arriba, z = -norte (metros, relativo al origen). La cámara mira hacia -z cuando apunta al norte.
import * as THREE from 'three';
import { Line2 } from './vendor/three/lines/Line2.js';
import { LineMaterial } from './vendor/three/lines/LineMaterial.js';
import { LineGeometry } from './vendor/three/lines/LineGeometry.js';
import { LineSegments2 } from './vendor/three/lines/LineSegments2.js';
import { LineSegmentsGeometry } from './vendor/three/lines/LineSegmentsGeometry.js';
import { CATEGORIAS, datoMarino, contextoEdad, periodo, era, FALLA, svgFalla } from './contenido.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const R_TIERRA = 6371000, REFRACCION = 0.13;

const CFG = {
  alcance: +(leer('alcance') || 25000), nGrid: 481, tex: 2048, ojo: 1.7,
  fadeCerca: 220, fadeLejos: 600, opacidad: +(leer('opacidad') || 0.5),
  fovLargo: +(leer('fov') || 68), // FOV de la cámara del teléfono en su lado largo (grados)
  fallas: leer('fallas') !== '0', etiquetas: leer('etiquetas') !== '0',
  perfil: leer('perfil') !== '0', cumbres: leer('cumbres') !== '0',
};

export const LUGARES = [
  { n: 'Santiago · Cerro San Cristóbal', lat: -33.4255, lon: -70.6335, rumbo: 95 },
  { n: 'Farellones · hacia el cerro El Plomo', lat: -33.3530, lon: -70.3100, rumbo: 35 },
  { n: 'Valle del Elqui · Vicuña', lat: -30.0327, lon: -70.7080, rumbo: 100 },
  { n: 'San Pedro de Atacama', lat: -22.9130, lon: -68.2000, rumbo: 105 },
  { n: 'Pucón · Volcán Villarrica', lat: -39.2800, lon: -71.9600, rumbo: 175 },
  { n: 'Torres del Paine', lat: -51.0630, lon: -72.9985, rumbo: 330 },
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
let UNI = null, INDICE = null, FALLAS = null, DECL = null, CUMBRES = [];
async function cargarBase() {
  const [u, i, f, d] = await Promise.all(['data/unidades.json', 'data/geo/index.json', 'data/fallas.json', 'data/declinacion.json']
    .map(p => fetch(p).then(r => r.json())));
  UNI = u; INDICE = new Set(i.teselas); FALLAS = f; DECL = d;
  try { CUMBRES = (await (await fetch('data/cumbres.json')).json()).c; } catch { CUMBRES = []; }
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
  for (const p of ESC.polys) {
    const b = p.bb; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (!dentroAnillo(p.anillos[0], lon, lat)) continue;
    let hueco = false; for (let k = 1; k < p.anillos.length; k++) if (dentroAnillo(p.anillos[k], lon, lat)) { hueco = true; break; }
    if (!hueco) return p.cod;
  }
  return null;
}

// ------------------------------------------------------------------ escena three.js
const ESC = { polys: [], fallas: [], cand: [], candF: [], listo: false, modo: 'explorar' };
let renderer, scene, camera, terrenoColor, terrenoProf, grupoFallas, texMapa;

function iniciarThree() {
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
  const w = innerWidth, h = innerHeight;
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
  const v = $('#cam'), sw = innerWidth, sh = innerHeight;
  let vw = v.videoWidth || 1080, vh = v.videoHeight || 1920;
  const esc = Math.max(sw / vw, sh / vh), dw = vw * esc, dh = vh * esc;
  const f = (Math.max(dw, dh) / 2) / Math.tan(CFG.fovLargo * Math.PI / 360);
  return 2 * Math.atan((sh / 2) / f) * 180 / Math.PI;
}

const VS = `
varying vec2 vUv; varying float vDist; varying vec3 vN;
void main(){ vUv = uv; vN = normal; vec4 wp = modelMatrix * vec4(position,1.0);
  vDist = length(wp.xz - cameraPosition.xz); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const FS = `
uniform sampler2D mapa; uniform float opacidad, fadeCerca, fadeLejos, modoAR, soloProf, alcance; uniform vec3 luz, cielo;
varying vec2 vUv; varying float vDist; varying vec3 vN;
void main(){
  if (modoAR > 0.5 && vDist < fadeCerca) discard;
  if (soloProf > 0.5) { gl_FragColor = vec4(0.0); return; }
  vec4 t = texture2D(mapa, vUv);
  float sh = clamp(dot(normalize(vN), luz), 0.0, 1.0);
  float fade = (modoAR > 0.5 ? smoothstep(fadeCerca, fadeLejos, vDist) : 1.0) * (1.0 - smoothstep(alcance*0.88, alcance, max(abs(vUv.x-0.5), abs(vUv.y-0.5))*2.0*alcance));
  if (modoAR > 0.5) {
    float a = t.a * opacidad * fade; if (a < 0.02) discard;
    vec3 cc = mix(vec3(dot(t.rgb, vec3(0.299,0.587,0.114))), t.rgb, 0.82);
    gl_FragColor = vec4(cc, a);
  } else {
    vec3 base = vec3(0.60, 0.57, 0.52);
    vec3 tc = mix(vec3(dot(t.rgb, vec3(0.299,0.587,0.114))), t.rgb, 0.8);
    vec3 c = mix(base, tc, t.a * (0.35 + 0.65 * opacidad)) * (0.38 + 0.8 * sh);
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
    mapa: { value: texMapa }, opacidad: { value: CFG.opacidad }, fadeCerca: { value: CFG.fadeCerca }, fadeLejos: { value: CFG.fadeLejos },
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
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const k = j * N + i; idx.push(k, k + 1, k + N, k + 1, k + N + 1, k + N); }
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
  FALLAS.f.forEach((f, fi) => {
    for (const enc of f.g) {
      const ll = decodificar(enc, q);
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
          const color = COLOR_ACT[f.act] || 0xff7a1a;
          const discont = /inferida|cubierta|ciega/.test(f.tipo);
          const mat = new LineMaterial({ color, linewidth: 4.5, dashed: discont, dashSize: 220, gapSize: 140, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false });
          mat.resolution.set(innerWidth, innerHeight);
          const l = new Line2(geo, mat); if (discont) l.computeLineDistances();
          l.renderOrder = 3; grupoFallas.add(l);
          const halo = new LineMaterial({ color: 0x10141c, linewidth: 8, transparent: true, opacity: 0.4, depthTest: true, depthWrite: false });
          halo.resolution.set(innerWidth, innerHeight);
          const lh = new Line2(geo, halo); lh.renderOrder = 2; grupoFallas.add(lh);
          ESC.fallas.push({ fi, pts: tramo.slice() });
          for (let k = 0; k < tramo.length; k += 8) {
            const [e, n] = tramo[k];
            ESC.candF.push({ fi, pos: new THREE.Vector3(e, hLocal(e, n) + 12, -n) });
          }
        }
        tramo = [];
      };
      for (const p of pts) { if (Math.abs(p[0]) < lim && Math.abs(p[1]) < lim) tramo.push(p); else cerrar(); }
      cerrar();
    }
  });
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
  for (const p of ESC.polys) {
    const [e, n] = aEN(p.lab[0], p.lab[1]);
    if (Math.abs(e) > A * 0.95 || Math.abs(n) > A * 0.95 || Math.hypot(e, n) < 450) continue;
    ESC.cand.push({ cod: p.cod, pos: new THREE.Vector3(e, hLocal(e, n) + 18, -n), peso: 2 });
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
      mat.resolution.set(innerWidth, innerHeight);
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
  out.x = (_v.x + 1) / 2 * innerWidth; out.y = (1 - _v.y) / 2 * innerHeight; return true;
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
  return `<div class="etq-caja"><span class="etq-ico">${c.ico}</span><span class="etq-txt"><b>${esc(c.nombre)}</b>
    <small>${u.ma ? esc(fmtRango(u, true)) + (u.edad ? ' · ' + esc(edadCorta(u.edad)) : '') : esc(c.lema)}</small></span>${nuevo ? '<i class="etq-nuevo">¡nuevo!</i>' : ''}</div>
    <div class="etq-palo"></div><div class="etq-punto"></div>`;
}
function htmlEtiquetaFalla(fi) {
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
  el.className = 'etq' + (clave.startsWith('§') ? ' etq-falla' : clave.startsWith('▲') ? ' cum' : '');
  el.style.setProperty('--c', color);
  el.innerHTML = html;
  el.addEventListener('click', ev => { ev.stopPropagation(); alTocar(); });
  $('#etiquetas').appendChild(el);
  requestAnimationFrame(() => el.classList.add('ver'));
  return { el, w: 0, h: 0, alto: 0 };
}

let ultimaSeleccion = 0;
function seleccionarEtiquetas(t) {
  if (t - ultimaSeleccion < 280) return false; ultimaSeleccion = t;
  const quiero = new Map();
  if (CFG.etiquetas && ESC.listo) {
    const grupos = new Map(), sp = { x: 0, y: 0 };
    for (const c of ESC.cand) {
      if (!enPantalla(c.pos, sp)) continue;
      if (sp.y < 70 || sp.y > innerHeight - 150) continue;
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
        if (!enPantalla(k.pos, sp4) || sp4.y < 90 || sp4.y > innerHeight - 160) return;
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
        if (!enPantalla(c.pos, sp2) || sp2.y < 70 || sp2.y > innerHeight - 150) continue;
        const clave = '§' + (FALLAS.f[c.fi].n || '#' + c.fi);
        const dc = Math.hypot(sp2.x - innerWidth / 2, sp2.y - innerHeight / 2);
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
  }
  for (const [k, e] of ETQ) if (!quiero.has(k)) { e.el.classList.remove('ver'); setTimeout(() => e.el.remove(), 300); ETQ.delete(k); }
  for (const [k, pos] of quiero) {
    let e = ETQ.get(k);
    if (!e) {
      if (k.startsWith('§')) { const fi = FI_DE.get(k); e = crearEtiqueta(k, htmlEtiquetaFalla(fi), '#ff5a36', () => abrirFichaFalla(fi)); }
      else if (k.startsWith('▲')) { const i = +k.slice(1); e = crearEtiqueta(k, htmlCumbre(ESC.cumbres[i]), '#fff', () => abrirFichaCumbre(i)); }
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
  const prio = k => k.startsWith('▲') ? 2 : k.startsWith('§') ? 1 : 0;
  const lista = [...ETQ.entries()].sort((a, b) => prio(b[0]) - prio(a[0]));
  for (const [k, e] of lista) {
    if (!e.pos || !enPantalla(e.pos, sp)) { e.el.style.opacity = 0; continue; }
    if (!e.w || medir) { const c = e.el.querySelector('.etq-caja'); e.w = c.offsetWidth; e.h = c.offsetHeight; }
    const esCumbre = k.startsWith('▲');
    let alto = esCumbre ? 16 : 46, ok = false;
    // desplazamiento horizontal para que la caja no se salga de la pantalla (el palito sigue en el punto)
    const dx = sp.x - e.w / 2 < 8 ? 8 + e.w / 2 - sp.x : sp.x + e.w / 2 > innerWidth - 8 ? innerWidth - 8 - e.w / 2 - sp.x : 0;
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
  if (!hit || (ESC.modo === 'ar' && hit.distanceTo(c) < CFG.fadeCerca)) {
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
  el.innerHTML = (u ? `<span class="mir-ico">${cat.ico}</span><span class="mir-txt"><small>Estás mirando · a ${fmtDist(dist)}</small>
      <b>${esc(cat.nombre)}</b><em>${esc(u.ma ? fmtRango(u, true) : cat.lema)}</em></span>` : `<span class="mir-ico">⚡</span><span class="mir-txt"><small>Estás mirando · a ${fmtDist(dist)}</small><b>Una falla</b></span>`)
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
  const dato = u.cat === 'marina' ? datoMarino(u) : c.dato;
  const joven = (u.cat === 'volcanica' && u.ma && u.ma[0] <= 2.6) ? '<p class="nota">Es volcanismo joven: algunos de estos volcanes pueden volver a entrar en erupción.</p>' : '';
  $('#ficha-cuerpo').innerHTML = `
    <header class="fi-cab" style="--c:${u.color}"><span class="fi-ico">${c.ico}</span><div><small>${esc(c.nombre)} · ${esc(c.lema)}</small><h2>${esc(u.titulo)}</h2></div></header>
    ${u.ma ? `<section><h3>⏳ ¿Qué edad tiene?</h3><p class="grande">${esc(fmtRango(u))}</p>
      <p>${esc(u.edad)} · era ${esc(era(media))}</p>
      <p>Si toda la historia de la Tierra (4.567 millones de años) fuera <b>un solo año</b>, esta roca se habría formado <b>${calendario(media)}</b>.</p>${barraAnio(media)}
      <p class="contexto">🌍 ${esc(contextoEdad(media))}</p></section>` : ''}
    <section><h3>🔎 ¿Qué es?</h3><p>${esc(c.que)}</p>${joven}</section>
    <section><h3>👀 ¿Cómo reconocerla?</h3><p>${esc(c.ver)}</p></section>
    ${dato ? `<section class="dato"><h3>💡 ¿Sabías que…?</h3><p>${esc(dato)}</p></section>` : ''}
    <section class="oficial"><h3>📖 Descripción del mapa oficial</h3><p>${esc(u.desc)}</p>
      <p class="cod">${u.cod.startsWith('S I') ? 'Lago o glaciar según el relieve' : `Unidad <b>${esc(u.cod)}</b>`} · Mapa Geológico de Chile 1:1.000.000, SERNAGEOMIN</p></section>
    <p class="aviso">A esta escala, los límites entre unidades pueden estar corridos varios cientos de metros respecto del terreno.</p>`;
  mostrarFicha();
  marcarVisto('u', cod);
  const e = ETQ.get(cod); if (e) e.el.querySelector('.etq-nuevo')?.remove();
}
function abrirFichaFalla(fi) {
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
function onOrientacion(ev, absoluto) {
  if (ev.alpha == null) return;
  if (!absoluto && S.absoluto && ev.webkitCompassHeading == null) return; // ya tenemos la absoluta
  const D = Math.PI / 180, orient = (screen.orientation?.angle ?? window.orientation ?? 0) * D;
  quatDispositivo(ev.alpha * D, ev.beta * D, ev.gamma * D, orient, _qa);
  let extra = 0;
  if (ev.webkitCompassHeading != null) { // iOS: alpha es relativo; se corrige con la brújula (solo con el teléfono vertical)
    if (ev.beta > 40 && ev.beta < 140) {
      const off = envolver(ev.webkitCompassHeading - rumboDe(_qa));
      S.iosOff = S.iosOff == null ? off : S.iosOff + envolver(off - S.iosOff) * 0.05;
    }
    extra = S.iosOff ?? 0; S.precision = ev.webkitCompassAccuracy; S.absoluto = true;
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
  const v = $('#cam'); v.srcObject = st; await v.play();
  v.addEventListener('loadedmetadata', ajustarTamano); ajustarTamano();
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
async function abrirEn(lat, lon, modo, rumbo = 0) {
  const gen = ++generacion;
  ESC.listo = false; ESC.modo = modo;
  document.body.dataset.modo = modo;
  $('#inicio').hidden = true; $('#escena').hidden = false;
  if (!renderer) iniciarThree();
  for (const o of [terrenoColor, terrenoProf, grupoFallas, grupoPerfil, terrenoLejos]) if (o) { scene.remove(o); o.traverse?.(x => { x.geometry?.dispose(); x.material?.dispose(); }); }
  texMapa?.dispose();
  for (const [, e] of ETQ) e.el.remove(); ETQ.clear();
  try {
    cargando('Cargando el mapa geológico…');
    if (!UNI) await cargarBase();
    setOrigen(lat, lon);
    S.decl = declinacion(lat, lon);
    const A = CFG.alcance;
    ESC.polys = await cargarGeologia(A);
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
    construirTerreno(A);
    construirTerrenoLejano();
    construirFallas(A);
    construirCandidatos(A);
    prepararCumbres(A);
    camera.position.set(0, hLocal(0, 0) + (modo === 'ar' ? CFG.ojo : 25), 0); // explorar: vista de dron bajo, evita que el plano cercano corte el suelo
    if (modo !== 'ar') { VISTA.yaw = rumbo; VISTA.pitch = -2; }
    actualizarModoShader(); ajustarTamano();
    ESC.listo = true; cargando();
    calcularPerfil(gen);
    actualizarPisando();
    $('#lugar').textContent = modo === 'ar' ? 'Tu ubicación' : (LUGARES.find(l => Math.abs(l.lat - lat) < 1e-3 && Math.abs(l.lon - lon) < 1e-3)?.n || `${nf1.format(lat)}°, ${nf1.format(lon)}°`);
    if (!leer('visto-ayuda')) { mostrarAyuda(); guardar('visto-ayuda', '1'); }
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
    $('#brujula').textContent = `${['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(rumbo / 45) % 8]} ${nf0.format(rumbo)}°`;
  }
}

let calibrando = false;
function instalarGestos() {
  const el = $('#escena'); let arr = null, pinza = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.etq, button, #ficha, .panel, #mirando, #pisando')) return;
    const conSensores = ESC.modo === 'ar' && S.tiene;
    arr = { x: e.clientX, y: e.clientY, yaw: conSensores ? S.yawUsuario : VISTA.yaw, pitch: conSensores ? S.pitchUsuario : VISTA.pitch };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!arr) return;
    if (!innerHeight) return;
    const gpp = camera.fov / innerHeight; // grados por píxel
    const dx = (e.clientX - arr.x) * gpp, dy = (e.clientY - arr.y) * gpp;
    if (ESC.modo === 'ar' && S.tiene) {
      if (!calibrando) return;
      S.yawUsuario = arr.yaw - dx; S.pitchUsuario = arr.pitch - dy;
    } else {
      VISTA.yaw = (arr.yaw - dx + 360) % 360; VISTA.pitch = Math.max(-45, Math.min(45, arr.pitch + dy));
    }
  });
  const fin = () => { if (arr && ESC.modo === 'ar' && S.tiene && calibrando) { guardar('yaw', S.yawUsuario.toFixed(2)); guardar('pitch', S.pitchUsuario.toFixed(2)); } arr = null; };
  el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
  el.addEventListener('wheel', e => {
    if (ESC.modo === 'ar') return;
    CFG.fovExplorar = Math.max(15, Math.min(80, (CFG.fovExplorar || 60) * (e.deltaY > 0 ? 1.08 : 0.92))); ajustarTamano();
  }, { passive: true });
  el.addEventListener('touchstart', e => { if (e.touches.length === 2) pinza = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), f: CFG.fovExplorar || 60, fl: CFG.fovLargo }; }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!pinza || e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), r = pinza.d / d;
    if (ESC.modo === 'ar') { if (calibrando || !S.tiene) { CFG.fovLargo = Math.max(40, Math.min(90, pinza.fl * r)); $('#r-fov').value = CFG.fovLargo; ajustarTamano(); } }
    else { CFG.fovExplorar = Math.max(15, Math.min(80, pinza.f * r)); ajustarTamano(); }
  }, { passive: true });
  el.addEventListener('touchend', () => { pinza = null; guardar('fov', CFG.fovLargo); });
}
function alternarCalibrar(on = !calibrando) {
  calibrando = on; document.body.classList.toggle('calibrando', on);
  if (grupoPerfil) grupoPerfil.visible = CFG.perfil || on;
  if (terrenoColor) terrenoColor.material.uniforms.opacidad.value = on ? Math.min(0.2, CFG.opacidad) : CFG.opacidad;
  $('#btn-calibrar').classList.toggle('activo', on);
  if (on) toast('Arrastra hasta que las líneas blancas calcen con el perfil de los cerros. Pellizca para ajustar el tamaño.', 5500);
}
function mostrarAyuda() {
  $('#ficha-cuerpo').innerHTML = `<header class="fi-cab" style="--c:#7cc4ff"><span class="fi-ico">🧭</span><div><small>Cómo usar GeoLente</small><h2>Lee los cerros como un geólogo</h2></div></header>
    <section><ol class="pasos">
      <li><b>Apunta a los cerros.</b> Los colores muestran de qué roca está hecho cada cerro, según el mapa geológico oficial.</li>
      <li><b>Toca una etiqueta</b> para saber qué es, cuántos millones de años tiene y cómo reconocerla.</li>
      <li><b>Usa la mira ⊕</b> del centro: te dice qué estás mirando y a qué distancia.</li>
      <li><b>Las líneas blancas dibujan el perfil de los cerros</b> (el horizonte y las crestas). Si no calzan con lo que ves, toca <b>🎯 Ajustar</b> y arrástralas hasta que coincidan: así sabrás exactamente qué cerro estás mirando.</li>
      <li><b>Las líneas rojas, naranjas y amarillas son fallas activas.</b> Las punteadas están inferidas o cubiertas.</li>
      <li>La brújula del teléfono puede fallar cerca de autos, rejas o edificios: por eso existe el ajuste.</li>
    </ol></section>
    <section class="leyenda-edades"><h3>Colores por edad</h3>
      <div class="ley"><i style="background:#FFF2AE"></i>Cuaternario (0–2,6 Ma)</div><div class="ley"><i style="background:#FFFF00"></i>Neógeno (2,6–23 Ma)</div>
      <div class="ley"><i style="background:#FDB46C"></i>Paleógeno (23–66 Ma)</div><div class="ley"><i style="background:#8CCD57"></i>Cretácico (66–145 Ma)</div>
      <div class="ley"><i style="background:#42AED0"></i>Jurásico (145–201 Ma)</div><div class="ley"><i style="background:#983999"></i>Triásico (201–252 Ma)</div>
      <div class="ley"><i style="background:#67A599"></i>Paleozoico (252–539 Ma)</div><div class="ley"><i style="background:#E8485A"></i>Rocas intrusivas (rojos: más oscuro, más antiguo)</div>
      <p class="aviso">Ma = millones de años. Los colores siguen la carta cronoestratigráfica internacional.</p></section>
    <section class="oficial"><h3>Fuentes</h3><p>Mapa Geológico de Chile 1:1.000.000 (SERNAGEOMIN, 2003) · Catálogo de Fallas Activas de Chile CHAF v1 (Melnick, Maldonado y Contreras, 2020; CC BY 4.0) · Nombres de cumbres: © colaboradores de OpenStreetMap (ODbL) y GeoNames (CC BY 4.0) · Relieve: teselas Terrarium (AWS Open Data, SRTM y otros) · Declinación magnética: WMM2025 (NOAA/BGS).</p>
    <p class="aviso">Herramienta de divulgación. Escala regional: no reemplaza cartas geológicas de detalle ni estudios de peligros geológicos.</p></section>`;
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
  if (fatal) $('#diag-explorar').onclick = () => { cerrarFicha(); const l = LUGARES[0]; abrirEn(l.lat, l.lon, 'explorar', l.rumbo); };
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

// ------------------------------------------------------------------ interfaz
function iniciarUI() {
  $('#lugares').innerHTML = LUGARES.map((l, i) => `<button class="chip" data-i="${i}">${esc(l.n)}</button>`).join('');
  $('#lugares').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { const l = LUGARES[+b.dataset.i]; abrirEn(l.lat, l.lon, 'explorar', l.rumbo); } };
  $('#btn-ar').onclick = empezarAR;
  $('#btn-explorar-aqui').onclick = async () => {
    try { cargando('Buscando tu ubicación…'); const c = await obtenerPosicion(); abrirEn(c.latitude, c.longitude, 'explorar', 0); }
    catch { cargando(); toast('No se pudo obtener tu ubicación. Elige un lugar de ejemplo.'); }
  };
  $('#btn-volver').onclick = volverInicio;
  $('#btn-ayuda').onclick = mostrarAyuda;
  $('#btn-coleccion').onclick = abrirColeccion;
  $('#btn-calibrar').onclick = () => alternarCalibrar();
  $('#btn-ajustes').onclick = () => $('#ajustes').classList.toggle('abierto');
  $('#ficha-cerrar').onclick = cerrarFicha;
  $('#ficha').addEventListener('click', e => { if (e.target.id === 'ficha') cerrarFicha(); });
  $('#mirando').onclick = () => { if (!miraActual) return; if (miraActual.cod) abrirFicha(miraActual.cod); else if (miraActual.falla != null) abrirFichaFalla(miraActual.falla); };
  const rOp = $('#r-opacidad'); rOp.value = CFG.opacidad;
  rOp.oninput = () => { CFG.opacidad = +rOp.value; guardar('opacidad', rOp.value); if (terrenoColor) terrenoColor.material.uniforms.opacidad.value = CFG.opacidad; };
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
  const sA = $('#s-alcance'); sA.value = CFG.alcance;
  sA.onchange = () => { CFG.alcance = +sA.value; guardar('alcance', sA.value); if (O) abrirEn(O.lat, O.lon, ESC.modo, VISTA.yaw); };
  $('#btn-reset').onclick = () => { S.yawUsuario = 0; S.pitchUsuario = 0; CFG.fovLargo = 68; rFov.value = 68; guardar('yaw', 0); guardar('pitch', 0); guardar('fov', 68); ajustarTamano(); toast('Ajuste restablecido.'); };
  actualizarContador();
  instalarGestos();
  requestAnimationFrame(bucle);

  const sim = params.get('sim');
  if (sim) { const [la, lo, ru] = sim.split(',').map(Number); abrirEn(la, lo, 'explorar', ru || 0); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
}
iniciarUI();

// para pruebas desde la consola
window.GeoLente = { get DEM2() { return DEM2; }, get DEM() { return DEM; }, calcularPerfil: () => calcularPerfil(generacion), get grupoPerfil() { return grupoPerfil; }, _orient: (a, b, g, abs = true, extra = {}) => onOrientacion({ alpha: a, beta: b, gamma: g, ...extra }, abs), rumboDe, ESC, CFG, VISTA, S, abrirEn, abrirFicha, abrirFichaFalla, abrirColeccion, get FALLAS() { return FALLAS; }, unidadEn: (lat, lon) => unidadEn(lon, lat), hLocal, get camera() { return camera; } };
