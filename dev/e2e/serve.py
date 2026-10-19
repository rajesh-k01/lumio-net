import http.server, socketserver, sys, os, mimetypes, urllib.request
mimetypes.add_type("text/javascript", ".mjs"); mimetypes.add_type("application/wasm", ".wasm"); mimetypes.add_type("application/octet-stream", ".onnx")
root = sys.argv[1]; port = int(sys.argv[2]); backend = sys.argv[3] if len(sys.argv) > 3 else None
os.chdir(root)
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def proxy(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        req = urllib.request.Request(backend + self.path, data=body, method=self.command, headers={k: v for k, v in self.headers.items() if k.lower() in ("content-type",)})
        try: r = urllib.request.urlopen(req, timeout=300); code = r.status
        except urllib.error.HTTPError as e: r = e; code = e.code
        data = r.read(); self.send_response(code)
        for k, v in r.headers.items():
            if k.lower() in ("content-type", "x-engine", "x-output-size"): self.send_header(k, v)
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        if backend and self.path.startswith("/api/"): return self.proxy()
        self.send_error(404)
    def do_GET(self):
        if backend and self.path.startswith("/api/"): return self.proxy()
        return super().do_GET()
socketserver.TCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(("127.0.0.1", port), H).serve_forever()
