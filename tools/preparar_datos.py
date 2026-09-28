"""Prepara los datos de GeoLente a partir de las fuentes en tools/src/.

Fuentes:
  - geo1M.geojson : Mapa Geológico de Chile 1:1.000.000 (SERNAGEOMIN, 2003; servicio corregido 2010),
                    descargado de un FeatureServer público de ArcGIS Online (18.935 polígonos).
  - leyenda.json  : descripciones oficiales por unidad, extraídas del PDF "Mapa Geológico de Chile:
                    versión digital" (millon.txt).
  - red_fallas.kml: CHAF v1, Melnick, Maldonado & Contreras (2020), PANGAEA doi:10.1594/PANGAEA.922241, CC-BY 4.0.

Salida (en ../data):
  - unidades.json         : ficha por unidad (edad en Ma, color, textos).
  - geo/index.json        : lista de teselas de 0,5° disponibles.
  - geo/<lat>_<lon>.json  : polígonos de la tesela, coordenadas enteras 1e-4° con delta.
  - fallas.json           : fallas CHAF simplificadas y traducidas.
"""
import json, math, re, collections
from pathlib import Path
from shapely.geometry import shape, box, Polygon, MultiPolygon
from shapely.ops import polylabel

RAIZ = Path(__file__).resolve().parent
SRC = RAIZ / "src"
OUT = RAIZ.parent / "data"
(OUT / "geo").mkdir(parents=True, exist_ok=True)

TESELA = 0.5          # grados
Q = 1e4               # cuantización: 1e-4° ≈ 11 m, suficiente para escala 1:1.000.000
SIMPL = 0.00015       # tolerancia de simplificación (~15 m)

# ---------------------------------------------------------------- edades (Ma, ICS 2024)
EDADES = {
    "holoceno": (0.0117, 0), "pleistoceno": (2.58, 0.0117), "cuaternario": (2.58, 0),
    "plioceno": (5.33, 2.58), "mioceno": (23.03, 5.33), "oligoceno": (33.9, 23.03),
    "eoceno": (56.0, 33.9), "paleoceno": (66.0, 56.0), "neogeno": (23.03, 2.58),
    "paleogeno": (66.0, 23.03), "terciario": (66.0, 2.58),
    "cretacico": (145.0, 66.0), "neocomiano": (145.0, 129.4), "aptiano": (121.4, 113.0),
    "cenomaniano": (100.5, 93.9), "campaniano": (83.6, 72.1), "maastrichtiano": (72.1, 66.0),
    "jurasico": (201.4, 145.0), "triasico": (251.9, 201.4), "permico": (298.9, 251.9),
    "carbonifero": (358.9, 298.9), "devonico": (419.2, 358.9), "silurico": (443.8, 419.2),
    "ordovicico": (485.4, 443.8), "paleozoico": (538.8, 251.9), "precambrico": (1000.0, 538.8),
}
SUB = {  # subdivisiones (Inferior/Medio/Superior, alto/bajo)
    ("mioceno", "inferior"): (23.03, 15.98), ("mioceno", "medio"): (15.98, 11.63),
    ("mioceno", "superior"): (11.63, 5.33), ("eoceno", "inferior"): (56.0, 47.8),
    ("eoceno", "medio"): (47.8, 38.0), ("eoceno", "superior"): (38.0, 33.9),
    ("cretacico", "inferior"): (145.0, 100.5), ("cretacico", "superior"): (100.5, 66.0),
    ("jurasico", "inferior"): (201.4, 174.7), ("jurasico", "medio"): (174.7, 161.5),
    ("jurasico", "superior"): (161.5, 145.0), ("triasico", "inferior"): (251.9, 247.2),
    ("triasico", "medio"): (247.2, 237.0), ("triasico", "superior"): (237.0, 201.4),
    ("carbonifero", "superior"): (323.2, 298.9), ("terciario", "inferior"): (66.0, 23.03),
}
MOD2 = {("inferior", "alto"): (125.0, 100.5), ("inferior", "bajo"): (145.0, 125.0),
        ("superior", "bajo"): (100.5, 86.0), ("superior", "alto"): (86.0, 66.0)}

