# Prepara los mapas geológicos detallados (gdb exportada a GeoJSON + simbología .lyr) para GeoLente.
# Entrada: mapas/salida/<id>_*.geojson (exportados con gdal3.js, ver mapas/_lector.html), <lyr>.lyr.json (lyr_a_json.py)
#          y dominios.json (dominios de la gdb).
# Salida:  data/mapas/index.json + data/mapas/<id>.json
import json, os, re, math
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SAL = os.path.join(RAIZ, 'mapas', 'salida')
OUT = os.path.join(RAIZ, 'data', 'mapas')
Q = 100000  # 1e-5° ≈ 1,1 m
PT = 0.0254 / 72 * 50000  # 1 punto tipográfico a escala 1:50.000, en metros (≈ 17,6 m)

MAPAS = [
    {'id': 'rc', 'lyr': 'Unidades geológicas__Rio_claro_29072026.lyr.json',
     'titulo': 'Río Claro (Informe Registrado)', 'hoja': 'Geología del área Río Claro, Región del Maule',
     'anno_u': 'Unidades_geologicasAnno_50', 'anno_m': 'Medidas_estructuralesAnno_50', 'colocar': {'si'},
     'pliegues': 'GB_PLIEGUE_L', 'diques': 'GB_DIQUE_FILON_MANTO_L', 'simb': 'GB_SIMBOLO_FALLA_PLIEGUE', 'fosil': 'GB_FOSIL',
     'anno_f': 'Fallas_Texto',
     # el .mxd solo muestra las dataciones con DESPLEGAR = 'Ap' OR DESPLEGAR = 'Si' (48 de 115)
     'geocron': lambda p: (p.get('DESPLEGAR') or '').strip().lower() in ('si', 'ap')},
    {'id': 'cc', 'lyr': 'Unidades geológicas_Central_Cipreses_01102026.lyr.json',
     'titulo': 'Central Cipreses (versión preliminar)', 'hoja': 'Geología del área Central Los Cipreses, Región del Maule (versión preliminar)',
     'anno_u': None, 'anno_m': 'Anno_Medidas_estructurales', 'colocar': {'NEW', 'NEW.'},
     'geocron': lambda p: True},  # sin campo DESPLEGAR: todas, salvo las sin edad o con "00±00" (se descartan más abajo)
]

DOM = json.load(open(os.path.join(SAL, 'dominios.json'), encoding='utf-8'))
dom = lambda c: (DOM.get(c) or '').strip() if c else ''

# ---------------------------------------------------------------- edades (ICS 2023): nombre → (base, techo) en Ma
PISOS = {
    'Holoceno superior': (0.0042, 0), 'Holoceno medio': (0.0082, 0.0042), 'Holoceno inferior': (0.0117, 0.0082),
    'Pleistoceno Superior': (0.129, 0.0117), 'Pleistoceno Medio': (0.774, 0.129), 'Calabriano': (1.80, 0.774), 'Gelasiano': (2.58, 1.80),
    'Piacenziano': (3.60, 2.58), 'Zancleano': (5.333, 3.60), 'Messiniano': (7.246, 5.333), 'Tortoniano': (11.63, 7.246),
    'Serravalliano': (13.82, 11.63), 'Langhiano': (15.98, 13.82), 'Burdigaliano': (20.44, 15.98), 'Aquitaniano': (23.03, 20.44),
    'Chattiano': (27.82, 23.03), 'Rupeliano': (33.9, 27.82), 'Priaboniano': (37.71, 33.9), 'Bartoniano': (41.2, 37.71),
    'Lutetiano': (47.8, 41.2), 'Ypresiano': (56.0, 47.8), 'Thanetiano': (59.2, 56.0), 'Selandiano': (61.6, 59.2), 'Daniano': (66.0, 61.6),
    'Maastrichtiano': (72.1, 66.0), 'Campaniano': (83.6, 72.1), 'Santoniano': (86.3, 83.6), 'Coniaciano': (89.8, 86.3),
    'Turoniano': (93.9, 89.8), 'Cenomaniano': (100.5, 93.9), 'Albiano': (113.0, 100.5), 'Aptiano': (121.4, 113.0),
    'Barremiano': (125.77, 121.4), 'Hauteriviano': (132.6, 125.77), 'Valanginiano': (139.8, 132.6), 'Berriasiano': (145.0, 139.8),
    'Titoniano': (149.2, 145.0), 'Kimmeridgiano': (154.8, 149.2), 'Oxfordiano': (161.5, 154.8),
    'Holoceno': (0.0117, 0), 'Pleistoceno': (2.58, 0.0117), 'Plioceno': (5.333, 2.58), 'Mioceno': (23.03, 5.333),
    'Oligoceno': (33.9, 23.03), 'Eoceno': (56.0, 33.9), 'Paleoceno': (66.0, 56.0), 'Cretácico Superior': (100.5, 66.0),
    'Cretácico Inferior': (145.0, 100.5), 'Jurásico Superior': (161.5, 145.0), 'Jurásico Medio': (174.7, 161.5),
    'Jurásico Inferior': (201.4, 174.7), 'Cuaternario': (2.58, 0), 'Neógeno': (23.03, 2.58), 'Paleógeno': (66.0, 23.03),
    'Cretácico': (145.0, 66.0), 'Jurásico': (201.4, 145.0), 'Triásico': (251.9, 201.4),
}
def rango(nombre):
    n = re.sub(r'\s*\(.*?\)', '', nombre or '').strip()
    return PISOS.get(n)

