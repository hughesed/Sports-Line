/* ================= Gold picks: the highest-probability legs, every sport =================
   Pick of the day is now the GOLD pick: per sport, the single leg the app rates 90%+ likely to land (team line, alternate total, player threshold,
   soccer double chance / goal ladder...), shown in gold at the top of the home screen. Next to it, per sport, Gold slips: 3 and 5 legs that are each
   85%+, from different games where possible, with the all-hit chance. Everything is written down before kickoff and graded at the final, and the
   graded record feeds back: once 20 gold legs are graded, new gold chances are scaled by how often gold legs really landed (bounded 0.85 to 1.02).
   Alternate game totals (all sports but soccer, which has its own goal ladder): "Under 7.5" in hockey, "Under 11.5" in baseball, a total a few points
   past the book's in football and basketball; chance from the model's projected total blended with the book's, with the sport's usual spread.
   Practice only: a 90% leg pays little, and several of them still miss together more often than people expect. */
const GPK={p:0.90,slip:0.85,sizes:[3,5],maxPer:2,cache:{},ver:0};
const GOLD_SKIP={passes:1,tkl:1};                 // soccer passes / tackles: ESPN may not report them, so they are never gold
const GOLD_YDS={passYds:1,rushYds:1,recYds:1,rr:1,pr:1};
const GOLD_STEP={nfl:3.5,cfb:3.5,nba:5,wnba:4,cbb:4,mlb:1,nhl:1,tennis:2};

/* ---------- alternate game totals ---------- */
function altTotMu(g){ const cr=g.crossroads||{}, L=g.lines||{}; if(L.total==null) return null; return cr.projTotal!=null?0.5*cr.projTotal+0.5*(+L.total):+L.total; }
function altTotLeg(tok,parts,g){
  const dir=parts[3], line=parseFloat(parts[4]), lg=g.key||g.lg; if(!(dir==='over'||dir==='under')||!isFinite(line)) return null;
  const mu=altTotMu(g); if(mu==null) return null; const sd=SDT[lg]||10;
  let po; if(lg==='mlb'||lg==='nhl') po=poisGE(Math.floor(line)+1,Math.max(0.5,mu)); else po=1-phi((line-mu)/sd);
  const p=clamp(dir==='over'?po:1-po,0.02,0.97);
  return {id:tok,gid:g.id,group:g.id+':tot',label:(dir==='over'?'Over ':'Under ')+line+' (alt total)',p:p,avail:1,price:estPrice(p),src:'est.',spec:{k:'tot',dir:dir,line:line},alt:1};
}
function altTotToks(g){
  const L=g.lines||{}, lg=g.key||g.lg, st=GOLD_STEP[lg]; if(L.total==null||!st||lg==='soccer'||lg==='tennis') return [];
  const out=[]; for(let k=1;k<=3;k++){ out.push('g:'+g.id+':at:under:'+(+L.total+k*st)); out.push('g:'+g.id+':at:over:'+(+L.total-k*st)); }
  return out;
}

/* ---------- calibration from graded gold legs ---------- */
function goldCal(){
  const xs=[]; P.calls.forEach(c=>{ if(c.kind!=='potd'&&c.kind.indexOf('gold')!==0) return; (c.legs||[]).forEach(l=>{ if((l.res==='W'||l.res==='L')&&l.p>=0.85) xs.push(l); }); });
  const n=xs.length, said=n?xs.reduce((s,l)=>s+l.p,0)/n:0, got=n?xs.filter(l=>l.res==='W').length/n:0;
  return {n:n,said:said,got:got,f:n>=20&&said>0?clamp(got/said,0.85,1.02):1};
}

