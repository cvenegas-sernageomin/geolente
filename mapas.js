// GeoLente — mapas geológicos detallados (1:50.000) dibujados con su simbología original.
// Los datos salen de la gdb del mapa (tools/mapas/preparar_mapas.py): polígonos con el relleno del .lyr
// (colores y tramas), contactos, fallas, pliegues, diques, manteos, dataciones y las anotaciones del mapa.
// Todo se dibuja en un canvas propio de cada mapa, que el shader del terreno pone encima del mapa 1:1M.

export const PT = 0.0254 / 72 * 50000; // un punto tipográfico a escala 1:50.000, en metros (≈ 17,6 m)

function decodificar(arr, q) {
  const out = new Float64Array(arr.length); let x = 0, y = 0;
  for (let k = 0; k < arr.length; k += 2) { x += arr[k]; y += arr[k + 1]; out[k] = x / q; out[k + 1] = y / q; }
  return out;
}

// Carga los mapas del índice que tocan el rectángulo [oeste, sur, este, norte]
export async function cargarMapas(indice, [w, s, e, n]) {
  const ids = indice.mapas.filter(m => m.bbox[2] > w && m.bbox[0] < e && m.bbox[3] > s && m.bbox[1] < n).map(m => m.id);
  return Promise.all(ids.map(async id => {
    const M = await (await fetch(`data/mapas/${id}.json`)).json();
    const q = M.q, dec = a => decodificar(a, q);
    M.bordeLL = dec(M.borde[0]);
    M.polys = M.p.map(p => {
      const anillos = p.r.map(dec), ex = anillos[0];
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let k = 0; k < ex.length; k += 2) { x0 = Math.min(x0, ex[k]); x1 = Math.max(x1, ex[k]); y0 = Math.min(y0, ex[k + 1]); y1 = Math.max(y1, ex[k + 1]); }
      return { cod: p.u, anillos, bb: [x0, y0, x1, y1], lab: p.l };
    });
    for (const k of ['lc', 'lf', 'lp', 'ld']) for (const l of M[k]) l.ll = dec(l.g);
    delete M.p;
    return M;
  }));
}

// color base de una unidad (primer relleno sólido del símbolo)
export const colorUnidad = u => (u.s.find(c => c.k === 'f') || {}).c || '#cccccc';

// ------------------------------------------------------------------ dibujo
const FUENTES_WEB = new Set(['Arial', 'geologia']); // "geologia" (fuente interna) usa los mismos códigos que Arial en estas tramas

