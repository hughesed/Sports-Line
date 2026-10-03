/* ================= safe slips, pick of the day, tracked calls, self-check ================= */
const POTD_P=0.80, POTD_PRICE=-140, MIN_SAFE=0.55, KEEP_DAYS=24, MAX_CALLS=700, MAX_LIVE_PER_GAME=8;
const KINDN={safe2:'Safe 2',safe4:'Safe 4',safe8:'Safe 8',potd:'Pick of the day',live:'Live calls'};
if(!Array.isArray(P.calls)) P.calls=[];

/* ---------- helpers ---------- */
const wallStarted=g=>{ const t=Date.parse(g.iso||''); return isFinite(t)&&Date.now()>=t-120000; };
const gDone=g=>!!((P.live||{})[g.id]||{}).done;
const preOK=g=>!!g.iso&&!wallStarted(g)&&!feedStarted(g.id)&&!gDone(g);
const gDay=g=>g.day||TODAY;
const legKind=l=>(l.spec&&l.spec.k==='prop')?'prop':'team';

/* ---------- self-check: how well did past calls do, and how much to trust new ones ---------- */
let CALV=0;
function legsGraded(kinds){
  const out=[]; P.calls.forEach(c=>{ if(kinds&&kinds.indexOf(c.kind)<0) return; (c.legs||[]).forEach(l=>{ if(l.res==='W'||l.res==='L') out.push({l:l,c:c}); }); });
  return out;
}
function calStats(){
  const r={}; ['prop','team'].forEach(k=>{
    const xs=legsGraded().filter(o=>legKind(o.l)===k&&o.c.kind!=='live'&&o.l.p>=0.5);
    const n=xs.length, said=n?xs.reduce((s,o)=>s+o.l.p,0)/n:0, got=n?xs.filter(o=>o.l.res==='W').length/n:0;
    let f=1; if(n>=25&&said>0) f=clamp(got/said,0.6,1.05);
    r[k]={n:n,said:said,got:got,f:f};
  });
  return r;
}
let CAL=calStats(), CALSIG='';
function calSigOf(c){ return ['prop','team'].map(k=>c[k].n+':'+c[k].f.toFixed(3)).join('|'); }
function calRefresh(){ CAL=calStats(); const g=calSigOf(CAL); if(g!==CALSIG){ CALSIG=g; CALV++; } }
function adjP(p,kind){ const c=CAL[kind]; return c&&c.n>=25?clamp(p*c.f,0.01,0.99):p; }

/* ---------- enumerate the pregame legs of a game ---------- */
function preToks(g){
  const out=[], L=g.lines||{};
  if(L.mlHome!=null&&L.mlAway!=null) ['home','away'].forEach(s=>out.push('g:'+g.id+':ml:'+s));
  if(L.sprHome!=null&&L.prHome!=null) ['home','away'].forEach(s=>out.push('g:'+g.id+':spr:'+s));
  if(L.total!=null&&L.over!=null) ['over','under'].forEach(d=>out.push('g:'+g.id+':tot:'+d));
  (g.players||[]).forEach(pl=>{
    if(pl.status&&pl.status.kind==='out') return;
    (pl.stats||[]).forEach(st=>{
      if(st.safeAdj!=null&&st.pSafe!=null) out.push('p:'+g.id+':'+pl.id+':'+st.key+':safe');
      (st.miles||[]).forEach(m=>out.push('p:'+g.id+':'+pl.id+':'+st.key+':m:'+m.t));
    });
  });
  return out;
}
function preLegs(g){
  const seen={}, out=[];
  preToks(g).forEach(t=>{
    const l=legFor(t); if(!l||l.price==null||!isFinite(l.price)||!l.spec) return;
    if(seen[l.label]) return; seen[l.label]=1;
    l.ps=adjP(clamp(l.p*(l.avail==null?1:l.avail),0,0.99),legKind(l)); out.push(l);
  });
  return out;
}

