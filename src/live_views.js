/* ================= slip bar ================= */
const BOOKS=[['gambly','Gambly: open chat','https://gambly.com/chat'],['draftkings','DraftKings','https://sportsbook.draftkings.com/'],['fanduel','FanDuel','https://sportsbook.fanduel.com/'],['betmgm','BetMGM','https://sports.betmgm.com/'],['caesars','Caesars','https://www.caesars.com/sportsbook-and-casino'],['espnbet','ESPN BET','https://espnbet.com/'],['hardrockbet','Hard Rock Bet','https://app.hardrock.bet/'],['betrivers','BetRivers','https://www.betrivers.com/'],['bet365','bet365','https://www.bet365.com/'],['fanaticsapp','Fanatics app','https://fanatics.onelink.me/5kut?af_force_deeplink=true&pid=share_bet&af_siteid=1616738407']];
function bookUrl(b){
  if(b[0]==='fanaticsapp') return b[2];
  try{ const dl=(typeof slipDeepLink==='function')?slipDeepLink(b[0]):null; if(dl&&dl.url) return dl.url; }catch(err){}
  /* when every leg is in one game and the odds feed knows that game, open the book on THAT game's page (the closest a web page can get to the slip) */
  try{ const gids=Array.from(new Set(S.slip.map(l=>l.gid))); if(gids.length===1&&G[gids[0]]&&typeof odFind==='function'){ const ev=odFind(G[gids[0]]); const lk=ev&&ev.eventLinks&&ev.eventLinks[b[0]]; if(lk&&/^https:\/\//i.test(lk)) return lk; } }catch(err){}
  const t=(P.tpl||'').trim();
  if(!/^https:\/\//i.test(t)) return b[2];
  const legs=encodeURIComponent(S.slip.map(l=>l.label+' '+fo(l.price)).join(' | '));
  const json=encodeURIComponent(JSON.stringify(S.slip.map(l=>({game:G[l.gid].title,leg:l.label,odds:l.price}))));
  return t.replace(/\{book\}/g,b[0]).replace(/\{legs\}/g,legs).replace(/\{json\}/g,json);
}
function calc(){
  const legs=S.slip; const stake=parseStake(); const n=legs.length;
  const dec=legs.reduce((d,l)=>d*decOf(l.price),1);
  const single=S.betMode==='single';
  const cost=single?r2(stake*n):stake;
  const toWin=single?legs.reduce((s,l)=>s+stake*decOf(l.price),0):stake*dec;
  const pall=legs.reduce((p,l)=>p*l.p*l.avail,1);
  return {stake,n,dec,cost,toWin:r2(toWin),pall,single};
}
function calcHtml(){
  const c=calc(); const err=placeCheck();
  return '<div class="calc"><span>Cost <b class="mono">'+money(c.cost)+'</b></span><span>Pays <b class="mono">'+money(c.toWin)+'</b></span><span>Bank <b class="mono">'+money(P.bank)+'</b></span>'+(c.single?'':'<span>All hit ~<b class="mono">'+(c.pall<0.01?'<1%':Math.round(c.pall*100)+'%')+'</b></span>')+'</div>'+
    (err&&parseStake()>0?'<div class="slipnote warnt">'+esc(err)+'</div>':'');
}
function slipHtml(){
  const legs=S.slip; if(!legs.length) return '';
  const c=calc(); const am=amerOfDec(c.dec); const games=new Set(legs.map(l=>l.gid)).size;
  const sum='<button class="slipsum" data-act="slip" aria-expanded="'+S.slipOpen+'"><span class="a">Slip · '+legs.length+' leg'+(legs.length>1?'s':'')+(S.slipOpen?'  (tap to collapse)':'')+'</span><span class="b">'+(c.single?'singles':'est. '+fo(am))+' · $10 pays $'+(c.single?legs.reduce((s,l)=>s+10*decOf(l.price),0):10*c.dec).toFixed(2)+'</span></button>';
  if(!S.slipOpen) return '<div class="in">'+sum+'</div>';
  const rows=legs.map(l=>'<div class="sl"><span>'+esc(l.label)+' <span class="mono" style="opacity:.75">'+fo(l.price)+(l.live?' live':l.src==='est.'?' est.':' '+(l.bk||'DK'))+'</span><br><span style="opacity:.65;font-size:11px">'+esc(G[l.gid].title)+'</span></span><button class="x" data-act="rm" data-tok="'+esc(l.id)+'" aria-label="Remove '+esc(l.label)+'">Remove</button></div>').join('');
  const chips=[['10%','10'],['25%','25'],['50%','50'],['Max','max']].map(x=>'<button class="x" data-act="stake-chip" data-v="'+x[1]+'">'+x[0]+'</button>').join('');
  const books=BOOKS.map(b=>{ let dl=null; try{ dl=(typeof slipDeepLink==='function')?slipDeepLink(b[0]):null; }catch(err){} return '<a class="btn bk" href="'+esc(bookUrl(b))+'" target="_blank" rel="noopener" data-act="book" data-bk="'+b[0]+'">'+esc(b[1])+(dl?' ✓ '+dl.n+'/'+dl.total:'')+'</a>'; }).join('');
  return '<div class="in"><div class="slipscroll">'+sum+'<div class="slipbody">'+rows+'</div>'+
    '<div class="seg inv" role="group" aria-label="Bet type"><button data-act="mode" data-v="parlay" aria-pressed="'+!c.single+'">'+(legs.length>1?(games>1?'Parlay':'Same-game parlay'):'Straight bet')+'</button><button data-act="mode" data-v="single" aria-pressed="'+c.single+'">Singles</button></div>'+
    '<div class="stakerow"><label class="sl-l">Stake $<input class="num stk" data-in="stake" inputmode="decimal" value="'+esc(S.stake)+'" aria-label="Stake in dollars"></label><span class="chips">'+chips+'</span></div>'+
    '<div id="slipcalc">'+calcHtml()+'</div>'+
    '<div class="btnrow"><button class="btn solid" data-act="place" id="placebtn">Place practice bet</button><button class="btn" data-act="saveslip">Save slip</button><button class="btn" data-act="clear">Clear</button></div>'+
    '<div class="slipnote" id="slipmsg">'+esc(S.slipMsg||'')+'</div>'+
    '<div class="small" style="opacity:.9"><b>Step 1.</b> Copy the slip. <b>Step 2.</b> Open Gambly and paste it into the chat box (Gambly cannot receive bets from a link, only pasted text or a screenshot).</div><div class="btnrow"><button class="btn solid" data-act="copyslip">Copy slip text</button></div>'+
    '<label class="small" style="display:block;opacity:.8" for="sliptxt">Slip text (if copying is blocked on your device, press and hold in this box, Select All, Copy)</label><textarea id="sliptxt" readonly rows="'+Math.min(6,legs.length+1)+'" style="width:100%;box-sizing:border-box;font:12px/1.4 ui-monospace,monospace" aria-label="Slip text to paste">'+esc(slipText(legs))+'</textarea>'+
    '<div class="small" style="opacity:.8">Take this slip to a sportsbook (opens in a new tab and copies the slip text; Gambly builds the slip from pasted text, then you choose the book):</div><div class="btnrow">'+books+'</div><div class="small" style="opacity:.85">A ✓ means the book opens with that many of your picks already in its slip. Tap the link itself (do not long-press) so your phone can hand it to the book\'s app. The slip text is also copied as a backup.</div>'+
    '<div class="slipnote">Prices here are model estimates or ESPN/DraftKings numbers from this snapshot, so the book will price it differently. Same-game legs are correlated. Real-money betting is for adults 21+ (call 1-800-GAMBLER for help).</div></div></div>';
}
function renderSlip(){
  { const ae=document.activeElement; if(ae&&ae.blur&&!S.slip.length&&ae.closest&&ae.closest('#slip')) ae.blur(); }   // only the slip's own fields (never the sign-in form or chat box)
  const h=slipHtml(); const el=document.getElementById('slip');
  const ae=document.activeElement; const keep=ae&&ae.getAttribute&&ae.getAttribute('data-in')==='stake';
  if(keep&&S.slip.length&&S.slipOpen&&!S.forceSlip) return;
  el.innerHTML=h; el.hidden=!h;
}
function updateCalc(){ const el=document.getElementById('slipcalc'); if(el) el.innerHTML=calcHtml(); }
function renderBank(){ const el=document.getElementById('bankchip'); if(el) el.textContent=money(P.bank); const t=document.getElementById('toast'); if(t){ t.textContent=S.flash||''; t.hidden=!S.flash; if(S.flash){ clearTimeout(S.flashT); S.flashT=setTimeout(()=>{ S.flash=''; renderBank(); },6000); } } }

/* ================= slips view ================= */
function legStatusIcon(l){ return l.res==='W'?'<span class="ic w">✓</span>':l.res==='L'?'<span class="ic l">✗</span>':l.res==='V'?'<span class="ic v">–</span>':'<span class="ic p">•</span>'; }
function fmtTime(t){ const d=new Date(t); return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function betHtml(b){
  const dec=decOfLegs(b.legs.map(l=>({price:l.price,res:l.res}))); const am=amerOfDec(dec);
  const cls={pending:'warn',won:'ok',lost:'bad',void:''}[b.status];
  const txt={pending:'Pending',won:'Won '+money(b.payout),lost:'Lost',void:'Refunded'}[b.status];
  return '<div class="bet"><div class="bh"><b>'+(b.legs.length>1?(new Set(b.legs.map(l=>l.gid)).size>1?'Parlay':'Same-game parlay')+' · '+b.legs.length+' legs':'Straight bet')+'</b><span class="badge '+cls+'">'+esc(txt)+'</span></div>'+
    '<div class="small muted">Stake '+money(b.stake)+' · odds '+fo(am)+' · pays '+money(b.stake*dec)+' · '+esc(fmtTime(b.t))+'</div>'+(b.status==='won'?'<div class="btnrow"><button class="shbtn" data-act="sh-open" data-k="slip" data-src="local" data-i="'+P.bets.indexOf(b)+'">Share this winning slip</button></div>':'')+
    b.legs.map(l=>'<div class="bl">'+legStatusIcon(l)+'<span>'+esc(l.label)+' <span class="mono muted">'+fo(l.price)+'</span><br><span class="muted small">'+esc(G[l.gid]?G[l.gid].title:'')+(l.res==='V'?' · void':'')+'</span></span></div>').join('')+
    (b.status==='pending'?'<div class="small muted">Settles when ESPN shows the final for '+esc([...new Set(b.legs.filter(l=>!l.res).map(l=>G[l.gid]?G[l.gid].teams.away.abbr+'@'+G[l.gid].teams.home.abbr:'game '+l.gid))].join(', '))+'.</div>':'')+'</div>';
}
function savedHtml(s){
  const dec=s.legs.reduce((d,l)=>d*decOf(l.price),1);
  return '<div class="bet"><div class="bh"><b>'+s.legs.length+' leg'+(s.legs.length>1?'s':'')+'</b><span class="muted small">'+esc(fmtTime(s.t))+'</span></div>'+
    '<div class="small muted">est. '+fo(amerOfDec(dec))+' · $10 pays $'+(10*dec).toFixed(2)+'</div>'+
    s.legs.map(l=>'<div class="bl"><span class="ic p">•</span><span>'+esc(l.label)+' <span class="mono muted">'+fo(l.price)+'</span><br><span class="muted small">'+esc(G[l.gid]?G[l.gid].title:'')+'</span></span></div>').join('')+
    '<div class="btnrow"><button class="btn pri" data-act="loadsaved" data-id="'+s.id+'">Load into slip</button><button class="btn" data-act="delsaved" data-id="'+s.id+'">Delete</button></div></div>';
}
function slipsView(){
  const pend=P.bets.filter(b=>b.status==='pending'); const done=P.bets.filter(b=>b.status!=='pending');
  const atStake=pend.reduce((s,b)=>s+b.stake,0); const net=P.bank+atStake-P.start;
  const draft=S.bankDraft!=null?S.bankDraft:String(P.start);
  const chips=[0.01,10,100,1000,10000].map(v=>'<button class="x2" data-act="bank-chip" data-v="'+v+'">'+(v===0.01?'$0.01':'$'+v.toLocaleString('en-US'))+'</button>').join('');
  return '<section class="game"><div class="sec"><h3>Practice bank <span class="hint">pretend money</span></h3>'+
    '<div class="bankbig mono">'+money(P.bank)+'</div>'+
    '<div class="proj"><div class="kv"><div class="k">Started with</div><div class="v">'+money(P.start)+'</div></div><div class="kv"><div class="k">On open bets</div><div class="v">'+money(atStake)+'</div></div><div class="kv"><div class="k">Profit / loss</div><div class="v" style="color:var(--'+(net>=0?'over':'under')+')">'+(net>=0?'+':'−')+money(Math.abs(net))+'</div></div></div>'+
    '<div class="stakerow2"><label>Set bank to $<input class="num" data-in="bank" inputmode="decimal" value="'+esc(draft)+'" aria-label="Practice bank amount"></label><button class="btn pri" data-act="bank-set">Set bank</button></div>'+
    '<div class="chips2">'+chips+'</div>'+
    '<div class="small muted">Pick anything from $0.01 to $10,000 to load. Winnings are added on top, so the bank can grow past $10,000. Setting the bank again replaces the balance.</div></div></section>'+
    '<section class="game"><div class="sec"><h3>Selected slips <span class="hint">saved for later</span></h3>'+(P.saved.length?P.saved.map(savedHtml).join(''):'<div class="small muted">Nothing saved yet. Build a slip from the Pregame or Live tab and tap Save slip.</div>')+'</div></section>'+
    '<section class="game"><div class="sec"><h3>Placed bets <span class="hint">'+pend.length+' open · '+done.length+' settled</span></h3>'+
    (P.bets.length?pend.concat(done).slice(0,60).map(betHtml).join(''):'<div class="small muted">No practice bets yet. Add selections, then tap Place practice bet.</div>')+
    (done.length?'<div class="btnrow"><button class="btn" data-act="clearhist">Clear settled bets</button></div>':'')+'</div></section>'+
    '<section class="game"><div class="sec"><h3>Sportsbook links <span class="hint">optional</span></h3><div class="small muted">The sportsbook buttons on your slip open each book. If you have a custom link that takes a slip, paste it here with <span class="mono">{book}</span> and <span class="mono">{legs}</span> where they belong (for example https://example.com/slip?book={book}&amp;legs={legs}).</div>'+
    '<input class="num wide" data-in="tpl" value="'+esc(P.tpl)+'" placeholder="https://… (optional)" aria-label="Custom link template"></div></section>';
}

/* ================= shell ================= */
function render(){
  const gs = DATA.games.filter(g=>S.league==='all'||(g.key||g.lg)===S.league);
  const counts={all:DATA.games.length}; DATA.games.forEach(g=>{counts[g.lg]=(counts[g.lg]||0)+1;});
  const ltabs=[['all','All'],['nfl','NFL'],['wnba','WNBA'],['mlb','MLB']].map(([k,l])=>'<button class="tab" data-act="league" data-k="'+k+'" aria-pressed="'+(S.league===k)+'">'+l+' '+(counts[k]||0)+'</button>').join('');
  const pend=P.bets.filter(b=>b.status==='pending').length;
  const vtabs=[['pre','Pregame'],['live','Live'],['slips','Slips'+(pend?' ('+pend+')':'')]].map(([k,l])=>'<button class="vtab" data-act="view" data-k="'+k+'" aria-pressed="'+(S.view===k)+'">'+l+'</button>').join('');
  let body='';
  if(S.view==='pre') body=gs.map(gameCard).join('');
  else if(S.view==='live') body=liveView();
  else body=slipsView();
  $app.innerHTML = '<header class="top"><div class="brand"><h1>Line Scout</h1><span class="bank" title="Practice money">Practice <b id="bankchip" class="mono">'+money(P.bank)+'</b></span></div><div class="asof">Today\'s slate · data pulled '+esc(DATA.asOf)+' from ESPN</div>'+
    '<div class="vtabs" role="group" aria-label="View">'+vtabs+'</div>'+
    (S.view!=='slips'?'<div class="tabs" role="group" aria-label="League">'+ltabs+'</div>':'')+(S.view==='pre'?infoBlock():'')+'</header>'+body+
    '<div class="foot"><div>Source: ESPN game logs (up to 15 games shown, last 10 feed the model), standings, injury reports and DraftKings lines. Pregame numbers are a snapshot, so lines and injury news will change before game time.</div><div>Practice money is pretend and the practice game is simulated. For information only. Sportsbook buttons may open partner links. Sports betting involves risk, so only stake what you can afford to lose. 21+. Help: 1-800-GAMBLER.</div></div>';
  renderSlip(); renderBank();
}

/* ================= events ================= */
function flushPending(){ const p=S.pendingLive; S.pendingLive={}; Object.keys(p).forEach(gid=>refreshLive(gid,p[gid]===2)); }
document.addEventListener('pointerdown',()=>{ S.pressing=true; },true);
const relPtr=()=>{ if(!S.pressing) return; setTimeout(()=>{ S.pressing=false; flushPending(); },80); };
document.addEventListener('pointerup',relPtr,true); document.addEventListener('pointercancel',relPtr,true);

function redrawCard(gid){ const el=document.getElementById('live-'+gid); if(!el) return; const tmp=document.createElement('div'); tmp.innerHTML=liveCard(G[gid]); el.replaceWith(tmp.firstElementChild); }
function toast(msg){ S.flash=msg; renderBank(); }

document.addEventListener('click',function(e){
  const t=e.target.closest('[data-act]'); if(!t) return;
  const act=t.getAttribute('data-act'); const gid=t.getAttribute('data-gid');
  if(act==='view'){ S.view=t.getAttribute('data-k'); render(); window.scrollTo(0,0); return; }
  if(act==='fs'){ openFS(t.getAttribute('data-g')); return; }
  if(act==='fsclose'){ closeFS(); return; }
  if(act==='snd'){ fsToggleSound(); return; }
  if(act==='sndtest'){ fsTestVoice(); return; }
  if(act==='lv-mode'){ const L=LS(gid); const m=t.getAttribute('data-mode'); if(L.mode!==m){ if(RT[gid]) RT[gid].running=false; L.mode=m; L.msg=''; if(m==='sim'&&L.started&&L.seed&&!(RT[gid]&&RT[gid].sim)) restoreSim(gid); persist(); } redrawCard(gid); return; }
  if(act==='lv-all'){ S.lvAll=!S.lvAll; DATA.games.forEach(x=>{ if(E('live-'+x.id)) refreshLive(x.id,true); else fsRefresh(x); }); return; }
  if(act==='lv-open'){ S.lvOpen[gid]=!S.lvOpen[gid]; RF('lv-mk-'+gid,marketsHtml(G[gid])); return; }
  if(act==='lv-stat'){ S.lvStat[t.getAttribute('data-key')]=t.getAttribute('data-stat'); RF('lv-mk-'+gid,marketsHtml(G[gid])); gid; return; }
  if(act==='sim-start'){ startSim(gid); persist(); redrawCard(gid); return; }
  if(act==='sim-toggle'){ const rt=RT[gid]; if(rt&&!LS(gid).done){ rt.running=!rt.running; persist(); } refreshLive(gid,true); return; }
  if(act==='sim-speed'){ LS(gid).speed=+t.getAttribute('data-v'); persist(); refreshLive(gid,true); return; }
  if(act==='sim-skip'){ const rt=RT[gid]; if(rt){ rt.running=false; } LS(gid).f=1; finishGame(gid); renderBank(); renderSlip(); refreshLive(gid,true); if(S.view==='slips') render(); return; }
  if(act==='sim-reset'){ const L=LS(gid); if(RT[gid]){ RT[gid].running=false; RT[gid].sim=null; } L.started=false; L.f=0; L.done=false; L.msg=''; persist(); redrawCard(gid); return; }
  if(act==='man-final'){ const L=LS(gid); L.man.final=true; finishGame(gid); renderBank(); renderSlip(); refreshLive(gid,true); return; }
  if(act==='bank-chip'){ S.bankDraft=t.getAttribute('data-v'); const inp=document.querySelector('[data-in="bank"]'); if(inp) inp.value=S.bankDraft; return; }
  if(act==='bank-set'){ const x=parseFloat(String(S.bankDraft!=null?S.bankDraft:P.start).replace(/[^0-9.]/g,'')); if(!isFinite(x)||x<MIN_LOAD){ toast('Enter an amount from $0.01 to $10,000.'); return; } const v=r2(clamp(x,MIN_LOAD,MAX_LOAD)); P.bank=v; P.start=v; S.bankDraft=String(v); persist(); toast('Practice bank set to '+money(v)+(x>MAX_LOAD?' (the most you can load is $10,000).':'.')); render(); return; }
  if(act==='mode'){ S.betMode=t.getAttribute('data-v'); renderSlip(); return; }
  if(act==='stake-chip'){ const v=t.getAttribute('data-v'); const amt=v==='max'?P.bank:P.bank*(+v/100); S.stake=String(Math.max(0.01,Math.floor(amt*100)/100)); renderSlip(); return; }
  if(act==='place'){ placeBet(); return; }
  if(act==='saveslip'){ saveSlip(); return; }
  if(act==='loadsaved'){ const s=P.saved.find(x=>x.id===+t.getAttribute('data-id')); if(!s) return; S.slip=[]; s.legs.forEach(l=>{ const f=legFor(l.id); if(f) S.slip.push(f); }); S.slipOpen=true; S.view='pre'; render(); toast(S.slip.length?'Loaded '+S.slip.length+' leg'+(S.slip.length>1?'s':'')+' with current prices.':'Those legs are no longer available.'); return; }
  if(act==='delsaved'){ P.saved=P.saved.filter(x=>x.id!==+t.getAttribute('data-id')); persist(); render(); return; }
  if(act==='clearhist'){ P.bets=P.bets.filter(b=>b.status==='pending'); persist(); render(); return; }
  if(act==='copyslip'){ const txt=slipText(S.slip); const say=m=>{ const e=document.getElementById('slipmsg'); if(e) e.textContent=m; };
    const viaBox=()=>{ const ta=document.getElementById('sliptxt'); let ok=false; if(ta){ try{ ta.focus(); ta.select(); ta.setSelectionRange(0,ta.value.length); ok=document.execCommand('copy'); }catch(err){} } say(ok?'Copied '+S.slip.length+' leg'+(S.slip.length>1?'s':'')+'. Now open Gambly and paste.':'Copy was blocked here. The slip text is selected in the box below: tap Copy in the pop-up menu, or press and hold and choose Copy.'); };
    try{ const p=navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(txt):null; if(p&&p.then) p.then(()=>say('Copied '+S.slip.length+' leg'+(S.slip.length>1?'s':'')+'. Now open Gambly and paste.'),viaBox); else viaBox(); }catch(err){ viaBox(); }
    return; }
  if(act==='book'){ const bk=t.getAttribute('data-bk'); const txt=slipText(S.slip); const url=t.getAttribute('href')||''; const native=bk!=='gambly'&&bk!=='fanaticsapp'&&/^https:\/\//i.test(url); if(!native) e.preventDefault();
    const say=m=>{ const el=document.getElementById('slipmsg'); if(el) el.textContent=m; };
    const okMsg=bk==='gambly'?'Slip copied. Paste it into the Gambly chat box and it builds the slip, then pick your sportsbook.':bk==='fanaticsapp'?'Slip copied. The Fanatics app opens but cannot load these bets, so paste or enter them there.':'Slip copied. The sportsbook opens on the game when it can; add the legs there (long-press, Paste, or enter them).';
    const failMsg='Could not copy automatically. The slip text is selected in the box above the book buttons, so copy it from there.';
    const viaBox=()=>{ const ta=document.getElementById('sliptxt'); let ok=false; if(ta){ try{ ta.focus(); ta.select(); ta.setSelectionRange(0,ta.value.length); ok=document.execCommand('copy'); }catch(err){} } say(ok?okMsg:failMsg); };
    /* 1) copy inside the tap (browsers only allow it there) 2) open the book in the same tap. Some iPhone home-screen apps ignore target=_blank links, so open it ourselves and fall back to the same window. */
    try{ const p=navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(txt):null; if(p&&p.then) p.then(()=>say(okMsg),viaBox); else viaBox(); }catch(err){ viaBox(); }
    if(url&&!native){ let w=null; try{ w=window.open(url,'_blank'); }catch(err){} if(!w){ say('Opening the sportsbook…'); setTimeout(()=>{ window.location.href=url; },350); } }
    return; }
});
document.addEventListener('input',function(e){
  const t=e.target; const k=t.getAttribute&&t.getAttribute('data-in'); if(!k) return;
  if(k==='stake'){ S.stake=t.value; updateCalc(); return; }
  if(k==='bank'){ S.bankDraft=t.value; return; }
  if(k==='tpl'){ P.tpl=t.value; persist(); return; }
  const gid=t.getAttribute('data-gid'); const L=gid?LS(gid):null;
  if(k==='man'){ L.man[t.getAttribute('data-f')]=t.value; }
  else if(k==='manplayer'){ const pid=t.getAttribute('data-pid'); (L.man.cur[pid]=L.man.cur[pid]||{})[t.getAttribute('data-stat')]=t.value; }
  else if(k==='manact'){ L.man.act[t.getAttribute('data-pid')]=t.value; }
  else if(k==='mangone'){ L.man.gone[t.getAttribute('data-pid')]=t.checked; }
  else return;
  persist();
  RF('lv-board-'+gid,boardHtml(G[gid])); RF('lv-best-'+gid,bestHtml(G[gid])); RF('lv-mk-'+gid,marketsHtml(G[gid]));
});
document.addEventListener('change',function(e){ const t=e.target; if(t&&t.getAttribute&&/^man/.test(t.getAttribute('data-in')||'')) { /* handled by input */ } });