def edad_unidad(p):
    """(texto, [base, techo], pisos). El texto sale de las épocas (o períodos); el rango en Ma, de los pisos
    solo si caen dentro de esas épocas (en algunas unidades los pisos no calzan con la época cargada)."""
    limpio = lambda x: re.sub(r'\s*\(.*?\)', '', x or '').strip()
    ev = dom(p.get('EPOCA_ESTRAT_MAX')) or dom(p.get('PERIODO_MAX'))
    ej = dom(p.get('EPOCA_ESTRAT_MIN')) or dom(p.get('PERIODO_MIN'))
    ev, ej = (ev or ej), (ej or ev)
    if not rango(ev) or not rango(ej): return '', None, ''
    txt = ev if ev == ej else f'{ev}–{ej}'
    ma = [rango(ev)[0], rango(ej)[1]]
    pv, pj = dom(p.get('EDAD_ESTRAT_MAX')), dom(p.get('EDAD_ESTRAT_MIN'))
    pisos = ''
    if rango(pv) and rango(pj):
        m2 = [rango(pv)[0], rango(pj)[1]]
        if ma[1] - 1e-6 <= m2[1] <= m2[0] <= ma[0] + 1e-6:
            ma = m2
            pisos = limpio(pv) if limpio(pv) == limpio(pj) else f'{limpio(pv)}–{limpio(pj)}'
            if pisos == txt: pisos = ''
    return txt, [round(ma[0], 4), round(ma[1], 4)], pisos

# edad aproximada desde el código de la unidad (cuando la gdb no trae los campos de edad)
PREF = [('PPl', 'Plioceno–Pleistoceno'), ('PlH', 'Pleistoceno–Holoceno'), ('PsPl', 'Plioceno superior–Pleistoceno'),
        ('Pls', 'Pleistoceno Superior'), ('Plm', 'Pleistoceno Medio'), ('Pli', 'Pleistoceno'), ('Pl', 'Pleistoceno'),
        ('Ps', 'Plioceno'), ('Pc', 'Plioceno'), ('Pal', 'Paleoceno'), ('OlM', 'Oligoceno–Mioceno'), ('OM', 'Oligoceno–Mioceno'),
        ('EM', 'Eoceno–Mioceno'), ('Mi', 'Mioceno'), ('Mm', 'Mioceno'), ('Ms', 'Mioceno'), ('MP', 'Mioceno–Plioceno'), ('M', 'Mioceno'),
        ('Ki', 'Cretácico Inferior'), ('Ks', 'Cretácico Superior'), ('K', 'Cretácico'), ('Jm', 'Jurásico Medio'),
        ('Js', 'Jurásico Superior'), ('Ji', 'Jurásico Inferior'), ('J', 'Jurásico'), ('Hq', 'Holoceno'), ('H', 'Holoceno')]