/* ---------- safe 2 / 4 / 8 ---------- */
const SAFE_CACHE={};
function safeSlip(g,n,legs){
  const pick=[], grp={}, per={}; let side=null;
  for(const l of legs){
    if(pick.length>=n) break; if(l.ps<MIN_SAFE) break;
    if(grp[l.group]) continue;
    const k=l.spec.k;
    if(k==='prop'){ if((per[l.pid]||0)>=2) continue; }
    else if(k==='ml'||k==='spr'){ if(side&&side!==l.spec.side) continue; }
    pick.push(l); grp[l.group]=1;
    if(k==='prop') per[l.pid]=(per[l.pid]||0)+1; else if(k!=='tot') side=l.spec.side;
  }
  const dec=pick.reduce((d,l)=>d*decOf(l.price),1), pAll=pick.reduce((p,l)=>p*l.ps,1);
  return {n:n,legs:pick,dec:dec,pAll:pAll,short:pick.length<n};
}
function safeAll(g){
  const key=g.id+':'+CALV; if(SAFE_CACHE[key]) return SAFE_CACHE[key];
  const legs=preLegs(g).sort((a,b)=>b.ps-a.ps||decOf(b.price)-decOf(a.price));
  const r={2:safeSlip(g,2,legs),4:safeSlip(g,4,legs),8:safeSlip(g,8,legs)};
  Object.keys(SAFE_CACHE).forEach(k=>{ if(k.indexOf(g.id+':')===0) delete SAFE_CACHE[k]; });
  SAFE_CACHE[key]=r; return r;
}
function slipIsSafe(g,n){
  const s=safeAll(g)[n]; if(!s.legs.length||S.slip.length!==s.legs.length) return false;
  const ids={}; S.slip.forEach(l=>ids[l.id]=1); return s.legs.every(l=>ids[l.id]);
}
function safeBar(g){
  const all=safeAll(g);
  if(!preOK(g)){
    const mine=P.calls.filter(c=>c.gid===g.id&&/^safe/.test(c.kind));
    if(!mine.length) return '';
    return '<div class="sec safebar"><h3>Safe slips <span class="hint">recorded before kickoff</span></h3><div class="vcs">'+mine.map(c=>callChip(c)).join('')+'</div></div>';
  }
  const btns=[2,4,8].map(n=>{
    const s=all[n]; const on=slipIsSafe(g,n);
    if(!s.legs.length) return '<button class="safeb" disabled><b>Safe '+n+'</b><span>no legs clear '+Math.round(MIN_SAFE*100)+'%</span></button>';
    const am=amerOfDec(s.dec);
    return '<button class="safeb'+(on?' on':'')+'" data-act="safeN" data-gid="'+g.id+'" data-n="'+n+'" aria-pressed="'+on+'"><b>Safe '+n+(s.short?' ('+s.legs.length+' legs)':'')+'</b><span>~'+Math.round(s.pAll*100)+'% all hit · est. '+fo(am)+'</span></button>';
  }).join('');
  const sh=[2,4,8].filter(n=>all[n].short&&all[n].legs.length);
  const note=(g.players&&g.players.length)?(sh.length?'Fewer legs than asked are shown when not enough clear '+Math.round(MIN_SAFE*100)+'%.':'')
    :'No player props are published for this league, so only the game lines can be used; slips are capped at the lines that clear '+Math.round(MIN_SAFE*100)+'%.';
  const shown=[2,4,8].map(n=>all[n]).filter(s=>s.legs.length);
  const detail=shown.length?'<details class="d"><summary>What is in each safe slip</summary>'+[2,4,8].map(n=>{ const s=all[n]; return s.legs.length?'<div class="small"><b>Safe '+n+'</b>: '+s.legs.map(l=>esc(l.label)+' <span class="mono">'+fo(l.price)+'</span> <span class="muted">'+Math.round(l.ps*100)+'%</span>').join(' · ')+'</div>':''; }).join('')+
    '<div class="small muted">The chance shown multiplies each leg\'s own chance as if they were unrelated and uses the model\'s own prices, so a sportsbook\'s same-game price will differ. Tap one to load it into the slip.</div></details>':'';
  return '<div class="sec safebar"><h3>Safe slips <span class="hint">highest-chance legs · tap to load</span></h3><div class="safebtns">'+btns+'</div>'+(note?'<div class="small muted">'+esc(note)+'</div>':'')+detail+'</div>';
}

