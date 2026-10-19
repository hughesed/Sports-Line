/* ================= Home screen picks built from the sportsbook feed (data/odds.json, SportsGameOdds) =================
   Same-game parlays for every sport (NFL, college football, NBA, WNBA, college basketball, MLB), "safe" legs chosen from the feed's own lines and
   no-vig fair prices, first basket (NBA / WNBA), no run in the first inning (MLB), collapsible sections, height / skill matchup for basketball.
   Prices on every leg are the best sportsbook price in the feed. Chances blend the feed's no-vig price with the model when the model has the player.
   Practice only. */
const HP={min:0.6,list:[],cache:{},open:{sgp:true}};
/* what the player's own sportsbook offers. NHL player props: overs only, and only points, assists, shots on goal and saves, so none of the builders may use anything else there.
   altSpr = FanDuel's alternate spread (NHL "Alternate Puck Line", WNBA "Alternate Handicaps") may be a leg; teamTot = team totals ("Anaheim Ducks Total Goals") may be a leg. Other leagues are unchanged. */
const HP_BOOK={nhl:{overOnly:true,stats:{pts:1,sog:1,saves:1,ast:1},altSpr:'alt puck line',teamTot:'goals'},wnba:{altSpr:'alt handicap'}};
function hpPropOk(key,stat,under){ const r=HP_BOOK[key]; return !r||((!under||!r.overOnly)&&(!r.stats||!!r.stats[stat])); }
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
    else if(stKey==='pts'||stKey==='pra'||stKey==='ptsreb'||stKey==='ptsast'){ const k=clamp(1-0.008*d,0.94,1.06); f*=k; if(Math.abs(k-1)>=0.01) why.push(g.teams[opp].abbr+' height '+(k<1?'cuts':'helps')+' inside scoring'); }
    else if(stKey==='fg3'){ const k=clamp(1+0.004*d,0.96,1.04); f*=k; }
    if(pl.ht&&(stKey==='reb'||stKey==='pts')){ const gap=pl.ht-ot.big; const k=clamp(1+0.006*gap,0.95,1.05); f*=k; if(Math.abs(k-1)>=0.02) why.push(pl.name.split(' ').pop()+' is '+Math.abs(gap)+' in '+(gap>0?'taller':'shorter')+' than their tallest'); }
  }
  const m=g.crossroads&&g.crossroads.matchups&&g.crossroads.matchups[pl.side==='home'?1:0];       // the opposing defense rating (50 = average)
  if(m&&m.dfn!=null&&(stKey==='pts'||stKey==='pra'||stKey==='ptsreb'||stKey==='ptsast'||stKey==='ast')){ const k=clamp(1-(m.dfn-50)/50*0.06,0.94,1.06); f*=k; if(Math.abs(k-1)>=0.02) why.push('their defense rates '+Math.round(m.dfn)+'/100'); }
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
  const e=(typeof bkEvent==='function')?bkEvent(g):null; const out=[]; if(!e||!e.main){ try{ if(typeof isSoc==='function'&&isSoc(g)) socTeamLegs(g).forEach(l=>out.push(l)); }catch(_){} const fdo=out.filter(hpIsFd); HP.cache[ck]=fdo; return fdo; }
  const cr=g.crossroads, M=e.main, A=g.teams.away, H=g.teams.home, key=keyOf(g);
  const abbrBk=b=>HP_BK[b]||b;
  const push=(tok,kind,label,x,opp,pModel,spec,group,extra)=>{ const b=hpBest(x); if(!b) return; const pf=hpFair(x,opp,b); if(pf==null) return;
    const p0=pModel==null?pf:0.5*pf+0.5*pModel; const p=adjP(clamp(p0*((extra&&extra.avail)||1),0.02,0.97),kind==='prop'?'prop':'team');
    out.push(Object.assign({id:tok,tok:tok,gid:g.id,kind:kind,label:label,price:b.odds,book:b.book,bk:abbrBk(b.book),link:b.link,nBooks:b.n,line:b.line,pFair:pf,pModel:pModel,p:p,ps:p,avail:1,src:abbrBk(b.book),spec:spec,group:group},extra||{})); };
  if(typeof isSoc==='function'&&isSoc(g)) socTeamLegs(g).forEach(l=>out.push(l));       // soccer: the 3-way result, double chance, goal ladders (soccer.js) instead of the 2-way lines
  else {
  ['home','away'].forEach(s=>{ const t=s==='home'?H:A, x=M.ml&&M.ml[s], o=M.ml&&M.ml[s==='home'?'away':'home'];
    push('o:'+g.id+':ml:'+s,'ml',t.abbr+' moneyline',x,o,cr?(s==='home'?cr.pHome:1-cr.pHome):null,{k:'ml',side:s},g.id+':ml'); });
  ['home','away'].forEach(s=>{ const x=M.spread&&M.spread[s], o=M.spread&&M.spread[s==='home'?'away':'home']; const b=hpBest(x); if(!b||b.line==null) return;
    const lineH=s==='home'?+b.line:-b.line; let pm=null; if(cr&&typeof LOGI!=='undefined'&&LOGI[key]){ const ph=logistic((cr.projMargin+lineH)/LOGI[key]); pm=s==='home'?ph:1-ph; }
    push('o:'+g.id+':spr:'+s,'spr',(s==='home'?H:A).abbr+' '+sg(+b.line),x,o,pm,{k:'spr',side:s,line:+b.line},g.id+':spr'); });
  ['over','under'].forEach(d=>{ const x=M.total&&M.total[d], o=M.total&&M.total[d==='over'?'under':'over']; const b=hpBest(x); if(!b||b.line==null) return;
    let pm=null; if(cr&&typeof TOTS!=='undefined'&&TOTS[key]){ const po=logistic((cr.projTotal-(+b.line))/TOTS[key]); pm=d==='over'?po:1-po; }
    push('o:'+g.id+':tot:'+d,'tot',(d==='over'?'Over ':'Under ')+b.line,x,o,pm,{k:'tot',dir:d,line:+b.line},g.id+':tot'); });
  }
  // player props: only players the slate knows (so the bet can be graded), priced from the feed
  const by={}; (e.props||[]).forEach(p=>{ const k=p.pid+'|'+p.stat; (by[k]=by[k]||{})[p.side]=p; });
  Object.keys(by).forEach(k=>{ const pair=by[k]; ['over','under'].forEach(side=>{ const p=pair[side]; if(!p||!hpPropOk(key,p.stat,side==='under')) return; const o=pair[side==='over'?'under':'over'];
    const pl=(g.players||[]).find(q=>hpKey(q.name)===hpKey(p.name)); if(!pl||(pl.status&&pl.status.kind==='out')||!stMain(g,pl)) return;
    const st=(pl.stats||[]).find(s=>s.key===p.stat); if(!st) return; const b=hpBest(p); if(!b||b.line==null) return; const line=+b.line, T=Math.floor(line)+1;
    let pm=null; if(st.proj!=null){ const mt=hpMatchup(g,pl,st.key); const mu=st.proj*mt.f; pm=mu<8?poisGE(T,mu):1-phi((T-0.5-mu)/Math.max(0.6,(st.sd||Math.sqrt(mu)))); if(side==='under') pm=1-pm; var why=mt.why; } else var why='';
    const lab=surname(pl.name)+' '+(side==='over'?'Over ':'Under ')+line+' '+String(st.label||st.key).toLowerCase();
    push('o:'+g.id+':pp:'+pl.id+':'+st.key+':'+side,'prop',lab,p,o,pm,{k:'prop',pid:pl.id,stat:st.key,T:T,dir:side==='over'?'ge':'lt'},g.id+':'+pl.id+':'+st.key,{pid:pl.id,avail:pl.avail==null?1:pl.avail,why:why,lead:stLead(g,pl)}); }); });
  /* stat thresholds ("125+ pass yds", "1+ receptions", "2+ pass TD"): ONLY the rungs FanDuel lists (its alternate lines and 1+ markets, put on the player's ladder by the bot,
     engine/fanduel.py), at FanDuel's price, with FanDuel's bet link. The app no longer invents rungs or prices for the builders: a number FanDuel does not offer is not a pick. */
  (g.players||[]).forEach(pl=>{ if(pl.status&&pl.status.kind==='out') return; const av=pl.avail==null?1:pl.avail;
    (pl.stats||[]).forEach(st=>{ if(!hpPropOk(key,st.key,false)) return; const lab=String(st.label||st.key).toLowerCase();
      (st.miles||[]).forEach(m=>{ if(!m||!m.fd||m.price==null||m.t==null) return; const T=+m.t, pf=clamp(hpImp(m.price)*0.96,0.02,0.97);      // one-sided price: about 4% of it is the book's margin
        const pm=m.p!=null?+m.p:null; const p=adjP(clamp((pm==null?pf:0.5*pf+0.5*pm)*av,0.02,0.97),'prop'), tok='o:'+g.id+':fd:'+pl.id+':'+st.key+':'+T;
        if(out.some(x=>x.tok===tok)) return;
        out.push({id:tok,tok:tok,gid:g.id,kind:'alt',label:surname(pl.name)+' '+T+'+ '+lab,price:m.price,book:'fanduel',bk:'FD',link:m.link||null,nBooks:1,line:T-0.5,pFair:pf,pModel:pm,p:p,ps:p,avail:1,src:'FD',
          spec:{k:'prop',pid:pl.id,stat:st.key,T:T,dir:'ge'},group:g.id+':'+pl.id+':'+st.key,pid:pl.id,lead:stLead(g,pl),fdRung:1,why:'FanDuel alternate line, at FanDuel\'s price.'}); }); }); });
  /* FanDuel's alternate game totals ("Under 7.5" in hockey) */
  if(!(typeof isSoc==='function'&&isSoc(g))) ['over','under'].forEach(d=>{ const x=M.total&&M.total[d], fd=x&&x.books&&x.books.fanduel; if(!fd||!fd.alts) return;
    fd.alts.forEach(a=>{ if(a.odds==null||a.line==null||(fd.line!=null&&+a.line===+fd.line)) return; const ln=+a.line, pf=clamp(hpImp(a.odds)*0.96,0.02,0.97);
      let pm=null; if(cr&&typeof TOTS!=='undefined'&&TOTS[key]){ const po=logistic((cr.projTotal-ln)/TOTS[key]); pm=d==='over'?po:1-po; }
      const p=adjP(clamp(pm==null?pf:0.5*pf+0.5*pm,0.02,0.97),'team'), tok='o:'+g.id+':atot:'+d+':'+ln;
      out.push({id:tok,tok:tok,gid:g.id,kind:'tot',label:(d==='over'?'Over ':'Under ')+ln+' (alt total)',price:a.odds,book:'fanduel',bk:'FD',link:a.link||null,nBooks:1,line:ln,pFair:pf,pModel:pm,p:p,ps:p,avail:1,src:'FD',spec:{k:'tot',dir:d,line:ln},group:g.id+':tot',fdRung:1}); }); });
  /* FanDuel's alternate spreads (NHL alternate puck line, WNBA alternate handicaps): the same team-side leg as the main spread at another number, graded the same way */
  const bk=HP_BOOK[key];
  if(bk&&bk.altSpr&&!(typeof isSoc==='function'&&isSoc(g))) ['home','away'].forEach(sd=>{ const x=M.spread&&M.spread[sd], fd=x&&x.books&&x.books.fanduel; if(!fd||!fd.alts) return;
    fd.alts.forEach(a=>{ if(a.odds==null||a.line==null||(fd.line!=null&&+a.line===+fd.line)) return; const ln=+a.line, pf=clamp(hpImp(a.odds)*0.96,0.02,0.97), lineH=sd==='home'?ln:-ln;
      let pm=null; if(cr&&typeof LOGI!=='undefined'&&LOGI[key]){ const ph=logistic((cr.projMargin+lineH)/LOGI[key]); pm=sd==='home'?ph:1-ph; }
      const p=adjP(clamp(pm==null?pf:0.5*pf+0.5*pm,0.02,0.97),'team'), tok='o:'+g.id+':aspr:'+sd+':'+ln;
      if(out.some(z=>z.tok===tok)) return;
      out.push({id:tok,tok:tok,gid:g.id,kind:'spr',label:(sd==='home'?H:A).abbr+' '+sg(ln)+' ('+bk.altSpr+')',price:a.odds,book:'fanduel',bk:'FD',link:a.link||null,nBooks:1,line:ln,pFair:pf,pModel:pm,p:p,ps:p,avail:1,src:'FD',spec:{k:'spr',side:sd,line:ln},group:g.id+':spr',fdRung:1}); }); });
  /* team totals ("Anaheim Ducks Total Goals"): FanDuel's own team line and its alternate lines. One team total per parlay (hpCat 'tteam'). The model's chance comes from the
     team's projected score: the projected total split by the projected margin, spread like a single team's score (about 0.72 of the game total's spread). */
  if(bk&&bk.teamTot&&e.tt&&!(typeof isSoc==='function'&&isSoc(g))) ['home','away'].forEach(sd=>{ const T=e.tt[sd]; if(!T) return; const nm=(sd==='home'?H:A).abbr;
    const proj=(cr&&typeof TOTS!=='undefined'&&TOTS[key]&&cr.projTotal!=null&&cr.projMargin!=null)?(cr.projTotal+(sd==='home'?1:-1)*cr.projMargin)/2:null;
    ['over','under'].forEach(d=>{ const x=T[d], fd=x&&x.books&&x.books.fanduel; if(!fd||fd.odds==null) return;
      const rows=[{odds:fd.odds,line:fd.line,link:fd.link,main:true}].concat((fd.alts||[]).map(a=>({odds:a.odds,line:a.line,link:a.link})));
      rows.forEach(r=>{ if(r.odds==null||r.line==null||!isFinite(+r.line)) return; const ln=+r.line, pf=clamp(hpImp(r.odds)*0.96,0.02,0.97);
        let pm=null; if(proj!=null){ const po=logistic((proj-ln)/(TOTS[key]*0.72)); pm=d==='over'?po:1-po; }
        const p=adjP(clamp(pm==null?pf:0.5*pf+0.5*pm,0.02,0.97),'team'), tok='o:'+g.id+':tt:'+sd+':'+d+':'+ln;
        if(out.some(z=>z.tok===tok)) return;
        out.push({id:tok,tok:tok,gid:g.id,kind:'tt',label:nm+' team total '+(d==='over'?'Over ':'Under ')+ln+(bk.teamTot==='goals'?' goals':''),price:r.odds,book:'fanduel',bk:'FD',link:r.link||null,nBooks:1,line:ln,pFair:pf,pModel:pm,p:p,ps:p,avail:1,src:'FD',
          spec:{k:'tt',side:sd,dir:d,line:ln},group:g.id+':tt:'+sd,fdRung:r.main?0:1}); }); }); });
  /* FanDuel only: a leg priced at another book, or estimated, is left out */
  const fdo=out.filter(hpIsFd); HP.cache[ck]=fdo; return fdo;
}
/* a bet FanDuel lists, at FanDuel's price */
function hpIsFd(l){ return !!l&&l.book==='fanduel'&&l.price!=null&&isFinite(l.price); }
function hpLeg(tok){ const p=String(tok).split(':'); const g=G[p[1]]; if(!g) return null; const l=hpLegs(g).find(x=>x.tok===tok); return l?Object.assign({},l):null; }