def edad_codigo(cod):
    for pre, txt in PREF:
        if cod.startswith(pre):
            partes = txt.split('–'); a, b = rango(partes[0]), rango(partes[-1])
            return txt, [a[0], b[1]]
    return '', None

# ---------------------------------------------------------------- categoría divulgativa (claves de contenido.js)
def categoria(p, nombre, cod):
    st, amb, n = p.get('SUBTIPO_DESC') or '', dom(p.get('AMBIENTE')), (nombre or '').upper()
    if 'REMOCI' in n: return 'remocion'
    if 'Intrusiva' in st: return 'intrusiva'
    if 'Volcánica y Sedimentaria' in st: return 'volcanosedimentaria'
    if 'Volcánica' in st: return 'volcanica'
    if 'Glaciar' in amb or 'GLACIA' in n: return 'glaciar'
    if 'Lacustre' in amb or 'LACUSTRE' in n: return 'lacustre'
    if 'Fluvi' in amb or 'FLUVIA' in n: return 'fluvial'
    if 'Aluvi' in amb or 'ALUVI' in n: return 'aluvial'
    if nombre: return 'sedimentaria'
    # sin atributos: depósitos cuaternarios por la letra final del código
    base = re.sub(r'\(.*?\)|\d+', '', cod)
    if re.match(r'^(H|Pl|PlH)', base):
        suf = base[len(re.match(r'^(PlH|Pl[sim]?|H)', base).group()):] if re.match(r'^(PlH|Pl[sim]?|H)', base) else ''
        for s, c in (('rm', 'remocion'), ('af', 'fluvial'), ('ac', 'aluvial'), ('a', 'aluvial'), ('f', 'fluvial'), ('g', 'glaciar'), ('l', 'lacustre'), ('v', 'volcanica'), ('m', 'remocion')):
            if suf.startswith(s): return c
    if base.endswith('v') or re.search(r'v\d?$', base): return 'volcanica'
    return 'sininfo'

def titulo(n):
    if not n: return ''
    n = re.sub(r'\s+', ' ', n).strip()
    n = re.sub(r'\s+[A-Z][a-z]+[A-Z]\w*$', '', n)  # quita un código de unidad pegado al final ("… HOLOCENO PlsHv")
    if n.isupper() or sum(c.isupper() for c in n) > len(n) * 0.6:
        menores = {'de', 'del', 'y', 'e', 'en'}
        cap = lambda w: '-'.join(x.capitalize() for x in w.split('-'))
        n = ' '.join(w.lower() if i and w.lower() in menores else cap(w) for i, w in enumerate(n.lower().split(' ')))
    for a, b in (('Depositos', 'Depósitos'), ('Formacion', 'Formación'), ('Volcanicos', 'Volcánicos'), ('Glaciosedimentarios', 'Glaciosedimentarios')):
        n = re.sub(r'\b' + a + r'\b', b, n)
    return n

# ---------------------------------------------------------------- simbología del .lyr → especificación de relleno
def hexcol(c):
    if not c or c.get('is_null'): return None
    if 'R' in c: return '#%02x%02x%02x' % (c['R'], c['G'], c['B'])
    return None
def marcador(m):
    t = m['type']
    if t in ('MultiLayerMarkerSymbol',):
        out = [marcador(l) for l in m['levels']]
        return [x for x in out if x]
    if t == 'CharacterMarkerSymbol':
        return [{'k': 'car', 'f': m.get('font'), 'u': m.get('unicode'), 's': m.get('size'), 'a': m.get('angle') or 0, 'c': hexcol(m.get('color')) or '#000',
                 'dx': m.get('x_offset') or 0, 'dy': m.get('y_offset') or 0}]
    if t == 'SimpleMarkerSymbol':
        return [{'k': 'pto', 't': m.get('marker_type'), 's': m.get('size'), 'c': hexcol(m.get('color')) or '#000'}]
    return []
