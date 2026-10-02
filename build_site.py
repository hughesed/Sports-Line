#!/usr/bin/env python3
"""Rebuilds index.html from the sources in src/.   usage:  python build_site.py          (add --check to only verify that index.html matches src/)
Run it only when you change something in src/ (the refresh bot never needs it: it only rewrites data/).
Same assembly as the original patch4 -> patch6 -> assemble_standalone chain, with one change: the slate, the learning data and the
past-day recaps are NOT baked into the page any more; the page loads data/slate.json, data/learn.json, data/pastp.json and data/meta.json
at start-up (src/loader.js) and re-checks them every few minutes."""
import os, re, sys, hashlib
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
def rd(n): return open(os.path.join(SRC, n), encoding="utf-8").read()

t = rd("template_v1.html")           # the v1 page; everything below patches it (kept so the build is repeatable)

def cut(t, start, end, repl=""):
    i = t.index(start); j = t.index(end, i)
    return t[:i] + repl + t[j:]
def rep(t, a, b, count=1):
    assert a in t, "missing: " + a[:90]
    return t.replace(a, b, count)

# ============================== stage 1 (was patch4.py) ==============================
t = cut(t, '/* ---------- legs ---------- */\nfunction legFor(tok){', 'const inSlip = tok')
t = cut(t, 'function legBtn(tok,title,sub,dis){', '/* ---------- pieces ---------- */')
t = cut(t, 'function slipHtml(){', 'function infoBlock(){')
t = cut(t, 'function render(){', 'function renderGame(gid){')
t = cut(t, 'function renderSlip(){', 'function rerenderAll(){')
t = rep(t, "const S = {league:'all', slip:[], slipOpen:false, drawer:{}, pick:{}, bar:{}, allInj:{}, };",
        "const S = {league:'all', view:'pre', slip:[], slipOpen:false, drawer:{}, pick:{}, bar:{}, allInj:{}, stake:'10', betMode:'parlay', lvOpen:{}, lvStat:{}, pendingLive:{}, pressing:false, slipMsg:'', flash:'', bankDraft:null};")
t = rep(t, "DATA.games.forEach(g=>{ if(document.getElementById('game-'+g.id)) renderGame(g.id); }); renderSlip(); window.scrollTo(0,y);",
        "DATA.games.forEach(g=>{ if(document.getElementById('game-'+g.id)) renderGame(g.id); }); renderSlip(); syncLegButtons(); window.scrollTo(0,y);")
old = "if(act==='leg'){toggleLeg(t.getAttribute('data-tok'));const gid=t.getAttribute('data-tok').split(':')[1];const y=window.scrollY;renderGame(gid);renderSlip();window.scrollTo(0,y);return;}"
t = rep(t, old, "if(act==='leg'){const tok=t.getAttribute('data-tok');toggleLeg(tok);S.slipMsg='';if(tok.charAt(0)==='l'&&tok.charAt(1)===':'){syncLegButtons();renderSlip();return;}const gid=tok.split(':')[1];const y=window.scrollY;renderGame(gid);renderSlip();window.scrollTo(0,y);return;}")
t = cut(t, 'function chart(pl,st,pid){', 'function gradeEl(g)', rd("chart_new.js") + "\n")
t = rep(t, "'<div class=\"kv\"><div class=\"k\">Last '+st.n+' vs line</div><div class=\"v\">'+st.overHits+'/'+st.n+' over</div>",
        "'<div class=\"kv\"><div class=\"k\">Last '+st.n15+' vs line</div><div class=\"v\">'+st.overHits15+'/'+st.n15+' over</div>")
t = rep(t, "' · '+st.n+' of '+st.n;", "' · '+st.n15+' of '+st.n15;")
t = rep(t, "Alternate lines (hit count is for the last '+st.n+')", "Alternate lines (hit count is for the last '+st.n15+' played)")
t = rep(t, "<span><i style=\"background:var(--safe)\"></i>safe point</span></div>'+",
        "<span><i style=\"background:var(--safe)\"></i>safe point</span><span>lighter bars: older than the 10-game model window</span><span>dashed: did not play</span></div>'+")
