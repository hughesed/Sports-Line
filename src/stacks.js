/* ================= Parlay stacks: cross-game parlays per sport (4 / 8 / 12-15 legs) =================
   Sits on the home screen under "Best same-game parlays". For each sport it builds one parlay from player legs spread across ALL of that sport's upcoming games
   (player points, rebounds, receptions, hits ... a few of each), choosing legs that should land often and keep landing:
     - chance   = the leg's blended chance (book no-vig price + model), pulled toward the player's own record at that number (last 15 games), then scaled by what
                  this app has learned from its own graded stacks for that sport and stat type (bounded 0.78 to 1.08)
     - steady   = the stat's spread is small next to its projection and the player cleared the number in most recent games
     - price    = a leg that beats the book's fair price gets a small bonus, a real FanDuel price beats an estimate, an estimated price is marked "est."
   Floor legs (floor.js: a low rung such as "2+ receptions" that the player almost always clears) get a bit of extra weight, their own stat cap, and a learned accuracy factor of their own;
   the fourth size, "Floor 6", is built from floor legs only (one per player, at most 2 per game).
   Each stack is locked the first time it is shown (so it does not reshuffle every data refresh), written to the tracked-picks ledger (P.calls, kinds pl4 / pl8 / pl12) and
   graded leg by leg as each game finishes. The graded legs feed back into the chance of future legs. Practice only. */
const PL={sport:null,size:4,cache:{},todo:{},view:{},learn:null,learnV:-1};
const PL_SIZES=[
  {n:4, min:4, max:4, floor:0.68,add:0.68,maxStat:2,maxGame:2,tab:'4 legs'},
  {n:8, min:7, max:8, floor:0.64,add:0.64,maxStat:3,maxGame:3,tab:'8 legs'},
  {n:12,min:12,max:15,floor:0.60,add:0.68,maxStat:4,maxGame:4,tab:'12–15 legs'},
  {n:6, min:5, max:6, floor:0.86,add:0.86,maxStat:4,maxGame:2,tab:'Floor 6',onlyFloor:true}];
const PL_ORDER=['nfl','cfb','nba','wnba','cbb','mlb','nhl'];
const PL_MAXVER=3;                                       // most stacks written down per sport and size in one day
const plKind=sz=>'pl'+sz.n;
const plSport=k=>LGN[k]||String(k).toUpperCase();

/* ---------- what the app has learned from its own graded legs ---------- */
function plLearnMap(){
  if(PL.learn&&PL.learnV===CALV) return PL.learn;
  const st={},dr={},fl={},seen={};
  legsGraded().forEach(o=>{ const l=o.l,c=o.c; if(c.kind==='live'||!l.spec||l.spec.k!=='prop'||l.p==null||!c.key) return;
    const once=c.date+'|'+l.id; if(c.multi){ if(seen[once]) return; seen[once]=1; }          // the same leg sits in several stacks of one day (4, 6, 8, 12): it is one result, not one per stack
    const w=l.res==='W'?1:0, k=c.key+'|'+l.spec.stat, d=c.key+'|'+(l.spec.dir==='lt'?'u':'o');
    const lst=l.fl?[[st,k],[dr,d],[fl,c.key]]:[[st,k],[dr,d]];
    lst.forEach(a=>{ const m=a[0],kk=a[1]; const x=m[kk]||(m[kk]={n:0,said:0,got:0}); x.n++; x.said+=l.p; x.got+=w; }); });
  const fin=m=>Object.keys(m).forEach(k=>{ const x=m[k]; const pb=x.said/x.n; x.pb=pb; x.f=x.n<4?1:clamp((x.got+8*pb)/(x.said+8*pb),0.78,1.08); });
  fin(st); fin(dr); fin(fl); PL.learn={st:st,dr:dr,fl:fl}; PL.learnV=CALV; return PL.learn;
}
function plFactor(sport,stat,under){
  const m=plLearnMap(), a=m.st[sport+'|'+stat], b=m.dr[sport+'|'+(under?'u':'o')];
  return clamp((a?a.f:1)*(b&&b.n>=10?b.f:1),0.78,1.08);
}
/* how floor legs of one sport have really done, from this app's own graded floor legs (needs 4; bounded 0.78 to 1.08) */
function plFloorFactor(sport){ const x=plLearnMap().fl[sport]; return x&&x.n>=4?x.f:1; }