/* ---------- pick of the day, per sport ---------- */
function potdFor(key){
  const gs=DATA.games.filter(g=>keyOf(g)===key&&preOK(g)); if(!gs.length) return null;
  let best=null, near=null;
  gs.forEach(g=>{
    preLegs(g).forEach(l=>{
      if(l.src!=='DraftKings') return;                      // price must be a real book price, not the model's own
      const ev=l.ps*decOf(l.price)-1; const o={g:g,l:l,ev:ev};
      if(l.ps>=POTD_P&&l.price>=POTD_PRICE){ if(!best||ev>best.ev) best=o; }
      else if(l.ps>=0.7&&l.price>=-200){ if(!near||ev>near.ev) near=o; }
    });
  });
  return {key:key,best:best,near:near,games:gs.length};
}
function potdRecord(key){
  const cs=P.calls.filter(c=>c.kind==='potd'&&c.key===key&&c.status!=='pending'&&c.status!=='void');
  return {n:cs.length,w:cs.filter(c=>c.status==='hit').length};
}
function potdHtml(){
  const keys=[]; DATA.games.forEach(g=>{ const k=keyOf(g); if(keys.indexOf(k)<0&&leagueOK(k)) keys.push(k); });
  const rows=keys.map(k=>{
    const r=potdFor(k); const rec=potdRecord(k); const recT=rec.n?rec.w+'-'+(rec.n-rec.w)+' so far':'no graded picks yet';
    const name=LGN[k]||k.toUpperCase();
    if(!r) return '<div class="potd none"><div class="ph"><b>'+esc(name)+'</b><span class="muted small">'+recT+'</span></div><div class="small muted">Every '+esc(name)+' game on the board has started or finished, so there is nothing left to pick.</div></div>';
    if(r.best){ const l=r.best.l, g=r.best.g, on=inSlip(l.id);
      return '<button class="potd hit'+(on?' on':'')+'" data-act="leg" data-tok="'+esc(l.id)+'" aria-pressed="'+on+'"><span class="ph"><b>'+esc(name)+' pick of the day</b><span class="muted small">'+recT+'</span></span><span class="pkrow"><span class="pklab">'+esc(l.label)+'<span class="muted small"> · '+esc(g.teams.away.abbr)+' @ '+esc(g.teams.home.abbr)+'</span></span><span class="mono pkpr">'+fo(l.price)+'<br><span class="muted">'+Math.round(l.ps*100)+'%</span></span></span></button>';
    }
    const n=r.near;
    return '<div class="potd none"><div class="ph"><b>'+esc(name)+' pick of the day</b><span class="muted small">'+recT+'</span></div><div class="small">No pick clears '+Math.round(POTD_P*100)+'% at '+fo(POTD_PRICE)+' or better today.'+(n?' <span class="muted">Closest: '+esc(n.l.label)+' ('+esc(n.g.teams.away.abbr)+' @ '+esc(n.g.teams.home.abbr)+') '+Math.round(n.l.ps*100)+'% at '+fo(n.l.price)+', not recorded.</span>':'')+'</div></div>';
  });
  return '<section class="game potds"><div class="sec"><h3>Pick of the day <span class="hint">'+Math.round(POTD_P*100)+'%+ chance, '+fo(POTD_PRICE)+' or better, real book price</span></h3>'+rows.join('')+'<div class="small muted">One pick per sport at most. Picks are written down before kickoff and graded at the final, so the record is honest. A quiet board is normal: a '+Math.round(POTD_P*100)+'% chance at a '+fo(POTD_PRICE)+' price is rare.</div></div></section>';
}

