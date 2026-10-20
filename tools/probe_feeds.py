"""One-off probe (run by .github/workflows/probe.yml): FanDuel's sportsbook API page / event-page shapes per sport. Writes data/probe.json (samples only)."""
import json, gzip, urllib.request, urllib.error, time, collections, re
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
AK = "FhMFpcPWXMeyZxOx"; HOST = "sbapi.mi.sportsbook.fanduel.com"
FDH = {"Origin": "https://sportsbook.fanduel.com", "Referer": "https://sportsbook.fanduel.com/"}
OUT = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
def get(url):
    h = {"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip"}; h.update(FDH)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=15) as r:
            raw = r.read()
            if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
            return r.status, json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as ex: return ex.code, None
    except Exception as ex: return str(ex)[:100], None
def mk(d):
    att = (d or {}).get("attachments") or {}; mks = att.get("markets") or {}
    seen = {}; 
    for m in mks.values():
        t = re.sub(r"PLAYER_[A-Z]_", "PLAYER_?_", m.get("marketType") or "")
        t = re.sub(r"\d+\+", "N+", t)
        if t in seen: continue
        rs = m.get("runners") or []
        seen[t] = {"mt": m.get("marketType"), "name": m.get("marketName"), "n": len(rs), "r": [(r.get("runnerName"), r.get("handicap"), ((r.get("winRunnerOdds") or {}).get("americanDisplayOdds") or {}).get("americanOdds")) for r in rs[:3]]}
    tabs = []
    try: tabs = [t.get("title") for t in ((d.get("layout") or {}).get("tabs") or {}).values()]
    except Exception: pass
    return {"n": len(mks), "tabs": tabs, "types": seen}
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
for page in ("nfl", "nhl", "ncaaf", "college-football", "mlb", "wnba", "ncaab", "nba"):
    st, d = get(f"https://{HOST}/api/content-managed-page?page=CUSTOM&customPageId={page}&pbHorizontal=false&_ak={AK}&timezone=America%2FNew_York")
    evs = list(((d or {}).get("attachments") or {}).get("events", {}).values())
    games = [e for e in evs if " @ " in (e.get("name") or "") or " v " in (e.get("name") or "")]
    OUT[page] = {"status": st, "nEvents": len(evs), "games": [(e["eventId"], e["name"], e.get("openDate")) for e in games[:6]]}
    if page in ("nba", "college-football", "mlb", "wnba", "ncaab") or not games: continue
    eid = games[0]["eventId"]; st, d = get(f"https://{HOST}/api/event-page?_ak={AK}&eventId={eid}&useCombinedTouchdownsVirtualMarket=true&usePulse=true&useQuickBets=true")
    info = mk(d); OUT[page]["event"] = {"status": st, "tabs": info["tabs"], "default": info["types"]}
    for t in info["tabs"]:
        s = slug(t)
        if not any(k in s for k in ("player", "props", "td", "touchdown", "passing", "rushing", "receiving", "goal", "shots", "points")): continue
        st, d = get(f"https://{HOST}/api/event-page?_ak={AK}&eventId={eid}&tab={s}&useCombinedTouchdownsVirtualMarket=true&usePulse=true&useQuickBets=true")
        OUT[page]["tab:" + s] = {"status": st, **({"types": mk(d)["types"]} if d else {})}
        time.sleep(0.4)
json.dump(OUT, open("data/probe.json", "w"), indent=1, default=str)