/* ---------- the legs of one game ---------- */
/* games the odds feed does not cover still get legs from the slate's own stat ladders (model price, marked est.) */
function plSlateLegs(g){
  const out=[];
  (g.players||[]).forEach(pl=>{ if(pl.status&&pl.status.kind==='out') return;
    (pl.stats||[]).forEach(st=>{ if(st.line==null) return;
      const rungs=(st.miles||[]).filter(m=>m&&m.t!=null).map(m=>{ if(m.p!=null) return m; const r=(typeof flRungP==='function')?flRungP(pl,st,+m.t):null; return r?{t:m.t,price:m.price,p:r.p}:null; }).filter(Boolean); if(!rungs.length) return;
      const cand=rungs.filter(m=>m.p>=0.58&&m.p<=0.88&&m.t>=0.5*(+st.line)).sort((a,b)=>b.t-a.t);
      const picks=[]; [cand.find(m=>m.p>=0.74),cand.find(m=>m.p<0.74)].forEach(m=>{ if(m&&picks.indexOf(m)<0) picks.push(m); });
      picks.forEach(m=>{ const av=pl.avail==null?1:pl.avail, p=adjP(clamp(m.p*av,0.02,0.97),'prop'), priced=m.price!=null, tok='p:'+g.id+':'+pl.id+':'+st.key+':m:'+m.t;
        out.push({id:tok,tok:tok,gid:g.id,kind:'alt',label:surname(pl.name)+' '+m.t+'+ '+String(st.label||st.key).toLowerCase(),price:priced?m.price:estPrice(m.p),book:priced?'draftkings':'est',bk:priced?'DK':'est.',
          link:null,nBooks:0,line:m.t-0.5,pFair:null,pModel:m.p,p:p,spec:{k:'prop',pid:pl.id,stat:st.key,T:m.t,dir:'ge'},group:g.id+':'+pl.id+':'+st.key,pid:pl.id}); }); }); });
  return out;
}
/* one leg, scored. p = chance of landing, score = how much the builder wants it */
function plLeg(g,l,sport){
  const sp=l.spec; if(!sp||sp.k!=='prop') return null;
  const pl=findPlayer(g,sp.pid); if(!pl) return null; const st=(pl.stats||[]).find(s=>s.key===sp.stat); if(!st) return null;
  const under=sp.dir==='lt', est=l.book==='est';
  const vals=(st.v15||[]).filter(x=>x!=null); const hist=vals.length>=4?{n:vals.length,h:vals.filter(x=>under?x<sp.T:x>=sp.T).length}:null;
  const mu=Math.max(0.4,+(st.proj!=null?st.proj:st.avg)||0), cv=st.sd!=null?st.sd/mu:null;
  let p=l.p; if(hist) p=(hist.h+8*p)/(hist.n+8);                // the player's own record at this number counts for more the more games there are
  p=clamp(p*plFactor(sport,sp.stat,under)*(l.floor?plFloorFactor(sport):1),0.02,0.97);
  const edge=(!est&&l.pFair!=null)?clamp(p-l.pFair,-0.06,0.10):0;
  const stead=cv==null?0.5:1-clamp((cv-0.25)/0.75,0,1), hr=hist?hist.h/hist.n:null;
  const steady=p>=0.62&&(cv==null||cv<=0.6)&&(hr==null||hr>=0.7);
  const score=p+0.5*edge+0.04*stead+(l.book==='fanduel'?0.01:0)-(est?0.015:0)+(hr!=null?0.03*(hr-0.5):0)+(l.floor?0.03:0);                 // a floor leg (a low rung he almost always clears) is the kind that keeps landing
  const lab=String(st.label||st.key), A=g.teams.away.abbr, H=g.teams.home.abbr, tm=pl.abbr||'', side=tm===H?'home':tm===A?'away':'';
  const what=under?'Under '+l.line+' '+lab.toLowerCase():(l.kind==='alt'?sp.T+'+ ':'Over '+l.line+' ')+lab.toLowerCase();
  return {tok:l.tok||l.id,gid:g.id,pid:pl.id,sk:sp.stat,skl:lab,who:surname(pl.name),team:tm,game:side==='home'?H+' vs '+A:side==='away'?A+' at '+H:A+' @ '+H,what:what,under:under,spec:sp,
    price:l.price,book:l.book,bk:l.bk||l.src||'',link:l.link||null,est:est,pFair:l.pFair==null?null:l.pFair,hist:hist,cv:cv,steady:steady,p:p,score:score,edge:edge,floor:!!l.floor,proj:l.floor?(l.proj!=null?l.proj:mu):null};
}
function plLegsOf(g){
  plLearnMap();
  const O=hpOdds(), sport=keyOf(g), ck='L'+g.id+'|'+(O?O.generatedAt:'')+'|'+CALV+'|'+PL.learnV;
  if(PL.cache[ck]) return PL.cache[ck];
  let base=[]; try{ base=O?hpLegs(g).filter(l=>l.kind==='prop'||l.kind==='alt'):[]; }catch(e){ base=[]; }
  if(!base.some(l=>!l.floor)){ const have={}; base.forEach(l=>{ if(l.spec) have[l.spec.pid+'|'+l.spec.stat+'|'+l.spec.T]=1; });
    base=base.concat(plSlateLegs(g).filter(l=>!have[l.spec.pid+'|'+l.spec.stat+'|'+l.spec.T])); }
  if(!O||!base.some(l=>l.floor)){ try{ const have={}; base.forEach(l=>{ if(l.spec) have[l.spec.pid+'|'+l.spec.stat+'|'+l.spec.T]=1; }); if(typeof flLegs==='function') base=base.concat(flLegs(g).filter(l=>!have[l.spec.pid+'|'+l.spec.stat+'|'+l.spec.T])); }catch(e){} }
  const out=[]; base.forEach(l=>{ try{ const s=plLeg(g,l,sport); if(s) out.push(s); }catch(e){} });
  Object.keys(PL.cache).forEach(k=>{ if(k.indexOf('L'+g.id+'|')===0&&k!==ck) delete PL.cache[k]; });
  PL.cache[ck]=out; return out;
}
const plGames=sport=>boardGames().filter(g=>keyOf(g)===sport&&hpInWin(g)&&preOK(g)&&(typeof llState!=='function'||llState(g)==='pre'));
function plPool(sport){ const out=[]; plGames(sport).forEach(g=>plLegsOf(g).forEach(l=>out.push(l))); return out; }

