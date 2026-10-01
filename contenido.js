// Textos divulgativos de GeoLente. Todo lo que se muestra al público y no viene de la leyenda oficial vive aquí.

export const CATEGORIAS = {
  intrusiva: {
    ico: '🔥', nombre: 'Roca intrusiva', lema: 'magma que se enfrió bajo tierra',
    que: 'Se formó cuando magma (roca fundida) se enfrió lentamente a varios kilómetros de profundidad, sin llegar a la superficie. Como se enfrió despacio, sus cristales crecieron lo bastante para verse a simple vista. Hoy la vemos porque la erosión desgastó las rocas que la cubrían.',
    ver: 'Roca maciza, sin capas, de grano grueso y aspecto moteado (cristales claros y oscuros). Suele formar cerros redondeados y grandes bloques.',
    dato: 'Muchos granitos de la Cordillera de la Costa son las raíces de antiguos arcos volcánicos: los volcanes desaparecieron por la erosión, pero quedaron las cámaras de magma que los alimentaban.'
  },
  volcanica: {
    ico: '🌋', nombre: 'Roca volcánica', lema: 'lavas y cenizas de antiguos volcanes',
    que: 'Se formó en erupciones volcánicas: coladas de lava que se enfriaron en la superficie y capas de ceniza y fragmentos lanzados por los volcanes.',
    ver: 'Capas apiladas o inclinadas de lavas oscuras o rojizas, a veces con pequeñas burbujas (vesículas), y tobas claras y livianas.',
    dato: 'Chile tiene más de 90 volcanes geológicamente activos. Forman parte del Cinturón de Fuego del Pacífico y SERNAGEOMIN los vigila con la Red Nacional de Vigilancia Volcánica.'
  },
  volcanosedimentaria: {
    ico: '🌋', nombre: 'Volcanes y sedimentos', lema: 'lavas y cenizas intercaladas con sedimentos',
    que: 'Es una mezcla de productos volcánicos y sedimentos: capas de lava y ceniza intercaladas con areniscas o conglomerados que dejaron ríos y lagos entre una erupción y otra (en algunas épocas y lugares, también el mar).',
    ver: 'Alternancia de capas de distinto color: lavas oscuras, tobas claras y capas de arenisca o conglomerado.',
    dato: 'Estas secuencias registran paisajes donde convivían volcanes activos con ríos y lagos, como ocurre hoy en el sur de Chile.'
  },
  sedimentaria: {
    ico: '🪨', nombre: 'Roca sedimentaria', lema: 'capas de sedimentos compactados',
    que: 'Se formó por la acumulación de fragmentos (arena, grava, barro) o de minerales que precipitaron del agua. Con el tiempo esas capas se compactaron y cementaron hasta volverse roca.',
    ver: 'Estratos: capas paralelas de distinto color o grosor. A veces contienen fósiles.',
    dato: 'Los sedimentos se depositan en capas horizontales. Si hoy las ves inclinadas o plegadas, es porque las fuerzas tectónicas las deformaron después.'
  },
  marina: {
    ico: '🐚', nombre: 'Antiguo fondo marino', lema: 'sedimentos que se depositaron bajo el mar',
    que: 'Son sedimentos que se acumularon en el fondo del mar. Hoy están en tierra firme, y a veces en plena cordillera, porque la corteza se levantó a lo largo de millones de años.',
    ver: 'Capas de arenisca, limolita, caliza o coquina (roca formada por conchas).',
    dato: null // depende de la edad: ver datoMarino()
  },
  lacustre: {
    ico: '🏞️', nombre: 'Antiguo lago', lema: 'sedimentos del fondo de lagos',
    que: 'Son sedimentos finos (limos y arcillas, a veces con capas calcáreas o de ceniza) que se depositaron en el fondo de lagos que hoy ya no existen.',
    ver: 'Capas delgadas, finas y claras, muy regulares.',
    dato: 'Las capas finas de un lago pueden registrar año a año los cambios del clima del pasado.'
  },
  aluvial: {
    ico: '🏜️', nombre: 'Sedimentos recientes', lema: 'gravas y arenas de ríos y quebradas',
    que: 'Son gravas, arenas y limos sueltos que transportaron ríos, quebradas y aluviones. Son los materiales más jóvenes del paisaje y todavía se siguen formando.',
    ver: 'Planicies, conos de sedimentos al pie de los cerros (abanicos aluviales) y terrazas junto a los ríos.',
    dato: 'Muchas ciudades de Chile, como Santiago, están construidas sobre enormes abanicos aluviales formados por los ríos que bajan de la cordillera.'
  },
  glaciar: {
    ico: '🏔️', nombre: 'Huella de glaciares', lema: 'material arrastrado por el hielo',
    que: 'Es material que arrastraron y depositaron los glaciares: morrenas (lomas de bloques y barro que el hielo empujó) y los sedimentos que dejaron sus aguas de deshielo.',
    ver: 'Lomas alargadas o en forma de arco con bloques de todos los tamaños mezclados con barro.',
    dato: 'En la última glaciación, hace unos 20.000 años, los glaciares cubrían gran parte del sur de Chile y en muchos lugares llegaban hasta el mar.'
  },
  fluvial: {
    ico: '🌊', nombre: 'Depósitos de río', lema: 'gravas y arenas que mueve el río',
    que: 'Son gravas, arenas y limos que el río transporta hoy o transportó hace poco. Forman su lecho, sus terrazas y sus llanuras de inundación.',
    ver: 'Bolones redondeados, arenas y terrazas escalonadas a los lados del cauce.',
    dato: 'Los bolones son redondos porque chocaron y se desgastaron durante su viaje río abajo.'
  },
  playa: {
    ico: '🏖️', nombre: 'Playa', lema: 'arenas y gravas que acumula el oleaje',
    que: 'Son arenas y gravas que el oleaje acumula y redistribuye constantemente en la costa.',
    ver: 'La franja de arena o gravilla junto al mar.',
    dato: 'El color de la arena delata su origen: la arena oscura suele provenir de rocas volcánicas y la clara, de granitos o de conchas.'
  },
  duna: {
    ico: '🏜️', nombre: 'Dunas', lema: 'arena acumulada por el viento',
    que: 'Son arenas finas que el viento transporta y acumula. Algunas dunas están activas y se mueven; otras ya están fijadas por la vegetación.',
    ver: 'Montículos de arena fina con formas suaves y ondulitas en la superficie.',
    dato: 'Una duna avanza porque el viento sube la arena por su cara suave y la deja caer por la cara empinada.'
  },
  salar: {
    ico: '🧂', nombre: 'Salar', lema: 'sales que deja el agua al evaporarse',
    que: 'En cuencas sin salida al mar, el agua que llega se evapora y deja sales: cloruros, sulfatos, carbonatos y, en algunos casos, bórax y litio.',
    ver: 'Superficies planas y blancas, costras de sal y lagunas someras.',
    dato: 'El Salar de Atacama contiene una de las mayores reservas de litio del mundo, un metal clave para las baterías.'
  },
  remocion: {
    ico: '⛰️', nombre: 'Remoción en masa', lema: 'antiguos derrumbes, flujos y avalanchas',
    que: 'Son depósitos de antiguos deslizamientos, flujos y avalanchas de detritos: enormes volúmenes de roca y barro que bajaron por las laderas.',
    ver: 'Acumulaciones caóticas de bloques de todos los tamaños en una matriz de arena y barro, al pie de laderas o en el fondo de valles.',
    dato: 'Estudiar los depósitos antiguos ayuda a identificar zonas expuestas a peligros geológicos en el presente.'
  },
  metamorfica: {
    ico: '💎', nombre: 'Roca metamórfica', lema: 'roca transformada por presión y calor',
    que: 'Es una roca que ya existía y que, en las profundidades, fue transformada por alta presión y temperatura sin llegar a fundirse. Sus minerales se reorganizaron y se orientaron.',
    ver: 'Aspecto laminado y brillante (esquistos) o en bandas claras y oscuras (gneises).',
    dato: 'Muchos esquistos de la Cordillera de la Costa del centro-sur de Chile se formaron en una antigua zona de subducción, bajo decenas de kilómetros de roca.'
  },
  glaciaractual: {
    ico: '🧊', nombre: 'Glaciar', lema: 'hielo que cubre las rocas',
    que: 'Aquí el mapa geológico no muestra roca: la superficie está cubierta por hielo. Un glaciar es una gran masa de hielo formada por nieve acumulada durante siglos, que fluye lentamente ladera abajo y va erosionando el terreno.',
    ver: 'Superficies blancas o azuladas, con grietas, y lomas de roca suelta (morrenas) en sus bordes.',
    dato: 'Chile tiene más de 26.000 glaciares, la mayor superficie glaciar de Sudamérica. Son reservas de agua dulce y la mayoría se está reduciendo con el calentamiento global.'
  },
  lago: {
    ico: '💧', nombre: 'Lago', lema: 'agua que cubre las rocas',
    que: 'Aquí el mapa geológico no muestra roca: es un cuerpo de agua. Muchos lagos del sur de Chile ocupan cuencas que excavaron los glaciares y quedaron represados por las morrenas que el hielo dejó al retirarse.',
    ver: 'Busca en sus orillas lomas de bloques y barro (morrenas) y playas de bolones.',
    dato: 'Grandes lagos del sur, como el Llanquihue o el Villarrica, se formaron así al final de la última glaciación, hace unos 17.000 a 14.000 años.'
  },
  sininfo: { ico: '❔', nombre: 'Sin información', lema: '', que: '', ver: '', dato: '' }
};

