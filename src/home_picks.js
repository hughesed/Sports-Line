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
  const e=(typeof bkEvent==='function')?bkEvent(g):null; const out=[]; if(!e||!e.main){ try{ if(typeof flLegs==='function') flLegs(g).forEach(l=>out.push(l)); }catch(_){} HP.cache[ck]=out; return out; }
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
  /* normal-stat thresholds ("60+ rush yds", "5+ receptions", "25+ points"): the model's own ladder around the book's line, for every player the slate knows.
     Priced from the book when the ladder has a book price for the rung, otherwise an estimate (marked est.). Over/under legs are not the only kind of leg any more. */
  (g.players||[]).forEach(pl=>{ if(pl.status&&pl.status.kind==='out') return;
    (pl.stats||[]).forEach(st=>{
      /* a slate player's rungs carry no chance of their own (only FanDuel-only players get one), so score each from the projection and the last-15 record (floor.js) */
      const rungs=(st.miles||[]).filter(m=>m&&m.t!=null).map(m=>{ if(m.p!=null) return m; const r=(typeof flRungP==='function')?flRungP(pl,st,+m.t):null; return r?{t:m.t,price:m.price,p:r.p}:null; }).filter(Boolean); if(!rungs.length||st.line==null) return;
      const lineT=Math.floor(+st.line)+1;
      /* meaningful thresholds only: near the book's line (not "1+ reception" for a 6-catch player), and not near-certain (those add nothing but a -600 price) */
      const cand=rungs.filter(m=>m.t!==lineT&&m.p>=0.55&&m.p<=0.82&&m.t>=0.55*(+st.line)).sort((a,b)=>b.t-a.t);        // highest threshold first
      const picks=[]; [cand.find(m=>m.p>=0.7),cand.find(m=>m.p<0.7)].forEach(m=>{ if(m&&picks.indexOf(m)<0) picks.push(m); });
      picks.forEach(m=>{ const av=pl.avail==null?1:pl.avail; const p=adjP(clamp(m.p*av,0.02,0.97),'prop'); const priced=m.price!=null; const tok='o:'+g.id+':alt:'+pl.id+':'+st.key+':'+m.t;
        out.push({id:tok,tok:tok,gid:g.id,kind:'alt',label:surname(pl.name)+' '+m.t+'+ '+String(st.label||st.key).toLowerCase(),price:priced?m.price:estPrice(m.p),book:priced?'draftkings':'est',bk:priced?'DK':'est.',link:null,nBooks:0,line:m.t-0.5,
          pFair:null,pModel:m.p,p:p,ps:p,avail:1,src:priced?'DK':'est.',spec:{k:'prop',pid:pl.id,stat:st.key,T:m.t,dir:'ge'},group:g.id+':'+pl.id+':'+st.key,pid:pl.id,why:''}); });
    }); });
  /* floor legs: low rungs the player almost always clears (floor.js); they replace a mid-range threshold for the same player and stat */
  try{ if(typeof flLegs==='function') flLegs(g).forEach(l=>{ if(!out.some(x=>x.tok===l.tok)) out.push(l); }); }catch(_){}
  HP.cache[ck]=out; return out;
}
function hpLeg(tok){ const p=String(tok).split(':'); const g=G[p[1]]; if(!g) return null; const l=hpLegs(g).find(x=>x.tok===tok); return l?Object.assign({},l):null; }

/* games from the selected day through the next 3 days (a Friday home screen still shows Sunday's NFL slate) */
function hpInWin(g){ if(!g.day) return true; const a=Date.parse(S.date+'T12:00:00Z'), d=Date.parse(g.day+'T12:00:00Z'); return d>=a&&d<=a+3*864e5; }
/* ---------- same-game parlays ---------- */
const HP_SIZES=[[2,0.58],[4,0.53],[8,0.5]];     // legs wanted, and the lowest chance a leg may have to be used
/* what kind of bet a leg is, for mixing: a team side (moneyline / spread), the game total, a player over/under, or a stat threshold ("60+ rush yds") */
const hpCat=l=>(l.kind==='ml'||l.kind==='spr')?'side':l.kind==='tot'?'total':l.floor?'floor':l.kind==='alt'?'alt':'ou';
const hpIsUnder=l=>!!(l.spec&&(l.spec.dir==='under'||l.spec.dir==='lt'));
/* picks up to n legs a step at a time. The score is the leg's chance, nudged so the parlay mixes kinds: at most one team side and one game total, no more than
   ~40% unders, a stat type is not repeated more than the size allows, the first leg of each kind gets a bonus, and legs already used in a smaller parlay for the
   same game are marked down so the 2, 4 and 8-leg builds are not the same picks. A leg still has to clear the chance floor for its size. */
