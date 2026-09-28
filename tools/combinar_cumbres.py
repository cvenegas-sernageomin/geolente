"""Combina cumbres: OpenStreetMap (posición precisa, prioridad) + GeoNames para las que OSM no tiene
+ volcanes agregados a mano si no hay uno de OSM cerca. 6º campo = radio (m) para ajustar a la cumbre del DEM:
120 m en OSM, 300 m en GeoNames (por defecto en la app), 1500 m en los volcanes a mano."""
import json, math
from pathlib import Path
R = Path(__file__).resolve().parent
osm = json.load(open(R / "src" / "cumbres_osm.json", encoding="utf-8"))["c"]
gn = json.load(open(R / "src" / "cumbres_geonames.json", encoding="utf-8"))["c"]
celda = lambda lon, lat: (math.floor(lon * 50), math.floor(lat * 50))  # celdas de ~2 km
idx = {}
for x in osm:
    idx.setdefault(celda(x[0], x[1]), []).append(x)
def cerca(lon, lat, m, solo_volcan=False):
    cx, cy = celda(lon, lat); k = math.cos(math.radians(lat))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for y in idx.get((cx + dx, cy + dy), []):
                if solo_volcan and not y[4]: continue
                if math.hypot((y[0] - lon) * 111320 * k, (y[1] - lat) * 110574) < m: return True
    return False
out = [x[:5] + [120] for x in osm]
n_gn = n_v = 0
for x in gn:
    if len(x) > 5:  # volcán agregado a mano
        if not cerca(x[0], x[1], 2000, True): out.append(x); n_v += 1
    elif not cerca(x[0], x[1], 800): out.append(x[:5]); n_gn += 1
dest = R.parent / "data" / "cumbres.json"
dest.write_text(json.dumps({"fuente": "© colaboradores de OpenStreetMap (ODbL) + GeoNames (CC BY 4.0)", "c": out},
                           ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"OSM {len(osm)} + GeoNames {n_gn} + volcanes a mano {n_v} = {len(out)} ({dest.stat().st_size / 1e6:.2f} MB)")
