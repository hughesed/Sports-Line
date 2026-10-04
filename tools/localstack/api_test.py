#!/usr/bin/env python3
"""API-level test of supabase/setup.sql through real PostgREST + the local auth mock (gateway.py), as anon / users / service role.
Needs the local stack (up.sh). Uses the fake clock in ls_private.settings to jump in time (midnight, timeouts, game end)."""
import json, os, sys, time, uuid, datetime, subprocess
import requests, psycopg2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gateway import ANON, SERVICE

BASE = os.environ.get("SB_URL", "http://127.0.0.1:54321")
DSN = "host=127.0.0.1 port=54329 dbname=ls user=postgres"
RES = []
def check(name, cond, extra=""):
    RES.append((bool(cond), name)); print(("PASS " if cond else "FAIL ") + name + ((" - " + str(extra)[:300]) if extra not in ("", None) else ""), flush=True)

def sql(q, args=None, one=False):
    c = psycopg2.connect(DSN); c.autocommit = True; cur = c.cursor(); cur.execute(q, args)
    try: r = cur.fetchall()
    except Exception: r = None
    c.close()
    return (r[0][0] if r else None) if one else r
def clock(ts):   # None = real time
    sql("update ls_private.settings set fake_now = %s where id = 1", (ts,))
def now_db(): return sql("select public.app_now()", one=True)

class Client:
    def __init__(self, token=ANON): self.token = token; self.uid = None; self.name = None
    def h(self): return {"apikey": ANON, "Authorization": "Bearer " + self.token, "Content-Type": "application/json"}
    def rpc(self, fn, **args):
        r = requests.post(f"{BASE}/rest/v1/rpc/{fn}", headers=self.h(), data=json.dumps(args))
        try: body = r.json()
        except Exception: body = r.text
        return r.status_code, body
    def ok(self, fn, **args):
        s, b = self.rpc(fn, **args)
        if s >= 300: raise AssertionError(f"{fn} failed {s}: {b}")
        return b
    def get(self, path):
        r = requests.get(f"{BASE}/rest/v1/{path}", headers=self.h()); return r.status_code, (r.json() if r.text else None)
    def raw(self, method, path, body=None, extra=None):
        h = self.h(); h.update(extra or {})
        r = requests.request(method, f"{BASE}/rest/v1/{path}", headers=h, data=json.dumps(body) if body is not None else None)
        return r.status_code, r.text

def signup(email, pw, username):
    r = requests.post(f"{BASE}/auth/v1/signup", headers={"apikey": ANON, "Content-Type": "application/json"}, data=json.dumps({"email": email, "password": pw, "data": {"username": username}}))
    j = r.json(); c = Client(j["access_token"]); c.uid = j["user"]["id"]; c.name = username; return c
def signin(email, pw):
    r = requests.post(f"{BASE}/auth/v1/token?grant_type=password", headers={"apikey": ANON, "Content-Type": "application/json"}, data=json.dumps({"email": email, "password": pw}))
    return r.status_code, r.json()

def bal(c): return float(sql("select balance from public.profiles where id = %s", (c.uid,), one=True))

