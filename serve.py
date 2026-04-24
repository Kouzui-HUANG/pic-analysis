#!/usr/bin/env python3
"""
Static file server with a GMI Cloud reverse-proxy prefix.

Browsers block direct calls from localhost to console.gmicloud.ai because
the GMI API does not emit CORS headers. This tiny stdlib-only proxy forwards
any request prefixed with ``/gmi-proxy/`` to ``https://console.gmicloud.ai/``
and streams the response back as same-origin, so the web app can reach the
GMI image endpoints without CORS preflight failures.

Run:
    python3 serve.py
    # serves http://localhost:3000 by default
"""

import http.server
import socketserver
import sys
import urllib.request
import urllib.error

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
# (prefix, upstream_base) pairs — longest prefix wins.
PROXY_ROUTES = [
    ("/gmi-proxy/", "https://console.gmicloud.ai/"),
    ("/storage-proxy/", "https://storage.googleapis.com/"),
]
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate",
    "proxy-authorization", "te", "trailers",
    "transfer-encoding", "upgrade", "content-length",
    "content-encoding",  # stdlib already decodes gzip/deflate for us
}


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def _proxy(self, method):
        match = None
        for prefix, upstream in PROXY_ROUTES:
            if self.path.startswith(prefix):
                match = (prefix, upstream)
                break
        if not match:
            return False
        prefix, upstream = match

        upstream_url = upstream + self.path[len(prefix):]

        body_len = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(body_len) if body_len else None

        fwd_headers = {}
        for k, v in self.headers.items():
            lk = k.lower()
            if lk in HOP_BY_HOP or lk == "host":
                continue
            fwd_headers[k] = v

        req = urllib.request.Request(
            upstream_url, data=body, method=method, headers=fwd_headers
        )

        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                self._relay(resp)
        except urllib.error.HTTPError as e:
            # Forward non-2xx responses verbatim so the browser sees
            # the real status code and body.
            self._relay(e)
        except Exception as e:
            self.send_error(502, f"Proxy error: {e}")
        return True

    def _relay(self, resp):
        self.send_response(resp.status if hasattr(resp, "status") else resp.code)
        for k, v in resp.headers.items():
            if k.lower() in HOP_BY_HOP:
                continue
            self.send_header(k, v)
        self.end_headers()
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            try:
                self.wfile.write(chunk)
            except BrokenPipeError:
                break

    def do_GET(self):
        if not self._proxy("GET"):
            super().do_GET()

    def do_POST(self):
        if not self._proxy("POST"):
            self.send_error(405)

    def do_PUT(self):
        if not self._proxy("PUT"):
            self.send_error(405)

    def do_DELETE(self):
        if not self._proxy("DELETE"):
            self.send_error(405)

    def do_OPTIONS(self):
        # Same-origin requests don't need CORS; just answer OK for any
        # preflight the browser may still send.
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()


class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with ReusableTCPServer(("", PORT), ProxyHandler) as httpd:
        routes = ", ".join(f"{p} -> {u}" for p, u in PROXY_ROUTES)
        print(f"Serving on http://localhost:{PORT} (proxies: {routes})")
        httpd.serve_forever()
