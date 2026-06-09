#!/usr/bin/env python3
"""
Geo3D local dev server.
Serves static files AND proxies requests so the browser can bypass CORS.
All API keys are hardcoded here — never sent to unauthenticated clients.

Routes:
  GET  /                              — password page (if not authed) or app
  POST /login                         — check password, set session cookie
  GET  /config                        — return Cesium token + Maptiler key (auth required)
  GET  /proxy?url=<encoded-url>       — image proxy for Wikimedia photos
  POST /ais-token                     — BarentsWatch OAuth2 token (uses hardcoded creds)
  GET  /ais-data?token=<bearer>       — BarentsWatch AIS latest snapshot proxy

Usage: python3 server.py
       python3 server.py 8765   (custom port)
"""

import http.server
import urllib.request
import urllib.parse
import http.cookies
import secrets
import json
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

# ── Config (edit config.json — never committed to git) ─────────────────────
_cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
with open(_cfg_path) as _f:
    _cfg = json.load(_f)
CESIUM_TOKEN    = _cfg['CESIUM_TOKEN']
MAPTILER_KEY    = _cfg['MAPTILER_KEY']
BW_CLIENT_ID    = _cfg['BW_CLIENT_ID']
BW_CLIENT_SECRET= _cfg['BW_CLIENT_SECRET']
SITE_PASSWORD   = _cfg['SITE_PASSWORD']   # set to '' to disable password protection

# ── In-memory session store ─────────────────────────────────────────────────
SESSIONS = set()

CORS_HEADERS = [
    ('Access-Control-Allow-Origin',  '*'),
    ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
    ('Access-Control-Allow-Headers', 'Content-Type, Authorization'),
]