def sin_tildes(s):
    return (s.lower().replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o")
            .replace("ú", "u").replace("ñ", "n"))

def rango_edad(txt):
    """Devuelve (ma_ini, ma_fin) desde un texto de edad; None si no se reconoce."""
    t = sin_tildes(txt or "")
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*[-– ]\s*(\d+(?:[.,]\d+)?)\s*ma", t)
    if m:
        a, b = float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", "."))
        return (max(a, b), min(a, b))
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*ka", t)
    toks = re.findall(r"[a-z]+", t)
    terms = []
    for i, w in enumerate(toks):
        if w in EDADES:
            r = EDADES[w]
            mods = []
            for w2 in toks[i + 1:i + 3]:
                if w2 in ("inferior", "medio", "superior", "alto", "bajo"):
                    mods.append(w2)
                else:
                    break
            if mods and (w, mods[0]) in SUB:
                r = SUB[(w, mods[0])]
                if len(mods) > 1 and w == "cretacico" and (mods[0], mods[1]) in MOD2:
                    r = MOD2[(mods[0], mods[1])]
            terms.append(r)
    if not terms:
        return None
    return (max(r[0] for r in terms[:1]), min(r[1] for r in terms[-1:]))

# ---------------------------------------------------------------- colores ICS
COLOR_EPOCA = [  # (ma_hasta, color): se elige por la edad media
    (0.0117, "#FEF2E0"), (2.58, "#FFF2AE"), (5.33, "#FFF08A"), (23.03, "#F2DE4B"),  # Neógeno algo atenuado: el amarillo ICS puro satura sobre la foto
    (33.9, "#FEC07A"), (56.0, "#FDB46C"), (66.0, "#FDA75F"), (100.5, "#A6D84A"),
    (145.0, "#8CCD57"), (161.5, "#B3E3EE"), (174.7, "#80CFD8"), (201.4, "#42AED0"),
    (237.0, "#BD8CC3"), (251.9, "#983999"), (298.9, "#F04028"), (358.9, "#67A599"),
    (419.2, "#CB8C37"), (443.8, "#B3E1B6"), (485.4, "#009270"), (538.8, "#7FA056"),
    (5000, "#F74370"),
]
ROJOS_INTRUSIVOS = [  # intrusivos: gama rojo-rosada, más oscuros los más antiguos (convención de mapas chilenos)
    (23.03, "#FF9AA2"), (66.0, "#F7707D"), (145.0, "#E8485A"), (201.4, "#C9304A"),
    (298.9, "#A61E3C"), (5000, "#7E1532"),
]

def color_por(ma, tabla):
    for hasta, c in tabla:
        if ma <= hasta:
            return c
    return tabla[-1][1]

# ---------------------------------------------------------------- categorías divulgativas
def categoria(cod, comp):
    c = cod.replace(" ", "")
    if c.startswith("Q1g"): return "glaciar"
    if c in ("Qf",): return "fluvial"
    if c in ("Qm",): return "playa"
    if c in ("Qe",): return "duna"
    if c in ("MQs",): return "salar"
    if c in ("PPl1r",): return "remocion"
    if c in ("Q1", "Qa", "Qan", "Qc"): return "aluvial"
    comp = sin_tildes(comp or "")
    if "intrusiv" in comp: return "intrusiva"
    if "metamorf" in comp: return "metamorfica"
    if "volcanosed" in comp: return "volcanosedimentaria"
    if "volcanic" in comp: return "volcanica"
    if "sediment" in comp:
        if re.search(r"1m[p]?$", c): return "marina"
        if re.search(r"1l$", c): return "lacustre"
        return "sedimentaria"
    return "sininfo"