function hpPick(legs,n,floor,used){
  const out=[],grp={},per={},kinds={},stats={}; let unders=0;
  const maxUnder=Math.max(1,Math.floor(n*0.4)), maxStat=n>=8?3:n>=4?2:1, maxAlt=Math.max(1,Math.floor(n/3)+(n>=4?1:0)), maxFloor=Math.max(1,Math.ceil(n/2));      // thresholds: 1 of 2, 2 of 4, 3 of 8; floor legs (a low rung the player almost always clears): 1 of 2, 2 of 4, 4 of 8
  while(out.length<n){
    let best=null,bs=-1;
    for(const l of legs){
      if(l.p<floor||grp[l.group]||out.indexOf(l)>=0) continue;
      const c=hpCat(l); if((c==='side'||c==='total')&&kinds[c]) continue; if(c==='alt'&&(kinds.alt||0)>=maxAlt) continue; if(c==='floor'&&(kinds.floor||0)>=maxFloor) continue;
      if((l.kind==='prop'||l.kind==='alt')&&per[l.pid]) continue;
      const un=hpIsUnder(l); if(un&&unders>=maxUnder) continue;
      const sk=l.spec&&l.spec.stat; if(sk&&(stats[sk]||0)>=maxStat) continue;
      let s=l.p*Math.pow(0.85,used[l.tok]||0);
      if(sk) s*=Math.pow(0.93,stats[sk]||0);
      if(un) s*=0.94;
      if(l.book==='fanduel') s*=1.06;                  // a real FanDuel price and link beats an estimate
      if(l.floor) s*=1.04;                              // a floor leg is the kind that keeps landing, so it is preferred over an equal-chance leg
      if(!kinds[c]) s*=n>=4?1.12:1.05;
      if(s>bs){ bs=s; best=l; } }
    if(!best) break;
    out.push(best); grp[best.group]=1; kinds[hpCat(best)]=(kinds[hpCat(best)]||0)+1; if(best.pid) per[best.pid]=1; if(hpIsUnder(best)) unders++;
    const sk=best.spec&&best.spec.stat; if(sk) stats[sk]=(stats[sk]||0)+1; }
  return out;
}
function hpBuild(g){
  const legs=hpLegs(g).slice(); if(legs.length<2) return [];
  const res=[], used={}; let prev=0;
  HP_SIZES.forEach(sz=>{ const n=sz[0], ls=hpPick(legs,n,sz[1],used);
    /* up to n legs: fewer are fine when the game does not have enough good ones, but a 4 or 8 that is no bigger than the size below it is not repeated */
    if(ls.length<2||(n>2&&ls.length<=prev)) return; prev=ls.length; ls.forEach(l=>{ used[l.tok]=(used[l.tok]||0)+1; });
    const dec=ls.reduce((d,l)=>d*decOf(l.price),1); const cats={}; ls.forEach(l=>{ cats[hpCat(l)]=(cats[hpCat(l)]||0)+1; });
    res.push({g:g,n:n,k:ls.length,legs:ls,dec:dec,am:amerOfDec(dec),cats:cats,p:ls.reduce((x,l)=>x*l.p,1)*Math.pow(0.97,ls.length-1)}); });
  return res;
}
function hpAllSgp(){
  const gs=boardGames().filter(g=>(S.league==='all'||keyOf(g)===S.league)&&hpInWin(g)&&preOK(g)&&(typeof llState!=='function'||llState(g)==='pre')); const all=[];
  gs.forEach(g=>{ hpBuild(g).forEach(s=>all.push(s)); });
  all.sort((a,b)=>b.p*(1+0.04*(Object.keys(b.cats).length-1))-a.p*(1+0.04*(Object.keys(a.cats).length-1))); return all;       // a mix of kinds ranks a little higher
}
const HP_CATN={side:'team side',total:'total',ou:'over/under prop',alt:'stat threshold',floor:'floor leg'};
function hpMixTxt(s){ return Object.keys(s.cats).map(k=>s.cats[k]+' '+HP_CATN[k]+(s.cats[k]>1&&k!=='side'?'s':'')).join(' · '); }
function hpLegRow(l){
  if(l.floor) return '<details class="hpleg"><summary><span class="hpl">'+esc(l.label)+'</span> <b class="flTag" title="a low number the player almost always reaches">floor</b> <span class="mono">'+fo(l.price)+'</span> <span class="muted small">'+esc(l.bk)+' · '+Math.round(l.p*100)+'%</span></summary>'+
    '<div class="small muted hpld">'+esc(l.why||'')+' '+(l.book==='est'?'Price is my estimate, not a sportsbook price (FanDuel may list this rung at a different price, or not at all).':'Price is the book\'s price for this rung.')+' FanDuel cannot load this leg from a link: add it by hand.</div></details>';
  if(l.kind==='alt') return '<details class="hpleg"><summary><span class="hpl">'+esc(l.label)+'</span> <span class="mono">'+fo(l.price)+'</span> <span class="muted small">'+esc(l.bk)+' · '+Math.round(l.p*100)+'%</span></summary>'+
    '<div class="small muted hpld">Stat threshold from the model\'s ladder around the book\'s line. '+(l.book==='est'?'Price is my estimate, not a sportsbook price (FanDuel may list this rung at a different price, or not at all).':'Price is the book\'s price for this rung.')+' Model chance '+Math.round(l.pModel*100)+'%'+(Math.abs(l.p-l.pModel)>0.005?', adjusted for availability to '+Math.round(l.p*100)+'%':'')+'. FanDuel cannot load this leg from a link: add it by hand.</div></details>';
  const isP=l.kind==='prop';
  return '<details class="hpleg"><summary><span class="hpl">'+esc(l.label)+'</span> <span class="mono">'+fo(l.price)+'</span> <span class="muted small">'+(l.book==='fanduel'?'<b class="fdtag">FD</b>':esc(l.bk))+' · '+Math.round(l.p*100)+'%</span></summary>'+
    '<div class="small muted hpld">'+(isP?'Player prop. ':'Game line. ')+(l.book==='fanduel'?'FanDuel\'s own price and line.':'FanDuel has not posted this one; best other book shown ('+esc(l.bk)+').')+
    ' Book no-vig chance '+Math.round(l.pFair*100)+'%'+(l.pModel!=null?', model '+Math.round(l.pModel*100)+'%':'')+', blended to '+Math.round(l.p*100)+'%.'+(l.why?' '+esc(l.why)+'.':'')+(l.link&&l.book==='fanduel'?' <a href="'+esc(l.link)+'" target="_blank" rel="noopener">Open this leg on FanDuel</a>':'')+'</div></details>';
}
function hpSgpCard(s,i){
  const g=s.g, on=s.legs.every(l=>inSlip(l.tok)); const nFd=s.legs.filter(l=>l.book==='fanduel').length, allFd=nFd===s.legs.length, fdU=hpFdUrl(s), nEst=s.legs.filter(l=>l.book==='est').length;
  return '<div class="potd hit'+(on?' on':'')+'"><div class="ph"><b>'+(typeof tlogo==='function'?tlogo(keyOf(g),g.teams.away,20)+' ':'')+esc(g.teams.away.abbr)+' @ '+(typeof tlogo==='function'?tlogo(keyOf(g),g.teams.home,20)+' ':'')+esc(g.teams.home.abbr)+' <span class="muted small">'+esc(LGN[keyOf(g)]||keyOf(g).toUpperCase())+' · '+esc(g.startDate||'')+' · '+s.k+(s.k<s.n?' of up to '+s.n:'')+' legs</span></b><span class="mono">est. '+fo(s.am)+' · ~'+Math.round(s.p*100)+'% all hit</span></div>'+
    '<div class="small muted hpmix">Mix: '+esc(hpMixTxt(s))+(nEst?' · '+nEst+' est. price'+(nEst>1?'s':''):'')+'</div>'+
    '<div class="hpsrc">'+(allFd?fdMark()+' same-game parlay legs':(nFd?fdMark()+' on '+nFd+' of '+s.k+' legs, the rest at the best other book':'FanDuel has not posted these legs yet, so the best other book is shown'))+'</div>'+
    '<details class="hplegs"'+(S.fold['hpl'+g.id+s.n]?' open':'')+' data-fold="hpl'+esc(g.id+s.n)+'"><summary class="small"><b>Legs</b> <span class="muted">tap to open or close, and tap a leg for its detail</span></summary>'+s.legs.map(hpLegRow).join('')+'</details>'+
    '<div class="btnrow"><button class="btn'+(on?'':' solid')+'" data-act="hp-add" data-i="'+i+'">'+(on?'Remove from slip':'Add to slip')+'</button>'+(fdU.url?'<a class="btn" href="'+esc(fdU.url)+'" rel="noopener">'+(fdU.n?'Open on FanDuel ('+fdU.n+' of '+s.k+' legs)':'Open game on FanDuel')+'</a>':'')+'</div>'+
    (fdU.n&&fdU.n<s.k?'<div class="small muted">Only '+fdU.n+' of '+s.k+' legs can be loaded by link ('+(s.k-fdU.n)+' without a FanDuel link: add by hand).</div>':'')+'</div>';
}
/* the FanDuel handoff for a parlay: {url, n}. n = how many legs are inside the link. Legs that have a FanDuel selection link are combined into one betslip link;
   legs without one (estimated thresholds, other-book fallbacks) cannot be loaded, so they are left out of the link rather than breaking it. With no linkable leg, the game's FanDuel page. */