def main():
    clock(None)
    tag = uuid.uuid4().hex[:5]
    anon = Client(); svc = Client(SERVICE)
    # ------------------------------------------------------------ accounts
    check("username_available: valid free name", anon.ok("username_available", p_name="alice_" + tag) is True)
    check("username_available: rejects bad characters / length", anon.ok("username_available", p_name="a!") is False and anon.ok("username_available", p_name="x" * 19) is False)
    A = signup(f"a{tag}@x.test", "secret1", "Alice_" + tag); B = signup(f"b{tag}@x.test", "secret1", "Bob_" + tag)
    C = signup(f"c{tag}@x.test", "secret1", "Cara_" + tag); D = signup(f"d{tag}@x.test", "secret1", "Dan_" + tag)
    check("sign-up creates a profile with 1,000 coins", all(bal(x) == 1000 for x in (A, B, C, D)), [bal(x) for x in (A, B, C, D)])
    check("ledger has the welcome coins", sql("select count(*) from public.ledger where user_id = %s and kind = 'signup' and amount = 1000", (A.uid,), one=True) == 1)
    s, j = signin(f"a{tag}@x.test", "secret1"); check("sign in with email + password", s == 200 and j.get("access_token"))
    s, j = signin(f"a{tag}@x.test", "wrong"); check("wrong password is refused", s == 400)
    E = signup(f"e{tag}@x.test", "secret1", "alice_" + tag.upper())          # same name, different case -> no profile from the trigger
    check("duplicate username (case-insensitive) does not get a profile", sql("select count(*) from public.profiles where id = %s", (E.uid,), one=True) == 0)
    s, b = E.rpc("claim_username", p_name="ALICE_" + tag); check("claim_username refuses a taken name", s >= 400 and "taken" in json.dumps(b), b)
    E.ok("claim_username", p_name="Eve_" + tag); check("claim_username with a free name creates the profile (1,000 coins)", bal(E) == 1000)
    check("emails are not exposed (profiles has no email column)", "email" not in json.dumps(anon.get("profiles?select=*&limit=1")[1]))

    # ------------------------------------------------------------ security: tables are read-only, functions gated
    s, t = A.raw("PATCH", f"profiles?id=eq.{A.uid}", {"balance": 999999}); check("user cannot UPDATE own balance directly", s in (401, 403) or bal(A) == 1000, (s, t[:120]))
    check("balance unchanged after the attempt", bal(A) == 1000)
    s, t = A.raw("POST", "badges", {"user_id": A.uid, "kind": "champion", "day": "2026-01-01"}); check("user cannot INSERT a badge", s in (401, 403), (s, t[:120]))
    s, t = A.raw("POST", "ledger", {"user_id": A.uid, "kind": "x", "amount": 5, "balance_after": 5}); check("user cannot write the ledger", s in (401, 403), (s, t[:120]))
    s, t = A.raw("PATCH", f"battle_stats?user_id=eq.{A.uid}", {"elo": 3000}); check("user cannot change battle stats", s in (401, 403), s)
    s, t = A.raw("DELETE", f"profiles?id=eq.{B.uid}"); check("user cannot delete profiles", s in (401, 403), s)
    s, b = A.rpc("bot_settle_games", p=[]); check("bot-only settle function is not callable by users", s in (401, 403, 404), s)
    s, b = anon.rpc("bot_pending_games"); check("bot-only functions not callable anonymously", s in (401, 403, 404), s)
    s, b = svc.rpc("bot_pending_games"); check("service role can call bot functions", s == 200, b)
    s, b = A.rpc("move_coins", p_user=A.uid, p_amount=5000, p_kind="x", p_ref="x"); check("internal coin function is not exposed", s >= 400, s)
    s, _ = A.get(f"ledger?user_id=eq.{B.uid}&select=*"); check("ledger rows of other users are invisible", s == 200 and _ == [], _)
    s, _ = anon.get("chat_messages?select=*"); check("chat is not readable signed out", s in (401, 403) or _ == [], (s, _))

    # ------------------------------------------------------------ real-game bets (games row uploaded by the bot)
    start = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)).replace(microsecond=0)
    gid = "T" + tag
    game = dict(gid=gid, lg="nfl", key="nfl", start_at=start.isoformat(), home="KC", away="BUF", title="Bills at Chiefs",
                lines=dict(mlHome=-150, mlAway=130, sprHome=-3.5, sprAway=3.5, prHome=-110, prAway=-110, total=47.5, over=-110, under=-110),
                props={"p1": {"name": "Patrick Mahomes", "side": "home", "status": {"kind": "ok"}, "stats": {"passYds": {"label": "Pass yds", "line": 265.5, "overPrice": -115, "safeAdj": 200, "safePrice": -600, "matchup": 0.05,
                        "miles": [{"t": 250, "price": None, "hit": 9, "n": 15}, {"t": 300, "price": 210, "hit": 4, "n": 15}]}}},
                       "p2": {"name": "Travis Kelce Jr.", "side": "home", "status": {"kind": "out"}, "stats": {"rec": {"label": "Receptions", "line": 5.5, "overPrice": 100, "matchup": 0, "miles": []}}}})
    r = requests.post(f"{BASE}/rest/v1/games?on_conflict=gid", headers={**svc.h(), "Prefer": "resolution=merge-duplicates,return=minimal"}, data=json.dumps([game]))
    check("service role upserts games (bot path)", r.status_code in (200, 201, 204), r.text[:200])
    s, t = A.raw("POST", "games", dict(game, gid="X" + tag)); check("users cannot write games", s in (401, 403), s)
    bet = A.ok("place_bet", p_legs=[f"g:{gid}:ml:home", {"tok": f"g:{gid}:tot:over", "price": 900}], p_stake=100, p_mode="parlay", p_boost="dk20")
    lg = {l["tok"]: l for l in bet["legs"]}
    check("place_bet: server prices the legs (client price 900 ignored)", lg[f"g:{gid}:tot:over"]["price"] == -110 and lg[f"g:{gid}:ml:home"]["price"] == -150, bet["legs"])
    check("place_bet: stake deducted atomically", bal(A) == 900, bal(A))
    check("place_bet: boost applied by server rules", (bet.get("boost") or {}).get("pct") == 20, bet.get("boost"))
    check("place_bet: labels match the page", lg[f"g:{gid}:ml:home"]["label"] == "KC moneyline" and lg[f"g:{gid}:tot:over"]["label"] == "Over 47.5")
    s, b = A.rpc("place_bet", p_legs=[f"p:{gid}:p1:passYds:over", f"p:{gid}:p1:passYds:m:250"], p_stake=10, p_mode="single")
    check("two lines of one player stat in one slip are refused (the page swaps them too)", s >= 400, b)
    sb = A.ok("place_bet", p_legs=[f"g:{gid}:spr:home", f"p:{gid}:p1:passYds:m:250"], p_stake=10, p_mode="single")
    check("singles mode makes one slip per leg (cost = stake x legs)", len(sb["bets"]) == 2 and bal(A) == 880, (sb["bets"], bal(A)))
    m250 = [l for l in sb["legs"] if l["tok"].endswith(":m:250")][0]
    check("milestone without a book price uses estPrice (same as the page)", m250["price"] == -170 and m250["label"] == "Mahomes 250+ pass yds" and m250["spec"]["T"] == 250, m250)
    s, b = A.rpc("place_bet", p_legs=[f"g:{gid}:ml:home"], p_stake=-5); check("negative stake is refused", s >= 400 and bal(A) == 880, b)
    s, b = A.rpc("place_bet", p_legs=[f"g:{gid}:ml:home"], p_stake=5000); check("stake above balance is refused", s >= 400 and "Not enough" in json.dumps(b), b)
    s, b = A.rpc("place_bet", p_legs=[f"g:{gid}:ml:home", f"g:{gid}:ml:away"], p_stake=5); check("two legs from one market are refused", s >= 400, b)
    s, b = anon.rpc("place_bet", p_legs=[f"g:{gid}:ml:home"], p_stake=5); check("signed-out betting is refused", s >= 400, b)
    s, b = A.rpc("place_bet", p_legs=[{"tok": f"l:{gid}:ml:home", "price": 150, "label": "KC to win (live)"}], p_stake=5)
    check("live legs are refused before the game window", s >= 400 and "closed" in json.dumps(b), b)
    clock((start + datetime.timedelta(minutes=30)).isoformat())
    s, b = A.rpc("place_bet", p_legs=[f"g:{gid}:spr:home"], p_stake=5); check("pregame bet after kickoff is refused", s >= 400 and "started" in json.dumps(b), b)
    s, b = A.rpc("place_bet", p_legs=[{"tok": f"l:{gid}:ml:home", "price": 900, "label": "x"}], p_stake=5); check("live price above the +400 cap is refused", s >= 400, b)
    lb = A.ok("place_bet", p_legs=[{"tok": f"l:{gid}:ml:away", "price": 160, "label": "<b>BUF</b> to win (live)"}, {"tok": f"l:{gid}:p:p2:rec:ge:4", "price": -200, "label": "Kelce 4+ rec (live)"}], p_stake=20)
    check("live parlay accepted in the live window, label sanitized", bal(A) == 860 and "<" not in lb["legs"][0]["label"], (bal(A), lb["legs"][0]["label"]))
    s, b = svc.rpc("bot_pending_games"); check("bot sees the game with open legs", s == 200 and any(x["gid"] == gid and x["props"] for x in b), b)
    # bot settles: KC 27, BUF 21; Mahomes 280 yds; Kelce (status out) not in the box score -> void
    fin = {"gid": gid, "home": 27, "away": 21, "played": {"p1": True}, "stat": {"p1": {"passYds": 280, "pr": 290}}}
    out = svc.ok("bot_settle_games", p=[fin])
    rows = sql("select b.id, b.status, b.payout from public.bets b where b.user_id = %s order by b.id", (A.uid,))
    st = {r[0]: (r[1], float(r[2])) for r in rows}
    exp_parlay = round(100 * (1 + (1.6667 * 1.9091 - 1) * 1.2), 2)
    p_id = bet["bets"][0]
    check("parlay won with the boost applied at settlement", st[p_id][0] == "won" and abs(st[p_id][1] - exp_parlay) < 0.1, (st[p_id], exp_parlay))
    check("both singles graded (KC -3.5 won, 250+ won)", all(st[i][0] == "won" for i in sb["bets"]), [st[i] for i in sb["bets"]])
    lid = lb["bets"][0]
    check("live parlay: losing ML leg loses the slip", st[lid][0] == "lost", st[lid])
    kel = sql("select res from public.bet_legs where bet_id = %s and tok like %s", (lid, "%p2%"), one=True)
    check("prop on a player who did not play (ruled out) is void", kel == "V", kel)
    expect_bal = 860 + st[p_id][1] + st[sb["bets"][0]][1] + st[sb["bets"][1]][1]
    check("payouts credited to the balance", abs(bal(A) - expect_bal) < 0.01, (bal(A), expect_bal))
    net = float(sql("select net from public.daily_stats where user_id = %s and day = %s", (A.uid, sql("select ls_private.today()", one=True)), one=True))
    check("daily net = profit of settled slips on the settle day", abs(net - (st[p_id][1] - 100 + st[sb["bets"][0]][1] - 10 + st[sb["bets"][1]][1] - 10 - 20)) < 0.01, net)
    out2 = svc.ok("bot_settle_games", p=[fin]); check("settling again changes nothing (idempotent)", out2["legs"] == 0 and abs(bal(A) - expect_bal) < 0.01, out2)
    s, b = A.rpc("place_bet", p_legs=[{"tok": f"l:{gid}:ml:home", "price": 150, "label": "x"}], p_stake=5); check("no bets on a final game", s >= 400, b)
    tot = float(sql("select sum(amount) from public.ledger where user_id = %s", (A.uid,), one=True))
    check("ledger sums to the balance (auditable)", abs(tot - bal(A)) < 0.01, (tot, bal(A)))
    clock(None)

    # ------------------------------------------------------------ chat + mentions
    s, b = A.rpc("send_chat", p_body=f"hey @{B.name} and @{C.name.lower()} and @nobody_{tag} \x07 <script>x</script>")
    check("chat send works", s == 200, b)
    msg = sql("select body from public.chat_messages where id = %s", (b["id"],), one=True)
    check("control characters are stripped (text kept as plain text, escaped by the page)", "\x07" not in msg and "<script>" in msg, msg)
    s, b2 = A.rpc("send_chat", p_body="again"); check("rate limit: 1 message per 2 s", s >= 400 and "Slow down" in json.dumps(b2), b2)
    time.sleep(2.1)
    s, b3 = A.rpc("send_chat", p_body="x" * 501); check("501 characters refused", s >= 400, b3)
    s, b3 = A.rpc("send_chat", p_body="pic", p_img="data:image/svg+xml;base64,PHN2Zz4="); check("SVG (script-capable) image refused", s >= 400, b3)
    s, b3 = A.rpc("send_chat", p_body="pic", p_img="data:image/png;base64," + "A" * 130000); check("image over 120 KB refused", s >= 400, b3)
    ms = sql("select user_id from public.mentions where msg_id = %s", (b["id"],))
    check("mentions recorded only for existing usernames", sorted(str(x[0]) for x in ms) == sorted([B.uid, C.uid]), ms)
    s, mm = B.get("mentions?select=*"); check("a user reads only their own mentions", s == 200 and len(mm) == 1 and mm[0]["from_name"] == A.name, mm)
    s, b4 = B.rpc("delete_chat", p_id=b["id"]); check("cannot delete someone else's message", s >= 400, b4)
    A.ok("delete_chat", p_id=b["id"]); check("delete own message", sql("select deleted from public.chat_messages where id = %s", (b["id"],), one=True) is True)
    s, cm = B.get("chat_messages?select=id,username,body&order=id.desc&limit=5"); check("signed-in users read chat", s == 200 and len(cm) >= 1, cm)
    time.sleep(2.1); B.ok("send_chat", p_body=f"@{C.name} gg")

    # ------------------------------------------------------------ battle
    mk = anon.ok("battle_markets", p_sport="nfl", p_home="KC", p_away="BUF")
    check("battle markets: ML, spread, total and 30+ props, 8+ players per team", all(k in mk for k in ("ml", "spr", "tot")) and len(mk["props"]) >= 30 and min(sum(1 for p in mk["players"] if p["side"] == sd) for sd in ("home", "away")) >= 8, (len(mk["props"]), len(mk["players"])))
    a0 = bal(A)
    bt = A.ok("create_battle", p_sport="nfl", p_home="KC", p_away="BUF", p_wager=100, p_side="home"); bid = bt["id"]
    check("create battle escrows the wager", abs(bal(A) - (a0 - 100)) < 0.01)
    s, x = A.rpc("accept_battle", p_id=bid); check("self-accept refused", s >= 400 and "own" in json.dumps(x), x)
    s, x = C.rpc("place_spectator_bet", p_id=bid, p_tok="win:creator", p_stake=10); check("winner market closed until accepted", s >= 400, x)
    C.ok("place_spectator_bet", p_id=bid, p_tok="ml:home", p_stake=50)
    b0 = bal(B); B.ok("accept_battle", p_id=bid)
    s, x = D.rpc("accept_battle", p_id=bid); check("double-accept refused", s >= 400 and "no longer open" in json.dumps(x), x)
    check("accept escrows the matching wager", abs(bal(B) - (b0 - 100)) < 0.01)
    s, x = A.rpc("place_spectator_bet", p_id=bid, p_tok="ml:home", p_stake=10); check("players cannot bet on their own battle", s >= 400, x)
    for tok in ("spr:away", "tot:over", "win:opponent"):
        C.ok("place_spectator_bet", p_id=bid, p_tok=tok, p_stake=25)
    s, x = C.rpc("place_spectator_bet", p_id=bid, p_tok="ml:home", p_stake=99999); check("spectator stake above balance refused", s >= 400, x)
    s, x = A.rpc("lock_battle_parlay", p_id=bid); check("cannot lock an empty parlay", s >= 400, x)
    props = [p_ for p_ in mk["props"] if not p_.get("yn")]
    pa = ["ml:home", f"p:{props[0]['pid']}:{props[0]['stat']}:over"]; pb = ["ml:away", "tot:under", f"p:{props[-1]['pid']}:{props[-1]['stat']}:under"]
    s, x = A.rpc("set_battle_parlay", p_id=bid, p_legs=["ml:home", "ml:away"]); check("one pick per market in a battle parlay", s >= 400, x)
    A.ok("set_battle_parlay", p_id=bid, p_legs=pa); B.ok("set_battle_parlay", p_id=bid, p_legs=pb)
    s, pv = C.get(f"battle_parlays?battle_id=eq.{bid}&select=*"); check("parlays are private before the game starts", s == 200 and pv == [], pv)
    s, pv = A.get(f"battle_parlays?battle_id=eq.{bid}&select=user_id"); check("a player sees only their own parlay before the start", len(pv) == 1 and pv[0]["user_id"] == A.uid, pv)
    A.ok("lock_battle_parlay", p_id=bid)
    s, x = A.rpc("set_battle_parlay", p_id=bid, p_legs=["ml:away"]); check("editing after lock refused", s >= 400 and "locked" in json.dumps(x), x)
    r = B.ok("lock_battle_parlay", p_id=bid); check("second lock starts the simulation", r.get("started") is True, r)
    s, x = D.rpc("place_spectator_bet", p_id=bid, p_tok="ml:home", p_stake=10); check("betting after the start refused", s >= 400 and "closed" in json.dumps(x), x)
    nev = sql("select count(*) from public.battle_events where battle_id = %s", (bid,), one=True)
    s, ev = C.get(f"battle_events?battle_id=eq.{bid}&select=seq,text,visible_at&order=seq")
    check("API hides future plays (RLS on visible_at)", s == 200 and len(ev) < nev and len(ev) <= 2, (len(ev), nev))
    s, rr = C.get(f"battle_results?battle_id=eq.{bid}&select=*"); check("final result hidden until the end", rr == [], rr)
    s, det = C.rpc("battle_detail", p_id=bid); check("battle_detail (caller rights) also hides future plays", len(det["events"]) == len(ev) and det["result"] is None, len(det["events"]))
    s, x = anon.rpc("settle_battle", p_id=bid); check("early settle does nothing", x.get("result") is None, x)
    time.sleep(6)
    s, ev2 = C.get(f"battle_events?battle_id=eq.{bid}&select=seq&order=seq"); check("plays are revealed progressively", len(ev2) > len(ev) or nev <= 3, (len(ev), len(ev2)))
    started = sql("select started_at from public.battles where id = %s", (bid,), one=True)
    clock((started + datetime.timedelta(seconds=90)).isoformat())
    s, ev3 = C.get(f"battle_events?battle_id=eq.{bid}&select=seq&order=seq"); check("halfway through: about half the plays visible", 0.25 * nev <= len(ev3) <= 0.8 * nev, (len(ev3), nev))
    clock((started + datetime.timedelta(seconds=181)).isoformat())
    s, x = anon.rpc("settle_battle", p_id=bid); check("lazy settle by anyone after the end", x.get("result") == "final", x)
    bb = sql("select status, winner, result from public.battles where id = %s", (bid,))[0]
    res = bb[2]; split = res["split"]; win = bb[1]
    pays = {A.uid: 0, B.uid: 0}
    if split: pays = {A.uid: 100, B.uid: 100}
    else: pays[str(win)] = 200
    check("pot paid to the winner (or split)", abs(bal(A) - (a0 - 100 + pays[A.uid])) < 0.01 and abs(bal(B) - (b0 - 100 + pays[B.uid])) < 0.01, (res, bal(A), bal(B)))
    pc, po = res["creator"], res["opponent"]
    rule = (pc["payout"] > po["payout"]) or (pc["payout"] == po["payout"] and pc["hits"] > po["hits"])
    rule_o = (po["payout"] > pc["payout"]) or (po["payout"] == pc["payout"] and po["hits"] > pc["hits"])
    check("winner = slip that pays more, then more legs hit, else split", (split and not rule and not rule_o) or (str(win) == A.uid and rule) or (str(win) == B.uid and rule_o), res)
    bs = {str(r[0]): r[1:] for r in sql("select user_id, w, l, t, rated, elo from public.battle_stats where sport = 'nfl' and user_id in (%s, %s)", (A.uid, B.uid))}
    check("W/L and Elo updated for both players", bs[A.uid][3] == 1 and bs[B.uid][3] == 1 and (split or float(bs[A.uid][4]) != 1200), bs)
    cst = sql("select count(*) from public.battle_stats where user_id = %s", (C.uid,), one=True)
    sp = sql("select tok, status, stake, payout, price from public.spectator_bets where battle_id = %s order by id", (bid,))
    check("spectator bets settled at their odds and do not create a battle record", all(r[1] in ("won", "lost", "void") for r in sp) and cst == 0, (sp, cst))
    ok_pay = all((r[1] != "won") or abs(float(r[3]) - round(float(r[2]) * (1 + (r[4] / 100 if r[4] > 0 else 100 / abs(r[4]))), 2)) < 0.02 for r in sp)
    check("spectator payouts = stake x decimal odds", ok_pay, sp)
    s, rr = C.get(f"battle_results?battle_id=eq.{bid}&select=*"); check("result visible after the end", len(rr) == 1)
    s, pv = C.get(f"battle_parlays?battle_id=eq.{bid}&select=*"); check("both parlays public after the game", len(pv) == 2)
    s, x = anon.rpc("settle_battle", p_id=bid); check("settling twice does nothing", x.get("result") is None and abs(bal(A) - (a0 - 100 + pays[A.uid])) < 0.01, x)
    tl = sql("select kind, text, hs, as_ from public.battle_events where battle_id = %s order by seq", (bid,))
    check("timeline ends with the final score", tl[-1][0] == "final" and tl[-1][2] == res["hs"] and tl[-1][3] == res["as"], tl[-1])
    clock(None)

    # ------------------------------------------------------------ cancellations / timeouts (refunds)
    a1, c1 = bal(A), bal(C)
    b2 = A.ok("create_battle", p_sport="nba", p_home="BOS", p_away="LAL", p_wager=40, p_side="away")["id"]
    C.ok("place_spectator_bet", p_id=b2, p_tok="tot:over", p_stake=15)
    A.ok("cancel_battle", p_id=b2)
    check("creator cancel refunds wager and spectator bets", abs(bal(A) - a1) < 0.01 and abs(bal(C) - c1) < 0.01, (bal(A), a1, bal(C), c1))
    b3 = A.ok("create_battle", p_sport="mlb", p_home="NYY", p_away="BOS", p_wager=30, p_side="home")["id"]
    clock((now_db() + datetime.timedelta(minutes=31)).isoformat()); anon.ok("battle_tick")
    check("not accepted within 30 min -> cancelled + refunded", sql("select status from public.battles where id = %s", (b3,), one=True) == "cancelled" and abs(bal(A) - a1) < 0.01)
    clock(None)
    b4 = A.ok("create_battle", p_sport="nba", p_home="DEN", p_away="CHA", p_wager=20, p_side="home")["id"]; d1 = bal(D)
    D.ok("accept_battle", p_id=b4, p_side="home"); A.ok("set_battle_parlay", p_id=b4, p_legs=["ml:home"]); A.ok("lock_battle_parlay", p_id=b4)
    clock((now_db() + datetime.timedelta(minutes=16)).isoformat()); anon.ok("battle_tick")
    check("parlays not locked within 15 min -> cancelled, both refunded", sql("select status from public.battles where id = %s", (b4,), one=True) == "cancelled" and abs(bal(A) - a1) < 0.01 and abs(bal(D) - d1) < 0.01)
    clock(None)

    # ------------------------------------------------------------ NBA + MLB battle quick run (sim through settlement)
    for sport, h, a in (("nba", "OKC", "WSH"), ("mlb", "LAD", "COL")):
        x = A.ok("create_battle", p_sport=sport, p_home=h, p_away=a, p_wager=10, p_side="home")["id"]
        B.ok("accept_battle", p_id=x); A.ok("set_battle_parlay", p_id=x, p_legs=["ml:home"]); B.ok("set_battle_parlay", p_id=x, p_legs=["tot:over"])
        A.ok("lock_battle_parlay", p_id=x); B.ok("lock_battle_parlay", p_id=x)
        st0 = sql("select started_at from public.battles where id = %s", (x,), one=True)
        clock((st0 + datetime.timedelta(seconds=200)).isoformat()); anon.ok("battle_tick"); clock(None)
        r = sql("select status, result from public.battles where id = %s", (x,))[0]
        check(f"{sport.upper()} battle simulated and settled ({r[1]['as']}-{r[1]['hs']})", r[0] == "final", r)

    # ------------------------------------------------------------ hot streak: 5 winning slips in a row
    gid2 = "H" + tag
    g2 = dict(game, gid=gid2, start_at=(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)).isoformat())
    g2["props"] = dict(game["props"], p3={"name": "Rashee Rice", "side": "home", "status": {"kind": "ok"}, "stats": {"recYds": {"label": "Rec yds", "line": 60.5, "overPrice": -110, "matchup": 0, "miles": []}}})
    requests.post(f"{BASE}/rest/v1/games?on_conflict=gid", headers={**svc.h(), "Prefer": "resolution=merge-duplicates,return=minimal"}, data=json.dumps([g2]))
    sql("update public.profiles set streak = 0 where id = %s", (D.uid,))
    D.ok("place_bet", p_legs=[f"g:{gid2}:ml:home", f"g:{gid2}:spr:home", f"g:{gid2}:tot:over", f"p:{gid2}:p1:passYds:over", f"p:{gid2}:p3:recYds:over"], p_stake=5, p_mode="single")
    svc.ok("bot_settle_games", p=[{"gid": gid2, "home": 30, "away": 20, "played": {"p1": True, "p3": True}, "stat": {"p1": {"passYds": 300}, "p3": {"recYds": 80}}}])
    check("HOT STREAK badge after 5 straight winning slips", sql("select count(*) from public.badges where user_id = %s and kind = 'hot'", (D.uid,), one=True) == 1)

    # ------------------------------------------------------------ leaderboard + midnight finalization (fake clock)
    lb = anon.ok("leaderboard")
    check("leaderboard lists today's winners with usernames", any(w["username"] == A.name for w in lb["winners"] + lb["losers"]), lb["winners"][:3])
    # tomorrow 00:05 ET: today's board becomes final
    today = sql("select ls_private.today()", one=True)
    sql("update public.daily_stats set net = 0 where day = %s and user_id not in (%s, %s, %s, %s)", (today, A.uid, B.uid, C.uid, D.uid))
    sql("update public.daily_stats set net = 1000000 where day = %s and user_id = %s", (today, A.uid))       # make A the clear champion of the test day
    sql("update public.daily_stats set net = -1000000 where day = %s and user_id = %s", (today, C.uid))      # and C the trash can
    sql("insert into public.daily_stats(day, user_id, actions) values (%s, %s, 500) on conflict (day, user_id) do update set actions = 500", (today, B.uid))
    sql("update public.daily_stats set mentions = 99 where day = %s and user_id = %s", (today, C.uid))
    for u, e in ((A.uid, 1500), (B.uid, 1400)):
        sql("insert into public.battle_stats(user_id, sport, elo, rated) values (%s, 'nfl', %s, 3) on conflict (user_id, sport) do update set elo = %s, rated = 3", (u, e, e))
    sql("update public.battle_stats set rated = 0 where sport = 'nfl' and user_id not in (%s, %s)", (A.uid, B.uid))
    sql("update public.profiles set balance = 40 where id = %s", (E.uid,))       # for the daily top-up
    tomorrow_et = datetime.datetime.combine(today + datetime.timedelta(days=1), datetime.time(0, 5))
    clock(f"{tomorrow_et.isoformat()} America/New_York")
    n = anon.ok("finalize_days"); check("finalize_days finalizes the day that ended", n >= 1, n)
    n2 = anon.ok("finalize_days"); check("finalize_days is idempotent", n2 == 0, n2)
    bd = {(r[0], r[1]): str(r[2]) for r in sql("select kind, sport, user_id from public.badges where day = %s", (today,))}
    check("CHAMPION = biggest winner", bd.get(("champion", "")) == A.uid, bd)
    check("TRASH CAN = biggest loser", bd.get(("trash", "")) == C.uid)
    check("MOST ACTIVE = most actions", bd.get(("active", "")) == B.uid)
    check("CONVERSATION = most @mentions", bd.get(("convo", "")) == C.uid)
    check("KING (NFL) = top Elo with 3+ rated battles", bd.get(("king", "nfl")) == A.uid)
    check("daily top-up to 100 coins", bal(E) == 100, bal(E))
    lb2 = anon.ok("leaderboard")
    check("new day: board reset, yesterday's champion + trash can shown", lb2["winners"] == [] and any(x["kind"] == "champion" and x["username"] == A.name for x in lb2["yesterday"]["badges"]), lb2["yesterday"])
    # a second day: badges stack
    sql("insert into public.daily_stats(day, user_id, net) values (%s, %s, 50) on conflict (day, user_id) do update set net = 50", (today + datetime.timedelta(days=1), A.uid))
    clock(f"{datetime.datetime.combine(today + datetime.timedelta(days=2), datetime.time(0, 1)).isoformat()} America/New_York")
    anon.ok("finalize_days")
    pr = anon.ok("get_profile", p_username=A.name)
    check("badges stack (CHAMPION x2 on the profile)", pr["badges"].get("champion") == 2, pr["badges"])
    check("profile: balance, today/all-time net, battle record, slips", all(k in pr for k in ("balance", "today_net", "alltime_net", "battle", "battles", "slips")) and pr["battle"]["nfl"]["rated"] >= 1, list(pr.keys()))
    lb3 = anon.ok("leaderboard"); check("all-time badge table", any(x["username"] == A.name and x["champion"] >= 2 for x in lb3["alltime"]), lb3["alltime"][:2])
    clock(None)
    bad = [r for r in RES if not r[0]]
    print(f"\n{len(RES) - len(bad)}/{len(RES)} API checks passed")
    return 1 if bad else 0

if __name__ == "__main__":
    try: sys.exit(main())
    finally: clock(None)