def relleno(sym):
    capas = []
    def rec(s):
        t = s['type']
        if t == 'MultiLayerFillSymbol':
            for l in s['levels']: rec(l)
        elif t == 'SimpleFillSymbol':
            c = hexcol(s.get('color'))
            if c: capas.append({'k': 'f', 'c': c})
        elif t == 'MarkerFillSymbol':
            mk = marcador(s['marker'])
            mk = [x for y in mk for x in (y if isinstance(y, list) else [y])]
            if mk: capas.append({'k': 'm', 'sx': s.get('separation_x'), 'sy': s.get('separation_y'), 'ox': s.get('offset_x') or 0, 'oy': s.get('offset_y') or 0,
                                 'r': bool(s.get('random')), 'mk': mk})
        elif t == 'LineFillSymbol':
            ln = s.get('line') or {}
            capas.append({'k': 'l', 'a': s.get('angle') or 0, 'sep': s.get('separation') or 4, 'w': ln.get('width') or 0.4, 'c': hexcol(ln.get('color')) or '#000'})
    rec(sym)
    return capas

# ---------------------------------------------------------------- geometría
def enc(coords):
    out, px, py = [], 0, 0
    for x, y in coords:
        qx, qy = round(x * Q), round(y * Q)
        out += [qx - px, qy - py]; px, py = qx, qy
    return out
def lineas(geom, tol=0.00003):
    g = shape(geom).simplify(tol, preserve_topology=False)
    if g.is_empty: return []
    parts = [g] if g.geom_type == 'LineString' else list(g.geoms)
    return [enc(p.coords) for p in parts if len(p.coords) >= 2]
def poligonos(geom, tol=0.00002):
    g = shape(geom).buffer(0).simplify(tol, preserve_topology=True)
    if g.is_empty: return []
    parts = [g] if g.geom_type == 'Polygon' else list(g.geoms)
    out = []
    for p in parts:
        if p.area <= 0: continue
        rp = p.representative_point()
        out.append({'r': [enc(p.exterior.coords)] + [enc(i.coords) for i in p.interiors], 'l': [round(rp.x, 6), round(rp.y, 6)], 'a': p.area})
    return out
def centro(f):
    g = shape(f['geometry']); c = g.centroid
    return [round(c.x, 6), round(c.y, 6)]

def L(mid, capa):
    p = os.path.join(SAL, f'{mid}_{capa}.geojson')
    if not os.path.exists(p): return []
    return [f for f in json.load(open(p, encoding='utf-8'))['features'] if f.get('geometry')]

INF = {'TP-INF-1': 0, 'TP-INF-2': 2, 'TP-INF-3': 1}  # 0 observada, 1 inferida, 2 cubierta

