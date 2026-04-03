import os
import http.server
import socketserver

PORT = int(os.environ.get('PORT', 8082))
Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving on http://localhost:{PORT}/", flush=True)
    httpd.serve_forever()
