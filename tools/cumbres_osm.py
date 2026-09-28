"""Cumbres y volcanes con nombre de OpenStreetMap (© colaboradores de OSM, ODbL) para Chile y la franja
argentina visible desde Chile (Aconcagua, etc.). Salida: data/cumbres.json = {"c": [[lon, lat, ele|null, nombre, v], ...]}
(v=1 si es volcán). Se descarga por tramos de latitud y reintenta en varios servidores Overpass."""
import json, time, urllib.parse, urllib.request
from pathlib import Path
SERVIDORES = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
              "https://overpass.private.coffee/api/interpreter"]
OUT = Path(__file__).resolve().parent.parent / "data" / "cumbres.json"
def pedir(s, n):
    q = f'[out:json][timeout:120];node["natural"~"^(peak|volcano)$"]["name"]({s},-76.5,{n},-65.5);out body;'
    for intento in range(12):
        url = SERVIDORES[intento % len(SERVIDORES)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(),
                                         headers={"User-Agent": "GeoLente/1.0 (https://cvenegas-sernageomin.github.io/geolente/)"})
            return json.load(urllib.request.urlopen(req, timeout=180))["elements"]
        except Exception as e:
            print(f"  {s}..{n} intento {intento + 1} en {url.split('/')[2]}: {str(e)[:80]}", flush=True)
            time.sleep(15 + 10 * intento)
    raise SystemExit(f"no se pudo descargar {s}..{n}")
def ele(t):
    try: return round(float(t.replace(",", ".").replace("m", "").strip()))
    except Exception: return None
todos = {}
for s in range(-56, -17, 3):
    els = pedir(s, s + 3); print(f"{s}..{s + 3}: {len(els)}", flush=True)
    for e in els:
        t = e["tags"]; todos[e["id"]] = [round(e["lon"], 5), round(e["lat"], 5), ele(t.get("ele", "")),
                                         t.get("name:es") or t["name"], 1 if t.get("natural") == "volcano" else 0]
OUT.write_text(json.dumps({"fuente": "© colaboradores de OpenStreetMap (ODbL)", "c": list(todos.values())},
                          ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("listo", len(todos), f"{OUT.stat().st_size / 1e6:.2f} MB")