/* ---------- candidates: every pregame leg of a sport, one entry per bet ---------- */
function goldGames(key){ const now=Date.now(); return DATA.games.filter(g=>keyOf(g)===key&&preOK(g)&&leagueOK(key)&&(Date.parse(g.iso)-now)<36*3600e3); }
function goldLegsOf(g){
  const ck=g.id+'|'+CALV+'|'+((window.__LSDATA&&window.__LSDATA.odds&&window.__LSDATA.odds.generatedAt)||''); if(GPK.cache[ck]) return GPK.cache[ck];
  const seen={}, out=[]; const cal=goldCal();
  const add=l=>{ if(!l||l.price==null||!isFinite(l.price)||!l.spec||l.live) return; if(l.spec.stat&&GOLD_SKIP[l.spec.stat]) return;
    if(l.spec.k==='prop'&&GOLD_YDS[l.spec.stat]&&l.spec.dir==='ge'&&+l.spec.T<10) return;          // "2+ rush yds" is not a pick
    if(l.spec.k==='prop'&&l.spec.dir==='ge'){ try{ const pl=findPlayer(g,l.spec.pid), st=pl&&pl.stats.find(x=>x.key===l.spec.stat), mu=st&&typeof flMu==='function'?flMu(st):null;
      if(mu!=null&&+l.spec.T<0.3*mu) return; }catch(e){} }                                           // nor is "1+ strikeouts" for a starter who projects 6.5
    const key=(l.label||'')+'|'+g.id; if(seen[key]) return; seen[key]=1;
    const p0=l.ps!=null?l.ps:adjP(clamp(l.p*(l.avail==null?1:l.avail),0,0.99),l.spec.k==='prop'?'prop':'team');
    const tok=l.tok||l.id; const book=l.book?(l.book==='est'?'est':l.book):(l.src==='FanDuel'?'fanduel':l.src==='DraftKings'||l.src==='DK'?'draftkings':'est');
    out.push({tok:tok,id:tok,gid:g.id,g:g,label:l.label,price:l.price,p:clamp(p0*cal.f,0.01,0.99),ps:clamp(p0*cal.f,0.01,0.99),book:book,est:book==='est',spec:l.spec,group:l.group||tok,pid:l.pid||(l.spec&&l.spec.pid)||null,lead:l.lead||0}); };
  try{ preLegs(g).forEach(add); }catch(e){}
  try{ if(typeof hpLegs==='function') hpLegs(g).forEach(add); }catch(e){}
  try{ altTotToks(g).forEach(t=>add(legFor(t))); }catch(e){}
  Object.keys(GPK.cache).forEach(k=>{ if(k.indexOf(g.id+'|')===0) delete GPK.cache[k]; });
  GPK.cache[ck]=out; return out;
}
/* rank: the chance (anything past 95% counts as 95%, so a near-certain leg that pays nothing does not beat a 94% leg at a real price), a sportsbook price over an estimate, then the better price */
const GOLD_MAX=0.97;          // above this a leg is filler the book would not list at a usable price
const goldScore=l=>Math.min(l.ps,0.95)+(l.est?0:0.012)+0.004*(l.lead||0)+Math.min(0.01,Math.max(0,(decOf(l.price)-1)*0.05));
function goldPick(key){
  const gs=goldGames(key); if(!gs.length) return null; let best=null, near=null;
  gs.forEach(g=>goldLegsOf(g).forEach(l=>{
    if(l.ps>GOLD_MAX) return;
    if(l.ps>=GPK.p){ if(!best||goldScore(l)>goldScore(best)+1e-9||(Math.abs(goldScore(l)-goldScore(best))<1e-9&&l.price>best.price)) best=l; }
    else if(!near||l.ps>near.ps) near=l; }));
  return {key:key,best:best,near:near,games:gs.length};
}
/* a gold slip: the n highest-chance legs of one sport, each at least GPK.slip, one per bet group and player, at most GPK.maxPer per game */
function goldSlip(key,n){
  const all=[]; goldGames(key).forEach(g=>goldLegsOf(g).forEach(l=>{ if(l.ps>=GPK.slip&&l.ps<=GOLD_MAX) all.push(l); }));
  all.sort((a,b)=>goldScore(b)-goldScore(a)||b.price-a.price);
  const pick=[], grp={}, per={}, ply={};
  for(const l of all){ if(pick.length>=n) break; if(grp[l.group]||(per[l.gid]||0)>=GPK.maxPer||(l.pid&&ply[l.pid])) continue;
    if(l.spec.k==='ml'||l.spec.k==='spr'||l.spec.k==='dc'){ if(pick.some(x=>x.gid===l.gid&&(x.spec.k==='ml'||x.spec.k==='spr'||x.spec.k==='dc'))) continue; }
    pick.push(l); grp[l.group]=1; per[l.gid]=(per[l.gid]||0)+1; if(l.pid) ply[l.pid]=1; }
  if(pick.length<2) return null;
  const same=pick.length-new Set(pick.map(l=>l.gid)).size;          // legs in one game are linked: 3% off per extra leg in the same game
  const pAll=pick.reduce((x,l)=>x*l.ps,1)*Math.pow(0.97,same), dec=pick.reduce((d,l)=>d*decOf(l.price),1);
  return {key:key,n:n,legs:pick,pAll:pAll,dec:dec,am:amerOfDec(dec),short:pick.length<n};
}