export function datoMarino(u) {
  if (u.ma && u.ma[1] >= 66) return 'En rocas marinas de esta edad en Chile se encuentran amonites, parientes extintos de los calamares con concha en espiral.';
  return 'En rocas marinas jóvenes de la costa de Chile hay fósiles de ballenas, pingüinos y dientes de tiburones gigantes como el megalodón (por ejemplo, en Bahía Inglesa).';
}

// Contexto del mundo según la edad (Ma = millones de años)
export function contextoEdad(ma) {
  if (ma < 0.0117) return 'Holoceno: el clima actual. Los primeros habitantes de Chile ya vivían aquí; en Monte Verde hay huellas humanas de hace unos 14.500 años.';
  if (ma < 2.58) return 'Cuaternario: la época de las glaciaciones. Grandes glaciares avanzaban y retrocedían, y hacia el final llegaron los primeros seres humanos a América.';
  if (ma < 23.03) return 'Neógeno: los Andes se levantan con fuerza, se forma el desierto de Atacama y se une Norte con Sudamérica por Panamá.';
  if (ma < 66) return 'Paleógeno: ya no hay dinosaurios (salvo las aves). Los mamíferos se diversifican y Sudamérica es un continente-isla.';
  if (ma < 145) return 'Cretácico: época de dinosaurios. Se abre el océano Atlántico Sur, aparecen las plantas con flores y, hace 66 millones de años, un asteroide provoca una gran extinción.';
  if (ma < 201.4) return 'Jurásico: época de grandes dinosaurios. Pangea se fragmenta y en el norte de Chile un mar interior cubría lo que hoy es desierto.';
  if (ma < 251.9) return 'Triásico: existe Pangea, un solo supercontinente. Aparecen los primeros dinosaurios y mamíferos.';
  if (ma < 298.9) return 'Pérmico: Pangea termina de formarse. El período cierra con la mayor extinción de la historia, hace 252 millones de años.';
  if (ma < 538.8) return 'Paleozoico: mucho antes de los dinosaurios. Aparecen los peces, las primeras plantas terrestres y los primeros bosques.';
  return 'Precámbrico: casi toda la historia de la Tierra ocurrió en este tiempo, antes de que existiera la vida compleja.';
}

