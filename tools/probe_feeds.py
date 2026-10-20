"""One-off probe (run by .github/workflows/probe.yml): can the refresh runner reach FanDuel's public sportsbook API and ESPN's
multi-season game logs, and what do the responses look like? Writes data/probe.json (structure samples only)."""
import json, gzip, urllib.request, urllib.error, time, collections
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
AK = "FhMFpcPWXMeyZxOx"
OUT = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "fd": {}, "espn": {}}

def get(url, hdr=None):
    h = {"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip"}
    h.update(hdr or {})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=15) as r:
            raw = r.read()
            if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
            try: return r.status, json.loads(raw.decode("utf-8")), None
            except Exception: return r.status, None, raw[:300].decode("utf-8", "replace")
    except urllib.error.HTTPError as ex:
        return ex.code, None, ex.read()[:300].decode("utf-8", "replace")
    except Exception as ex:
        return None, None, f"{type(ex).__name__}: {ex}"[:300]

FDH = {"Origin": "https://sportsbook.fanduel.com", "Referer": "https://sportsbook.fanduel.com/"}
def mk_summary(d, nmk=60):
    att = (d or {}).get("attachments") or {}
    evs = att.get("events") or {}; mks = att.get("markets") or {}
    out = {"keys": list((d or {}).keys())[:20], "attKeys": list(att.keys())[:20], "nEvents": len(evs), "nMarkets": len(mks),
           "events": [{k: e.get(k) for k in ("eventId", "name", "openDate", "competitionId", "eventTypeId")} for e in list(evs.values())[:40]],
           "marketTypes": collections.Counter(m.get("marketType") for m in mks.values()).most_common(120), "markets": []}
    for m in list(mks.values())[:nmk]:
        rs = m.get("runners") or []
        out["markets"].append({"marketId": m.get("marketId"), "eventId": m.get("eventId"), "marketType": m.get("marketType"), "marketName": m.get("marketName"),
                               "status": m.get("marketStatus"), "nRunners": len(rs), "keys": list(m.keys())[:30],
                               "runners": [{k: r.get(k) for k in ("selectionId", "runnerName", "handicap", "runnerStatus", "winRunnerOdds", "result")} for r in rs[:6]],
                               "runnerKeys": list(rs[0].keys())[:30] if rs else []})
    if (d or {}).get("layout"):
        lay = d["layout"]; out["layoutKeys"] = list(lay.keys())[:20]
        try: out["tabs"] = [{k: t.get(k) for k in ("title", "id", "name")} for t in (lay.get("tabs") or {}).values()][:40]
        except Exception: pass
    return out

ev_id = None
for host in ("sbapi.mi.sportsbook.fanduel.com", "sbapi.nj.sportsbook.fanduel.com", "api.sportsbook.fanduel.com"):
    url = f"https://{host}/api/content-managed-page?page=CUSTOM&customPageId=nba&pbHorizontal=false&_ak={AK}&timezone=America%2FNew_York"
    st, d, err = get(url, FDH)
    OUT["fd"][host] = {"status": st, "err": err, "summary": mk_summary(d) if d else None}
    if d and not ev_id:
        for e in ((d.get("attachments") or {}).get("events") or {}).values():
            if "Celtics" in (e.get("name") or "") or "Pistons" in (e.get("name") or ""): ev_id = e.get("eventId")
        if not ev_id:
            evs = list(((d.get("attachments") or {}).get("events") or {}).values())
            if evs: ev_id = evs[0].get("eventId")
        OUT["fd"]["host_ok"] = host
OUT["fd"]["eventId"] = ev_id
if ev_id:
    host = OUT["fd"]["host_ok"]
    for tab in ("", "popular", "player-points", "player-threes", "player-rebounds", "player-assists", "player-combos", "player-props"):
        url = f"https://{host}/api/event-page?_ak={AK}&eventId={ev_id}" + (f"&tab={tab}" if tab else "") + "&useCombinedTouchdownsVirtualMarket=true&usePulse=true&useQuickBets=true"
        st, d, err = get(url, FDH)
        OUT["fd"]["event:" + (tab or "default")] = {"status": st, "err": err, "summary": mk_summary(d, 40) if d else None}
        time.sleep(0.5)
    # NFL page too (football ladders)
    st, d, err = get(f"https://{host}/api/content-managed-page?page=CUSTOM&customPageId=nfl&pbHorizontal=false&_ak={AK}&timezone=America%2FNew_York", FDH)
    OUT["fd"]["nfl_page"] = {"status": st, "err": err, "summary": mk_summary(d, 10) if d else None}

def gl_summary(d):
    if not d: return None
    out = {"keys": list(d.keys())[:20], "names": d.get("names"), "seasonTypes": []}
    for s in d.get("seasonTypes", []):
        out["seasonTypes"].append({"displayName": s.get("displayName"), "year": s.get("year"), "cats": [(c.get("type"), c.get("displayName"), len(c.get("events", []))) for c in s.get("categories", [])]})
    out["filters"] = d.get("filters")
    out["nEvents"] = len(d.get("events") or {})
    return out
for aid, nm in (("4065648", "Tatum"), ("3157465", "Robinson"), ("4432166", "Cunningham")):
    for q in ("", "?season=2026", "?season=2026&seasontype=3"):
        st, d, err = get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{aid}/gamelog{q}")
        OUT["espn"][nm + q] = {"status": st, "err": err, "summary": gl_summary(d)}
st, d, err = get("https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909088/competitions/401909088/odds/100/propBets?limit=400")
OUT["espn"]["nbaProps"] = {"status": st, "err": err, "count": (d or {}).get("count"), "types": collections.Counter(((i.get("type") or {}).get("name")) for i in (d or {}).get("items", [])).most_common(40)}
st, d, err = get("https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909088/competitions/401909088/odds")
OUT["espn"]["nbaOdds"] = {"status": st, "err": err, "providers": [((i.get("provider") or {}).get("name"), (i.get("provider") or {}).get("id")) for i in (d or {}).get("items", [])]}
json.dump(OUT, open("data/probe.json", "w"), indent=1, default=str)
print(json.dumps({k: (v.get("status") if isinstance(v, dict) else v) for k, v in OUT["fd"].items()}, indent=1))