t = rep(t, "is the highest number a player reached in every game of the window (the last 10 games, or every game played this season in the NFL). If he had a zero in that stretch, there is no safe point.",
        "is the highest number a player reached in every game he played in the window (up to 15 games, shown in the chart; fewer when the season is shorter). Games he missed show as DNP and are not counted as zeros. If he had a zero in a game he played, there is no safe point.")
t = rep(t, "<div><b>Limits</b>: the NFL has only 3 games played, so a safe point there means 3 of 3.",
        "<div><b>Model window</b>: the projections and chances use the last 10 games a player played, with this season weighted in, then adjust for the opponent, the injury report, teammates who are out and players returning from missed games. The chart and safe points look back further (up to 15) so you can see the pattern.</div><div><b>Live tab</b>: chances change with the clock and score. Remaining production is the model projection scaled to the time left, nudged by what the player has already done, and set to zero if he is out or leaves hurt. Practice prices come from a plain baseline (season averages and book totals) so you can see where the model disagrees.</div><div><b>Limits</b>: early in a season a player may have only a few games played, so a safe point can mean just 3 of 3.")
t = rep(t, '</style>', rd("live.css") + "\n</style>")
t = rep(t, '<div class="slipbar" id="slip" hidden></div>', '<div id="toast" hidden role="status"></div>\n<div class="slipbar" id="slip" hidden></div>')
js = rd("ctx.js") + "\n" + rd("live_core.js") + "\n" + rd("live_ui.js") + "\n" + rd("live_views.js") + "\n"
t = rep(t, "const $app=document.getElementById('app');", js + "\nconst $app=document.getElementById('app');")
t = rep(t, "\nrender();\n})();", "\nrender();\ninitStore();\n})();")

# ============================== stage 2 (was patch6.py) ==============================
t = rep(t, 'family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap', 'family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap')
pal = '''/* palette: blue sportsbook look; every colour is a token */
:root{
  --bg:#eef2f7; --surface:#ffffff; --surface2:#f3f6fb; --ink:#0e1a2b; --muted:#566880; --line:#dbe3ee;
  --accent:#1766e6; --accent-ink:#ffffff; --accent-soft:#dcebff;
  --over:#12915a; --under:#d6403a; --safe:#1766e6; --hot:#d9541a; --cold:#2b7fd1; --warn:#9a6200;
  --over-soft:#dcf3e6; --under-soft:#fbe1df; --warn-soft:#fbefd0; --safe-soft:#dce8fb; --hot-soft:#fbe3d5; --cold-soft:#dcebf8;
  --hdr:#0b4fc4; --hdr-ink:#ffffff;
  --shadow:0 1px 2px rgba(14,26,43,.07);
  --f-display:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-body:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#09101c; --surface:#121b2d; --surface2:#182339; --ink:#e6edf8; --muted:#93a4bd; --line:#26344d;
  --accent:#4d98ff; --accent-ink:#04122b; --accent-soft:#14284a;
  --over:#2fcb7e; --under:#f06d66; --safe:#7db0ff; --hot:#ff8d52; --cold:#6db6f5; --warn:#e3ae3f;
  --over-soft:#12352a; --under-soft:#3a1f1e; --warn-soft:#352b12; --safe-soft:#17284a; --hot-soft:#3a2315; --cold-soft:#162b3d;
  --hdr:#0f2a5c; --hdr-ink:#ffffff;
  --shadow:none; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#09101c; --surface:#121b2d; --surface2:#182339; --ink:#e6edf8; --muted:#93a4bd; --line:#26344d;
  --accent:#4d98ff; --accent-ink:#04122b; --accent-soft:#14284a;
  --over:#2fcb7e; --under:#f06d66; --safe:#7db0ff; --hot:#ff8d52; --cold:#6db6f5; --warn:#e3ae3f;
  --over-soft:#12352a; --under-soft:#3a1f1e; --warn-soft:#352b12; --safe-soft:#17284a; --hot-soft:#3a2315; --cold-soft:#162b3d;
  --hdr:#0f2a5c; --hdr-ink:#ffffff;
  --shadow:none; color-scheme:dark}

'''
t = cut(t, ':root{', '*{box-sizing:border-box}', pal)
t = rep(t, 'body{background:var(--bg);color:var(--ink);font-family:var(--f-body);font-size:14px;line-height:1.45;padding-inline:16px;padding-block:18px 120px}',
        'body{background:var(--bg);color:var(--ink);font-family:var(--f-body);font-size:14px;line-height:1.45;padding-inline:0;padding-block:0 170px}')