/* games from the selected day through the next 3 days (a Friday home screen still shows Sunday's NFL slate) */
function hpInWin(g){ if(!g.day) return true; const a=Date.parse(S.date+'T12:00:00Z'), d=Date.parse(g.day+'T12:00:00Z'); return d>=a&&d<=a+3*864e5; }
/* ---------- same-game parlays ---------- */
const HP_SIZES=[[2,0.64],[4,0.58],[8,0.54]];     // legs wanted, and the lowest chance a leg may have to be used
const HP_MIN_ALL=0.28;                            // a same-game parlay is only built or shown when its all-hit chance is at least this; a leg that would pull it below is left out, so a big parlay may have fewer legs
/* what kind of bet a leg is, for mixing: a team side (moneyline / spread), the game total, a player over/under, or a stat threshold ("60+ rush yds") */
const hpCat=l=>(l.kind==='ml'||l.kind==='spr')?'side':l.kind==='tot'?'total':l.kind==='tt'?'tteam':l.floor?'floor':l.kind==='alt'?'alt':'ou';
const hpIsUnder=l=>!!(l.spec&&(l.spec.dir==='under'||l.spec.dir==='lt'));
/* picks up to n legs a step at a time. The score is the leg's chance, nudged so the parlay mixes kinds: at most one team side and one game total, no more than
   ~40% unders, a stat type is not repeated more than the size allows, the first leg of each kind (floor legs excepted) gets a bonus, and legs already used in a smaller parlay for the
   same game are marked down so the 2, 4 and 8-leg builds are not the same picks. A leg still has to clear the chance floor for its size. */