function hpFdUrl(s){
  try{ const ls=s.legs.map(l=>l.book==='fanduel'?l.link:null).filter(u=>u&&/^https:\/\/sportsbook\.fanduel\.com\//.test(u));
    if(ls.length){ const c=(ls.length>1&&typeof odCombine==='function')?odCombine('fanduel',ls):ls[0]; if(c) return {url:c,n:ls.length}; return {url:ls[0],n:1}; }
    const e=bkEvent(s.g); const u=e&&e.eventLinks&&e.eventLinks.fanduel; return {url:u&&/^https:\/\//.test(u)?u:'',n:0}; }catch(e){ return {url:'',n:0}; }
}
function hpSgpHtml(){
  if(!hpOdds()) return {err:'<div class="small muted">Sportsbook lines have not loaded yet, so no parlays can be built. They refresh about every hour.</div>'};
  const all=hpAllSgp(); HP.list=all; const out={};
  HP_SIZES.forEach(sz=>{ const n=sz[0], per={}; const show=[];
    all.forEach((s,i)=>{ if(s.n!==n) return; const k=keyOf(s.g); per[k]=(per[k]||0)+1; if(per[k]<=2&&show.length<4) show.push([s,i]); });
    out[n]=show.length?show.map(x=>hpSgpCard(x[0],x[1])).join(''):'<div class="small muted">No game has enough legs at or above '+Math.round(sz[1]*100)+'% for a '+n+'-leg parlay'+(S.league==='all'?'':' in this league')+' right now.</div>'; });
  out.note='<div class="small muted">Each parlay mixes kinds of bets: a team side (moneyline or spread), the game total, player over/unders and stat thresholds such as "60+ rush yds". Floor legs, low numbers a player almost always reaches ("2+ receptions", "15+ receiving yards": the projection is far above the number and he cleared it in nearly every recent game), are tagged and ranked a little higher. Over/under legs and the team lines are FanDuel\'s own price (only a line FanDuel has not posted falls back to the best other book); threshold legs use the model\'s ladder around the book\'s line and are marked est. when no book price exists, so they cannot be loaded into FanDuel by link. Chances blend the book\'s no-vig price with the model. Combined odds multiply leg prices, and a sportsbook prices same-game legs lower because they are linked, so check the real price at the book. Games already under way are not listed here.</div>';
  return out;
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
  const sg=hpSgpHtml(); const fb=hpFirstHtml(), nr=hpNrfiHtml(); let parlays;
  if(sg.err) parlays=hpFold('sgp','Best same-game parlays','',sg.err,true);
  else parlays=hpFold('sgp','Best same-game parlays',HP.list.length+' built · FanDuel lines and props',
      HP_SIZES.map(sz=>hpFold('sgp'+sz[0],sz[0]+'-leg parlays',(HP.list.filter(s=>s.n===sz[0]).length)+' found'+(sz[0]>2?' · up to '+sz[0]+' legs, fewer when that is all there is':''),sg[sz[0]],sz[0]===2)).join('')+sg.note,true);
  let stacks=''; try{ stacks=(typeof plHtml==='function')?plHtml():''; }catch(e){ stacks=''; }
  return '<section class="game hpsec"><div class="sec">'+parlays+stacks+hpFold('fb','First basket (NBA and WNBA)','',fb,false)+hpFold('nrfi','No run first inning (MLB)','',nr,false)+'</div></section>';
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
  if(sp.k==='prop'&&sp.dir==='ge'){ const pl=findPlayer(g,sp.pid); const st=pl&&pl.stats.find(s=>s.key===sp.stat); if(!st) return null;
    if(st.line!=null&&Math.floor(st.line)+1===sp.T) return 'p:'+g.id+':'+pl.id+':'+st.key+':over';
    if((st.miles||[]).some(m=>m.t===sp.T)) return 'p:'+g.id+':'+pl.id+':'+st.key+':m:'+sp.T;        // a threshold from the slate's own ladder
    return null; }
  return null;
}
try{ if(window.__LS) window.__LS.hp={legs:hpLegs,all:hpAllSgp,mix:hpMixTxt,pick:hpPick,odds:hpOdds}; }catch(e){}