/* ---------- ledger: write down before kickoff, grade at the final ---------- */
function mkCall(g,kind,legs,extra){
  const c={id:gDay(g)+':'+g.id+':'+kind,date:gDay(g),key:keyOf(g),gid:g.id,kind:kind,t:Date.now(),status:'pending',
    legs:legs.map(l=>({id:l.id,gid:l.gid,label:l.label,price:l.price,p:Math.round(l.ps!=null?l.ps*1000:l.p*1000)/1000,spec:l.spec,res:null}))};
  if(extra) Object.keys(extra).forEach(k=>c[k]=extra[k]); return c;
}
function hasCall(id){ return P.calls.some(c=>c.id===id); }
function logPre(){
  let add=0;
  DATA.games.forEach(g=>{
    if(!preOK(g)) return; const all=safeAll(g);
    [2,4,8].forEach(n=>{ const s=all[n], id=gDay(g)+':'+g.id+':safe'+n; if(s.legs.length>=2&&!hasCall(id)){ P.calls.push(mkCall(g,'safe'+n,s.legs,{want:n})); add++; } });
  });
  const keys=[]; DATA.games.forEach(g=>{ const k=keyOf(g); if(keys.indexOf(k)<0) keys.push(k); });
  keys.forEach(k=>{ const r=potdFor(k); if(!r||!r.best) return; const g=r.best.g, id=gDay(g)+':'+g.id+':potd'; if(hasCall(id)) return;
    if(P.calls.some(c=>c.kind==='potd'&&c.key===k&&c.date===gDay(g))) return;   // one per sport per day
    P.calls.push(mkCall(g,'potd',[r.best.l])); add++; });
  if(add){ trimCalls(); persist(); }
}
const feedLive=gid=>{ const f=FEED[gid]; return !!f&&f.st&&f.st.s==='in'; };
function logLiveCalls(g,st,picks){
  if(!feedLive(g.id)||!picks||!picks.length) return;
  let add=0; const have=P.calls.filter(c=>c.kind==='live'&&c.gid===g.id);
  picks.forEach(o=>{
    const l=o.leg; if(!l||l.closed||l.p<LIVE_P) return;
    if(have.length+add>=MAX_LIVE_PER_GAME) return;
    const id=gDay(g)+':'+g.id+':live:'+l.id;
    if(hasCall(id)||have.some(c=>c.legs[0]&&c.legs[0].group===l.group)) return;
    const c=mkCall(g,'live',[l]); c.id=id; c.legs[0].group=l.group; c.clock=(FEED[g.id].st.clk?('Q'+FEED[g.id].st.per+' '+FEED[g.id].st.clk):'')||''; c.score=st.away+'-'+st.home; if(o.lean) c.lean=1;
    P.calls.push(c); add++;
  });
  if(add){ trimCalls(); persist(); }
}
function trimCalls(){
  const cut=new Date(Date.now()-KEEP_DAYS*864e5).toISOString().slice(0,10);
  P.calls=P.calls.filter(c=>c.date>=cut||c.status==='pending');
  if(P.calls.length>MAX_CALLS) P.calls=P.calls.slice(P.calls.length-MAX_CALLS);
}
function settleCalls(gid,F){
  let n=0;
  P.calls.forEach(c=>{
    if(c.status!=='pending'||c.gid!==gid) return;
    c.legs.forEach(l=>{ if(!l.res) l.res=gradeLeg(l,F); });
    if(c.legs.some(l=>l.res==='L')) c.status='miss';
    else if(c.legs.every(l=>l.res)) c.status=c.legs.every(l=>l.res==='V')?'void':'hit';
    if(c.status!=='pending') n++;
  });
  if(n){ calRefresh(); persist(); }
}