function dibujarMarcador(ctx, mk, k) {
  ctx.save();
  ctx.translate((mk.dx || 0) * k, -(mk.dy || 0) * k);
  ctx.fillStyle = ctx.strokeStyle = mk.c || '#000';
  if (mk.k === 'pto') {
    const r = Math.max(0.6, mk.s * k / 2);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 2 * Math.PI);
    if (mk.t === 'square') { ctx.beginPath(); ctx.rect(-r, -r, 2 * r, 2 * r); }
    ctx.fill();
  } else if (mk.k === 'car') {
    const px = mk.s * k;
    ctx.rotate(-(mk.a || 0) * Math.PI / 180);
    if (FUENTES_WEB.has(mk.f)) {
      ctx.font = `${px}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String.fromCharCode(mk.u), 0, 0);
    } else {
      // fuentes ESRI y otras que el navegador no tiene: un signo sencillo del mismo tamaño
      ctx.lineWidth = Math.max(0.8, px * 0.06); const r = px * 0.22;
      ctx.beginPath();
      if (/Geology/.test(mk.f)) { ctx.arc(0, r * 0.4, r, Math.PI, 2 * Math.PI); ctx.moveTo(-r, r * 0.4); ctx.lineTo(-r, r * 1.2); ctx.moveTo(r, r * 0.4); ctx.lineTo(r, r * 1.2); }
      else if (/Caves/.test(mk.f)) { ctx.arc(0, 0, r * 0.5, 0, 2 * Math.PI); }
      else { ctx.ellipse(0, 0, r, r * 0.6, 0, 0, 2 * Math.PI); }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Trama de un MarkerFillSymbol como CanvasPattern (separación y desplazamientos en puntos)
function trama(ctx, capa, k) {
  const tw = Math.max(2, Math.round(capa.sx * k)), th = Math.max(2, Math.round(capa.sy * k));
  if (Math.min(tw, th) < 3) return null; // a esta resolución la trama sería ruido
  const n = capa.r ? 3 : 1; // trama al azar: tesela más grande con posiciones pseudoaleatorias
  const cv = document.createElement('canvas'); cv.width = tw * n; cv.height = th * n;
  const c = cv.getContext('2d');
  let semilla = 7;
  const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = capa.r ? (i + azar()) * tw : capa.ox * k, y = capa.r ? (j + azar()) * th : -capa.oy * k;
    for (const dx of [-tw * n, 0, tw * n]) for (const dy of [-th * n, 0, th * n]) {
      c.save(); c.translate(((x % (tw * n)) + tw * n) % (tw * n) + dx, ((y % (th * n)) + th * n) % (th * n) + dy);
      for (const mk of capa.mk) dibujarMarcador(c, mk, k);
      c.restore();
    }
  }
  return ctx.createPattern(cv, 'repeat');
}

// recorre una polilínea (en píxeles) y llama f(x, y, ángulo) cada "paso" píxeles, empezando en "desde"
function aLoLargo(pts, paso, desde, f) {
  let resto = desde;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3], d = Math.hypot(x1 - x0, y1 - y0);
    if (!d) continue;
    const a = Math.atan2(y1 - y0, x1 - x0);
    let t = resto;
    while (t <= d) { f(x0 + (x1 - x0) * t / d, y0 + (y1 - y0) * t / d, a); t += paso; }
    resto = t - d;
  }
}
function largo(pts) { let L = 0; for (let i = 0; i + 3 < pts.length; i += 2) L += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]); return L; }
function puntoMedio(pts) {
  const L = largo(pts) / 2; let r = null;
  aLoLargo(pts, 1e12, L, (x, y, a) => { r ??= [x, y, a]; });
  return r;
}

// Dibuja el mapa M en un canvas que cubre su parte dentro del cuadrado ±A (metros) alrededor del origen.
// Devuelve { canvas, uv: [u0, v0, u1, v1] } en coordenadas de textura del terreno, o null si no se ve.
export function pintarMapa(M, A, aEN, maxPx) {
  let e0 = 1e9, e1 = -1e9, n0 = 1e9, n1 = -1e9;
  const b = M.bordeLL;
  for (let i = 0; i < b.length; i += 2) { const [e, n] = aEN(b[i], b[i + 1]); e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
  e0 = Math.max(e0, -A); e1 = Math.min(e1, A); n0 = Math.max(n0, -A); n1 = Math.min(n1, A);
  if (e1 - e0 < 50 || n1 - n0 < 50) return null;
  const mpp = Math.max(e1 - e0, n1 - n0) / maxPx;
  const W = Math.ceil((e1 - e0) / mpp), H = Math.ceil((n1 - n0) / mpp);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const k = PT / mpp; // píxeles por punto tipográfico
  const px = (lon, lat) => { const [e, n] = aEN(lon, lat); return [(e - e0) / mpp, (n1 - n) / mpp]; };
  const aPx = ll => { const o = new Float64Array(ll.length); for (let i = 0; i < ll.length; i += 2) { const [x, y] = px(ll[i], ll[i + 1]); o[i] = x; o[i + 1] = y; } return o; };
  const trazo = (pts, cerrar) => { for (let i = 0; i < pts.length; i += 2) i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1]); if (cerrar) ctx.closePath(); };
  const linea = (pts, w, color, dash) => { ctx.beginPath(); trazo(pts); ctx.lineWidth = Math.max(0.7, w * k); ctx.strokeStyle = color; ctx.setLineDash(dash ? dash.map(d => d * k) : []); ctx.stroke(); };
  const DASH = [null, [5, 2.5], [1, 2]]; // observada, inferida, cubierta
  ctx.lineJoin = ctx.lineCap = 'round';

  // todo queda dentro del borde del mapa
  const borde = aPx(b);
  ctx.save(); ctx.beginPath(); trazo(borde, true); ctx.clip();
  ctx.fillStyle = '#f4f6f4'; ctx.fillRect(0, 0, W, H); // "papel": huecos sin unidad (lagunas, nieve) quedan claros como en la carta

  // unidades: relleno sólido + tramas del .lyr, en el orden de sus capas
  const tramas = new Map();
  for (const p of M.polys) {
    const u = M.u[p.cod]; if (!u) continue;
    ctx.beginPath(); for (const r of p.anillos) trazo(aPx(r), true);
    for (const capa of u.s) {
      if (capa.k === 'f') { ctx.fillStyle = capa.c; ctx.fill('evenodd'); }
      else if (capa.k === 'm') {
        const clave = p.cod + JSON.stringify(capa);
        if (!tramas.has(clave)) tramas.set(clave, trama(ctx, capa, k));
        const pat = tramas.get(clave); if (pat) { ctx.fillStyle = pat; ctx.fill('evenodd'); }
      } else if (capa.k === 'l') {
        ctx.save(); ctx.clip('evenodd');
        const sep = Math.max(3, capa.sep * k), a = -capa.a * Math.PI / 180, R = Math.hypot(W, H);
        ctx.translate(W / 2, H / 2); ctx.rotate(a); ctx.beginPath();
        for (let y = -R; y < R; y += sep) { ctx.moveTo(-R, y); ctx.lineTo(R, y); }
        ctx.lineWidth = Math.max(0.6, capa.w * k); ctx.strokeStyle = capa.c; ctx.setLineDash([]); ctx.stroke(); ctx.restore();
      }
    }
  }

  // contactos
  for (const l of M.lc) linea(aPx(l.ll), 0.45, '#111', DASH[l.t]);
  // diques
  for (const l of M.ld) linea(aPx(l.ll), 0.8, '#b0102a', null);

  // pliegues: traza axial + flechas en el centro (anticlinal hacia afuera, sinclinal hacia adentro)
  for (const l of M.lp) {
    const pts = aPx(l.ll); linea(pts, 1, '#111', DASH[l.i]);
    const m = puntoMedio(pts); if (!m) continue;
    const [x, y, a] = m, L = 6 * k, h = 1.6 * k, sale = l.t === 'anticlinal';
    ctx.setLineDash([]); ctx.lineWidth = Math.max(0.7, 0.9 * k);
    for (const s of [1, -1]) {
      const nx = Math.sin(a) * s, ny = -Math.cos(a) * s; // normal a cada lado
      const [ax, ay, bx, by] = sale ? [x, y, x + nx * L, y + ny * L] : [x + nx * L, y + ny * L, x, y];
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const ang = Math.atan2(by - ay, bx - ax);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang - 0.45) * h * 1.8, by - Math.sin(ang - 0.45) * h * 1.8);
      ctx.lineTo(bx - Math.cos(ang + 0.45) * h * 1.8, by - Math.sin(ang + 0.45) * h * 1.8); ctx.closePath(); ctx.fillStyle = '#111'; ctx.fill();
    }
  }

  // fallas: inversa con dientes, normal con bolita, de rumbo con flechas; inferida segmentada, cubierta punteada
  for (const l of M.lf) {
    const pts = aPx(l.ll);
    linea(pts, 1.3, '#000', DASH[l.i]);
    ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle = '#000';
    if (l.t === 'inversa') {
      const base = 3.2 * k, alto = 2.6 * k;
      aLoLargo(pts, 22 * k, 11 * k, (x, y, a) => {
        const ux = Math.cos(a), uy = Math.sin(a), nx = uy, ny = -ux; // izquierda del sentido de digitalización
        ctx.beginPath(); ctx.moveTo(x - ux * base / 2, y - uy * base / 2); ctx.lineTo(x + ux * base / 2, y + uy * base / 2);
        ctx.lineTo(x + nx * alto, y + ny * alto); ctx.closePath(); ctx.fill();
      });
    } else if (l.t === 'normal') {
      aLoLargo(pts, 28 * k, 14 * k, (x, y, a) => {
        const nx = Math.sin(a), ny = -Math.cos(a), L = 3 * k;
        ctx.lineWidth = Math.max(0.7, 0.8 * k);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + nx * L, y + ny * L); ctx.stroke();
        ctx.beginPath(); ctx.arc(x + nx * L, y + ny * L, Math.max(1, 1.1 * k), 0, 2 * Math.PI); ctx.fill();
      });
    } else if (l.t === 'sinistral' || l.t === 'dextral') {
      const m = puntoMedio(pts); if (m) {
        const [x, y, a] = m, ux = Math.cos(a), uy = Math.sin(a), nx = uy, ny = -ux, L = 7 * k, d = 2 * k;
        for (const lado of [1, -1]) {
          // sinistral: el bloque de la izquierda se mueve hacia atrás y el de la derecha hacia adelante
          const dir = (l.t === 'sinistral' ? -1 : 1) * lado;
          const cx = x + nx * d * lado, cy = y + ny * d * lado;
          const sx = cx - ux * L / 2 * dir, sy = cy - uy * L / 2 * dir, ex = cx + ux * L / 2 * dir, ey = cy + uy * L / 2 * dir;
          ctx.lineWidth = Math.max(0.7, 0.8 * k);
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
          ctx.lineTo(ex - ux * 2 * k * dir + nx * 1.4 * k * lado, ey - uy * 2 * k * dir + ny * 1.4 * k * lado); ctx.stroke();
        }
      }
    }
  }

  // símbolos de pliegue (flecha según el azimut)
  for (const [lon, lat, az] of M.sm) {
    const [x, y] = px(lon, lat), L = 6 * k;
    ctx.save(); ctx.translate(x, y); ctx.rotate(az * Math.PI / 180);
    ctx.strokeStyle = ctx.fillStyle = '#111'; ctx.lineWidth = Math.max(0.7, 0.9 * k);
    ctx.beginPath(); ctx.moveTo(0, L / 2); ctx.lineTo(0, -L / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -L / 2 - 1.5 * k); ctx.lineTo(-1.3 * k, -L / 2 + 0.8 * k); ctx.lineTo(1.3 * k, -L / 2 + 0.8 * k); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // manteos: rumbo (AZIMUT, regla de la mano derecha) + palito hacia el manteo
  for (const [lon, lat, az, , t, foto] of M.pm) {
    const [x, y] = px(lon, lat);
    ctx.save(); ctx.translate(x, y); ctx.rotate(az * Math.PI / 180);
    ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(0.7, 0.7 * k); ctx.setLineDash(foto ? [1.5 * k, 1 * k] : []);
    const L = 4 * k, tic = 2 * k;
    if (t === 'h') {
      ctx.beginPath(); ctx.arc(0, 0, 2 * k, 0, 2 * Math.PI); ctx.moveTo(-3 * k, 0); ctx.lineTo(3 * k, 0); ctx.moveTo(0, -3 * k); ctx.lineTo(0, 3 * k); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(0, L); ctx.moveTo(0, 0); ctx.lineTo(tic, 0);
      if (t === 'v') { ctx.moveTo(0, 0); ctx.lineTo(-tic, 0); }
      ctx.stroke();
    }
    ctx.restore();
  }

  // dataciones (cuadrito negro, como en la carta; la caja con la edad la pone la app) y fósiles (espiral)
  for (const [lon, lat] of M.pg) {
    const [x, y] = px(lon, lat), R = 1.3 * k;
    ctx.fillStyle = '#fff'; ctx.fillRect(x - R - 0.6, y - R - 0.6, 2 * R + 1.2, 2 * R + 1.2);
    ctx.fillStyle = '#000'; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
  }
  for (const [lon, lat] of M.pf) {
    const [x, y] = px(lon, lat);
    ctx.beginPath(); for (let t = 0; t < 4 * Math.PI; t += 0.2) { const r = 0.25 * k * t; ctx.lineTo(x + r * Math.cos(t), y + r * Math.sin(t)); }
    ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(0.7, 0.5 * k); ctx.setLineDash([]); ctx.stroke();
  }

  // textos del mapa: códigos de unidad, manteos y nombres de fallas (ángulo ESRI: antihorario desde el este)
  const textos = (lista, peso) => {
    for (const [lon, lat, txt, ang, hm] of lista) {
      const f = hm / mpp; if (f < 5) continue;
      const [x, y] = px(lon, lat);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-ang * Math.PI / 180);
      ctx.font = `${peso} ${f}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(1.5, f * 0.16); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.fillStyle = '#000';
      const lineas = String(txt).split('\n');
      lineas.forEach((t, i) => { const yy = (i - (lineas.length - 1) / 2) * f * 1.05; ctx.strokeText(t, 0, yy); ctx.fillText(t, 0, yy); });
      ctx.restore();
    }
  };
  ctx.setLineDash([]);
  textos(M.tu, '600'); textos(M.tm, '400'); textos(M.tf, 'bold');
  ctx.restore(); // fin del recorte

  // borde del mapa
  ctx.beginPath(); trazo(borde, true); ctx.lineWidth = Math.max(1, 1.2 * k); ctx.strokeStyle = '#000'; ctx.setLineDash([]); ctx.stroke();

  return { canvas: cv, uv: [(e0 + A) / (2 * A), (n0 + A) / (2 * A), (e1 + A) / (2 * A), (n1 + A) / (2 * A)], mpp };
}

// ¿el punto (lon, lat) cae dentro del borde del mapa?
export function dentroBorde(M, lon, lat) {
  const r = M.bordeLL; let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