/* all-hit chance of a set of legs (the same formula the cards show: product of leg chances, 3% off per extra leg for the legs being linked) */
const hpAllP=ls=>ls.reduce((x,l)=>x*l.p,1)*Math.pow(0.97,Math.max(0,ls.length-1));
/* opts (optional, used by the Generate button): rnd = random function that shakes the scores so a new combination comes out */
function hpPick(legs,n,floor,used,opts){
  const out=[],grp={},per={},kinds={},stats={}; let unders=0; const rnd=opts&&opts.rnd, amp=(opts&&opts.amp)||0.35;
  const maxUnder=Math.max(1,Math.floor(n*0.4)), maxStat=n>=8?3:n>=4?2:1, maxAlt=Math.max(1,Math.ceil(n*0.6)), maxFloor=n>=8?2:n>=4?1:0, maxPer=n>=8?2:1;      // starter thresholds: 2 of 2, 3 of 4, 5 of 8; floor legs (a low rung the player almost always clears): none in a 2-leg, 1 of 4, 2 of 8; legs per player: 1 (2 in an 8-leg parlay, like a QB's yards and TDs)
  while(out.length<n){
    let best=null,bs=-1;
    for(const l of legs){
      if(l.p<floor||grp[l.group]||out.indexOf(l)>=0) continue;
      if(out.length>=1&&hpAllP(out.concat([l]))<HP_MIN_ALL) continue;       // keep the whole parlay at or above the all-hit minimum
      const c=hpCat(l); if((c==='side'||c==='total'||c==='tteam')&&kinds[c]) continue; if(c==='alt'&&(kinds.alt||0)>=maxAlt) continue; if(c==='floor'&&(kinds.floor||0)>=maxFloor) continue;
      if((l.kind==='prop'||l.kind==='alt')&&(per[l.pid]||0)>=maxPer) continue;
      const un=hpIsUnder(l); if(un&&unders>=maxUnder) continue;
      const sk=l.spec&&l.spec.stat; if(sk&&(stats[sk]||0)>=maxStat) continue;
      let s=stScore(l.p)*Math.pow(0.85,used[l.tok]||0)*(1+0.04*(l.lead||0));                // a QB1 / RB1 / WR1 leg edges out an equal-chance leg on a lesser starter
      if(sk) s*=Math.pow(0.93,stats[sk]||0);
      if(un) s*=0.94;
      if(l.book==='fanduel') s*=1.06;                  // a real FanDuel price and link beats an estimate
      if(!kinds[c]&&c!=='floor') s*=n>=4?1.12:1.05;
      if(rnd) s*=1+(rnd()-0.5)*amp;
      if(s>bs){ bs=s; best=l; } }
    if(!best) break;
    out.push(best); grp[best.group]=1; kinds[hpCat(best)]=(kinds[hpCat(best)]||0)+1; if(best.pid) per[best.pid]=(per[best.pid]||0)+1; if(hpIsUnder(best)) unders++;
    const sk=best.spec&&best.spec.stat; if(sk) stats[sk]=(stats[sk]||0)+1; }
  return out;
}
function hpBuild(g){
  const legs=hpLegs(g).slice(); if(legs.length<2) return [];
  const res=[], used={}; let prev=0;
  HP_SIZES.forEach(sz=>{ const n=sz[0], ls=hpPick(legs,n,sz[1],used);
    /* up to n legs: fewer are fine when the game does not have enough good ones, but a 4 or 8 that is no bigger than the size below it is not repeated */
    if(ls.length<2||(n>2&&ls.length<=prev)) return; prev=ls.length; ls.forEach(l=>{ used[l.tok]=(used[l.tok]||0)+1; });
    const s=hpMake(g,n,ls); if(s.p<HP_MIN_ALL) return; res.push(s); });
  return res;
}
function hpMake(g,n,ls){
  const dec=ls.reduce((d,l)=>d*decOf(l.price),1); const cats={}; ls.forEach(l=>{ cats[hpCat(l)]=(cats[hpCat(l)]||0)+1; });
  return {g:g,n:n,k:ls.length,legs:ls,dec:dec,am:amerOfDec(dec),cats:cats,p:hpAllP(ls)};
}
/* ---------- Generate button: a fresh parlay for the same game and size ---------- */
HP.over={}; HP.seen={}; HP.note={};
const hpSig=ls=>ls.map(l=>l.tok).sort().join('|');
function hpRand(seed){ let a=seed>>>0; return function(){ a=(a+0x6D2B79F5)>>>0; let t=a; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function hpRegen(gid,n){
  const g=G[gid]; if(!g) return null; gid=g.id; const sz=HP_SIZES.find(x=>x[0]===n); if(!sz) return null;
  const legs=hpLegs(g).slice(); const key=gid+':'+n; const seen=HP.seen[key]||(HP.seen[key]={});
  const cur=(HP.list||[]).find(s=>String(s.g.id)===String(gid)&&s.n===n); if(cur) seen[hpSig(cur.legs)]=1;
  let best=null;
  for(let t=0;t<40&&!best;t++){
    const amp=0.35+Math.min(t,20)*0.05;                       // shake harder each try when the same combination keeps coming back
    const ls=hpPick(legs,n,sz[1],{},{rnd:hpRand((Date.now()+t*7919+n*131)^(gid.length*977)),amp:amp});
    if(ls.length<2) break; const s=hpMake(g,n,ls); if(s.p<HP_MIN_ALL) continue;
    if(!seen[hpSig(ls)]) best=s; }
  if(!best){ HP.seen[key]={}; return null; }                  // every combination this game can make has been shown: start over next tap
  seen[hpSig(best.legs)]=1; HP.over[key]=best; return best;
}
function hpAllSgp(){
  const gs=boardGames().filter(g=>(S.league==='all'||keyOf(g)===S.league)&&hpInWin(g)&&preOK(g)&&(typeof llState!=='function'||llState(g)==='pre')); const all=[];
  gs.forEach(g=>{ hpBuild(g).forEach(s=>{
    const o=HP.over[g.id+':'+s.n];                        // a parlay made with the Generate button replaces the built one, while its legs are still on offer
    if(o){ const ok=hpLegs(g); if(o.legs.every(l=>ok.some(x=>x.tok===l.tok))) { const nl=o.legs.map(l=>ok.find(x=>x.tok===l.tok)), m=hpMake(g,o.n,nl); if(m.p>=HP_MIN_ALL) s=m; else delete HP.over[g.id+':'+s.n]; } else delete HP.over[g.id+':'+s.n]; }
    all.push(s); }); });
  all.sort((a,b)=>b.p*(1+0.04*(Object.keys(b.cats).length-1))-a.p*(1+0.04*(Object.keys(a.cats).length-1))); return all;       // a mix of kinds ranks a little higher
}
const HP_CATN={side:'team side',total:'total',tteam:'team total',ou:'over/under prop',alt:'stat threshold',floor:'floor leg'};
function hpMixTxt(s){ return Object.keys(s.cats).map(k=>s.cats[k]+' '+HP_CATN[k]+(s.cats[k]>1&&k!=='side'?'s':'')).join(' · '); }
function hpLegRow(l){
  if(l.fdRung) return '<details class="hpleg"><summary><span class="hpl">'+esc(l.label)+'</span> <span class="mono">'+fo(l.price)+'</span> <span class="muted small"><b class="fdtag">FD</b> · '+Math.round(l.p*100)+'%</span></summary>'+
    '<div class="small muted hpld">FanDuel alternate line at FanDuel\'s price. Chance '+Math.round(l.p*100)+'% (FanDuel\'s price without its margin'+(l.pModel!=null?', blended with the model\'s '+Math.round(l.pModel*100)+'%':'')+').'+(l.link?' <a href="'+esc(l.link)+'" target="_blank" rel="noopener">Open this leg on FanDuel</a>':'')+'</div></details>';
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
  return '<div class="potd hit'+(on?' on':'')+'"><div class="ph"><b>'+(typeof tlogo==='function'?tlogo(keyOf(g),g.teams.away,20)+' ':'')+esc(g.teams.away.abbr)+' @ '+(typeof tlogo==='function'?tlogo(keyOf(g),g.teams.home,20)+' ':'')+esc(g.teams.home.abbr)+' <span class="muted small">'+esc(LGN[keyOf(g)]||keyOf(g).toUpperCase())+' · '+esc(g.startDate||'')+' · '+s.k+(s.k<s.n?' of up to '+s.n:'')+' legs</span></b><span class="hpstat"><span class="mono">est. '+fo(s.am)+' · ~'+Math.round(s.p*100)+'% all hit</span><button class="btn hpgen" data-act="hp-gen" data-g="'+esc(g.id)+'" data-n="'+s.n+'" title="Build a different parlay for this game">Generate</button></span></div>'+
    '<div class="small muted hpmix">Mix: '+esc(hpMixTxt(s))+(nEst?' · '+nEst+' est. price'+(nEst>1?'s':''):'')+'</div>'+
    (HP.note[g.id+':'+s.n]?'<div class="small muted">'+esc(HP.note[g.id+':'+s.n])+'</div>':'')+
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
    out[n]=show.length?show.map(x=>hpSgpCard(x[0],x[1])).join(''):'<div class="small muted">No game has enough legs at or above '+Math.round(sz[1]*100)+'% (with at least a '+Math.round(HP_MIN_ALL*100)+'% chance of all legs hitting) for a '+n+'-leg parlay'+(S.league==='all'?'':' in this league')+' right now.</div>'; });
  out.note='<div class="small muted">Every leg is a bet FanDuel lists, at FanDuel\'s price: team lines, player over/unders, and FanDuel\'s own alternate lines ("125+ pass yds", "1+ receptions", alternate totals). A number FanDuel does not offer is never used. Player legs are built around the main players of the game. Chances take FanDuel\'s price without its margin and blend it with the model where the model knows the player. Combined odds multiply the leg prices; FanDuel prices same-game legs lower because they are linked, so check the real price in the betslip. Games already under way are not listed here.</div>';
  return out;
}

