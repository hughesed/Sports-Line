/* ================= Home screen picks built from the sportsbook feed (data/odds.json, SportsGameOdds) =================
   Same-game parlays for every sport (NFL, college football, NBA, WNBA, college basketball, MLB), "safe" legs chosen from the feed's own lines and
   no-vig fair prices, first basket (NBA / WNBA), no run in the first inning (MLB), collapsible sections, height / skill matchup for basketball.
   Prices on every leg are the best sportsbook price in the feed. Chances blend the feed's no-vig price with the model when the model has the player.
   Practice only. */
const HP={min:0.6,list:[],cache:{},open:{sgp:true}};
if(!S.fold) S.fold={};
const HP_BK={draftkings:'DK',fanduel:'FD',betmgm:'MGM',caesars:'CZR',espnbet:'ESPN',fanatics:'FAN',bovada:'BOV',betrivers:'BR',hardrockbet:'HR'};
const hpImp=o=>o==null?null:(o<0?(-o)/(-o+100):100/(o+100));
const hpAm=p=>{ p=clamp(p,0.01,0.99); return p>=0.5?Math.round(-100*p/(1-p)):Math.round(100*(1-p)/p); };
const hpKey=s=>String(s||'').toLowerCase().replace(/[^a-z]/g,'');
function hpOdds(){ try{ const O=window.__LSDATA&&window.__LSDATA.odds; return O&&Array.isArray(O.events)?O:null; }catch(e){ return null; } }
/* FanDuel is the main book: its own price and line whenever it lists the outcome; only when it does not, the best price among the other books on their most common line */
function hpBest(x){
  if(!x||!x.books) return null; const ks=Object.keys(x.books).filter(k=>x.books[k]&&x.books[k].odds!=null); if(!ks.length) return null;
  const cnt={}; ks.forEach(k=>{ const l=String(x.books[k].line); cnt[l]=(cnt[l]||0)+1; });
  const fd=x.books.fanduel;
  if(fd&&fd.odds!=null) return {book:'fanduel',odds:fd.odds,line:fd.line,link:fd.link,n:cnt[String(fd.line)]||1,fd:true};
  const main=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0]; let best=null;
  ks.forEach(k=>{ const v=x.books[k]; if(String(v.line)!==main) return; if(!best||v.odds>best.odds) best={book:k,odds:v.odds,line:v.line,link:v.link,n:cnt[main],fallback:true}; });
  return best;
}
/* no-vig chance: the feed's fair price when it is on the same line, otherwise the two best prices with the margin removed */
function hpFair(x,opp,b){
  if(x&&x.fair&&x.fair.odds!=null&&(x.fair.line==null||b.line==null||Math.abs(+x.fair.line-Math.abs(+b.line))<0.6||Math.abs(+x.fair.line-(+b.line))<0.6)) return hpImp(x.fair.odds);
  const bo=hpBest(opp); const a=hpImp(b.odds); if(a==null) return null; if(!bo) return a*0.96; const c=hpImp(bo.odds); return a/(a+c);
}

