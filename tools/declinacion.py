"""Grilla de declinación magnética (WMM2025 vía pygeomag) para Chile continental, 1°x1°, época 2026.75.
El navegador entrega el rumbo respecto al norte MAGNÉTICO; la app suma la declinación para llevarlo al norte geográfico."""
import json
from pathlib import Path
from pygeomag import GeoMag
g = GeoMag()
LAT0, LAT1, LON0, LON1 = -57, -17, -78, -65
grid = [[round(g.calculate(glat=la, glon=lo, alt=0, time=2026.75).d, 2) for lo in range(LON0, LON1 + 1)]
        for la in range(LAT0, LAT1 + 1)]
out = {"epoca": 2026.75, "modelo": "WMM2025", "lat0": LAT0, "lon0": LON0, "paso": 1, "d": grid}
Path(__file__).resolve().parent.parent.joinpath("data", "declinacion.json").write_text(json.dumps(out, separators=(",", ":")))
print("ok", len(grid), "x", len(grid[0]))