t = rep(t, '.wrap{max-width:760px;margin-inline:auto;display:flex;flex-direction:column;gap:16px}', '.wrap{max-width:760px;margin-inline:auto;display:flex;flex-direction:column;gap:14px;padding-inline:16px;padding-block:14px 0}')
t = rep(t, 'bottom:calc(76px + env(safe-area-inset-bottom,0px))', 'bottom:calc(150px + env(safe-area-inset-bottom,0px))')
t = rep(t, '</style>', rd("ui2.css") + "\n" + rd("live3.css") + "\n" + rd("fs.css") + "\n" + rd("picks.css") + "\n" + rd("site.css") + "\n</style>")
t = rep(t, '<div class="wrap" id="app"></div>', '<header class="hd" id="hdr"></header>\n<div class="wrap" id="app"></div>')
t = rep(t, '<div class="slipbar" id="slip" hidden></div>', '<div class="slipbar" id="slip" hidden></div>\n<nav class="bnav" id="nav" aria-label="Main"></nav>')
t = cut(t, '/* ================= shell ================= */\nfunction render(){', '/* ================= events')
t = cut(t, 'function linesTable(g){', 'function crossroads(g){')
t = rep(t, "'<div class=\"sec\"><h3>Lines <span class=\"hint\">DraftKings via ESPN</span></h3>'+linesTable(g)+'</div>'", "'<div class=\"sec\"><h3>Lines <span class=\"hint\">DraftKings via ESPN · tap to add to slip</span></h3>'+linesTable(g)+'</div>'")
t = rep(t, "'</div>'+leans+notesHtml+", "'</div>'+leans+ctxBox(g)+learnedBox(g)+notesHtml+")
t = rep(t, "const LEAGUE_N = {nfl:32,wnba:15,mlb:30};", "const LEAGUE_N = {nfl:32,wnba:15,mlb:30,nba:30,cfb:136,cbb:362};")
t = rep(t, "const LOGI = {nfl:7.9,wnba:6.5,mlb:2.5};", "const LOGI = {nfl:7.9,wnba:6.5,mlb:2.5,cfb:11.1,nba:8.9,cbb:8.2};")
t = rep(t, "const TOTS = {nfl:5.6,wnba:9,mlb:3};", "const TOTS = {nfl:5.6,wnba:9,mlb:3,cfb:6.9,nba:7.9,cbb:7.4};")
t = rep(t, "const cr=g.crossroads,a=g.teams.away,h=g.teams.home,N=LEAGUE_N[g.lg];", "const cr=g.crossroads,a=g.teams.away,h=g.teams.home,N=g.n||LEAGUE_N[g.lg];")
t = rep(t, """    '<button class="drawerbtn" data-act="drawer" data-gid="'+g.id+'" aria-expanded="'+open+'"><span>SGP builder</span><span class="mono">'+countSelections(g)+' selections '+(open?'(hide)':'(open)')+'</span></button>'+
    (open?drawer(g):'')+'</article>';""", """    (g.players.length?'<button class="drawerbtn" data-act="drawer" data-gid="'+g.id+'" aria-expanded="'+open+'"><span>SGP builder</span><span class="mono">'+countSelections(g)+' selections '+(open?'(hide)':'(open)')+'</span></button>':'<div class="sec"><div class="small muted">The book feed does not publish player props for this league, so there is no SGP builder here. Lines, the model, and the live view still work.</div></div>')+
    (open&&g.players.length?drawer(g):'')+'</article>';""")