/* ---------- pick the legs ---------- */
function plPick(pool,sz){
  const cand=pool.filter(l=>l.p>=sz.floor&&(!sz.onlyFloor||l.floor)), nG={},nS={}; cand.forEach(l=>{ nG[l.gid]=1; nS[l.sk]=1; });
  /* the spread caps relax when a sport has few games or few stat types on offer (a postseason slate, NHL points only), so a stack can still be built */
  const capG=Math.max(sz.maxGame,Math.ceil(sz.min/Math.max(1,Object.keys(nG).length))), capS=Math.max(sz.maxStat,Math.ceil(sz.min/Math.max(1,Object.keys(nS).length)));
  const maxEst=Math.ceil(sz.max*0.6), maxFl=sz.onlyFloor?sz.max:Math.ceil(sz.max*0.6);       // the regular sizes keep room for real-priced legs; Floor 6 is floor legs only
  const run=frac=>{
    const out=[],per={},stat={},gm={}; let unders=0,est=0,fls=0; const maxUnder=Math.floor(sz.max*frac);
    while(out.length<sz.max){
      let best=null,bs=-1;
      for(const l of cand){
        if(per[l.pid]||out.indexOf(l)>=0) continue;
        if((stat[l.sk]||0)>=(l.floor?capS+1:capS)||(gm[l.gid]||0)>=capG) continue;     // floor legs may repeat a stat once more (several receivers)
        if(l.under&&unders>=maxUnder) continue; if(l.floor&&fls>=maxFl) continue; if(l.est&&!l.floor&&est>=maxEst) continue;           // the cap on estimated prices is for guesses: a floor rung is estimated by nature (the feed lists main lines only)
        if(out.length>=sz.min&&l.p<sz.add) continue;                 // past the minimum, a leg has to be strong to be added
        const s=l.score*Math.pow(0.97,gm[l.gid]||0)*Math.pow(0.96,stat[l.sk]||0);
        if(s>bs){ bs=s; best=l; } }
      if(!best) break;
      out.push(best); per[best.pid]=1; stat[best.sk]=(stat[best.sk]||0)+1; gm[best.gid]=(gm[best.gid]||0)+1; if(best.under) unders++; if(best.est&&!best.floor) est++; if(best.floor) fls++;
    }
    return out;
  };
  /* about a quarter unders at most; only when too little else clears the bar does the cap loosen (and the card says so) */
  let out=[]; for(const f of [0.25,0.5,1]){ out=run(f); if(out.length>=sz.min) break; }
  return {legs:out,avail:cand.length,capG:capG,capS:capS};
}
function plSummarize(sport,sz,legs,extra){
  const dec=legs.reduce((d,l)=>d*decOf(l.price),1), games={}; legs.forEach(l=>games[l.gid]=1);
  const pAll=legs.reduce((x,l)=>x*l.p,1)*Math.pow(0.99,Math.max(0,legs.length-1));
  const s={sport:sport,sz:sz,legs:legs,dec:dec,am:amerOfDec(dec),pAll:pAll,games:Object.keys(games).length,
    avgP:legs.reduce((x,l)=>x+l.p,0)/legs.length,steady:legs.filter(l=>l.steady).length,est:legs.filter(l=>l.est).length,fd:legs.filter(l=>l.book==='fanduel').length};
  return Object.assign(s,extra||{});
}
function plBuildFor(sport,sz){
  plLearnMap();
  const O=hpOdds(), key='B'+sport+'|'+sz.n+'|'+TODAY+'|'+S.date+'|'+(O?O.generatedAt:'')+'|'+CALV+'|'+PL.learnV;      // S.date: the pool is the selected day and the 3 after it
  if(PL.cache[key]!==undefined) return PL.cache[key];
  Object.keys(PL.cache).forEach(k=>{ if(k.indexOf('B'+sport+'|'+sz.n+'|')===0) delete PL.cache[k]; });
  const pool=plPool(sport), r=plPick(pool,sz);
  const res=r.legs.length>=sz.min?plSummarize(sport,sz,r.legs,{capG:r.capG,capS:r.capS}):{none:true,avail:r.avail,got:r.legs.length,pool:pool.length,sz:sz,sport:sport};
  PL.cache[key]=res; return res;
}
/* a stack that was written down earlier today and whose games have not started is shown as it was written down (so it does not reshuffle) */
function plFromCall(c){
  const sz=PL_SIZES.filter(x=>plKind(x)===c.kind)[0];
  const legs=c.legs.map(l=>{ const cur=(typeof hpLeg==='function'&&l.id.indexOf('o:')===0)?hpLeg(l.id):null;
    return {tok:l.id,gid:l.gid,pid:l.pid||'',sk:l.sk||'',skl:l.skl||'',who:l.who||l.label,team:l.team||'',game:l.game||'',what:l.what||'',under:!!l.under,spec:l.spec,price:l.price,book:l.bkn||(l.est?'est':''),
      bk:l.bk||'',link:(cur&&cur.link&&cur.book==='fanduel')?cur.link:(l.lk||null),est:!!l.est,pFair:null,hist:l.hn?{h:l.hh,n:l.hn}:null,cv:null,steady:!!l.sd,p:l.p,score:l.p,res:l.res,floor:!!l.fl,proj:l.pj==null?null:l.pj}; });
  return plSummarize(c.key,sz,legs,{locked:c,t:c.t});
}
function plStackFor(sport,sz){
  const mine=P.calls.filter(c=>c.multi&&c.kind===plKind(sz)&&c.key===sport&&c.date===TODAY).sort((a,b)=>a.t-b.t), last=mine[mine.length-1];
  if(last&&last.status==='pending'&&last.legs.length&&last.legs.every(l=>{ const g=G[l.gid]; return g&&preOK(g); })) return plFromCall(last);
  const b=plBuildFor(sport,sz); if(!b||b.none) return b;
  if(mine.length<PL_MAXVER) PL.todo[sport+'|'+sz.n]={b:b,ver:mine.length+1};
  return Object.assign({},b,{ver:mine.length+1,untracked:mine.length>=PL_MAXVER});
}
/* called after every render: write down the stacks that were just shown for the first time */
function plLog(){
  const keys=Object.keys(PL.todo); if(!keys.length) return; let add=0;
  keys.forEach(k=>{ const o=PL.todo[k], b=o.b, id='pl:'+TODAY+':'+b.sport+':'+b.sz.n+':v'+o.ver; if(hasCall(id)||!b.legs||!b.legs.length) return;
    P.calls.push({id:id,date:TODAY,key:b.sport,gid:'',multi:true,kind:plKind(b.sz),t:Date.now(),status:'pending',want:b.sz.n,ver:o.ver,dec:Math.round(b.dec*100)/100,pAll:Math.round(b.pAll*10000)/10000,
      legs:b.legs.map(l=>({id:l.tok,gid:l.gid,pid:l.pid,label:l.who+' '+l.what,price:l.price,p:Math.round(l.p*1000)/1000,spec:l.spec,res:null,sk:l.sk,skl:l.skl,who:l.who,team:l.team,game:l.game,what:l.what,under:l.under?1:0,
        bk:l.bk,bkn:l.book,lk:l.book==='fanduel'?l.link:null,est:l.est?1:0,hh:l.hist?l.hist.h:0,hn:l.hist?l.hist.n:0,sd:l.steady?1:0,fl:l.floor?1:0,pj:l.proj==null?null:Math.round(l.proj*10)/10}))}); add++; });
  PL.todo={}; if(add){ trimCalls(); persist(); }
}