# ---------------------------------------------------------------- leyenda
leyenda = json.load(open(SRC / "leyenda.json", encoding="utf-8"))
ALIAS = {"PzTr4 a": "PzTr4", "PzTr4 b": "PzTr4", "KTg a": "KTg",
         "Q1g1": "Q1g", "Q1g2": "Q1g", "Q1g3": "Q1g", "Q1g4": "Q1g"}
EXTRA = {
    "PzTr4 a": "Esquistos pelíticos del complejo metamórfico.",
    "PzTr4 b": "Esquistos y anfibolitas; en menor proporción, rocas metamórficas ultramáficas.",
    "Q1g1": "Asociados a la glaciación Llanquihue (35.000–14.200 años).",
    "Q1g2": "Asociados a la glaciación Santa María (262.000–132.000 años).",
    "Q1g3": "Asociados a la glaciación Río Llico (480.000–338.000 años).",
    "Q1g4": "Asociados a la glaciación Caracol (687.000–512.000 años).",
}
EDAD_Q1g = {"Q1g1": (0.035, 0.0142), "Q1g2": (0.262, 0.132), "Q1g3": (0.48, 0.338), "Q1g4": (0.687, 0.512)}

def titulo_de(desc, cat):
    if not desc:
        return {"intrusiva": "Rocas intrusivas", "volcanica": "Rocas volcánicas",
                "metamorfica": "Rocas metamórficas", "sedimentaria": "Rocas sedimentarias",
                "marina": "Sedimentos marinos", "aluvial": "Depósitos no consolidados"}.get(cat, "Unidad sin descripción")
    t = re.split(r"[:;.]", desc)[0].strip()
    t = re.sub(r"\s*\(.*?\)", "", t)
    if len(t) > 64:
        t = t[:64].rsplit(" ", 1)[0] + "…"
    return t[0].upper() + t[1:]

def lugares_de(desc):
    """Parte de la descripción oficial que nombra formaciones/lugares (después de la primera oración)."""
    partes = re.split(r"(?<=[.:])\s+(?=En\s)", desc or "", maxsplit=1)
    return partes[1].strip() if len(partes) > 1 else ""

d = json.load(open(SRC / "geo1M.geojson", encoding="utf-8"))
props_por = {}
for f in d["features"]:
    p = f["properties"]
    props_por.setdefault(p["geo"], p)

unidades = {}
for cod, p in sorted(props_por.items(), key=lambda x: str(x[0])):
    base = ALIAS.get(cod, cod)
    ley = leyenda.get(base) or leyenda.get(cod) or {}
    comp = p.get("composicio") or ""
    cat = categoria(cod, comp)
    edad_txt = ley.get("edad") or (p.get("epoca") or "")
    if cod in EDAD_Q1g:
        rango = EDAD_Q1g[cod]
    elif cod == "PPl1m":
        rango = (5.33, 0.0117); edad_txt = "Plioceno-Pleistoceno"
    else:
        rango = rango_edad(edad_txt) or rango_edad(p.get("epoca") or "")
    desc = ley.get("desc", "")
    if cod in EXTRA:
        desc = (desc + " " + EXTRA[cod]).strip()
    if cod == "PPl1m" and not desc:
        desc = "Secuencias sedimentarias marinas litorales: areniscas, conglomerados y coquinas."
    sin = cat == "sininfo" or cod in ("S I", "mar", "Dg", "EM3", "Ks4", "Qc") and not ley
    if cod == "S I":  # en el mapa 1:1M son cuerpos de agua o hielo (lagos y glaciares); la app los distingue con el relieve
        cat, sin, rango, desc = "hieloagua", False, None, "Cuerpo de agua o de hielo (lago o glaciar): el mapa no asigna una unidad de roca."
    if sin and cod == "Qc":
        cat, sin = "aluvial", False
        desc = "Depósitos no consolidados (clasificación sin descripción en la leyenda digital)."
        rango = rango or (2.58, 0)
    if rango:
        media = (rango[0] + rango[1]) / 2
        color = color_por(media, ROJOS_INTRUSIVOS if cat == "intrusiva" else COLOR_EPOCA)
        if cat == "volcanica" and media < 5.33:  # volcanismo joven: tono salmón para no confundirlo con gravas del mismo color de edad
            color = "#F29A76" if media < 2.58 else "#F6B48E"
    else:
        color = "#DDEBF5" if cat == "hieloagua" else "#B8B8B8"
    unidades[cod] = {
        "cod": cod, "cat": cat, "sin": bool(sin),
        "titulo": titulo_de(desc, cat),
        "edad": re.sub(r"\s+", " ", edad_txt).strip(),
        "ma": [round(rango[0], 4), round(rango[1], 4)] if rango else None,
        "era": (p.get("era") or "").strip().capitalize(),
        "desc": desc, "lugares": lugares_de(desc), "color": color,
    }