/* ---------- first basket (NBA / WNBA) ----------
   The bot (engine/firstbasket.py) puts g.fb on every NBA / WNBA card: the chance that each player scores the game's first basket (the model's, averaged with FanDuel's
   first-basket prices when the feed has them), locked at the first pre-tip snapshot. Once the game is final it adds the real first basket from ESPN's play-by-play,
   and data/firstbasket.json keeps the record (how often the top pick was right against how often it was expected to be). A free throw is not a basket. */
function hpFbFd(g){ try{ const O=hpOdds(); const e=O&&bkEvent(g); return (e&&e.first||[]).some(x=>x.pid&&x.name); }catch(_){ return false; } }
function hpFbRecord(){
  const F=window.__LSDATA&&window.__LSDATA.fb; if(!F||!F.leagues) return '';
  const rows=['wnba','nba'].filter(k=>F.leagues[k]&&(F.leagues[k].n||F.leagues[k].pending)&&(S.league==='all'||S.league===k)).map(k=>{ const v=F.leagues[k], nm=k.toUpperCase();
    if(!v.n) return '<div class="small"><b>'+nm+'</b> <span class="muted">'+v.pending+' game'+(v.pending>1?'s':'')+' waiting to be tracked; the record starts with the first final.</span></div>';
    return '<div class="small"><b>'+nm+'</b> top pick right <b>'+v.top1+' of '+v.n+'</b> ('+Math.round(v.top1/v.n*100)+'%, the model expected about '+v.exp1.toFixed(1)+') · first scorer in our top 3: <b>'+v.top3+' of '+v.n+'</b> ('+Math.round(v.top3/v.n*100)+'%, expected about '+v.exp3.toFixed(1)+')'+(v.listed<v.n?' · '+(v.n-v.listed)+' times the scorer was not on our list':'')+(v.pending?' · '+v.pending+' to come':'')+'</div>'; }).join('');
  const rec=(F.recent||[]).filter(r=>S.league==='all'||S.league===r.lg).slice(0,6).map(r=>'<div class="small"><span class="mono">'+(r.rank===1?'✓':r.rank&&r.rank<=3?'~':'✗')+'</span> '+esc(r.a)+' @ '+esc(r.h)+': <b>'+esc(r.who)+'</b> ('+(r.sv===3?'a three':'a basket')+(r.ft?', after a free throw':'')+') <span class="muted">· we had '+(r.rank?'him #'+r.rank+' at '+Math.round((r.pw||0)*100)+'%':'him off the list')+', top pick '+esc(r.top||'–')+(r.p1!=null?' '+Math.round(r.p1*100)+'%':'')+'</span></div>').join('');
  if(!rows&&!rec) return '';
  return '<div class="rg"><div class="rgh"><b>Track record</b> <span class="muted small">the first made field goal of each game</span></div>'+rows+(rec?'<div class="small muted" style="margin-top:6px">Latest results (✓ top pick, ~ in our top 3, ✗ missed):</div>'+rec:'')+'</div>';
}
function hpFirstHtml(){
  const gs=boardGames().filter(g=>(keyOf(g)==='nba'||keyOf(g)==='wnba')&&(S.league==='all'||keyOf(g)===S.league)&&hpInWin(g)&&(preOK(g)||(g.fb&&g.fb.locked)));
  const rec=hpFbRecord(); if(!gs.length) return rec;
  const rows=gs.map(g=>{ const f=g.fb, A=g.teams.away, H=g.teams.home; const hd='<div class="rgh"><b>'+esc(A.abbr)+' @ '+esc(H.abbr)+'</b> <span class="muted small">'+esc(g.startDate||'')+'</span></div>';
    if(!f||!f.rows||!f.rows.length) return '<div class="rg">'+hd+'<div class="small muted">No first-basket prediction yet: it appears once the game has its player list or FanDuel posts the market.</div></div>';
    const w=f.res&&f.res.fg; const pH=f.pH==null?null:f.pH; const tn=f.tip==null?'':(f.tip>=0.005?' · '+esc(H.abbr)+' has the taller centre':f.tip<=-0.005?' · '+esc(A.abbr)+' has the taller centre':'');
    const top=f.rows.slice(0,6).map((r,i)=>{ const hit=w&&(String(w.i)===String(r.id)||(w.n&&String(w.n).toLowerCase()===String(r.name).toLowerCase()));
      return '<div class="small">'+(hit?'<b>✓ ':'')+esc(r.name)+' <span class="muted">'+esc((r.side==='home'?H:A).abbr)+'</span> <span class="mono">'+(r.p*100).toFixed(1)+'%</span> <span class="muted">fair '+fo(hpAm(r.p))+(r.fd!=null?' · <b class="fdtag">FD</b> '+fo(r.fd):'')+(r.pt!=null&&i<3?' · '+Math.round(r.pt*100)+'% of '+esc((r.side==='home'?H:A).abbr)+'\'s first baskets':'')+'</span>'+(hit?'</b>':'')+'</div>'; }).join('');
    const res=w?'<div class="small" style="margin:4px 0"><b>First basket: '+esc(w.n)+'</b> ('+esc(w.tm==='home'?H.abbr:A.abbr)+', '+(w.sv===3?'a three':'a field goal')+(w.q?', Q'+w.q+' '+esc(w.c||''):'')+')'+(f.res.any&&f.res.any.i!==w.i&&f.res.any.sv===1?' <span class="muted">· the first points were a free throw by '+esc(f.res.any.n)+'</span>':'')+'</div>'
      :(f.locked?'<div class="small muted" style="margin:4px 0">Tipped off: this is the locked pre-game prediction. The result is added after the game.</div>':'');
    return '<div class="rg">'+hd+res+top+'<div class="small muted">'+esc(H.abbr)+' '+(pH==null?'':Math.round(pH*100)+'% / '+esc(A.abbr)+' '+Math.round((1-pH)*100)+'% to score first')+tn+' · '+(f.src==='both'?'model averaged with FanDuel\'s first-basket prices':f.src==='book'?'from FanDuel\'s first-basket prices (no player cards for this game)':'model only (FanDuel has not posted first basket)')+'</div></div>'; }).join('');
  return rec+rows+'<div class="small muted">Chance = who scores the game\'s first made field goal. Model: which team scores first (a little for the taller centre and the better team) times the player\'s share of his team\'s scoring, scaled by availability. Even the favourite is rarely above 15%. A free throw does not count; sportsbooks differ on that, so check your book\'s rule.</div>';
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
  return '<section class="game hpsec"><div class="sec">'+parlays+stacks+hpFold('fb','First basket (NBA and WNBA)',(window.__LSDATA&&window.__LSDATA.fb&&window.__LSDATA.fb.leagues&&Object.keys(window.__LSDATA.fb.leagues).some(k=>window.__LSDATA.fb.leagues[k].n)?'tracked · ':'')+'who scores it first',fb,true)+hpFold('nrfi','No run first inning (MLB)','',nr,false)+'</div></section>';
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
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act="hp-gen"]'); if(!t) return; e.stopPropagation(); e.preventDefault();
  const gid=t.getAttribute('data-g'), n=+t.getAttribute('data-n'); let r=null; try{ r=hpRegen(gid,n); }catch(err){ try{ console.error('Line Scout: generate failed',err); }catch(_){} }
  HP.note[gid+':'+n]=r?'':'That was every combination this game can make at this size. Tap again to start over.';
  render();
},true);
/* signed-in practice bets are priced by the server from the slate; a feed leg goes through only when the slate offers the same line */
function hpServerTok(l){
  const g=G[l.gid]; if(!g||!l.spec) return null; const sp=l.spec, L=g.lines||{};
  if(sp.k==='ml') return 'g:'+g.id+':ml:'+sp.side;
  if(sp.k==='spr'){ const ln=sp.side==='home'?L.sprHome:L.sprAway; return ln!=null&&Math.abs(ln-sp.line)<0.01?'g:'+g.id+':spr:'+sp.side:null; }
  if(sp.k==='tot') return L.total!=null&&Math.abs(L.total-sp.line)<0.01?'g:'+g.id+':tot:'+sp.dir:'g:'+g.id+':at:'+sp.dir+':'+sp.line;     // alternate total: the server prices it from FanDuel's alt line (lines.altTot)
  if(sp.k==='prop'&&sp.dir==='ge'){ const pl=findPlayer(g,sp.pid); const st=pl&&pl.stats.find(s=>s.key===sp.stat); if(!st) return null;
    if(st.line!=null&&Math.floor(st.line)+1===sp.T) return 'p:'+g.id+':'+pl.id+':'+st.key+':over';
    if((st.miles||[]).some(m=>m.t===sp.T)) return 'p:'+g.id+':'+pl.id+':'+st.key+':m:'+sp.T;        // a threshold from the slate's own ladder
    return null; }
  return null;
}
try{ if(window.__LS) window.__LS.hp={first:hpFirstHtml,legs:hpLegs,all:hpAllSgp,mix:hpMixTxt,pick:hpPick,odds:hpOdds,regen:hpRegen}; }catch(e){}