export const PERIODOS = [
  [2.58, 'Cuaternario'], [23.03, 'Neógeno'], [66, 'Paleógeno'], [145, 'Cretácico'], [201.4, 'Jurásico'],
  [251.9, 'Triásico'], [298.9, 'Pérmico'], [358.9, 'Carbonífero'], [419.2, 'Devónico'], [443.8, 'Silúrico'],
  [485.4, 'Ordovícico'], [538.8, 'Cámbrico'], [1e9, 'Precámbrico']
];
export function periodo(ma) { for (const [h, n] of PERIODOS) if (ma <= h) return n; return 'Precámbrico'; }
export function era(ma) { return ma < 66 ? 'Cenozoico' : ma < 251.9 ? 'Mesozoico' : ma < 538.8 ? 'Paleozoico' : 'Precámbrico'; }

export const FALLA = {
  que: 'Una falla es una fractura de la corteza en la que los bloques de roca se han desplazado uno respecto del otro. Cuando se mueven de golpe, liberan energía y generan un sismo.',
  tipos: {
    normal: 'Falla normal: el bloque de arriba baja respecto del otro. Ocurre cuando la corteza se estira.',
    inversa: 'Falla inversa: el bloque de arriba sube respecto del otro. Ocurre cuando la corteza se comprime, como la que levanta la cordillera de los Andes.',
    rumbo: 'Falla de rumbo: los bloques se deslizan horizontalmente, uno al lado del otro. Es dextral si el bloque del frente se mueve a la derecha y sinistral si se mueve a la izquierda.'
  },
  activa: 'Una falla activa es aquella que se ha movido en el período geológico reciente y que podría volver a moverse. Conocerlas ayuda a planificar el territorio y a reducir los peligros geológicos.',
  actividad: {
    comprobada: 'Actividad comprobada: hay evidencia clara de que se movió en el Cuaternario (los últimos 2,6 millones de años).',
    probable: 'Actividad probable: hay evidencias de movimiento reciente, aunque todavía no están del todo confirmadas.',
    posible: 'Actividad posible: su forma en el paisaje sugiere movimiento reciente, pero faltan estudios para confirmarlo.'
  }
};

