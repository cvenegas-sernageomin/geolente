# Lee las capas de entidades (FeatureLayer) de un .mxd una por una con slyr, saltándose las capas de anotación
# (la versión libre de slyr no lee FDOGraphicsLayer y aborta el documento completo).
# uso: python tools/mapas/mxd_capas.py ruta.mxd salida.json
import sys, json, os, io, uuid
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, 'slyr'))
import olefile
from slyr_community.parser.initalize_registry import initialize_registry
from slyr_community.parser.stream import Stream

initialize_registry()
maps = olefile.OleFileIO(sys.argv[1]).openstream('Maps').read()
guid = uuid.UUID('e663a651-8aad-11d0-bec7-00805f7c4268').bytes_le
capas, err = [], 0
p = maps.find(guid)
while p >= 0:
    try:
        st = Stream(io.BytesIO(maps), force_layer=True, tolerant=True, extract_doc_structure=False)
        st.io_stream.seek(p)
        obj = st.read_object('capa')
        capas.append(obj.to_dict())
    except Exception as e:  # referencias a objetos definidos antes en el documento, etc.
        err += 1
        print('falló en', p, type(e).__name__, str(e)[:120])
    p = maps.find(guid, p + 16)
with open(sys.argv[2], 'w', encoding='utf-8') as fo:
    json.dump(capas, fo, ensure_ascii=False, indent=1, default=str)
print(len(capas), 'capas leídas,', err, 'fallidas →', sys.argv[2])
