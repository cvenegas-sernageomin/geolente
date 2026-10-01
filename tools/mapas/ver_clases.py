# Resume las clases de un renderer UniqueValue de un .lyr.json (salida de lyr_a_json.py)
import json, sys


def col(c):
    if not c or c.get('is_null'):
        return None
    if 'R' in c:
        return '#%02x%02x%02x' % (c['R'], c['G'], c['B'])
    return str({k: v for k, v in c.items() if k in ('C', 'M', 'Y', 'K', 'type')})


def sym(s):
    if not s:
        return ['-']
    t = s['type']
    if t in ('MultiLayerFillSymbol', 'MultiLayerMarkerSymbol', 'MultiLayerLineSymbol'):
        return [x for l in s['levels'] for x in sym(l)]
    if t == 'SimpleFillSymbol':
        return [f"Relleno({col(s.get('color'))} {s.get('fill_style')} borde {col((s.get('outline') or {}).get('color'))})"]
    if t == 'LineFillSymbol':
        return [f"Lineas(ang {s.get('angle')} sep {s.get('separation')} {sym(s.get('line'))})"]
    if t == 'MarkerFillSymbol':
        return [f"Marcas(sep {s.get('separation_x')}x{s.get('separation_y')} off {s.get('offset_x')},{s.get('offset_y')} ang {s.get('grid_angle')} rnd {s.get('random')} {sym(s.get('marker'))})"]
    if t == 'CharacterMarkerSymbol':
        return [f"Car({s.get('font')} #{s.get('unicode')} tam {s.get('size')} ang {s.get('angle')} {col(s.get('color'))})"]
    if t == 'SimpleMarkerSymbol':
        return [f"Punto({s.get('marker_type')} {s.get('size')} {col(s.get('color'))})"]
    if t in ('SimpleLineSymbol', 'CartographicLineSymbol'):
        return [f"Linea({col(s.get('color'))} {s.get('width')} {s.get('line_type', '')})"]
    return [t]


d = json.load(open(sys.argv[1], encoding='utf-8'))['root']
r = d['renderer']
cl = [c for g in r['groups'] for c in g['classes']]
print(len(cl), 'clases', r['type'])
for v, c in zip(r['values'], cl):
    print(v, '|', c.get('label'), '|', (c.get('description') or '')[:70])
    print('     ', ' + '.join(sym(c.get('symbol'))))
