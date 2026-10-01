# Servidor local para leer la gdb con gdal3.js en el navegador: sirve el repo y acepta PUT en mapas/salida/
import http.server, os, sys
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, 'mapas', 'salida')
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=RAIZ, **k)
    def do_PUT(s):
        nombre = os.path.basename(s.path.split('?')[0])
        n = int(s.headers['Content-Length'])
        with open(os.path.join(SALIDA, nombre), 'wb') as f:
            while n > 0:
                b = s.rfile.read(min(n, 1 << 20)); f.write(b); n -= len(b)
        s.send_response(201); s.end_headers()
    def end_headers(s):
        s.send_header('Cache-Control', 'no-store')  # el puerto lo usan otros proyectos: sin caché HTTP
        super().end_headers()
    def log_message(s, *a): pass
os.makedirs(SALIDA, exist_ok=True)
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8766), H).serve_forever()
