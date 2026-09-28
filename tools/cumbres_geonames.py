"""Cumbres, cerros y volcanes con nombre desde GeoNames (CC BY 4.0, https://www.geonames.org), Chile + franja argentina
cercana a la frontera. Las coordenadas de GeoNames pueden estar corridas cientos de metros: la app ajusta cada cumbre
al punto más alto del relieve en 400 m a la redonda. Salida: data/cumbres.json = {"c": [[lon, lat, ele|null, nombre, volcán], ...]}
Fuentes: tools/src/CL.zip y AR.zip de https://download.geonames.org/export/dump/ (alternativa: cumbres_osm.py, Overpass)."""
import json, zipfile
from pathlib import Path
RAIZ = Path(__file__).resolve().parent
TIPOS = {"PK", "MT", "VLC", "HLL"}
out, vistos = [], set()
for pais in ("CL", "AR"):
    txt = zipfile.ZipFile(RAIZ / "src" / f"{pais}.zip").read(f"{pais}.txt").decode("utf-8")
    for linea in txt.splitlines():
        f = linea.split("\t")
        if f[6] != "T" or f[7] not in TIPOS: continue
        lat, lon = round(float(f[4]), 5), round(float(f[5]), 5)
        if pais == "AR" and lon < -73.9: pass
        if pais == "AR" and lon > -67.0: continue  # solo la franja visible desde Chile
        clave = (f[1], round(lat, 2), round(lon, 2))
        if clave in vistos: continue
        vistos.add(clave)
        ele = int(f[15]) if f[15].strip().lstrip("-").isdigit() and int(f[15]) > 0 else None
        out.append([lon, lat, ele, f[1], 1 if f[7] == "VLC" else 0])
# volcanes principales que faltan en GeoNames: coordenadas aproximadas, la app los ajusta a la cumbre real (radio 1,5 km)
VOLCANES = [("Volcán Villarrica", -39.420, -71.939, 2847), ("Volcán Licancabur", -22.834, -67.887, 5916),
    ("Volcán Láscar", -23.367, -67.733, 5592), ("Volcán Parinacota", -18.166, -69.142, 6348), ("Volcán Llaima", -38.692, -71.729, 3125),
    ("Volcán Calbuco", -41.330, -72.614, 2003), ("Volcán Lanín", -39.637, -71.502, 3747), ("Volcán Antuco", -37.406, -71.349, 2979),
    ("Nevados de Chillán", -36.863, -71.377, 3212), ("Volcán San José", -33.787, -69.897, 5856), ("Volcán Tinguiririca", -34.814, -70.352, 4280),
    ("Volcán Peteroa", -35.240, -70.570, 3603), ("Volcán Descabezado Grande", -35.580, -70.750, 3953), ("Volcán Puyehue", -40.590, -72.117, 2236),
    ("Volcán Chaitén", -42.833, -72.646, 1122), ("Volcán Hudson", -45.900, -72.970, 1905), ("Nevado Ojos del Salado", -27.109, -68.541, 6893),
    ("Volcán Mocho-Choshuenco", -39.927, -72.027, 2422), ("Volcán Quetrupillán", -39.500, -71.700, 2360), ("Volcán Lonquimay", -38.377, -71.586, 2865),
    ("Volcán Copahue", -37.856, -71.183, 2997), ("Volcán Guallatiri", -18.420, -69.090, 6071), ("Volcán Isluga", -19.150, -68.830, 5550),
    ("Volcán Ollagüe", -21.300, -68.180, 5868), ("Volcán San Pedro", -21.885, -68.407, 6145), ("Volcán Putana", -22.570, -67.850, 5890),
    ("Volcán Tupungatito", -33.400, -69.800, 5682), ("Volcán Maipo", -34.161, -69.833, 5264), ("Volcán Tacora", -17.720, -69.770, 5980),
    ("Volcán Taapaca", -18.100, -69.500, 5860), ("Volcán Osorno", -41.100, -72.493, 2652), ("Volcán Yate", -41.755, -72.396, 2187),
    ("Volcán Corcovado", -43.192, -72.794, 2300), ("Volcán Melimoyu", -44.080, -72.880, 2400), ("Volcán Lautaro", -49.020, -73.550, 3607)]
nombres = [(x[3], x[1], x[0]) for x in out]
for n, la, lo, ele in VOLCANES:
    base = n.split()[-1]
    if any(base in m and abs(a - la) < 0.03 and abs(b - lo) < 0.03 for m, a, b in nombres): continue
    out.append([lo, la, ele, n, 1, 1500])
dest = RAIZ.parent / "data" / "cumbres.json"
dest.write_text(json.dumps({"fuente": "GeoNames (CC BY 4.0)", "c": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(out), "cumbres", f"{dest.stat().st_size / 1e6:.2f} MB")
