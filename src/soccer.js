/* ================= Soccer =================
   Cards come from engine/soccer.py: ESPN's match (so the live score, the grader and the bot all read the same ESPN summary) priced by the sportsbook feed.
   g.lines.soc holds every market the app offers, priced once in Python for both this page and the practice server:
     ml3   home / draw / away over 90 minutes (a draw loses both team sides)   dc    double chance: home or draw, away or draw, no draw
     btts  both teams to score yes / no                                         tot   goal totals 0.5 to 5.5 (under 3.5 / 4.5 are the high-chance legs)
     tt    team goal totals 0.5 to 3.5                                          hcp   handicaps -2.5 to +2.5 on the home side
   Each outcome: {price, p, src}. p comes from a Poisson model fitted to the book's own 3-way and total prices; the price is the book's where it posts one,
   otherwise the app's estimate (marked est.).
   Tokens:  g:<id>:ml:home|draw|away   g:<id>:dc:home|away|nodraw   g:<id>:btts:yes|no   g:<id>:at:over|under:<line>   g:<id>:tt:home|away:over|under:<line>
   (the main handicap and total keep the usual g:<id>:spr:<side> and g:<id>:tot:<dir> tokens). Practice only. */
const SOC_KEYS={dc:1,btts:1,tt:1};
const socM=g=>(g&&g.lines&&g.lines.soc)||null;
const isSoc=g=>!!g&&(g.key||g.lg)==='soccer';
function socPmf(l,n){ const o=[]; let p=Math.exp(-l); for(let k=0;k<n;k++){ o.push(p); p*=l/(k+1); } return o; }
/* chance that test(homeGoals, awayGoals) holds at full time; st (optional) = live state {home, away, f} */
function socProb(g,test,st){
  const s=(g.crossroads&&g.crossroads.soc)||{lh:1.4,la:1.1}; const r=st?Math.max(0,1-st.f):1, ch=st?st.home:0, ca=st?st.away:0;
  const ph=socPmf(s.lh*r,12), pa=socPmf(s.la*r,12); let p=0;
  for(let i=0;i<12;i++) for(let j=0;j<12;j++) if(test(ch+i,ca+j)) p+=ph[i]*pa[j];
  return clamp(p,0,1);
}
function socKeyLn(x){ const v=Math.round(+x*2)/2; return Number.isInteger(v)?v.toFixed(1):String(v); }
function socOut(o,p){ return o?{price:o.price,p:o.p,src:o.src}:{price:estPrice(p),p:p,src:'est.'}; }
const socSrcBk=s=>s==='FanDuel'?'FD':s==='est.'?undefined:'DK';
/* the leg behind a soccer token, or undefined for tokens that are not soccer-specific */
function socLegFor(tok,parts,g){
  if(!isSoc(g)) return undefined;
  const M=socM(g)||{}, L=g.lines, a=g.teams.away, h=g.teams.home, kind=parts[2], side=parts[3];
  const mk=(group,label,o,spec)=>({id:tok,gid:g.id,group:g.id+':'+group,label:label,p:o.p,avail:1,price:o.price,src:o.src,bk:socSrcBk(o.src),spec:spec,soc:1,
    link:(o.src==='FanDuel'&&L.fd&&L.fd[spec.k==='ml'?'ml':spec.k]&&L.fd[spec.k==='ml'?'ml':spec.k][spec.side||spec.dir])||undefined});
  if(kind==='ml'&&(side==='home'||side==='away'||side==='draw')){
    const o=socOut(M.ml3&&M.ml3[side],socProb(g,side==='home'?(x,y)=>x>y:side==='away'?(x,y)=>x<y:(x,y)=>x===y));
    if(side!=='draw'){ const book=side==='home'?L.mlHome:L.mlAway; if(book!=null&&o.src!=='FanDuel'){ o.price=book; o.src=(L.src&&L.src.ml)||'FanDuel'; } }
    return mk('ml',side==='draw'?'Draw (90 min)':g.teams[side].abbr+' to win (90 min)',o,{k:'ml',side:side,x3:1});
  }
  if(kind==='spr'&&(side==='home'||side==='away')){
    const lnH=+L.sprHome, ln=side==='home'?lnH:-lnH; const rowH=M.hcp&&M.hcp[socKeyLn(lnH)];
    const p=socProb(g,(x,y)=>(side==='home'?x-y:y-x)+ln>0); const o=rowH&&rowH[side]?{price:rowH[side].price,p:rowH[side].p,src:rowH[side].src}:{price:side==='home'?L.prHome:L.prAway,p:p,src:'est.'};
    if((side==='home'?L.prHome:L.prAway)!=null) o.price=side==='home'?L.prHome:L.prAway;
    return mk('spr',g.teams[side].abbr+' '+sg(ln)+' goals',o,{k:'spr',side:side,line:ln});
  }
  if(kind==='tot'||kind==='at'){
    const dir=kind==='tot'?side:side, line=kind==='tot'?+L.total:parseFloat(parts[4]); if(!(dir==='over'||dir==='under')||!isFinite(line)) return null;
    const row=M.tot&&M.tot[socKeyLn(line)]; const p=socProb(g,(x,y)=>dir==='over'?x+y>line:x+y<line);
    const o=socOut(row&&row[dir],p); if(kind==='tot'){ const bp=dir==='over'?L.over:L.under; if(bp!=null) o.price=bp; }
    return mk('tot',(dir==='over'?'Over ':'Under ')+line+' goals',o,{k:'tot',dir:dir,line:line});
  }
  if(kind==='dc'&&(side==='home'||side==='away'||side==='nodraw')){
    const o=socOut(M.dc&&M.dc[side],socProb(g,side==='home'?(x,y)=>x>=y:side==='away'?(x,y)=>x<=y:(x,y)=>x!==y));
    return mk('dc',side==='nodraw'?h.abbr+' or '+a.abbr+' (no draw)':g.teams[side].abbr+' or draw',o,{k:'dc',side:side});
  }
  if(kind==='btts'&&(side==='yes'||side==='no')){
    const o=socOut(M.btts&&M.btts[side],socProb(g,(x,y)=>side==='yes'?(x>0&&y>0):(x===0||y===0)));
    return mk('btts','Both teams to score: '+(side==='yes'?'Yes':'No'),o,{k:'btts',dir:side});
  }
  if(kind==='tt'&&(side==='home'||side==='away')){
    const dir=parts[4], line=parseFloat(parts[5]); if(!(dir==='over'||dir==='under')||!isFinite(line)) return null;
    const row=M.tt&&M.tt[side]&&M.tt[side][socKeyLn(line)]; const p=socProb(g,(x,y)=>{ const v=side==='home'?x:y; return dir==='over'?v>line:v<line; });
    return mk('tt:'+side,g.teams[side].abbr+' '+(dir==='over'?'over ':'under ')+line+' goals',socOut(row&&row[dir],p),{k:'tt',side:side,dir:dir,line:line});
  }
  return undefined;
}
/* grading of the soccer-only bet kinds (and the 3-way moneyline: a draw loses both sides). undefined = not a soccer leg, the usual grader decides */
function socGrade(leg,F){
  const sp=leg.spec; if(!sp) return undefined; const g=G[leg.gid]; const soc=isSoc(g)||sp.x3;
  if(!soc&&!SOC_KEYS[sp.k]) return undefined;
  const hm=+F.home, aw=+F.away;
  if(sp.k==='ml'){ if(sp.side==='draw') return hm===aw?'W':'L'; if(hm===aw) return 'L'; return ((sp.side==='home')===(hm>aw))?'W':'L'; }
  if(sp.k==='dc'){ const ok=sp.side==='home'?hm>=aw:sp.side==='away'?aw>=hm:hm!==aw; return ok?'W':'L'; }
  if(sp.k==='btts'){ const y=hm>0&&aw>0; return (sp.dir==='yes')===y?'W':'L'; }
  if(sp.k==='tt'){ const v=sp.side==='home'?hm:aw; if(v===sp.line) return 'V'; return ((sp.dir==='over')===(v>sp.line))?'W':'L'; }
  if(sp.k==='prop'&&soc){       // a stat ESPN did not report for a player who played voids the leg instead of counting as zero
    if(!F.played[sp.pid]) return 'V'; const row=F.stat[sp.pid]||{}; const doc=FEED[leg.gid]; const raw=doc&&doc.p&&doc.p[sp.pid];
    if(raw&&raw[sp.stat]===undefined) return 'V';
    const x=row[sp.stat]||0; return (sp.dir==='ge'?x>=sp.T:x<sp.T)?'W':'L';
  }
  return undefined;
}