/* ---------- ledger: gold slips are recorded once per sport, size and day ---------- */
function goldSlipFor(key,n){
  const id='gold:'+TODAY+':'+key+':'+n; const c=P.calls.find(x=>x.id===id);
  if(c&&c.status==='pending'&&c.legs.every(l=>{ const g=G[l.gid]; return g&&preOK(g); })){
    const legs=c.legs.map(l=>{ const g=G[l.gid]; return Object.assign({},l,{tok:l.id,g:g,ps:l.p}); });
    const same=legs.length-new Set(legs.map(l=>l.gid)).size;
    return {key:key,n:n,legs:legs,pAll:legs.reduce((x,l)=>x*l.ps,1)*Math.pow(0.97,same),dec:legs.reduce((d,l)=>d*decOf(l.price),1),am:amerOfDec(legs.reduce((d,l)=>d*decOf(l.price),1)),short:legs.length<n,locked:true};
  }
  const s=goldSlip(key,n); if(s&&!c) GPK.todo[id]=s; return s;
}
GPK.todo={};
function goldLog(){
  const ids=Object.keys(GPK.todo); let add=0;
  ids.forEach(id=>{ if(hasCall(id)) return; const s=GPK.todo[id];
    P.calls.push({id:id,date:TODAY,key:s.key,gid:'',multi:true,kind:'gold'+s.n,t:Date.now(),status:'pending',want:s.n,dec:Math.round(s.dec*100)/100,pAll:Math.round(s.pAll*10000)/10000,
      legs:s.legs.map(l=>({id:l.tok,gid:l.gid,pid:l.pid,label:l.label,price:l.price,p:Math.round(l.ps*1000)/1000,spec:l.spec,res:null,game:l.g?l.g.teams.away.abbr+' @ '+l.g.teams.home.abbr:'',est:l.est?1:0}))}); add++; });
  GPK.todo={}; if(add){ trimCalls(); persist(); }
}

/* ---------- the home-screen section ---------- */
function goldRecord(key){
  const cs=P.calls.filter(c=>(c.kind==='potd'||c.kind.indexOf('gold')===0)&&c.key===key&&c.status!=='pending'&&c.status!=='void');
  const legs=[]; cs.forEach(c=>c.legs.forEach(l=>{ if(l.res==='W'||l.res==='L') legs.push(l); }));
  const p=cs.filter(c=>c.kind==='potd');
  return {pick:p.length?p.filter(c=>c.status==='hit').length+'-'+p.filter(c=>c.status!=='hit').length:'',legs:legs.length?legs.filter(l=>l.res==='W').length+'/'+legs.length:''};
}
function goldLegLine(l){ const g=l.g||G[l.gid];
  return '<span class="glleg"><span class="gll">'+esc(l.label)+(g?' <span class="muted small">'+esc(g.teams.away.abbr+' @ '+g.teams.home.abbr)+'</span>':'')+'</span><span class="mono glp">'+fo(l.price)+(l.est?'*':'')+' · '+Math.round(l.ps*100)+'%</span></span>'; }
