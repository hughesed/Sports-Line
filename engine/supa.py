"""Tiny Supabase REST client for the bot (stdlib only). Used only when SUPABASE_URL and SUPABASE_SERVICE_KEY are set.
The service role key is a secret: it lives in a GitHub Actions secret and is never written to data/ or printed."""
import json, os, time, urllib.request, urllib.error

URL = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
STATS = {"calls": 0, "fails": 0, "seconds": 0.0}
STOP_AT = None          # epoch seconds after which no new call is started (keeps the run inside its time budget)

def enabled():
    return bool(URL and KEY)

def _req(method, path, body=None, headers=None, timeout=8):
    if STOP_AT is not None and time.time() > STOP_AT:
        raise TimeoutError("run time budget used up; skipped " + path.split("?")[0])
    h = {"apikey": KEY, "Content-Type": "application/json", "Accept": "application/json"}
    if not KEY.startswith("sb_"): h["Authorization"] = "Bearer " + KEY      # legacy JWT keys; new "sb_secret_..." keys go in the apikey header only
    if headers: h.update(headers)
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    t0 = time.time(); STATS["calls"] += 1
    try:
        req = urllib.request.Request(URL + path, data=data, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8") or "null"
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as ex:
        STATS["fails"] += 1
        try: msg = json.loads(ex.read().decode("utf-8")).get("message")
        except Exception: msg = ""
        raise RuntimeError(f"HTTP {ex.code} on {path.split('?')[0]}: {msg}"[:300])
    except Exception:
        STATS["fails"] += 1
        raise
    finally:
        STATS["seconds"] += time.time() - t0

def rpc(name, args=None, timeout=10):
    return _req("POST", "/rest/v1/rpc/" + name, args or {}, timeout=timeout)

def upsert(table, rows, on_conflict, timeout=6):
    if not rows: return 0
    _req("POST", f"/rest/v1/{table}?on_conflict={on_conflict}", rows,
         headers={"Prefer": "resolution=merge-duplicates,return=minimal"}, timeout=timeout)
    return len(rows)

def delete(table, query, timeout=6):
    return _req("DELETE", f"/rest/v1/{table}?{query}", None, headers={"Prefer": "return=minimal"}, timeout=timeout)