/* ---------- display of tracked calls ---------- */
function callChip(c){
  const cls=c.status==='hit'?'ok':c.status==='miss'?'bad':'';
  const sym=c.status==='hit'?'✓ ':c.status==='miss'?'✗ ':c.status==='void'?'– ':'… ';
  const gg=G[c.gid]; const where=gg?gg.teams.away.abbr+' @ '+gg.teams.home.abbr:'';
  const legs=c.legs.map(l=>(l.res==='W'?'✓ ':l.res==='L'?'✗ ':l.res==='V'?'– ':'… ')+l.label+' ('+fo(l.price)+', '+Math.round(l.p*100)+'%)').join('\n');
  const nm=c.kind==='live'?(c.legs[0].label+(c.clock?' · '+c.clock:'')):(KINDN[c.kind]+(c.kind.indexOf('safe')===0&&c.legs.length<c.want?' ('+c.legs.length+' legs)':'')+(c.kind==='potd'?': '+c.legs[0].label:''));
  const hitn=c.legs.filter(l=>l.res==='W').length;
  return '<span class="vc '+cls+'" title="'+esc(where+'\n'+legs)+'">'+sym+esc(nm)+(c.kind.indexOf('safe')===0?' <span class="muted">('+hitn+'/'+c.legs.length+')</span>':'')+'</span>';
}
function callsOn(date){ return P.calls.filter(c=>c.date===date); }
function callCount(date){ return P.calls.reduce((n,c)=>n+(c.date===date?1:0),0); }
function tallyCalls(cs){
  const t={n:0,w:0,legN:0,legW:0};
  cs.forEach(c=>{ if(c.status==='pending'||c.status==='void') return; t.n++; if(c.status==='hit') t.w++; c.legs.forEach(l=>{ if(l.res==='W'||l.res==='L'){ t.legN++; if(l.res==='W') t.legW++; } }); });
  return t;
}
function callsDayHtml(date){
  const cs=callsOn(date).filter(c=>leagueOK(c.key));
  const live=cs.filter(c=>c.kind==='live'), rest=cs.filter(c=>c.kind!=='live');
  const gm=id=>{ const g=G[id]; return g?g.teams.away.abbr+' @ '+g.teams.home.abbr:id; };
  let h='<section class="game"><div class="sec"><h3>Tracked picks <span class="hint">written down before kickoff or when the live view showed them</span></h3>';
  if(!cs.length) return h+'<div class="small muted">Nothing was recorded for this day'+(S.league==='all'?'':' in this league')+'. Safe slips and picks of the day are recorded when this page is open before kickoff; live calls are recorded while a game is live and the page is open.</div></div></section>';
  const byG={}; rest.forEach(c=>{ (byG[c.gid]=byG[c.gid]||[]).push(c); });
  h+=Object.keys(byG).map(id=>'<div class="rg"><div class="rgh"><b>'+esc(gm(id))+'</b></div><div class="vcs">'+byG[id].sort((a,b)=>a.kind<b.kind?-1:1).map(callChip).join('')+'</div></div>').join('');
  if(live.length){ const t=tallyCalls(live);
    h+='<div class="rg"><div class="rgh"><b>Live bets pointed out</b><span class="mono">'+t.w+'/'+t.n+' landed</span></div><div class="vcs">'+live.map(c=>'<span class="vcw">'+esc(gm(c.gid))+'</span>'+callChip(c)).join('')+'</div></div>'; }
  return h+'</div></section>';
}
function callsSummaryHtml(){
  const cut=new Date(Date.now()-7*864e5).toISOString().slice(0,10);
  const cs=P.calls.filter(c=>c.date>=cut&&leagueOK(c.key));
  const rows=[]; ['safe2','safe4','safe8','potd','live'].forEach(k=>{ const t=tallyCalls(cs.filter(c=>c.kind===k)); if(t.n) rows.push('<div class="kv"><div class="k">'+KINDN[k]+'</div><div class="v">'+t.w+'/'+t.n+'</div><div class="s">legs '+t.legW+'/'+t.legN+(t.legN?' ('+Math.round(100*t.legW/t.legN)+'%)':'')+'</div></div>'); });
  let h='<section class="game"><div class="sec"><h3>Tracked picks, last 7 days <span class="hint">'+cs.length+' recorded</span></h3>';
  if(!rows.length) return h+'<div class="small muted">No graded picks yet. Recording starts with the first slate this page sees before kickoff, so the first results arrive after those games finish.</div></div></section>';
  h+='<div class="proj">'+rows.join('')+'</div>';
  const keys=[]; cs.forEach(c=>{ if(keys.indexOf(c.key)<0) keys.push(c.key); });
  h+=keys.map(k=>{ const cc=cs.filter(c=>c.key===k); const parts=['safe2','safe4','safe8','potd','live'].map(x=>{ const t=tallyCalls(cc.filter(c=>c.kind===x)); return t.n?KINDN[x]+' '+t.w+'/'+t.n:''; }).filter(Boolean); return parts.length?'<div class="small"><b>'+esc(LGN[k]||k)+'</b> <span class="muted">'+parts.join(' · ')+'</span></div>':''; }).join('');
  return h+'<div class="small muted">A safe slip counts as hit only when every leg hits. Leg percentages show how often single legs landed.</div></div></section>';
}
function selfCheckHtml(){
  const c=CAL; const row=(k,lab)=>{ const x=c[k]; return x.n?'<div class="small"><b>'+lab+'</b> '+x.n+' graded legs: the model said '+Math.round(x.said*100)+'% on average, they hit '+Math.round(x.got*100)+'%.'+(x.n>=25?(Math.abs(x.f-1)<0.02?' No adjustment needed.':' New picks are now scaled by '+x.f.toFixed(2)+'.'):' Adjustments start at 25 graded legs.')+'</div>':''; };
  const a=row('prop','Player legs'), b=row('team','Game-line legs');
  return '<section class="game"><div class="sec"><h3>Self-check <span class="hint">the model grades itself</span></h3>'+(a||b?a+b:'<div class="small muted">No graded legs yet. After 25 or more graded legs the app compares what it predicted with what happened and scales future chances up or down, so overconfident picks lose rank automatically.</div>')+'</div></section>';
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  const t=e.target.closest('[data-act="safeN"]'); if(!t) return;
  const g=G[t.getAttribute('data-gid')]; const n=+t.getAttribute('data-n'); if(!g||!preOK(g)) return;
  const s=safeAll(g)[n]; if(!s.legs.length) return;
  if(slipIsSafe(g,n)){ S.slip=[]; S.slipMsg=''; }
  else { S.slip=s.legs.map(l=>l); S.betMode='parlay'; S.slipOpen=true; S.slipMsg='Loaded Safe '+n+' ('+s.legs.length+' legs). Chances are the model\'s own and legs in one game are linked, so the real price will differ.'; }
  renderSlip(); syncLegButtons(); renderGame(g.id);
});

function trackRecordHtml(){
  const cut=new Date(Date.now()-7*864e5).toISOString().slice(0,10);
  const n=P.calls.filter(c=>c.date>=cut&&c.status!=='pending'&&c.status!=='void').length;
  return '<details class="how"><summary>Track record, last 7 days <span class="muted small">'+(n?n+' graded':'building')+'</span></summary><div class="body">'+callsSummaryHtml()+selfCheckHtml()+'</div></details>';
}

try{ window.__LS={get P(){return P},get S(){return S},get G(){return G},get CAL(){return CAL},get FEED(){return FEED},cands:(gid)=>candidates(G[gid],stateOf(G[gid])),stateOf:(gid)=>stateOf(G[gid]),logLive:(gid)=>logLiveCalls(G[gid],stateOf(G[gid]),candidates(G[gid],stateOf(G[gid])))}; }catch(e){}