def preparar(M, compartidas):
    mid = M['id']
    lyr = json.load(open(os.path.join(SAL, M['lyr']), encoding='utf-8'))['root']['renderer']
    clases = [c for g in lyr['groups'] for c in g['classes']]
    simb = {v: relleno(c['symbol']) for v, c in zip(lyr['values'], clases)}

    borde = shape(L(mid, 'MD_MAPA_P')[0]['geometry'])
    if borde.geom_type == 'MultiPolygon': borde = max(borde.geoms, key=lambda g: g.area)
    bb = borde.bounds
    # unidades
    U, polys = {}, []
    for f in L(mid, 'GB_UNIDAD_GEO_P'):
        p = f['properties']; cod = (p.get('CODIGO') or '').strip()
        if not cod: continue
        if cod not in U:
            nombre = titulo(p.get('NOMBRE_UNIDAD'))
            txt, ma, pisos = edad_unidad(p)
            aprox = False
            if not ma and cod in compartidas:  # misma unidad descrita en la otra hoja
                o = compartidas[cod]; nombre = nombre or o['n']; txt, ma, pisos = o['e'], o['ma'], o.get('pi', '')
            if not ma:
                txt, ma = edad_codigo(cod); aprox = bool(ma); pisos = ''
            partes = [dom(p.get('TP_UNIDAD_LITOESTRAT')), dom(p.get('STP_UNIDAD')), dom(p.get('AMBIENTE'))]
            U[cod] = {'n': nombre, 'cat': categoria(p, nombre, cod), 'e': txt, 'pi': pisos, 'ma': ma, 'ap': aprox,
                      't': p.get('SUBTIPO_DESC') or '', 'd': ' · '.join(x for x in partes if x), 'def': (p.get('DEFINICION') or '').strip(),
                      'g': [p.get('GEOCRON_EDAD_MAX'), p.get('GEOCRON_EDAD_MIN'), dom(p.get('UNIDAD_MEDIDA'))] if p.get('GEOCRON_EDAD_MAX') or p.get('GEOCRON_EDAD_MIN') else None,
                      's': simb.get(cod) or [{'k': 'f', 'c': '#cccccc'}]}
        for pp in poligonos(f['geometry']):
            pp['u'] = cod; polys.append(pp)
    polys.sort(key=lambda x: -x['a'])
    for pp in polys: del pp['a']

    # contactos
    contactos = []
    for f in L(mid, 'GB_CONTACTO_L'):
        d = f['properties'].get('SUBTIPO_DESC') or ''
        t = 1 if 'inferido' in d else 2 if 'cubierto' in d else 0
        for g in lineas(f['geometry']): contactos.append({'t': t, 'g': g})
    # fallas
    fallas = []
    for f in L(mid, 'GB_FALLA_L'):
        p = f['properties']; s = dom(p.get('FALLA')).lower() or (p.get('SUBTIPO_DESC') or '').lower()
        tipo = 'inversa' if 'inversa' in s else 'normal' if 'normal' in s else 'sinistral' if 'sinistral' in s else 'dextral' if 'dextral' in s else 'rumbo' if 'rumbo' in s else 'indet'
        nombre = (p.get('NOMBRE') or '').strip()
        gs = shape(f['geometry']); nv = sum(len(x.coords) for x in (gs.geoms if hasattr(gs, 'geoms') else [gs]))
        if nv <= 4 and (p.get('SHAPE_Length') or 0) > 15000:  # recta de lado a lado de la hoja: traza de perfil cargada como falla
            print(f'  {mid}: se omite una "falla" recta de {p["SHAPE_Length"] / 1000:.1f} km ({p.get("SUBTIPO_DESC")}), parece traza de perfil')
            continue
        for g in lineas(f['geometry']): fallas.append({'t': tipo, 'i': INF.get(p.get('TP_INFORMACION'), 0), 'n': nombre, 'g': g})
    pliegues, diques, simbolos, fosiles = [], [], [], []
    if M.get('pliegues'):
        for f in L(mid, M['pliegues']):
            p = f['properties']; t = 'anticlinal' if 'anticlinal' in (p.get('SUBTIPO_DESC') or '').lower() else 'sinclinal'
            for g in lineas(f['geometry']): pliegues.append({'t': t, 'i': INF.get(p.get('TP_INFORMACION'), 0), 'g': g})
    if M.get('diques'):
        for f in L(mid, M['diques']):
            p = f['properties']
            for g in lineas(f['geometry']): diques.append({'lit': dom(p.get('LITOLOGIA')), 'tp': dom(p.get('TIPO_INTRUSION')), 'g': g})
    if M.get('simb'):
        for f in L(mid, M['simb']):
            p = f['properties']; x, y = f['geometry']['coordinates'][:2]
            simbolos.append([round(x, 6), round(y, 6), p.get('AZIMUT') or 0, (p.get('SUBTIPO_DESC') or '').replace('Símbolo ', '')])
    if M.get('fosil'):
        for f in L(mid, M['fosil']):
            p = f['properties']; x, y = f['geometry']['coordinates'][:2]
            ed = ' – '.join(x for x in (dom(p.get('EDAD_MAX')) or dom(p.get('EPOCA_MAX')), dom(p.get('EDAD_MIN')) or dom(p.get('EPOCA_MIN'))) if x)
            fosiles.append([round(x, 6), round(y, 6), p.get('SUBTIPO_DESC') or 'Fósil', p.get('LOCALIDAD') or '', ed, p.get('REFERENCIA') or ''])
    # medidas estructurales (solo las que el mapa muestra: campo Colocar)
    medidas = []
    for f in L(mid, 'GB_MEDIDA_ESTRUCTURAL'):
        p = f['properties']
        if (p.get('Colocar') or '').strip() not in M['colocar']: continue
        x, y = f['geometry']['coordinates'][:2]
        tp = dom(p.get('TP_MEDIDA_ESTRUCT')).lower()
        t = 'h' if 'horizontal' in tp else 'v' if 'vertical' in tp else 'i'
        medidas.append([round(x, 6), round(y, 6), p.get('AZIMUT') or 0, p.get('MANTEO_BUZAMIENTO'), t, 1 if 'fotointerpret' in tp else 0])
    # geocronología
    geocron = []
    for f in (L(mid, 'GB_GEOCRONOLOGIA') if M.get('geocron') else []):
        p = f['properties']; x, y = f['geometry']['coordinates'][:2]
        if not M['geocron'](p): continue
        if not borde.buffer(0.002).contains(shape(f['geometry'])): continue
        et = re.sub(r'\s+\S+$', '', (p.get('ETIQUETA') or '').strip()) if re.search(r'(Ma|ka|AP|BP)\s+\S+$', p.get('ETIQUETA') or '') else (p.get('ETIQUETA') or '').strip()
        if not et and p.get('EDAD'):
            et = f"{p['EDAD']:g} ± {p.get('ERROR') or 0:g} {'Ma' if 'Ma' in dom(p.get('UNIDAD_MEDIDA')) or (p.get('UNIDAD_MEDIDA') or '').startswith('Ma') else ''}".strip()
        if not et or et.startswith('00'): continue
        met = (p.get('SUBTIPO_DESC') or p.get('METODO') or '').strip()
        mm = re.search(r'\(([^)]+)\)', met); met_c = mm.group(1) if mm else (p.get('METODO') or met)
        geocron.append([round(x, 6), round(y, 6), et.replace('±', ' ± '), met_c, dom(p.get('MATERIAL_DAT')), p.get('LITOLOGIA') or '',
                        p.get('UNIDAD_GEOLOGICA') or '', p.get('SIGLA_MUESTRA') or '', p.get('REFERENCIA') or ''])
    # anotaciones dibujadas sobre el mapa: códigos de unidad y manteos (texto, posición, ángulo, alto en m)
    def anotaciones(capa):
        out = []
        for f in L(mid, capa):
            p = f['properties']; t = (p.get('TextString') or '').replace('\r\n', '\n').strip()
            t = re.sub(r'<[^>]+>', '', t)
            if not t: continue
            c = centro(f)
            out.append([c[0], c[1], t, round(p.get('Angle') or 0, 1), round((p.get('FontSize') or 6) * PT, 1)])
        return out
    tu = anotaciones(M['anno_u']) if M.get('anno_u') else []
    if not tu:  # sin anotación: el código en el punto interior de cada polígono grande
        tu = [[pp['l'][0], pp['l'][1], pp['u'], 0, 6 * PT] for pp in polys[:400]]
    tm = anotaciones(M['anno_m']) if M.get('anno_m') else []
    tf = anotaciones(M['anno_f']) if M.get('anno_f') else []

    return {
        'id': mid, 'titulo': M['titulo'], 'hoja': M['hoja'], 'escala': 50000,
        'bbox': [round(b, 6) for b in bb], 'borde': [enc(borde.exterior.coords)], 'q': Q,
        'u': U, 'p': polys, 'lc': contactos, 'lf': fallas, 'lp': pliegues, 'ld': diques,
        'sm': simbolos, 'pm': medidas, 'pg': geocron, 'pf': fosiles, 'tu': tu, 'tm': tm, 'tf': tf,
    }

def main():
    os.makedirs(OUT, exist_ok=True)
    indice, compartidas = [], {}
    for M in MAPAS:
        d = preparar(M, compartidas)
        for cod, u in d['u'].items():
            if u['ma'] and not u['ap']: compartidas.setdefault(cod, u)
        ruta = os.path.join(OUT, d['id'] + '.json')
        with open(ruta, 'w', encoding='utf-8') as fo: json.dump(d, fo, ensure_ascii=False, separators=(',', ':'))
        indice.append({'id': d['id'], 'titulo': d['titulo'], 'bbox': d['bbox']})
        print(d['id'], f"{os.path.getsize(ruta) / 1024:.0f} KB", {k: len(d[k]) for k in ('u', 'p', 'lc', 'lf', 'lp', 'ld', 'sm', 'pm', 'pg', 'pf', 'tu', 'tm', 'tf')})
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as fo: json.dump({'mapas': indice}, fo, ensure_ascii=False)

if __name__ == '__main__':
    main()