t = rep(t, "const P={bank:1000,start:1000,bets:[],saved:[],tpl:'',seq:1,live:{}};", "const P={bank:1000,start:1000,bets:[],saved:[],tpl:'',seq:1,live:{},nick:'',boardOn:false,chatOn:false};")
t = rep(t, "  if(d.live&&typeof d.live==='object') P.live=d.live;", "  if(d.live&&typeof d.live==='object') P.live=d.live;\n  if(typeof d.nick==='string') P.nick=d.nick.slice(0,18);\n  if(typeof d.boardOn==='boolean') P.boardOn=d.boardOn;\n  if(typeof d.chatOn==='boolean') P.chatOn=d.chatOn;")
t = rep(t, "function persist(){ clearTimeout(saveT); saveT=setTimeout(doSave,600); }", "function persist(){ clearTimeout(saveT); saveT=setTimeout(doSave,600); if(typeof syncBoardSoon==='function') syncBoardSoon(false); }")
t = rep(t, "let loaded=false;\n  try{", "let loaded=false, dbh=null, userh=null;\n  try{")
t = rep(t, "if(db&&user){\n        const id=await user.id();", "if(db&&user){\n        dbh=db; userh=user;\n        const id=await user.id();")
t = rep(t, "  render();\n  if(store.ref) doSave();", "  render();\n  if(store.ref) doSave();\n  if(dbh&&userh) initSocial(dbh,userh); else { FS.conn='nodb'; if(S.view==='live') render(); }")
t = rep(t, "  Object.keys(P.live).forEach(gid=>{ if(G[gid]) restoreSim(gid); });", "  normLive();")
t = rep(t, "<div class=\"meta\"><span class=\"lg\">'+esc(g.league)+'</span><span>'+esc(g.startDate)", "<div class=\"meta\"><span class=\"lg\">'+esc(g.league)+'</span>'+liveBadge(g.id)+'<span>'+esc(g.startDate)")
t = rep(t, "    crossroads(g)+patterns(g)+injuries(g)+\n", "    crossroads(g)+patterns(g)+injuries(g)+safeBar(g)+\n")
t = rep(t, "  const res=settleBets(gid,F);", "  const res=settleBets(gid,F); try{ settleCalls(gid,F); }catch(e){}")
t = rep(t, "  if(d.live&&typeof d.live==='object') P.live=d.live;", "  if(d.live&&typeof d.live==='object') P.live=d.live;\n  if(Array.isArray(d.calls)) P.calls=d.calls;")
t = rep(t, "function bookUrl(b){\n", "function bookUrl(b){\n  const dku=(b[0]==='draftkings'&&S.slip.length===1)?dkLeg(S.slip[0]):''; if(dku) return dku;\n")
t = rep(t, "  const dec=legs.reduce((d,l)=>d*decOf(l.price),1);\n  const single=S.betMode==='single';", "  const dec=legs.reduce((d,l)=>d*decOf(l.price),1);\n  const bb=activeBoost(); const bdec=boostedDec(dec,bb);\n  const single=S.betMode==='single';")
t = rep(t, "stake*dec;\n", "stake*bdec;\n")
t = rep(t, "return {stake,n,dec,cost,toWin:r2(toWin),pall,single};", "return {stake,n,dec,bdec,boost:bb,cost,toWin:r2(toWin),pall,single};")
t = rep(t, "<span>Pays <b class=\"mono\">'+money(c.toWin)+'</b></span>", "<span>Pays <b class=\"mono\">'+money(c.toWin)+'</b>'+(c.boost?' <span class=\"bst\">+'+c.boost.pct+'% '+esc(c.boost.book)+'</span>':'')+'</span>")
t = rep(t, "const am=amerOfDec(c.dec);", "const am=amerOfDec(c.bdec);")
t = rep(t, "10*c.dec).toFixed(2)", "10*c.bdec).toFixed(2)")
t = rep(t, "'<div class=\"stakerow\"><label class=\"sl-l\">", "boostHtml()+'<div class=\"stakerow\"><label class=\"sl-l\">")
t = rep(t, "  const mk=(ls,st)=>({id:P.seq++,t:now,mode:ls.length>1?'parlay':'single',stake:st,legs:ls,status:'pending',payout:0});",
        "  const bb=S.betMode==='single'?null:activeBoost();\n  const mk=(ls,st)=>({id:P.seq++,t:now,mode:ls.length>1?'parlay':'single',stake:st,legs:ls,status:'pending',payout:0,boost:(ls.length>1&&bb)?{id:bb.id,book:bb.book,pct:bb.pct,minLegs:bb.minLegs,name:bb.name}:null});")