/* ---------- basketball: opponent height and skill ---------- */
const HP_HT={nba:{avg:79,big:82},wnba:{avg:75.5,big:77}};
function hpMatchup(g,pl,stKey){
  const key=keyOf(g), base=HP_HT[key]; if(!base||!pl) return {f:1,why:''};
  const opp=pl.side==='home'?'away':'home', ot=g.teams[opp]&&g.teams[opp].ht; let f=1; const why=[];
  if(ot){ const d=ot.avg-base.avg;
    if(stKey==='reb'){ const k=clamp(1-0.018*d,0.9,1.1); f*=k; if(Math.abs(k-1)>=0.015) why.push(g.teams[opp].abbr+' rotation avg '+ot.avg+' in: '+(k<1?'taller, fewer boards':'shorter, more boards')); }
    else if(stKey==='pts'||stKey==='pra'||stKey==='pr'||stKey==='pa'){ const k=clamp(1-0.008*d,0.94,1.06); f*=k; if(Math.abs(k-1)>=0.01) why.push(g.teams[opp].abbr+' height '+(k<1?'cuts':'helps')+' inside scoring'); }
    else if(stKey==='fg3'){ const k=clamp(1+0.004*d,0.96,1.04); f*=k; }
    if(pl.ht&&(stKey==='reb'||stKey==='pts')){ const gap=pl.ht-ot.big; const k=clamp(1+0.006*gap,0.95,1.05); f*=k; if(Math.abs(k-1)>=0.02) why.push(pl.name.split(' ').pop()+' is '+Math.abs(gap)+' in '+(gap>0?'taller':'shorter')+' than their tallest'); }
  }
  const m=g.crossroads&&g.crossroads.matchups&&g.crossroads.matchups[pl.side==='home'?1:0];       // the opposing defense rating (50 = average)
  if(m&&m.dfn!=null&&(stKey==='pts'||stKey==='pra'||stKey==='pr'||stKey==='pa'||stKey==='ast')){ const k=clamp(1-(m.dfn-50)/50*0.06,0.94,1.06); f*=k; if(Math.abs(k-1)>=0.02) why.push('their defense rates '+Math.round(m.dfn)+'/100'); }
  return {f:f,why:why.join('; ')};
}
function hpHtBlock(g){
  const key=keyOf(g); if(key!=='nba'&&key!=='wnba') return '';
  const a=g.teams.away, h=g.teams.home; if(!(a.ht||h.ht)) return '<div class="small muted">Height and skill matchup: waiting for roster heights from the next data refresh.</div>';
  const row=(t,o)=>t.ht?'<div class="small"><b>'+esc(t.abbr)+'</b> rotation averages <b>'+t.ht.avg+' in</b>, tallest '+t.ht.big+' in'+(o.ht?(t.ht.avg-o.ht.avg>=0.5?' (taller than '+esc(o.abbr)+' by '+(t.ht.avg-o.ht.avg).toFixed(1)+')':t.ht.avg-o.ht.avg<=-0.5?' (shorter than '+esc(o.abbr)+' by '+(o.ht.avg-t.ht.avg).toFixed(1)+')':' (even)'):'')+'</div>':'';
  return '<div class="shprof"><b>Height &amp; skill matchup</b>'+row(a,h)+row(h,a)+'<div class="small muted">Used in the parlay picks below: rebounds and inside scoring move up to about 10% with the opposing rotation\'s height, a player taller than their tallest gets a small boost, and scoring props move up to 6% with the opposing defense rating.</div></div>';
}