/* ---------- what the sports have to offer ---------- */
function plSports(){
  const out=[]; PL_ORDER.forEach(k=>{ const gs=plGames(k); if(!gs.length) return; const pool=plPool(k); if(pool.length<PL_SIZES[0].min) return; out.push({key:k,name:plSport(k),games:gs.length,legs:pool.length}); });
  return out;
}

/* ---------- display ---------- */
const plPct=x=>Math.round(x*100)+'%';
function plPctAll(x){ return x>=0.1?Math.round(x*100)+'%':x>=0.01?(x*100).toFixed(1)+'%':'<1%'; }
function plFdUrl(s){
  try{ const ls=s.legs.map(l=>l.book==='fanduel'?l.link:null).filter(u=>u&&/^https:\/\/sportsbook\.fanduel\.com\//.test(u)); if(!ls.length) return {url:'',n:0};
    const c=(ls.length>1&&typeof odCombine==='function')?odCombine('fanduel',ls):ls[0]; return c?{url:c,n:ls.length}:{url:ls[0],n:1}; }catch(e){ return {url:'',n:0}; }
}
function plLegRow(l){
  const hr=l.hist?l.hist.h/l.hist.n:null;
  const res=l.res==='W'?' win':l.res==='L'?' loss':'';
  const pj=(l.floor&&l.proj!=null)?' · projects '+(Math.round(l.proj*10)/10):'';
  return '<div class="plr'+res+'"><div class="plw"><b>'+esc(l.who)+'</b> <span class="plwh">'+esc(l.what)+'</span>'+(l.floor?' <b class="flTag" title="a low number the player almost always reaches">floor</b>':'')+'<div class="plsub">'+esc(l.game)+esc(pj)+'</div></div>'+
    '<div class="plpr"><span class="mono">'+fo(l.price)+'</span><span class="plbk'+(l.book==='fanduel'?' fd':'')+'">'+esc(l.est?'est.':(l.book==='fanduel'?'FD':l.bk))+'</span></div>'+
    '<div class="plch"><b>'+plPct(l.p)+'</b><span class="plhist" title="how often the player cleared this number in the last games">'+(l.hist?l.hist.h+'/'+l.hist.n:'–')+'</span></div>'+
    '<i class="pldot'+(l.steady?' on':'')+'" title="'+(l.steady?'steady: small spread and cleared this number in most recent games':'not flagged steady')+'"></i></div>';
}
function plGroups(s){
  const by={},order=[]; s.legs.forEach(l=>{ if(!by[l.sk]){ by[l.sk]={l:l.skl,legs:[]}; order.push(l.sk); } by[l.sk].legs.push(l); });
  order.sort((a,b)=>by[b].legs.length-by[a].legs.length);
  return order.map(k=>by[k]);
}
function plCardHtml(s){
  const gs=plGroups(s), on=s.legs.every(l=>inSlip(l.tok)), fd=plFdUrl(s), open=S.fold['plg'+s.sport+s.sz.n]!=null?S.fold['plg'+s.sport+s.sz.n]:s.sz.n===4;
  const when=s.locked?new Date(s.locked.t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';
  const mix=gs.map(x=>'<span class="plmix"><b>'+x.legs.length+'</b> '+esc(x.l)+'</span>').join('');
  const meterW=Math.max(3,Math.min(100,Math.round(s.pAll*100)));
  return '<div class="plcard'+(on?' on':'')+'"><div class="plh"><div><div class="plt">'+esc(plSport(s.sport))+' · '+(s.sz.onlyFloor?'floor stack · '+s.legs.length+' legs':s.legs.length+'-leg stack')+'</div>'+
      '<div class="pls">'+s.games+' game'+(s.games>1?'s':'')+(s.legs.length<s.sz.max?' · '+s.legs.length+' legs cleared the bar':'')+'</div></div>'+
      '<div class="plo"><b class="mono">'+fo(s.am)+'</b><span>est. odds</span></div></div>'+
    '<div class="plstats"><div><b>~'+plPctAll(s.pAll)+'</b><span>all legs hit</span><div class="plmeter"><i style="width:'+meterW+'%"></i></div></div><div><b>'+plPct(s.avgP)+'</b><span>avg per leg</span></div>'+
      '<div><b>'+s.steady+'/'+s.legs.length+'</b><span>steady legs</span></div></div>'+
    '<div class="plmixrow">'+mix+'</div>'+
    '<details class="plgroups" data-fold="plg'+esc(s.sport+s.sz.n)+'"'+(open?' open':'')+'><summary><b>Legs</b> <span class="muted small">by stat · tap to '+(open?'close':'open')+'</span></summary>'+
      gs.map(x=>'<div class="plg"><div class="plgh"><b>'+esc(x.l)+'</b><span>×'+x.legs.length+'</span></div>'+x.legs.map(plLegRow).join('')+'</div>').join('')+
      '<div class="plkey"><i class="pldot on"></i> steady · the small grey number is how often the player cleared that number in recent games</div></details>'+
    '<div class="btnrow"><button class="btn'+(on?'':' solid')+'" data-act="pl-add" data-sport="'+esc(s.sport)+'" data-size="'+s.sz.n+'">'+(on?'Remove from slip':'Add to slip')+'</button>'+
      (fd.url?'<a class="btn" href="'+esc(fd.url)+'" rel="noopener">Open on FanDuel ('+fd.n+' of '+s.legs.length+' legs)</a>':'')+'</div>'+
    '<div class="plfoot">'+(s.untracked?'Not tracked: '+PL_MAXVER+' '+s.sz.tab+' stacks were already written down for this sport today.':(s.locked?'Locked in at '+esc(when)+' and tracked. Prices are as written down.':'Tracked from the moment it is shown, and graded leg by leg as each game ends.'))+
      (s.games<3&&s.games<s.legs.length?' Small slate, so several legs share a game.':'')+(s.legs.filter(l=>l.under).length*2>s.legs.length?' Mostly unders: little else clears the bar today.':'')+(s.est?' '+s.est+' of '+s.legs.length+' prices are estimates (no book price for that number), so the real payout will differ.':'')+(fd.n&&fd.n<s.legs.length?' Only '+fd.n+' legs can be loaded by link; add the rest by hand.':'')+'</div></div>';
}
/* the stacks' own record, and what it has learned */
function plRecordHtml(sport){
  const cs=P.calls.filter(c=>c.multi&&c.key===sport&&String(c.kind).indexOf('pl')===0);
  const done=cs.filter(c=>c.status==='hit'||c.status==='miss'), parts=PL_SIZES.map(sz=>{ const xs=done.filter(c=>c.kind===plKind(sz)); return xs.length?(sz.onlyFloor?'floor ':sz.tab.replace(' legs','')+'-leg ')+xs.filter(c=>c.status==='hit').length+'/'+xs.length:''; }).filter(Boolean);
  let legN=0,legW=0,said=0; cs.forEach(c=>c.legs.forEach(l=>{ if(l.res==='W'||l.res==='L'){ legN++; if(l.res==='W') legW++; said+=l.p; } }));
  const m=plLearnMap(), notes=[]; const fx=m.fl[sport];
  if(fx&&fx.n>=4) notes.push('Floor legs: '+fx.got+' of '+fx.n+' landed vs '+Math.round(fx.pb*100)+'% expected'+(Math.abs(fx.f-1)>=0.03?' (×'+fx.f.toFixed(2)+' on new floor legs)':'')+'.');
  Object.keys(m.st).filter(k=>k.indexOf(sport+'|')===0&&m.st[k].n>=6).sort((a,b)=>Math.abs(m.st[b].f-1)-Math.abs(m.st[a].f-1)).slice(0,2).forEach(k=>{ const x=m.st[k], sk=k.split('|')[1];
    if(Math.abs(x.f-1)>=0.03) notes.push((x.f<1?'Trusting ':'Leaning on ')+esc(sk)+' legs '+(x.f<1?'less':'more')+': '+x.got+' of '+x.n+' landed vs '+Math.round(x.pb*100)+'% expected (×'+x.f.toFixed(2)+').'); });
  if(!legN&&!parts.length) return '<div class="plrec muted">No graded stacks yet for '+esc(plSport(sport))+'. Each stack shown is written down before kickoff and graded leg by leg; the results then nudge the chances of future legs (needs about 4 graded legs of a stat type before it moves).</div>';
  return '<div class="plrec"><b>Track record</b> '+(parts.length?parts.join(' · ')+' fully hit':'no stack fully graded yet')+(legN?' · legs '+legW+'/'+legN+' ('+Math.round(100*legW/legN)+'%, expected '+Math.round(100*said/legN)+'%)':'')+(notes.length?'<div class="small muted">'+notes.join(' ')+'</div>':'')+'</div>';
}
function plEmptyHtml(r,sport){
  const sz=r.sz;
  if(sz.onlyFloor) return '<div class="plempty"><b>No floor stack right now.</b><div class="small muted">Only '+r.avail+' '+esc(plSport(sport))+' floor leg'+(r.avail===1?'':'s')+' (a low number a player almost always reaches) clear '+Math.round(sz.floor*100)+'%; a floor stack needs '+sz.min+' across different players, no more than '+sz.maxGame+' per game. They appear as players\' game logs fill in and books post lines.</div></div>';
  return '<div class="plempty"><b>No '+sz.tab+' stack right now.</b><div class="small muted">Only '+r.avail+' '+esc(plSport(sport))+' leg'+(r.avail===1?'':'s')+' clear '+Math.round(sz.floor*100)+'% (need '+sz.min+' across different players, with no more than '+sz.maxStat+' of one stat and '+sz.maxGame+' per game). More appear as books post lines and lineups firm up.</div></div>';
}
function plBody(){
  const sports=plSports();
  if(!sports.length) return '<div class="small muted">Parlay stacks use player lines from upcoming games. None are posted yet, so there is nothing to build; they appear as soon as a league\'s player props go up.</div>';
  if(!PL.sport||!sports.some(x=>x.key===PL.sport)) PL.sport=(sports.some(x=>x.key===S.league)?S.league:sports[0].key);
  const stacks={}; PL_SIZES.forEach(sz=>{ stacks[sz.n]=plStackFor(PL.sport,sz); });
  const cur=PL_SIZES.filter(sz=>sz.n===PL.size)[0]||PL_SIZES[0];
  PL.view={}; PL_SIZES.forEach(sz=>{ const s=stacks[sz.n]; if(s&&!s.none) PL.view[PL.sport+'|'+sz.n]=s; });
  const chips=sports.map(x=>'<button class="plchip" data-act="pl-sport" data-k="'+x.key+'" aria-pressed="'+(x.key===PL.sport)+'">'+esc(x.name)+'<span>'+x.games+' game'+(x.games>1?'s':'')+'</span></button>').join('');
  const seg=PL_SIZES.map(sz=>{ const s=stacks[sz.n]; return '<button class="plseg-b" data-act="pl-size" data-n="'+sz.n+'" aria-pressed="'+(sz.n===cur.n)+'"><b>'+esc(sz.tab)+'</b><span>'+(s&&!s.none?'~'+plPctAll(s.pAll)+' hit':'not enough')+'</span></button>'; }).join('');
  const s=stacks[cur.n];
  return '<div class="plchips" role="tablist" aria-label="Sport">'+chips+'</div><div class="plseg" role="tablist" aria-label="Parlay size">'+seg+'</div>'+
    (s&&!s.none?plCardHtml(s):plEmptyHtml(s||{sz:cur,avail:0},PL.sport))+plRecordHtml(PL.sport)+
    '<details class="plhow"><summary class="small muted">How these are picked</summary><div class="small muted">Each stack takes player legs from every upcoming game of one sport, so the legs do not depend on each other the way same-game legs do. A leg\'s chance is the book\'s no-vig price blended with the model, pulled toward how often the player cleared that number in recent games, then scaled by how this app\'s own graded legs for that stat have actually done. Steadier stats (small spread next to the projection) and legs whose price beats the fair price rank higher, a real FanDuel price beats an estimate, and the mix caps one player per stack, '+cur.maxStat+' of one stat and '+cur.maxGame+' per game for this size, and about a quarter unders. Odds multiply the legs\' prices; the all-hit chance multiplies their chances, with a small haircut. Floor legs are low numbers that a player nearly always reaches ("2+ receptions", "15+ receiving yards"): the projection sits well above the number, he cleared it in nearly every recent game, and the leg is 86%+; they rank a little higher and may repeat a stat once more, and the Floor 6 size is built from them alone. Long parlays are long shots by nature: a 12-leg stack of 70% legs lands about 1.4% of the time. Floor prices are estimates unless the book lists that rung, and a book\'s real price for a very safe leg is shorter than fair, so check the payout before relying on it.</div></details>';
}
function plHtml(){
  let inner; try{ inner='<div id="plbox">'+plBody()+'</div>'; }catch(e){ try{ console.error('Line Scout: parlay stacks failed',e); }catch(_){} return ''; }
  return hpFold('pl','Parlay stacks by sport','cross-game · 4, 8, 12–15 legs or a floor 6',inner,true);
}
function plRepaint(){ const b=document.getElementById('plbox'); if(!b) return; try{ b.innerHTML=plBody(); }catch(e){ try{ console.error(e); }catch(_){} } plLog(); }

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act^="pl-"]'); if(!t) return; const act=t.getAttribute('data-act');
  if(act!=='pl-sport'&&act!=='pl-size'&&act!=='pl-add') return; e.stopPropagation(); e.preventDefault();
  if(act==='pl-sport'){ PL.sport=t.getAttribute('data-k'); plRepaint(); return; }
  if(act==='pl-size'){ PL.size=+t.getAttribute('data-n'); plRepaint(); return; }
  const s=PL.view[t.getAttribute('data-sport')+'|'+t.getAttribute('data-size')]; if(!s) return;
  if(s.legs.every(l=>inSlip(l.tok))){ S.slip=S.slip.filter(x=>!s.legs.some(l=>l.tok===x.id)); S.slipMsg=''; }
  else { const legs=s.legs.map(l=>legFor(l.tok)).filter(Boolean);
    if(!legs.length){ S.slipMsg='Those legs are no longer posted, so they cannot be loaded.'; S.slipOpen=true; }
    else { S.slip=legs; S.betMode='parlay'; S.slipOpen=true; S.slipMsg='Loaded '+legs.length+(legs.length<s.legs.length?' of '+s.legs.length:'')+' legs from a '+plSport(s.sport)+' stack'+(legs.length<s.legs.length?' (the rest are no longer posted)':'')+'. Legs are in different games, so the combined price is the plain multiply, and estimated prices will differ at a book.'; } }
  renderSlip(); syncLegButtons(); plRepaint();
},true);

try{ if(window.__LS) window.__LS.pl={PL:PL,sizes:PL_SIZES,settle:settleCalls,build:plBuildFor,log:plLog,body:plBody,learn:plLearnMap,pool:plPool,games:plGames,legsOf:plLegsOf}; }catch(e){}
