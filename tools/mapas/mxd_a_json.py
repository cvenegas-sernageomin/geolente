# Convierte un .mxd de ArcMap a JSON con slyr (capas, renderers, símbolos, etiquetas)
# uso: python tools/mapas/mxd_a_json.py ruta.mxd salida.json
import sys, json, os
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, 'slyr'))
from slyr_community.parser.initalize_registry import initialize_registry
from slyr_community.parser.streams.map_document import MapDocument

initialize_registry()
with open(sys.argv[1], 'rb') as fh:
    d = MapDocument(fh, tolerant=True)
with open(sys.argv[2], 'w', encoding='utf-8') as fo:
    json.dump(d.to_dict(), fo, ensure_ascii=False, indent=1, default=str)
print(sys.argv[2], os.path.getsize(sys.argv[2]))