/* ---------- legs for one game, all from the feed ---------- */
function hpLegs(g){
  const O=hpOdds(); if(!O) return []; const ck=g.id+'|'+O.generatedAt+'|'+CALV; if(HP.cache[ck]) return HP.cache[ck];
  const e=(typeof bkEvent==='function')?bkEvent(g):null; const out=[]; if(!e||!e.main){ HP.cache[ck]=out; return out; }
  const cr=g.crossroads, M=e.main, A=g.teams.away, H=g.teams.home, key=keyOf(g);
  const abbrBk=b=>HP_BK[b]||b;
  const push=(tok,kind,label,x,opp,pModel,spec,group,extra)=>{ const b=hpBest(x); if(!b) return; const pf=hpFair(x,opp,b); if(pf==null) return;
    const p0=pModel==null?pf:0.5*pf+0.5*pModel; const p=adjP(clamp(p0*((extra&&extra.avail)||1),0.02,0.97),kind==='prop'?'prop':'team');
    out.push(Object.assign({id:tok,tok:tok,gid:g.id,kind:kind,label:label,price:b.odds,book:b.book,bk:abbrBk(b.book),link:b.link,nBooks:b.n,line:b.line,pFair:pf,pModel:pModel,p:p,ps:p,avail:1,src:abbrBk(b.book),spec:spec,group:group},extra||{})); };
  const L={mlH:M.ml&&M.ml.home,mlA:M.ml&&M.ml.away};
  ['home','away'].forEach(s=>{ const t=s==='home'?H:A, x=M.ml&&M.ml[s], o=M.ml&&M.ml[s==='home'?'away':'home'];
    push('o:'+g.id+':ml:'+s,'ml',t.abbr+' moneyline',x,o,cr?(s==='home'?cr.pHome:1-cr.pHome):null,{k:'ml',side:s},g.id+':ml'); });
  ['home','away'].forEach(s=>{ const x=M.spread&&M.spread[s], o=M.spread&&M.spread[s==='home'?'away':'home']; const b=hpBest(x); if(!b||b.line==null) return;
    const lineH=s==='home'?+b.line:-b.line; let pm=null; if(cr&&typeof LOGI!=='undefined'&&LOGI[key]){ const ph=logistic((cr.projMargin+lineH)/LOGI[key]); pm=s==='home'?ph:1-ph; }
    push('o:'+g.id+':spr:'+s,'spr',(s==='home'?H:A).abbr+' '+sg(+b.line),x,o,pm,{k:'spr',side:s,line:+b.line},g.id+':spr'); });
  ['over','under'].forEach(d=>{ const x=M.total&&M.total[d], o=M.total&&M.total[d==='over'?'under':'over']; const b=hpBest(x); if(!b||b.line==null) return;
    let pm=null; if(cr&&typeof TOTS!=='undefined'&&TOTS[key]){ const po=logistic((cr.projTotal-(+b.line))/TOTS[key]); pm=d==='over'?po:1-po; }
    push('o:'+g.id+':tot:'+d,'tot',(d==='over'?'Over ':'Under ')+b.line,x,o,pm,{k:'tot',dir:d,line:+b.line},g.id+':tot'); });
  // player props: only players the slate knows (so the bet can be graded), priced from the feed
  const by={}; (e.props||[]).forEach(p=>{ const k=p.pid+'|'+p.stat; (by[k]=by[k]||{})[p.side]=p; });
  Object.keys(by).forEach(k=>{ const pair=by[k]; ['over','under'].forEach(side=>{ const p=pair[side]; if(!p) return; const o=pair[side==='over'?'under':'over'];
    const pl=(g.players||[]).find(q=>hpKey(q.name)===hpKey(p.name)); if(!pl||(pl.status&&pl.status.kind==='out')) return;
    const st=(pl.stats||[]).find(s=>s.key===p.stat); if(!st) return; const b=hpBest(p); if(!b||b.line==null) return; const line=+b.line, T=Math.floor(line)+1;
    let pm=null; if(st.proj!=null){ const mt=hpMatchup(g,pl,st.key); const mu=st.proj*mt.f; pm=mu<8?poisGE(T,mu):1-phi((T-0.5-mu)/Math.max(0.6,(st.sd||Math.sqrt(mu)))); if(side==='under') pm=1-pm; var why=mt.why; } else var why='';
    const lab=surname(pl.name)+' '+(side==='over'?'Over ':'Under ')+line+' '+String(st.label||st.key).toLowerCase();
    push('o:'+g.id+':pp:'+pl.id+':'+st.key+':'+side,'prop',lab,p,o,pm,{k:'prop',pid:pl.id,stat:st.key,T:T,dir:side==='over'?'ge':'lt'},g.id+':'+pl.id+':'+st.key,{pid:pl.id,avail:pl.avail==null?1:pl.avail,why:why}); }); });
  HP.cache[ck]=out; return out;
}
function hpLeg(tok){ const p=String(tok).split(':'); const g=G[p[1]]; if(!g) return null; const l=hpLegs(g).find(x=>x.tok===tok); return l?Object.assign({},l):null; }