PASSWORD_PAGE = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>GeoBed3D — Access</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #080d18; font-family: 'Inter', system-ui, sans-serif;
      color: #e2e8f0;
    }
    .card {
      background: #0b1120; border: 1px solid #1a2840; border-radius: 14px;
      padding: 2.5rem 2rem; width: 340px; text-align: center;
      box-shadow: 0 8px 40px rgba(0,0,0,.6);
    }
    .logo { font-size: 2rem; font-weight: 700; letter-spacing: -1px; margin-bottom: .5rem; }
    .logo span { color: #3b82f6; }
    .subtitle { color: #94a3b8; font-size: .85rem; margin-bottom: 2rem; }
    input[type=password] {
      width: 100%; padding: .65rem 1rem; border-radius: 8px;
      background: #0f1a2e; border: 1px solid #1a2840; color: #e2e8f0;
      font-size: .95rem; font-family: inherit; outline: none;
      transition: border-color .15s;
    }
    input[type=password]:focus { border-color: #3b82f6; }
    button {
      margin-top: .75rem; width: 100%; padding: .65rem; border-radius: 8px;
      background: #3b82f6; border: none; color: #fff; font-size: .95rem;
      font-family: inherit; font-weight: 600; cursor: pointer;
      transition: background .15s;
    }
    button:hover { background: #2563eb; }
    .err { color: #ef4444; font-size: .82rem; margin-top: .6rem; min-height: 1.1em; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">GeoBed<span>3D</span></div>
    <div class="subtitle">Enter password to access the viewer</div>
    <form method="POST" action="/login" id="f">
      <input type="password" name="password" id="pw" placeholder="Password" autofocus />
      <button type="submit">Enter</button>
      <div class="err" id="err">{{error}}</div>
    </form>
  </div>
</body>
</html>'''


class GeoHandler(http.server.SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS_HEADERS:
            self.send_header(k, v)
        self.end_headers()

    def _action(self):
        qs = urllib.parse.parse_qs(self.path.split('?')[1] if '?' in self.path else '')
        return (qs.get('a', [None])[0] or '').strip()

    def do_GET(self):
        path   = self.path.split('?')[0]
        action = self._action()

        # proxy.php?a=... style (PHP-compatible URLs)
        if path == '/proxy.php':
            if not self._check_session():
                self._serve_password_page(''); return
            if action == 'ais-data':
                self._ais_data(); return
            if action == 'img':
                self._image_proxy_query(); return
            if action in ('', None):
                self._serve_html('/index.html'); return

        if path == '/login':
            self._serve_password_page(''); return

        if not self._check_session():
            self._serve_password_page(''); return

        if self.path.startswith('/proxy?'):
            self._image_proxy()
        elif self.path.startswith('/ais-data'):
            self._ais_data()
        elif path in ('/', '/index.html', '/geojson-manual.html'):
            self._serve_html(path)
        else:
            super().do_GET()

    def do_POST(self):
        path   = self.path.split('?')[0]
        action = self._action()

        if path == '/proxy.php' and action == 'ais-token':
            if not self._check_session():
                self.send_error(401, 'Unauthorized'); return
            self._ais_token(); return

        if path == '/proxy.php':  # login form posts here
            self._login(); return

        if path == '/login':
            self._login(); return
        elif path == '/ais-token':
            if not self._check_session():
                self.send_error(401, 'Unauthorized'); return
            self._ais_token()
        else:
            self.send_error(404)

    # ── Session helpers ────────────────────────────────────────
    def _check_session(self):
        if not SITE_PASSWORD:
            return True
        cookie_header = self.headers.get('Cookie', '')
        cookies = http.cookies.SimpleCookie()
        cookies.load(cookie_header)
        token = cookies.get('geobed3d_session')
        return token is not None and token.value in SESSIONS

    def _serve_password_page(self, error):
        html = PASSWORD_PAGE.replace('{{error}}', error).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(html)))
        self.end_headers()
        self.wfile.write(html)

    # ── Login ──────────────────────────────────────────────────
    def _login(self):
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length).decode()
        params = urllib.parse.parse_qs(body)
        pw     = (params.get('password', [None])[0] or '').strip()

        if pw != SITE_PASSWORD:
            self._serve_password_page('Incorrect password.')
            return

        token = secrets.token_hex(32)
        SESSIONS.add(token)

        self.send_response(302)
        self.send_header('Location', '/')
        self.send_header('Set-Cookie',
            f'geobed3d_session={token}; HttpOnly; SameSite=Strict; Path=/')
        self.end_headers()

    # ── HTML with injected config ──────────────────────────────
    def _serve_html(self, path):
        filename = 'index.html' if path in ('/', '/index.html') else path.lstrip('/')
        try:
            with open(filename, 'rb') as f:
                content = f.read()
        except FileNotFoundError:
            self.send_error(404)
            return
        config  = json.dumps({'cesiumToken': CESIUM_TOKEN, 'maptilerKey': MAPTILER_KEY})
        inject  = f'<script>window.__GEOBED3D_CONFIG__={config};</script>'.encode()
        content = content.replace(b'</head>', inject + b'</head>')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    # ── Image proxy (proxy.php?a=img&url=...) ─────────────────
    def _image_proxy_query(self):
        params = urllib.parse.parse_qs(self.path.split('?')[1] if '?' in self.path else '')
        url    = params.get('url', [None])[0]
        if not url:
            self.send_error(400, 'Missing url parameter'); return
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; Geo3D/1.0)'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                self._send_data(resp.read(), resp.headers.get('Content-Type', 'image/png'), cache=True)
        except Exception as e:
            self.send_error(502, f'Proxy error: {e}')

    # ── Image proxy ────────────────────────────────────────────
    def _image_proxy(self):
        query  = self.path[len('/proxy?'):]
        params = urllib.parse.parse_qs(query)
        url    = params.get('url', [None])[0]
        if not url:
            self.send_error(400, 'Missing url parameter')
            return
        try:
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'Mozilla/5.0 (compatible; Geo3D/1.0)'},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
                ct   = resp.headers.get('Content-Type', 'image/png')
                self._send_data(data, ct, cache=True)
        except Exception as e:
            self.send_error(502, f'Proxy error: {e}')

    # ── BarentsWatch OAuth2 token proxy ────────────────────────
    def _ais_token(self):
        token_body = urllib.parse.urlencode({
            'grant_type':    'client_credentials',
            'client_id':     BW_CLIENT_ID,
            'client_secret': BW_CLIENT_SECRET,
            'scope':         'ais',
        }).encode()
        try:
            req = urllib.request.Request(
                'https://id.barentswatch.no/connect/token',
                data=token_body,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                self._send_data(data, 'application/json')
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            for k, v in CORS_HEADERS:
                self.send_header(k, v)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_error(502, f'Token proxy error: {e}')

    # ── BarentsWatch AIS data proxy ────────────────────────────
    def _ais_data(self):
        params = urllib.parse.parse_qs(self.path[self.path.find('?')+1:] if '?' in self.path else '')
        token  = (params.get('token', [None])[0] or '').strip()
        if not token:
            self.send_error(400, 'Missing token parameter')
            return
        try:
            req = urllib.request.Request(
                'https://live.ais.barentswatch.no/live/v1/latest/combined',
                headers={'Authorization': f'Bearer {token}'},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
                self._send_data(data, 'application/json')
        except urllib.error.HTTPError as e:
            self.send_error(e.code, f'AIS upstream error: {e.reason}')
        except Exception as e:
            self.send_error(502, f'AIS proxy error: {e}')

    # ── Helper ─────────────────────────────────────────────────
    def _send_data(self, data, ct, cache=False):
        self.send_response(200)
        self.send_header('Content-Type', ct)
        for k, v in CORS_HEADERS:
            self.send_header(k, v)
        if cache:
            self.send_header('Cache-Control', 'public, max-age=86400')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if args and str(args[1]) not in ('200', '304', '302'):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('', PORT), GeoHandler)
    print(f'Geo3D running → http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
