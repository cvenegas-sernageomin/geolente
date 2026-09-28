"""Descarga las fuentes a tools/src/ (no se versionan por tamaño):
  - geo1M.geojson : Mapa Geológico de Chile 1:1.000.000 desde un FeatureServer público de ArcGIS Online (CORS abierto).
  - red_fallas.kml: CHAF v1 desde PANGAEA (CC BY 4.0).
La leyenda (src/leyenda.json) se extrajo una vez del PDF "Mapa Geológico de Chile: versión digital"
(https://www.ipgp.fr/~dechabal/Geol-millon.pdf) y sí se versiona."""
import io, json, urllib.parse, urllib.request, zipfile
from pathlib import Path
SRC = Path(__file__).resolve().parent / "src"; SRC.mkdir(exist_ok=True)
B = "https://services1.arcgis.com/Jv4ezovgAQ6StsZU/arcgis/rest/services/Mapa_Geologico_de_Chile/FeatureServer/0/query"
feats, off = [], 0
while True:
    q = urllib.parse.urlencode(dict(where="1=1", outFields="FID,geo,epoca,composicio,era,periodo", returnGeometry="true", outSR=4326,
                                    geometryPrecision=5, resultOffset=off, resultRecordCount=2000, orderByFields="FID", f="geojson"))
    fs = json.load(urllib.request.urlopen(B + "?" + q, timeout=120))["features"]
    feats += fs; print(off, len(fs), flush=True)
    if len(fs) < 2000: break
    off += 2000
json.dump({"type": "FeatureCollection", "features": feats}, open(SRC / "geo1M.geojson", "w", encoding="utf-8"))
req = urllib.request.Request("https://download.pangaea.de/dataset/922241/files/CHAF_Pangaea_v1.kmz", headers={"User-Agent": "Mozilla/5.0"})
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
kml = next(n for n in z.namelist() if n.endswith(".kml"))
(SRC / "red_fallas.kml").write_bytes(z.read(kml))
print("listo:", len(feats), "polígonos")