/* games from the selected day through the next 3 days (a Friday home screen still shows Sunday's NFL slate) */
function hpInWin(g){ if(!g.day) return true; const a=Date.parse(S.date+'T12:00:00Z'), d=Date.parse(g.day+'T12:00:00Z'); return d>=a&&d<=a+3*864e5; }
/* ---------- same-game parlays ---------- */
function hpBuild(g){
  const legs=hpLegs(g).slice().sort((a,b)=>b.p-a.p); if(legs.length<2) return [];
  const pickN=n=>{ const out=[],grp={},per={}; let team=false;
    for(const l of legs){ if(out.length>=n) break; if(l.p<HP.min) break; if(grp[l.group]) continue;
      if(l.kind==='ml'||l.kind==='spr'){ if(team) continue; team=true; }
      if(l.kind==='prop'){ if(per[l.pid]) continue; per[l.pid]=1; }
      out.push(l); grp[l.group]=1; }
    return out; };
  const res=[]; [2,3].forEach(n=>{ const ls=pickN(n); if(ls.length===n){ const dec=ls.reduce((d,l)=>d*decOf(l.price),1); res.push({g:g,n:n,legs:ls,dec:dec,am:amerOfDec(dec),p:ls.reduce((x,l)=>x*l.p,1)*Math.pow(0.97,n-1)}); } });
  return res;
}
function hpAllSgp(){
  const gs=boardGames().filter(g=>(S.league==='all'||keyOf(g)===S.league)&&hpInWin(g)&&preOK(g)); const all=[];
  gs.forEach(g=>{ hpBuild(g).forEach(s=>all.push(s)); });
  all.sort((a,b)=>b.p-a.p); return all;
}
function hpSgpCard(s,i){
  const g=s.g, on=s.legs.every(l=>inSlip(l.tok)); const nFd=s.legs.filter(l=>l.book==='fanduel').length, allFd=nFd===s.legs.length, fdU=hpFdUrl(s);
  return '<div class="potd hit'+(on?' on':'')+'"><div class="ph"><b>'+(typeof tlogo==='function'?tlogo(keyOf(g),g.teams.away,20)+' ':'')+esc(g.teams.away.abbr)+' @ '+(typeof tlogo==='function'?tlogo(keyOf(g),g.teams.home,20)+' ':'')+esc(g.teams.home.abbr)+' <span class="muted small">'+esc(LGN[keyOf(g)]||keyOf(g).toUpperCase())+' · '+esc(g.startDate||'')+' · '+s.n+'-leg</span></b><span class="mono">est. '+fo(s.am)+' · ~'+Math.round(s.p*100)+'% all hit</span></div>'+
    '<div class="hpsrc">'+(allFd?fdMark()+' same-game parlay legs':(nFd?fdMark()+' on '+nFd+' of '+s.n+' legs, the rest at the best other book':'FanDuel has not posted these legs yet, so the best other book is shown'))+'</div>'+
    s.legs.map(l=>'<div class="small">'+esc(l.label)+' <span class="mono">'+fo(l.price)+'</span> <span class="muted">'+(l.book==='fanduel'?'<b class="fdtag">FD</b>':esc(l.bk))+' · '+Math.round(l.p*100)+'%'+(l.why?' · '+esc(l.why):'')+'</span></div>').join('')+
    '<div class="btnrow"><button class="btn'+(on?'':' solid')+'" data-act="hp-add" data-i="'+i+'">'+(on?'Remove from slip':'Add to slip')+'</button>'+(fdU?'<a class="btn" href="'+esc(fdU)+'" target="_blank" rel="noopener">Open on FanDuel</a>':'')+'</div></div>';
}
/* the FanDuel page for a parlay: all legs in one betslip link when every leg has its FanDuel link, otherwise the game's FanDuel page */
function hpFdUrl(s){
  try{ const ls=s.legs.map(l=>l.book==='fanduel'?l.link:null); if(ls.every(u=>u&&/^https:\/\//.test(u))){ const c=(ls.length>1&&typeof odCombine==='function')?odCombine('fanduel',ls):ls[0]; if(c) return c; }
    const e=bkEvent(s.g); const u=e&&e.eventLinks&&e.eventLinks.fanduel; return u&&/^https:\/\//.test(u)?u:''; }catch(e){ return ''; }
}
function hpSgpHtml(){
  if(!hpOdds()) return '<div class="small muted">Sportsbook lines have not loaded yet, so no parlays can be built. They refresh about every hour.</div>';
  const all=hpAllSgp(); HP.list=all; if(!all.length) return '<div class="small muted">No same-game parlay clears '+Math.round(HP.min*100)+'% right now'+(S.league==='all'?'':' in this league')+'. That is normal when lines are tight or a league has no props posted.</div>';
  const per={}; const show=[]; all.forEach((s,i)=>{ const k=keyOf(s.g)+s.n; per[k]=(per[k]||0)+1; if(per[k]<=2&&show.length<8) show.push([s,i]); });
  return show.map(x=>hpSgpCard(x[0],x[1])).join('')+'<div class="small muted">Every leg is a sportsbook line with its best price and a chance that blends the book\'s no-vig price with the model. Combined odds multiply leg prices, and a sportsbook prices same-game legs lower because they are linked, so check the real price at the book.</div>';
}

/* ---------- first basket (NBA / WNBA) ---------- */
function hpFirstHtml(){
  const O=hpOdds(); const gs=boardGames().filter(g=>(keyOf(g)==='nba'||keyOf(g)==='wnba')&&(S.league==='all'||keyOf(g)===S.league)&&hpInWin(g)&&preOK(g)); if(!gs.length) return '';
  const rows=gs.map(g=>{ const e=O&&bkEvent(g); const f=(e&&e.first||[]).filter(x=>x.pid&&x.name); let lines='';
    if(f.length){ const bt=f.map(x=>({n:x.name,b:hpBest(x),team:x.team})).filter(x=>x.b).sort((a,b)=>hpImp(b.b.odds)-hpImp(a.b.odds)).slice(0,5);
      lines=bt.map(x=>'<div class="small">'+esc(x.n)+' <span class="mono">'+fo(x.b.odds)+'</span> <span class="muted">'+esc(HP_BK[x.b.book]||x.b.book)+'</span></div>').join(''); }
    else if((g.players||[]).length){ const w=(side)=>(g.players||[]).filter(p=>p.side===side&&!(p.status&&p.status.kind==='out')).map(p=>{ const st=(p.stats||[]).find(s=>s.key==='pts'); return {p:p,w:st&&st.avg?Math.pow(st.avg,1.5)*(p.avail==null?1:p.avail):0}; }).filter(x=>x.w>0).sort((a,b)=>b.w-a.w).slice(0,6);
      const cr=g.crossroads, pH=cr?cr.pHome:0.5, tHome=clamp(0.5+(pH-0.5)*0.15,0.4,0.6); const ws={home:w('home'),away:w('away')}; const tot={home:ws.home.reduce((s,x)=>s+x.w,0),away:ws.away.reduce((s,x)=>s+x.w,0)};
      const c=[]; ['home','away'].forEach(sd=>{ ws[sd].forEach(x=>{ c.push({n:x.p.name,p:(sd==='home'?tHome:1-tHome)*x.w/(tot[sd]||1)*0.9}); }); }); c.sort((a,b)=>b.p-a.p);
      lines=c.slice(0,5).map(x=>'<div class="small">'+esc(x.n)+' <span class="mono">'+fo(hpAm(x.p))+'</span> <span class="muted">model estimate · '+(x.p*100).toFixed(1)+'%</span></div>').join(''); }
    if(!lines) return '<div class="small muted"><b>'+esc(g.teams.away.abbr)+' @ '+esc(g.teams.home.abbr)+'</b>: no first-basket prices posted yet.</div>';
    return '<div class="rg"><div class="rgh"><b>'+esc(g.teams.away.abbr)+' @ '+esc(g.teams.home.abbr)+'</b></div>'+lines+'</div>'; }).join('');
  return rows+'<div class="small muted">Prices come from the sportsbook feed when it lists first basket; otherwise a model estimate is shown (starters\' scoring, scaled by who is likelier to score first). A long shot by nature: even the favourite is rarely above 15%.</div>';
}

/* ---------- no run in the first inning (MLB) ---------- */
function hpNrfiHtml(){
  const O=hpOdds(); const gs=boardGames().filter(g=>keyOf(g)==='mlb'&&(S.league==='all'||S.league==='mlb')&&hpInWin(g)&&preOK(g)); if(!gs.length) return '';
  return gs.map(g=>{ const e=O&&bkEvent(g); const n=e&&e.nrfi; const cr=g.crossroads; const A=g.teams.away, H=g.teams.home;
    const mdl=cr?{a:Math.exp(-0.66*(cr.projAway/4.5)),h:Math.exp(-0.66*(cr.projHome/4.5))}:null;
    const cell=(label,x,pm)=>{ const b=x&&hpBest(x.under); if(b) return '<span class="shchip"><b>'+esc(label)+'</b> '+fo(b.odds)+' <span class="muted">'+esc(HP_BK[b.book]||b.book)+' · '+(hpFair(x.under,x.over,b)*100).toFixed(0)+'%</span></span>';
      return pm!=null?'<span class="shchip"><b>'+esc(label)+'</b> '+fo(hpAm(pm))+' <span class="muted">model · '+Math.round(pm*100)+'%</span></span>':''; };
    const both=mdl?mdl.a*mdl.h:null;
    return '<div class="rg"><div class="rgh"><b>'+esc(A.abbr)+' @ '+esc(H.abbr)+'</b></div><div class="shrow">'+cell('NRFI (both)',n&&n.all,both)+cell(A.abbr+' scoreless',n&&n.away,mdl&&mdl.a)+cell(H.abbr+' scoreless',n&&n.home,mdl&&mdl.h)+'</div></div>'; }).join('')+
    '<div class="small muted">NRFI means neither team scores in the 1st inning. Book prices are shown when the feed has them; otherwise a model estimate from each team\'s projected runs.</div>';
}

/* ---------- collapsible sections ---------- */
function hpFold(key,title,sum,inner,startOpen){
  if(!inner) return ''; const open=S.fold[key]!=null?S.fold[key]:!!startOpen;
  return '<details class="d hpfold" data-fold="'+esc(key)+'"'+(open?' open':'')+'><summary><b>'+esc(title)+'</b>'+(sum?' <span class="muted small">'+esc(sum)+'</span>':'')+'</summary>'+inner+'</details>';
}
function hpHomeHtml(){
  const sgp=hpSgpHtml(), n=HP.list.length; const fb=hpFirstHtml(), nr=hpNrfiHtml();
  return '<section class="game hpsec"><div class="sec">'+hpFold('sgp','Best same-game parlays',n?Math.min(n,8)+' picks · sportsbook lines':'sportsbook lines',sgp,true)+
    hpFold('fb','First basket (NBA and WNBA)','',fb,false)+hpFold('nrfi','No run first inning (MLB)','',nr,false)+'</div></section>';
}
document.addEventListener('toggle',function(e){ const d=e.target; if(d&&d.getAttribute&&d.getAttribute('data-fold')) S.fold[d.getAttribute('data-fold')]=d.open; },true);

/* ---------- slip: add a parlay, and translate feed legs for the practice server ---------- */
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act="hp-add"]'); if(!t) return; e.stopPropagation(); e.preventDefault();
  const s=HP.list[+t.getAttribute('data-i')]; if(!s) return;
  if(s.legs.every(l=>inSlip(l.tok))){ S.slip=S.slip.filter(l=>!s.legs.some(x=>x.tok===l.id)); S.slipMsg=''; }
  else { S.slip=s.legs.map(l=>legFor(l.tok)).filter(Boolean); S.betMode='parlay'; S.slipOpen=true; S.slipMsg='Loaded '+s.n+' legs. Prices are the best in the sportsbook feed; the book will price the combo lower.'; }
  renderSlip(); syncLegButtons(); render();
},true);
/* signed-in practice bets are priced by the server from the slate; a feed leg goes through only when the slate offers the same line */
function hpServerTok(l){
  const g=G[l.gid]; if(!g||!l.spec) return null; const sp=l.spec, L=g.lines||{};
  if(sp.k==='ml') return 'g:'+g.id+':ml:'+sp.side;
  if(sp.k==='spr'){ const ln=sp.side==='home'?L.sprHome:L.sprAway; return ln!=null&&Math.abs(ln-sp.line)<0.01?'g:'+g.id+':spr:'+sp.side:null; }
  if(sp.k==='tot') return L.total!=null&&Math.abs(L.total-sp.line)<0.01?'g:'+g.id+':tot:'+sp.dir:null;
  if(sp.k==='prop'&&sp.dir==='ge'){ const pl=findPlayer(g,sp.pid); const st=pl&&pl.stats.find(s=>s.key===sp.stat); return st&&st.line!=null&&Math.floor(st.line)+1===sp.T?'p:'+g.id+':'+pl.id+':'+st.key+':over':null; }
  return null;
}