/* ---------- card pieces ---------- */
function socBtn(tok,top){ const l=legFor(tok); if(!l) return ''; const on=inSlip(tok);
  return '<button class="odd'+(on?' on':'')+'" data-act="leg" data-tok="'+esc(tok)+'" aria-pressed="'+on+'"><span class="o1">'+esc(top)+'</span><span class="o2 mono">'+esc(fo(l.price))+(l.src==='est.'?'*':'')+' · '+Math.round(l.p*100)+'%</span></button>'; }
function socOddsGrid(g){
  const L=g.lines, a=g.teams.away, h=g.teams.home;
  const btn=(tok,top)=>{ const l=legFor(tok); const on=inSlip(tok); return '<button class="odd'+(on?' on':'')+'" data-act="leg" data-tok="'+esc(tok)+'" aria-pressed="'+on+'"><span class="o1">'+esc(top)+'</span><span class="o2 mono">'+(l?fo(l.price):'–')+'</span></button>'; };
  const row=(t,side)=>'<div class="orow"><div class="team">'+chipOf(t)+'<div class="tn"><div class="n">'+esc(t.short)+'</div><div class="r">'+esc(t.record||'')+(side==='away'?' · away':' · home')+'</div></div></div>'+
    btn('g:'+g.id+':spr:'+side,sg(side==='home'?L.sprHome:L.sprAway))+btn('g:'+g.id+':tot:'+(side==='away'?'over':'under'),(side==='away'?'O ':'U ')+L.total)+btn('g:'+g.id+':ml:'+side,'Win')+'</div>';
  const draw='<div class="orow socdraw"><div class="team"><div class="chip" style="background:#64748b">X</div><div class="tn"><div class="n">Draw</div><div class="r">90 minutes</div></div></div><span></span><span></span>'+btn('g:'+g.id+':ml:draw','Draw')+'</div>';
  return '<div class="ogrid"><div class="ohead"><span></span><span>Handicap</span><span>Goals</span><span>Result</span></div>'+row(a,'away')+row(h,'home')+draw+'</div>'+
    '<div class="small muted">Result is the 90-minute 3-way line: a draw loses both team sides. Handicap and goals follow the book\'s main line.</div>';
}
function socMarketsHtml(g){
  if(!isSoc(g)) return ''; const M=socM(g); if(!M) return ''; const a=g.teams.away, h=g.teams.home, id=g.id;
  const grp=(title,btns)=>'<div class="socg"><div class="small"><b>'+esc(title)+'</b></div><div class="socbtns">'+btns.join('')+'</div></div>';
  const tots=Object.keys(M.tot||{}).map(Number).filter(l=>l>=1.5&&l<=4.5).sort((x,y)=>x-y);
  const goals=tots.map(l=>socBtn('g:'+id+':at:under:'+l,'Under '+l)).concat(tots.map(l=>socBtn('g:'+id+':at:over:'+l,'Over '+l)));
  const tt=s=>Object.keys((M.tt||{})[s]||{}).map(Number).filter(l=>l<=2.5).sort((x,y)=>x-y).map(l=>socBtn('g:'+id+':tt:'+s+':under:'+l,g.teams[s].abbr+' U '+l)+socBtn('g:'+id+':tt:'+s+':over:'+l,g.teams[s].abbr+' O '+l));
  return '<div class="sec socm"><h3>Soccer markets <span class="hint">tap to add · % is the chance, * = estimated price</span></h3>'+
    grp('Double chance',[socBtn('g:'+id+':dc:home',h.abbr+' or draw'),socBtn('g:'+id+':dc:away',a.abbr+' or draw'),socBtn('g:'+id+':dc:nodraw','No draw')])+
    grp('Both teams to score',[socBtn('g:'+id+':btts:yes','Yes'),socBtn('g:'+id+':btts:no','No')])+
    grp('Total goals',goals)+grp(h.abbr+' goals',tt('home'))+grp(a.abbr+' goals',tt('away'))+
    '<div class="small muted">Chances come from expected goals fitted to the book\'s own 3-way and total prices ('+esc(h.abbr)+' '+(g.crossroads.soc.lh).toFixed(2)+', '+esc(a.abbr)+' '+(g.crossroads.soc.la).toFixed(2)+'). Every market is graded on the 90-minute score.</div></div>';
}
function socBookBox(g){
  const cr=g.crossroads, a=g.teams.away, h=g.teams.home, s=cr.soc||{};
  return '<div class="sec"><h3>The market <span class="hint">sportsbook, no vig</span></h3><div class="proj">'+
    '<div class="kv"><div class="k">'+esc(h.short||h.abbr)+' win</div><div class="v">'+pct(cr.pHome)+'</div><div class="s">'+(s.lh!=null?s.lh.toFixed(2)+' exp. goals':'')+'</div></div>'+
    '<div class="kv"><div class="k">Draw</div><div class="v">'+pct(cr.pDraw!=null?cr.pDraw:0)+'</div><div class="s">90 minutes</div></div>'+
    '<div class="kv"><div class="k">'+esc(a.short||a.abbr)+' win</div><div class="v">'+pct(cr.pAway!=null?cr.pAway:1-cr.pHome)+'</div><div class="s">'+(s.la!=null?s.la.toFixed(2)+' exp. goals':'')+'</div></div>'+
    '</div><div class="small muted">'+esc(g.note||'')+'</div></div>';
}
/* every soccer team leg of a game, in the shape the parlay builders use (home_picks.js) */
function socTeamLegs(g){
  if(!isSoc(g)||!socM(g)) return []; const M=socM(g), id=g.id, toks=[];
  ['home','away','draw'].forEach(s=>toks.push('g:'+id+':ml:'+s)); ['home','away','nodraw'].forEach(s=>toks.push('g:'+id+':dc:'+s));
  ['yes','no'].forEach(s=>toks.push('g:'+id+':btts:'+s)); if(g.lines.sprHome!=null) ['home','away'].forEach(s=>toks.push('g:'+id+':spr:'+s));
  Object.keys(M.tot||{}).forEach(l=>{ toks.push('g:'+id+':at:under:'+(+l)); toks.push('g:'+id+':at:over:'+(+l)); });
  ['home','away'].forEach(s=>Object.keys((M.tt||{})[s]||{}).forEach(l=>{ toks.push('g:'+id+':tt:'+s+':under:'+(+l)); toks.push('g:'+id+':tt:'+s+':over:'+(+l)); }));
  const out=[];
  toks.forEach(tok=>{ const l=legFor(tok); if(!l||l.price==null) return; const sp=l.spec;
    const kind=sp.k==='ml'||sp.k==='dc'||sp.k==='spr'?(sp.k==='spr'?'spr':'ml'):'tot'; const book=l.src==='FanDuel'?'fanduel':l.src==='est.'?'est':'draftkings';
    const p=adjP(l.p,'team');
    out.push({id:tok,tok:tok,gid:g.id,kind:kind,label:l.label,price:l.price,book:book,bk:book==='fanduel'?'FD':book==='est'?'est.':'DK',link:l.link||null,nBooks:1,line:sp.line,
      pFair:l.p,pModel:l.p,p:p,ps:p,avail:1,src:l.src,spec:sp,group:l.group,soc:1}); });
  return out;
}