t = rep(t, "S.slip=[]; S.slipOpen=false; S.slipMsg='';", "S.slip=[]; S.boost=null; S.slipOpen=false; S.slipMsg='';")
t = rep(t, "b.payout=r2(b.stake*decOfLegs(b.legs));", "b.payout=r2(b.stake*boostedDec(decOfLegs(b.legs),(b.boost&&live.length>=b.boost.minLegs)?b.boost:null));")
t = rep(t, "pays '+money(b.stake*dec)+' · '", "pays '+money(b.stake*boostedDec(dec,b.boost))+(b.boost?' with +'+b.boost.pct+'% '+esc(b.boost.book)+' boost':'')+' · '")
t = rep(t, "function renderSlip(){\n", "function renderSlip(){\n  if(!S.slip.length) S.boost=null;\n")
js = rd("live3.js") + "\n" + rd("fullscreen.js") + "\n" + rd("audio.js") + "\n" + rd("ui2.js") + "\n" + rd("picks.js")
t = rep(t, "const $app=document.getElementById('app');", js + "\nconst $app=document.getElementById('app');")

# ============================== stage 3 (was assemble_standalone.py): data comes from data/*.json ==============================
t = rep(t, "const DATA = __DATA__;", "const DATA = window.__LSDATA.slate;")
t = rep(t, "const LEARN=__LEARN__;", "const LEARN=window.__LSDATA.learn;")
t = rep(t, "const PASTP=__PASTP__;", "const PASTP=window.__LSDATA.pastp;")
sa = rd("standalone.js") + "\n" + rd("keepcards.js")
assert t.count("const $app=document.getElementById") == 1
t = t.replace("const $app=document.getElementById", sa + "\nconst $app=document.getElementById", 1)
t = rep(t, "if(dbh&&userh) initSocial(dbh,userh); else { FS.conn='nodb'; if(S.view==='live') render(); }", "if(dbh&&userh) initSocial(dbh,userh); else { startPoll(); }")
for a, b in [("Sign in to claude.ai to join the boards. Boards need the page\\'s shared database, which is not available in this view, so only your own numbers exist here.", "Boards are not part of this standalone copy, so only your own numbers show here."),
             ("Chat needs the shared database, which is not available in this view. Sign in to claude.ai and open the page from your account.", "Chat is not part of this standalone copy.")]:
    t = rep(t, a, b)
t = rep(t, "\nrender();\ninitStore();\n})();", "\nwindow.__LS_hooks={slipCount:function(){return S.slip.length;}};\nrender();\ninitStore();\n})();")

# ---- split: <head> part (title, fonts, style) / body markup / app script
m = re.search(r"<header class=\"hd\" id=\"hdr\">", t)
head_part, rest = t[:m.start()], t[m.start():]
s0 = rest.index("<script>")
body_markup = rest[:s0]
scripts = rest[s0:]
# the page has two <script> blocks: DATA, then the app. Fold them into one text block the loader runs after the data arrived.
app = re.sub(r"</?script>", "", scripts).strip()
assert "</script" not in app.lower().replace("<\\/script", "")
assert "window.__LSDATA" in app
app = app.replace("</script", "<\\/script")
title = re.search(r"<title>.*?</title>", head_part, re.S).group(0)
head_rest = head_part.replace(title, "", 1)
loader = rd("loader.js")
build_id = hashlib.sha1((app + head_rest + loader).encode()).hexdigest()[:10]
out = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b4fc4">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="Line Scout">
<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icons/apple-touch-icon.png"><link rel="icon" href="icons/icon-192.png">
<meta name="description" content="Line Scout: practice sports-betting scouting with play money. Not a sportsbook.">
{title}
{head_rest}<style>[hidden]{{display:none!important}}img{{max-width:100%}}</style></head>
<body data-build="{build_id}">
<div id="lsbar" class="lsbar" role="status">Loading data…</div>
{body_markup}
<script>{loader}</script>
<script type="text/plain" id="ls-app">{app}</script>
</body></html>
"""
target = os.path.join(ROOT, "index.html")
if "--check" in sys.argv:          # CI-style check: is index.html up to date with src/ ?
    same = os.path.exists(target) and open(target, encoding="utf-8").read() == out
    print("index.html is up to date" if same else "index.html is OUT OF DATE: run python build_site.py"); sys.exit(0 if same else 1)
open(target, "w", encoding="utf-8").write(out)
print(f"index.html written: {len(out)/1024:.0f} KB, build {build_id}")