// Diagramas simples de tipo de falla (SVG en línea)
export function svgFalla(sentido) {
  const s = sentido || '';
  const defs = `<defs><marker id="pf" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0L10,5L0,10z" fill="#fff"/></marker></defs>`;
  const flecha = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="4" marker-end="url(#pf)"/>`;
  const capas = (dy) => [[52, '#c98b5a'], [70, '#8fae6a'], [88, '#d9c27a']].map(([y, c]) => `<rect x="0" y="${y - dy}" width="240" height="14" fill="${c}"/>`).join('');
  if (s.startsWith('de rumbo')) {
    // vista en planta: el bloque de enfrente se mueve a la derecha (dextral) o a la izquierda (sinistral)
    const dex = s.includes('dextral');
    const franjas = (x0) => [0, 1, 2].map(k => `<rect x="${x0 + k * 70}" y="0" width="22" height="120" fill="#8fae6a"/>`).join('');
    return `<svg viewBox="0 0 240 124" class="svg-falla">${defs}
      <clipPath id="cA"><rect x="10" y="10" width="220" height="48"/></clipPath><clipPath id="cB"><rect x="10" y="62" width="220" height="48"/></clipPath>
      <rect x="10" y="10" width="220" height="48" fill="#c98b5a"/><g clip-path="url(#cA)">${franjas(dex ? 58 : 18)}</g>
      <rect x="10" y="62" width="220" height="48" fill="#c98b5a"/><g clip-path="url(#cB)">${franjas(38)}</g>
      <line x1="10" y1="60" x2="230" y2="60" stroke="#ff3b30" stroke-width="4"/>
      ${dex ? flecha(80, 34, 160, 34) + flecha(160, 86, 80, 86) : flecha(160, 34, 80, 34) + flecha(80, 86, 160, 86)}
      <text x="120" y="122" fill="#cfd8e3" font-size="10" text-anchor="middle">vista desde arriba</text></svg>`;
  }
  // corte vertical: plano de falla inclinado hacia la derecha; el bloque de la derecha (techo) sube (inversa) o baja (normal)
  const inversa = s.startsWith('inversa');
  const d = inversa ? 18 : -18;
  const xf = y => 95 + (y - 10) * 0.5;
  const topF = 38, topH = 38 - d;
  const pie = `M10 ${topF} L${xf(topF)} ${topF} L${xf(118)} 118 L10 118 Z`;
  const techo = `M${xf(topH)} ${topH} L230 ${topH} L230 118 L${xf(118)} 118 Z`;
  const fx = xf(70), fy = 70;
  return `<svg viewBox="0 0 240 124" class="svg-falla">${defs}
    <clipPath id="cP"><path d="${pie}"/></clipPath><clipPath id="cT"><path d="${techo}"/></clipPath>
    <path d="${pie}" fill="#7d6a55"/><g clip-path="url(#cP)">${capas(0)}</g>
    <path d="${techo}" fill="#7d6a55"/><g clip-path="url(#cT)">${capas(d)}</g>
    <line x1="${xf(Math.min(topF, topH) - 4)}" y1="${Math.min(topF, topH) - 4}" x2="${xf(118)}" y2="118" stroke="#ff3b30" stroke-width="4"/>
    ${inversa ? flecha(fx + 26, fy + 26, fx + 12, fy - 2) + flecha(fx - 26, fy - 10, fx - 12, fy + 18) : flecha(fx + 12, fy - 6, fx + 26, fy + 22) + flecha(fx - 12, fy + 14, fx - 26, fy - 14)}
    <text x="120" y="12" fill="#cfd8e3" font-size="9" text-anchor="middle">corte vertical · las capas quedan desplazadas</text></svg>`;
}