/* ---------- ESPN live feed: soccer summary -> the page's compact doc ---------- */
function socPid(name){ let x=String(name||''); try{ x=x.normalize('NFD').replace(/[̀-ͯ]/g,''); }catch(e){} return 'n'+x.toLowerCase().replace(/[^a-z]/g,''); }
const SOC_STAT={totalGoals:'gls',goalAssists:'ast',totalShots:'shots',shotsOnTarget:'sog',saves:'saves',totalPasses:'passes',passes:'passes',totalTackles:'tkl',tackles:'tkl'};
function soccerBuild(gid){
  const g=G[gid]; if(!g||!g.esl) return Promise.resolve(null);
  return sGet(ESPB+'soccer/'+g.esl+'/summary?event='+gid).then(s=>{
    if(!s||!s.header) return null;
    const comp=s.header.competitions[0], stt=comp.status||{}, ty=stt.type||{};
    const home=comp.competitors.find(c=>c.homeAway==='home'), away=comp.competitors.find(c=>c.homeAway==='away');
    const ab={}; comp.competitors.forEach(c=>{ if(c.team) ab[c.team.id]=c.team.abbreviation; });
    const doc={gid:gid,lg:'soccer',st:{s:ty.state||'pre',per:stt.period||0,clk:stt.displayClock||'',det:ty.shortDetail||ty.detail||'',pre:''},hs:sToi(home&&home.score),as:sToi(away&&away.score),p:{},dnp:[],plays:[],nm:{},ts:{},ab:{home:(home&&home.team&&home.team.abbreviation)||g.teams.home.abbr,away:(away&&away.team&&away.team.abbreviation)||g.teams.away.abbr},sit:{},wp:[]};
    (s.rosters||[]).forEach(r=>{ (r.roster||[]).forEach(x=>{ const at=x.athlete||{}; const nm=at.displayName||at.fullName; if(!nm) return; const pid=socPid(nm);
      const played=!!x.starter||!!x.subbedIn; const d={}; (x.stats||[]).forEach(st=>{ const k=SOC_STAT[st.name]; if(k) d[k]=sToi(st.value!=null?st.value:st.displayValue); });
      if(played) doc.p[pid]=d; else if(ty.state==='post') doc.dnp.push(pid); }); });
    let hs=0, as_=0;
    (s.keyEvents||s.plays||[]).slice(-60).forEach((pl,i)=>{ const tm=ab[(pl.team||{}).id]||''; const sc=!!pl.scoringPlay;
      if(sc){ if(tm===doc.ab.home) hs++; else if(tm===doc.ab.away) as_++; }
      doc.plays.push({i:pl.id||('k'+i),q:(pl.period||{}).number||1,c:(pl.clock||{}).displayValue||'',tm:tm,tx:String(pl.text||pl.shortText||'').trim(),ty:(pl.type||{}).text||'',sc:sc,v:1,sh:sc||/shot|save|attempt/i.test((pl.type||{}).text||''),hs:hs,as:as_}); });
    return doc;
  });
}
/* minute of play from ESPN's clock text ("67'", "45'+2'", "HT") */
function socMinute(clk,det){ const m=String(clk||det||'').match(/(\d+)'?(?:\s*\+\s*(\d+))?/); if(/half|HT/i.test(String(det||''))&&!m) return 45; return m?Math.min(90,+m[1]):0; }

/* ---------- live view: a pitch (shots and goals drawn in the attacking half; home attacks right) ---------- */
function socViz(g){
  const a=g.teams.away,h=g.teams.home; let s='<svg id="rnk-'+g.id+'" class="socp" viewBox="0 0 120 50" role="img" aria-label="Soccer pitch with the latest shots and goals">';
  s+='<rect x="0" y="0" width="120" height="50" fill="#2f8a4e"/>'; for(let i=0;i<8;i++) s+='<rect x="'+(i*15)+'" y="0" width="7.5" height="50" fill="#36985a"/>';
  s+='<rect x="3" y="3" width="114" height="44" fill="none" stroke="#fff" stroke-width=".6"/><line x1="60" y1="3" x2="60" y2="47" stroke="#fff" stroke-width=".6"/><circle cx="60" cy="25" r="7" fill="none" stroke="#fff" stroke-width=".6"/>';
  s+='<rect x="3" y="13" width="15" height="24" fill="none" stroke="#fff" stroke-width=".6"/><rect x="102" y="13" width="15" height="24" fill="none" stroke="#fff" stroke-width=".6"/><rect x="1" y="21" width="2" height="8" fill="#fff"/><rect x="117" y="21" width="2" height="8" fill="#fff"/>';
  s+='<text x="20" y="44" class="rtx" fill="#fff" text-anchor="middle">'+esc(a.abbr)+'</text><text x="100" y="44" class="rtx" fill="#fff" text-anchor="middle">'+esc(h.abbr)+'</text>';
  s+='<g id="rshots-'+g.id+'"></g><circle id="puck-'+g.id+'" r="1.6" cx="0" cy="0" fill="#fff" stroke="#111" stroke-width=".4" style="opacity:0"/></svg>';
  return s;
}
function socV(g){ const V=vis(g.id); if(!V.vs.soc) V.vs.soc={shots:[]}; return V.vs.soc; }
function socApply(g){ const V=socV(g); const el=E('rshots-'+g.id); if(el) el.innerHTML=V.shots.map(s=>nhlShotEl(s,false)).join(''); }
function socPlay(g,p,instant){
  const V=socV(g); const made=!!p.sc; const xy=nhlShotXY(g,p);
  if(p.sh||made){ V.shots.push({x:xy[0],y:xy[1],m:made}); if(V.shots.length>14) V.shots.shift(); }
  if(instant){ socApply(g); return; }
  const els=E('rshots-'+g.id), bl=E('puck-'+g.id);
  if(bl&&(p.sh||made)){ bl.style.opacity=1; bl.animate([{transform:'translate(60px,25px)'},{transform:'translate('+xy[0]+'px,'+xy[1]+'px)'}],{duration:800,easing:'ease-in',fill:'forwards'}).onfinish=()=>{ bl.style.opacity=0; if(els) els.insertAdjacentHTML('beforeend',nhlShotEl({x:xy[0],y:xy[1],m:made},true)); }; }
  chip(g.id,made?'GOAL!':(p.ty||'PLAY').toUpperCase(),(p.c?p.c+' · ':'')+(p.tm?p.tm+' · ':'')+(p.tx||'').slice(0,110),made?'score':(p.sh?'run':'other'));
  if(made) celebrate(g.id,'GOAL!');
}
try{ if(window.__LS) window.__LS.soc={legFor:socLegFor,grade:socGrade,prob:socProb,team:socTeamLegs}; }catch(e){}
