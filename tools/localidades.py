"""Localidades de Chile para el buscador de GeoLente, desde GeoNames (CL.zip, CC BY 4.0).
Salida data/localidades.json: {"r": [regiones], "l": [[nombre, lat, lon, iRegión, población], ...]} ordenado por población."""
import zipfile, json
from pathlib import Path
RAIZ = Path(__file__).resolve().parent
REG = {'15': 'Arica y Parinacota', '16': 'Arica y Parinacota', '01': 'Valparaíso', '02': 'Aysén', '03': 'Antofagasta', '04': 'La Araucanía', '05': 'Atacama',
       '06': 'Biobío', '07': 'Coquimbo', '08': "O'Higgins", '10': 'Magallanes', '11': 'Maule', '12': 'Metropolitana', '14': 'Los Lagos', '17': 'Los Ríos', '18': 'Ñuble'}
REG['15'] = 'Tarapacá'
regiones = sorted(set(REG.values())); ix = {r: i for i, r in enumerate(regiones)}
filas = [l.split('\t') for l in zipfile.ZipFile(RAIZ / 'src' / 'CL.zip').open('CL.txt').read().decode('utf-8').splitlines()]
out = []
for r in filas:
    if r[6] != 'P' or r[10] not in REG: continue
    out.append([r[1], round(float(r[4]), 4), round(float(r[5]), 4), ix[REG[r[10]]], int(r[14] or 0)])
out.sort(key=lambda x: -x[4])
(RAIZ.parent / 'data' / 'localidades.json').write_text(json.dumps({'r': regiones, 'l': out}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(len(out), 'localidades;', (RAIZ.parent / 'data' / 'localidades.json').stat().st_size // 1024, 'KB')
