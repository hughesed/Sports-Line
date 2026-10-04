#!/usr/bin/env python3
"""Local stand-in for a Supabase project's HTTP surface (TEST ONLY).
  /rest/v1/*  -> real PostgREST (127.0.0.1:3000), JWT-authenticated exactly like Supabase
  /auth/v1/*  -> minimal GoTrue-compatible mock: signup, token (password / refresh_token), user, logout
  /realtime/* -> 404 (realtime cannot run here; the page must fall back to polling)
Keys: python gateway.py --keys prints the anon / service keys."""
import json, sys, time, uuid, secrets, threading, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import jwt, psycopg2

SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"
PGRST = "http://127.0.0.1:3000"
DSN = "host=127.0.0.1 port=54329 dbname=ls user=postgres"
PORT = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 54321
def mk(role, exp=2000000000): return jwt.encode({"role": role, "iss": "supabase-local", "iat": 1700000000, "exp": exp}, SECRET, algorithm="HS256")
ANON, SERVICE = mk("anon"), mk("service_role")
REFRESH = {}
LOCK = threading.Lock()

def db():
    c = psycopg2.connect(DSN); c.autocommit = True; return c

def user_json(row):
    uid, email, meta, created = row
    return {"id": str(uid), "aud": "authenticated", "role": "authenticated", "email": email, "email_confirmed_at": created.isoformat(),
            "user_metadata": meta or {}, "app_metadata": {"provider": "email", "providers": ["email"]}, "identities": [],
            "created_at": created.isoformat(), "updated_at": created.isoformat()}

def session_for(row):
    now = int(time.time())
    at = jwt.encode({"sub": str(row[0]), "role": "authenticated", "aud": "authenticated", "email": row[1], "iat": now, "exp": now + 3600,
                     "session_id": str(uuid.uuid4()), "is_anonymous": False}, SECRET, algorithm="HS256")
    rt = secrets.token_hex(16)
    with LOCK: REFRESH[rt] = str(row[0])
    return {"access_token": at, "token_type": "bearer", "expires_in": 3600, "expires_at": now + 3600, "refresh_token": rt, "user": user_json(row)}

def err(code, msg, ec="validation_failed"):
    return code, {"code": code, "error_code": ec, "msg": msg, "error": ec, "error_description": msg, "message": msg}

def auth(method, path, q, body, hdr):
    c = db(); cur = c.cursor()
    try:
        if method == "POST" and path == "/auth/v1/signup":
            email = (body.get("email") or "").strip().lower(); pw = body.get("password") or ""
            if not email or len(pw) < 6: return err(422, "Password should be at least 6 characters.", "weak_password")
            cur.execute("select 1 from auth.users where email=%s", (email,))
            if cur.fetchone(): return err(422, "User already registered", "user_already_exists")
            cur.execute("select crypt(%s, gen_salt('bf'))", (pw,)); hpw = cur.fetchone()[0]
            cur.execute("set role supabase_auth_admin")          # like Supabase: the auth service inserts users (and fires the sign-up trigger) as this role
            try:
                cur.execute("insert into auth.users(email, encrypted_password, raw_user_meta_data) values (%s, %s, %s) returning id, email, raw_user_meta_data, created_at",
                            (email, hpw, json.dumps(body.get("data") or {})))
                row = cur.fetchone()
            except Exception as ex:
                return err(500, "Database error saving new user: " + str(ex)[:120], "unexpected_failure")
            finally:
                cur.execute("reset role")
            return 200, session_for(row)
        if method == "POST" and path == "/auth/v1/token":
            gt = q.get("grant_type")
            if gt == "password":
                cur.execute("select id, email, raw_user_meta_data, created_at from auth.users where email=%s and encrypted_password = crypt(%s, encrypted_password)",
                            ((body.get("email") or "").strip().lower(), body.get("password") or ""))
                row = cur.fetchone()
                if not row: return err(400, "Invalid login credentials", "invalid_credentials")
                return 200, session_for(row)
            if gt == "refresh_token":
                with LOCK: uid = REFRESH.pop(body.get("refresh_token") or "", None)
                if not uid: return err(400, "Invalid Refresh Token: Refresh Token Not Found", "refresh_token_not_found")
                cur.execute("select id, email, raw_user_meta_data, created_at from auth.users where id=%s", (uid,))
                return 200, session_for(cur.fetchone())
            return err(400, "unsupported grant_type")
        tok = (hdr.get("Authorization") or "").replace("Bearer ", "")
        try: claims = jwt.decode(tok, SECRET, algorithms=["HS256"], audience="authenticated")
        except Exception: return err(401, "invalid JWT", "bad_jwt")
        if method == "GET" and path == "/auth/v1/user":
            cur.execute("select id, email, raw_user_meta_data, created_at from auth.users where id=%s", (claims["sub"],))
            row = cur.fetchone()
            return (200, user_json(row)) if row else err(404, "User not found", "user_not_found")
        if method == "POST" and path == "/auth/v1/logout":
            return 204, None
        return err(404, "not found", "not_found")
    finally:
        c.close()

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", self.headers.get("Access-Control-Request-Headers") or "authorization,apikey,content-type,prefer,x-client-info,accept-profile,content-profile,range")
        self.send_header("Access-Control-Expose-Headers", "content-range,x-supabase-api-version")
    def send(self, code, body, ctype="application/json", extra=None):
        data = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        self.send_response(code); self.cors()
        for k, v in (extra or {}).items(): self.send_header(k, v)
        if data: self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data))); self.end_headers()
        if data: self.wfile.write(data)
    def do_OPTIONS(self): self.send(204, None)
    def handle_any(self, method):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) if n else b""
        path, _, qs = self.path.partition("?")
        q = dict(p.split("=", 1) if "=" in p else (p, "") for p in qs.split("&") if p)
        if not self.headers.get("apikey") and not self.headers.get("Authorization") and path.startswith(("/rest/", "/auth/")):
            return self.send(401, {"message": "No API key found in request"})
        if path.startswith("/auth/v1/"):
            try: body = json.loads(raw or b"{}")
            except Exception: body = {}
            code, out = auth(method, path, q, body, self.headers)
            return self.send(code, out)
        if path.startswith("/rest/v1/"):
            h = {k: v for k, v in self.headers.items() if k.lower() in ("authorization", "content-type", "prefer", "accept", "range", "accept-profile", "content-profile")}
            if "Authorization" not in h and "authorization" not in {k.lower() for k in h}: h["Authorization"] = "Bearer " + self.headers.get("apikey", "")
            req = urllib.request.Request(PGRST + self.path[len("/rest/v1"):], data=raw if method in ("POST", "PATCH", "PUT", "DELETE") and raw else None, method=method, headers=h)
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read(); extra = {k: v for k, v in r.headers.items() if k.lower() in ("content-range",)}
                    return self.send(r.status, data, r.headers.get("Content-Type") or "application/json", extra)
            except urllib.error.HTTPError as ex:
                return self.send(ex.code, ex.read(), ex.headers.get("Content-Type") or "application/json")
        return self.send(404, {"message": "not available locally"})
    def do_GET(self): self.handle_any("GET")
    def do_POST(self): self.handle_any("POST")
    def do_PATCH(self): self.handle_any("PATCH")
    def do_PUT(self): self.handle_any("PUT")
    def do_DELETE(self): self.handle_any("DELETE")

if __name__ == "__main__":
    if "--keys" in sys.argv: print(json.dumps({"anon": ANON, "service": SERVICE})); sys.exit(0)
    print(f"gateway on :{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
