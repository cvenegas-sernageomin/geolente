# Convierte .lyr de ArcMap (binario) a JSON con slyr (north-road/slyr, clonado en tools/mapas/slyr)
# uso: python tools/mapas/lyr_a_json.py mapas/*.lyr  -> mapas/salida/<nombre>.lyr.json
import sys, json, os, glob
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, 'slyr'))
from slyr_community.parser.initalize_registry import initialize_registry
from slyr_community.parser.streams.layer import LayerFile

initialize_registry()
for patron in sys.argv[1:]:
    for f in glob.glob(patron):
        with open(f, 'rb') as fh:
            d = LayerFile(fh).to_dict()
        out = os.path.join(os.path.dirname(f), 'salida', os.path.basename(f) + '.json')
        with open(out, 'w', encoding='utf-8') as fo:
            json.dump(d, fo, ensure_ascii=False, indent=1, default=str)
        print(out)