print("unidades:", len(unidades), " sin edad:", [k for k, v in unidades.items() if not v["ma"] and not v["sin"]])
json.dump(unidades, open(OUT / "unidades.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

# ---------------------------------------------------------------- teselas de polígonos
codigos = list(unidades)
cidx = {c: i for i, c in enumerate(codigos)}

def enc_anillo(coords):
    out, px, py = [], 0, 0
    for x, y in coords:
        ix, iy = round(x * Q), round(y * Q)
        out += [ix - px, iy - py]
        px, py = ix, iy
    return out

teselas = collections.defaultdict(list)
n_poly = 0
for f in d["features"]:
    if not f["geometry"]:
        continue
    g = shape(f["geometry"])
    if not g.is_valid:
        g = g.buffer(0)
    cod = f["properties"]["geo"]
    if unidades[cod]["sin"]:
        continue  # sin información: no se dibuja
    polys = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
    for pg in polys:
        if pg.is_empty or pg.area <= 0:
            continue
        ps = pg.simplify(SIMPL, preserve_topology=True)
        if ps.is_empty or not isinstance(ps, Polygon):
            ps = pg
        try:
            lab = polylabel(pg, tolerance=0.001)
        except Exception:
            lab = pg.representative_point()
        minx, miny, maxx, maxy = ps.bounds
        rec = {"u": cidx[cod], "id": f["properties"]["FID"],
               "l": [round(lab.x * Q), round(lab.y * Q)],
               "a": round(pg.area * 1e4, 3),  # área relativa (para elegir etiquetas)
               "r": [enc_anillo(ps.exterior.coords)] + [enc_anillo(h.coords) for h in ps.interiors]}
        for ty in range(math.floor(miny / TESELA), math.floor(maxy / TESELA) + 1):
            for tx in range(math.floor(minx / TESELA), math.floor(maxx / TESELA) + 1):
                if ps.intersects(box(tx * TESELA, ty * TESELA, (tx + 1) * TESELA, (ty + 1) * TESELA)):
                    teselas[(ty, tx)].append(rec)
        n_poly += 1

total = 0
for (ty, tx), recs in teselas.items():
    nombre = f"{ty}_{tx}.json"
    s = json.dumps({"q": Q, "u": codigos, "p": recs}, separators=(",", ":"))
    (OUT / "geo" / nombre).write_text(s, encoding="utf-8")
    total += len(s)
json.dump({"tesela": TESELA, "teselas": sorted(f"{a}_{b}" for a, b in teselas)},
          open(OUT / "geo" / "index.json", "w"), separators=(",", ":"))
print(f"polígonos: {n_poly}  teselas: {len(teselas)}  total {total/1e6:.1f} MB")

# ---------------------------------------------------------------- fallas CHAF
t = (SRC / "red_fallas.kml").read_text(encoding="utf-8")
SENTIDO = {"Normal": "normal", "Reverse": "inversa", "Dextral": "de rumbo dextral",
           "Sinistral": "de rumbo sinistral"}
ACTIV = {"Proved": "comprobada", "Probable": "probable", "Possible": "posible"}
TIPO = {"observed": "observada en superficie", "inferred": "inferida", "covered": "cubierta por depósitos",
        "blind": "ciega (no llega a superficie)", "registered": "registrada"}
EDADF = {"Holocene": "Holoceno (últimos 11.700 años)", "post 50 ka": "posterior a 50.000 años",
         "Historic": "histórica (con registro escrito)", "Late Quaternary (<125 ka)": "Cuaternario tardío (menos de 125.000 años)"}
SIST = {"LOFS": "Sistema de Falla Liquiñe-Ofqui", "ATFS": "Sistema de Falla de Atacama",
        "SRFS": "Falla San Ramón", "MFFS": "Sistema de Falla Magallanes-Fagnano",
        "CFTF": "Sistema de Fallas del Cinturón Plegado y Corrido", "EWFS": "Fallas este-oeste del Norte Grande"}
RECIENTE = [("offsets holocene alluvial fans", "desplaza abanicos aluviales del Holoceno"),
            ("offsets mis 5e marine terrace", "desplaza una terraza marina de hace ~125.000 años"),
            ("offsets 7.1-ka lacustrine marker", "desplaza un nivel lacustre de hace 7.100 años"),
            ("offsets glacial valley", "desplaza un valle glaciar"),
            ("offsets glacial morphology", "desplaza formas glaciares"),
            ("offsets holocene fallout deposits", "desplaza depósitos de caída volcánica del Holoceno"),
            ("surface flexure", "genera una flexura en la superficie"),
            ("offsets colluvial deposits", "desplaza depósitos coluviales"),
            ("offsets quaternary marine deposits", "desplaza depósitos marinos cuaternarios")]

def sentido_es(s):
    if not s:
        return ""
    partes = [SENTIDO.get(x.strip(), x.strip().lower()) for x in s.split("-")]
    if len(partes) == 1:
        return partes[0]
    return f"{partes[0]} con componente {partes[1].replace('de rumbo ', '')}"

fallas = []
for pm in re.findall(r"<Placemark>(.*?)</Placemark>", t, re.S):
    at = dict(re.findall(r'<SimpleData name="(\w+)">(.*?)</SimpleData>', pm, re.S))
    at = {k: re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", v).replace("&amp;", "&").strip() for k, v in at.items()}
    lineas = []
    for cs in re.findall(r"<coordinates>(.*?)</coordinates>", pm, re.S):
        pts = [tuple(map(float, c.split(",")[:2])) for c in cs.split()]
        if len(pts) >= 2:
            ls = shape({"type": "LineString", "coordinates": pts}).simplify(0.0001)
            lineas.append(enc_anillo(ls.coords))
    if not lineas:
        continue
    rec = at.get("recent_act", "")
    for en, es in RECIENTE:
        if rec.lower().startswith(en):
            rec = es
            break
    else:
        rec = ""
    nombre = at.get("F_name") or at.get("FT_name") or ""
    fallas.append({
        "n": nombre, "t": at.get("FT_name", "") if at.get("FT_name") != nombre else "",
        "s": sentido_es(at.get("sense", "")), "act": ACTIV.get(at.get("activity", ""), ""),
        "tipo": TIPO.get(at.get("type", ""), ""), "edad": EDADF.get(at.get("age", ""), ""),
        "rec": rec, "km": round(float(at.get("length_km") or 0), 1),
        "sis": SIST.get(at.get("F_system", ""), ""), "ref": at.get("refs", ""),
        "g": lineas,
    })
json.dump({"q": Q, "f": fallas}, open(OUT / "fallas.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print("fallas:", len(fallas), f"{(OUT / 'fallas.json').stat().st_size/1e6:.2f} MB")