function goldSportHtml(key){
  const name=LGN[key]||key.toUpperCase(), r=goldPick(key), rec=goldRecord(key);
  const recT=(rec.pick?'gold picks '+rec.pick:'no graded gold pick yet')+(rec.legs?' · gold legs '+rec.legs:'');
  let h='<div class="gold"><div class="glh"><b>'+esc(name)+'</b><span class="muted small">'+esc(recT)+'</span></div>';
  if(!r) return h+'<div class="small muted">Every '+esc(name)+' game on the board has started.</div></div>';
  if(r.best){ const l=r.best, on=inSlip(l.tok);
    h+='<button class="glpick'+(on?' on':'')+'" data-act="leg" data-tok="'+esc(l.tok)+'" aria-pressed="'+on+'"><span class="glbadge">GOLD PICK</span><span class="glrow"><span class="gll">'+esc(l.label)+'<span class="muted small"> · '+esc(l.g.teams.away.abbr+' @ '+l.g.teams.home.abbr)+'</span></span><span class="glbig">'+Math.round(l.ps*100)+'%<small class="mono">'+fo(l.price)+(l.est?' est.':'')+'</small></span></span></button>';
  } else h+='<div class="small">No leg reaches '+Math.round(GPK.p*100)+'% in '+esc(name)+' right now.'+(r.near?' <span class="muted">Closest: '+esc(r.near.label)+' ('+esc(r.near.g.teams.away.abbr+' @ '+r.near.g.teams.home.abbr)+') '+Math.round(r.near.ps*100)+'%.</span>':'')+'</div>';
  let lastN=0; GPK.sizes.forEach(n=>{ const s=goldSlipFor(key,n); if(!s||s.legs.length<=lastN) return; lastN=s.legs.length; const on=s.legs.every(l=>inSlip(l.tok));
    h+='<details class="glslip"><summary><span><b>Gold '+n+'</b>'+(s.short?' <span class="muted small">('+s.legs.length+' legs)</span>':'')+'</span><span class="mono small">~'+Math.round(s.pAll*100)+'% all hit · '+fo(s.am)+'</span></summary>'+
      s.legs.map(goldLegLine).join('')+'<div class="btnrow"><button class="btn'+(on?'':' solid')+' glbtn" data-act="gold-add" data-k="'+esc(key)+'" data-n="'+n+'">'+(on?'Remove from slip':'Add to slip')+'</button></div></details>'; });
  return h+'</div>';
}
function goldHtml(){
  const keys=[]; DATA.games.forEach(g=>{ const k=keyOf(g); if(keys.indexOf(k)<0&&leagueOK(k)&&(S.league==='all'||S.league===k)) keys.push(k); });
  const order=['nfl','cfb','nba','wnba','cbb','mlb','nhl','soccer','tennis']; keys.sort((a,b)=>(order.indexOf(a)+99)%99-(order.indexOf(b)+99)%99);
  if(!keys.length) return '';
  const picks=keys.map(k=>goldPick(k)).filter(r=>r&&r.best).map(r=>r.best);
  const allOn=picks.length>1&&picks.every(l=>inSlip(l.tok)); const pAll=picks.reduce((x,l)=>x*l.ps,1);
  const cal=goldCal();
  return '<section class="game goldsec"><div class="sec"><h3>Gold picks <span class="hint">'+Math.round(GPK.p*100)+'%+ chance, one per sport · gold slips: every leg '+Math.round(GPK.slip*100)+'%+</span></h3>'+
    (picks.length>1?'<button class="btn solid glall" data-act="gold-all">'+(allOn?'Remove the gold picks from the slip':'Add all '+picks.length+' gold picks to the slip (~'+Math.round(pAll*100)+'% all hit)')+'</button>':'')+
    keys.map(goldSportHtml).join('')+
    '<div class="small muted">The gold pick is the leg the app rates most likely to land in each sport, team lines and player numbers alike, with a sportsbook price preferred over an estimate (* = estimated price; the book may price it differently or not list it). Chances blend the book\'s no-vig price with the model and are scaled by the app\'s own graded record'+(cal.n>=20?' (gold legs said '+Math.round(cal.said*100)+'%, landed '+Math.round(cal.got*100)+'%, so new ones are scaled by '+cal.f.toFixed(2)+')':' once 20 gold legs are graded ('+cal.n+' so far)')+'. A 90% leg pays little and still misses about one time in ten; five of them all land only about 6 times in 10. Written down before kickoff, graded at the final.</div></div></section>';
}
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act="gold-add"],[data-act="gold-all"]'); if(!t) return; e.stopPropagation(); e.preventDefault();
  let legs=[];
  if(t.getAttribute('data-act')==='gold-all'){ DATA.games.forEach(()=>{}); const keys=[]; DATA.games.forEach(g=>{ const k=keyOf(g); if(keys.indexOf(k)<0&&leagueOK(k)&&(S.league==='all'||S.league===k)) keys.push(k); }); keys.forEach(k=>{ const r=goldPick(k); if(r&&r.best) legs.push(r.best); }); }
  else { const s=goldSlipFor(t.getAttribute('data-k'),+t.getAttribute('data-n')); if(s) legs=s.legs; }
  if(!legs.length) return;
  if(legs.every(l=>inSlip(l.tok))){ S.slip=S.slip.filter(x=>!legs.some(l=>l.tok===x.id)); S.slipMsg=''; }
  else { S.slip=legs.map(l=>legFor(l.tok)).filter(Boolean); S.betMode='parlay'; S.slipOpen=true; S.slipMsg='Loaded '+S.slip.length+' gold legs. Each is rated '+Math.round(GPK.slip*100)+'%+ but they can still miss together.'; }
  renderSlip(); syncLegButtons(); render();
},true);
try{ if(window.__LS) window.__LS.gold={pick:goldPick,slip:goldSlip,legs:goldLegsOf,cal:goldCal,alt:altTotLeg,html:goldHtml}; }catch(e){}
