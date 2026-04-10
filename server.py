import os
import http.server
import socketserver

port = int(os.environ.get('PORT', 8081))

class ReuseAddrServer(socketserver.TCPServer):
    allow_reuse_address = True

handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
})

with ReuseAddrServer(("", port), handler) as httpd:
    print(f"Serving HTTP on 0.0.0.0 port {port} (http://0.0.0.0:{port}/) ...", flush=True)
    httpd.serve_forever()
