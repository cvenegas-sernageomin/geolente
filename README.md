# GeoLente — ¿de qué está hecho ese cerro?

PWA de realidad aumentada para público general: apuntas el teléfono a los cerros y ves encima el
Mapa Geológico de Chile 1:1.000.000 (SERNAGEOMIN) y las fallas activas (CHAF), con etiquetas y fichas
divulgativas (edad, qué es, cómo reconocerla, dato curioso, contexto del mundo en esa época).

## Cómo funciona
- **Posición**: GPS del teléfono; la altura se toma del relieve (no del GPS) + 1,7 m.
- **Orientación**: `deviceorientationabsolute` (Android) o `webkitCompassHeading` (iPhone) + declinación
  magnética WMM2025 precalculada para Chile (`data/declinacion.json`). El usuario puede corregir con 🎯 Ajustar
  (arrastrar = rumbo/inclinación, pellizcar = campo visual). El ajuste queda guardado en el teléfono.
- **Relieve**: teselas Terrarium (AWS Open Data) z10–12 según el alcance, con curvatura terrestre y refracción.
- **Mapa sobre el cerro**: el mapa se pinta en una textura y se "drapea" sobre una malla del relieve (más densa
  cerca del observador). Pasada previa de profundidad para que solo se coloree la superficie más cercana.
- **Etiquetas**: grilla de candidatos + punto interior de cada polígono; se muestran las unidades con más
  superficie visible (con prueba de visibilidad contra el relieve) y hasta 3 fallas (una por nombre).
- **Perfil de los cerros** (estilo PeakVisor): por cada azimut (0,1°) se marcha por el relieve buscando las crestas
  que tapan lo de atrás (≥25 m bajo la visual), se unen entre azimuts vecinos y se descartan cadenas cortas. Se
  ignoran los primeros 200 m (el DEM cercano taparía todo). Sirve para calzar con 🎯 Ajustar.
- **Cumbres**: OpenStreetMap (ODbL, `tools/cumbres_osm.py`) + GeoNames (CC BY 4.0) donde OSM no tiene + volcanes a mano,
  combinados con `tools/combinar_cumbres.py`; en la app
  cada cumbre se ajusta al punto más alto del relieve cercano porque las coordenadas de GeoNames pueden estar corridas.
- **Mira central**: raycast sobre el relieve → unidad y distancia del punto al que apuntas.
- **Modo explorar** (sin cámara): arrastrar para mirar, útil en escritorio y para probar. `?sim=lat,lon,rumbo`.
- Lagos y glaciares ("S I" en el mapa 1:1M) se distinguen por el relieve: plano = lago.

## Datos (`tools/`)
- `tools/preparar_datos.py`: fuentes en `tools/src/` → `data/unidades.json`, `data/geo/*.json` (teselas de 0,5°,
  coordenadas enteras 1e-4° con delta), `data/fallas.json`.
- `tools/declinacion.py`: grilla de declinación (requiere `pygeomag`).
- Fuentes: Mapa Geológico de Chile 1:1.000.000 (SERNAGEOMIN 2003; copia pública en ArcGIS Online),
  leyenda oficial extraída del PDF "Mapa Geológico de Chile: versión digital"; CHAF v1 (Melnick, Maldonado y
  Contreras 2020, PANGAEA, CC BY 4.0).

## Probar en local
`python -m http.server 8790` y abrir `http://localhost:8790/?sim=-33.4255,-70.6335,95`.
La cámara y los sensores exigen **https** (o localhost): para probar en el teléfono hay que publicarla.

## Pendiente / límites
- Probar en teléfonos reales (Android e iPhone): calce de la brújula, campo visual por defecto (68°), rendimiento.
- Escala 1:1.000.000: los límites pueden estar corridos cientos de metros. Integrar cartas 1:100.000 donde existan.
