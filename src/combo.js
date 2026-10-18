/* ================= Combos: 2x, 3x, 4x, 5x your money, all sports together =================
   For each target (+200, +300, +400, +500 combined odds) the app searches every FanDuel leg it has for games that have not started, across all
   sports, for the set of legs whose combined price lands between the target and the target + 83 points (so +200 to +283 for 2x) and whose chance of
   all hitting is the highest. It is not a same-game parlay: legs come from different games (at most 2 from one game, linked legs cost 3% each).
   Search: legs are ranked by how little chance they give up per unit of payout (log chance / log decimal price), then a beam search keeps the best
   few hundred partial combos at every size and records each combo that reaches the target window; the best all-hit chance wins.
   Always optimized: while none of a recorded combo's games has started, a better combo found on a later data refresh replaces it. Once one of its
   games starts it is locked and graded leg by leg at the finals; a fresh combo from the games still to come can then be recorded (max 3 per target a day).
   Recorded in the tracked-picks ledger (kinds cx2..cx5), so the results show on the next day's report. Practice only. */
const CX={targets:[2,3,4,5],over:83,beam:260,maxLegs:14,pool:90,cache:{},k:2,maxVer:3};
const cxKind=k=>'cx'+k;
const cxLo=k=>100*k, cxHi=k=>100*k+CX.over;                      // American odds window
function cxGames(){ const now=Date.now(); return DATA.games.filter(g=>!g.ghost&&preOK(g)&&(Date.parse(g.iso)-now)<36*3600e3); }
function cxGameTag(g){ return g?g.teams.away.abbr+' @ '+g.teams.home.abbr:''; }
function cxPool(){
  const out=[]; cxGames().forEach(g=>{ let ls=[]; try{ ls=(typeof goldLegsOf==='function')?goldLegsOf(g):[]; }catch(e){ ls=[]; }
    ls.forEach(l=>{ if(l.est||l.ps<0.5||l.ps>0.97) return; const d=decOf(l.price); if(!(d>=1.04)) return;
      out.push(Object.assign({},l,{dec:d,lc:Math.log(d),lv:Math.log(l.ps),lg:keyOf(g)})); }); });
  out.forEach(l=>{ l.r=l.lv/l.lc; });                                // closer to 0 = gives up less chance per unit of payout
  out.sort((a,b)=>b.r-a.r||b.ps-a.ps);
  return out.slice(0,CX.pool);
}
const cxSide=l=>l.spec&&(l.spec.k==='ml'||l.spec.k==='spr'||l.spec.k==='dc');
function cxSearch(pool,k){
  const cmin=Math.log(1+k), cmax=Math.log(1+(cxHi(k)/100)), N=pool.length; if(!N) return null;
  const rBest=pool.reduce((m,l)=>Math.max(m,l.r),-99);
  let beam=[{i:-1,ix:[],c:0,v:0,grp:{},ply:{},per:{},side:{},same:0}], best=null;
  const score=s=>s.v+Math.max(0,cmin-s.c)*rBest;                   // optimistic: the rest of the payout bought at the best rate
  for(let depth=0;depth<CX.maxLegs&&beam.length;depth++){
    const next=[];
    beam.forEach(s=>{ for(let j=s.i+1;j<N;j++){ const l=pool[j]; const c=s.c+l.lc; if(c>cmax+1e-9) continue;
      if(s.grp[l.group]||(l.pid&&s.ply[l.pid])||(s.per[l.gid]||0)>=2) continue;
      if(cxSide(l)&&s.side[l.gid]) continue;
      const same=s.same+((s.per[l.gid]||0)>0?1:0);
      const n={i:j,ix:s.ix.concat(j),c:c,v:s.v+l.lv,grp:Object.assign({},s.grp),ply:Object.assign({},s.ply),per:Object.assign({},s.per),side:Object.assign({},s.side),same:same};
      n.grp[l.group]=1; if(l.pid) n.ply[l.pid]=1; n.per[l.gid]=(n.per[l.gid]||0)+1; if(cxSide(l)) n.side[l.gid]=1;
      if(c>=cmin-1e-9){ const val=n.v+same*Math.log(0.97); if(!best||val>best.val) best={ix:n.ix,val:val,same:same}; }
      else next.push(n); } });
    next.sort((a,b)=>score(b)-score(a)); beam=next.slice(0,CX.beam);
    if(best&&beam.length&&score(beam[0])<best.val) break;            // nothing left in the beam can beat the best found
  }
  if(!best) return null;
  const legs=best.ix.map(i=>pool[i]); const dec=legs.reduce((d,l)=>d*l.dec,1);
  return {k:k,legs:legs,dec:dec,am:amerOfDec(dec),pAll:Math.exp(best.val),sports:Array.from(new Set(legs.map(l=>l.lg)))};
}
function cxBuildAll(){
  const ck=CALV+'|'+((window.__LSDATA&&window.__LSDATA.odds&&window.__LSDATA.odds.generatedAt)||'')+'|'+DATA.asOf+'|'+cxGames().map(g=>g.id).join(',');
  if(CX.cache.key===ck) return CX.cache.val;
  const pool=cxPool(), val={}; CX.targets.forEach(k=>{ try{ val[k]=cxSearch(pool,k); }catch(e){ val[k]=null; try{ console.error('Line Scout: combo failed',e); }catch(_){} } });
  CX.cache={key:ck,val:val}; return val;
}

/* ---------- ledger ---------- */
const cxStarted=c=>c.legs.some(l=>{ const g=G[l.gid]; return !g||!preOK(g); });
const cxSig=legs=>legs.map(l=>l.tok||l.id).sort().join('|');
function cxRec(s){
  return {dec:Math.round(s.dec*100)/100,am:s.am,pAll:Math.round(s.pAll*10000)/10000,
    legs:s.legs.map(l=>({id:l.tok,gid:l.gid,pid:l.pid,label:l.label,price:l.price,p:Math.round(l.ps*1000)/1000,spec:l.spec,res:null,game:cxGameTag(l.g),lg:l.lg,bkn:l.book,lk:l.book==='fanduel'?(l.link||null):null}))};
}
function cxToday(k){ return P.calls.filter(c=>c.kind===cxKind(k)&&c.date===TODAY&&c.status!=='void').sort((a,b)=>a.t-b.t); }
/* what to show for a target: the optimized combo, written down (or swapped in) so it gets graded */
function cxFor(k,fresh){
  const mine=cxToday(k), last=mine[mine.length-1]; let changed=false, cur=null;
  if(last&&last.status==='pending'&&!cxStarted(last)){
    if(fresh&&fresh.pAll>last.pAll+0.002&&cxSig(fresh.legs)!==cxSig(last.legs)){ Object.assign(last,cxRec(fresh),{t2:Date.now()}); changed=true; }
    cur=last;
  } else if(fresh&&mine.length<CX.maxVer&&!(last&&cxSig(last.legs)===cxSig(fresh.legs))){
    const c=Object.assign({id:'cx:'+TODAY+':'+k+':v'+(mine.length+1),date:TODAY,key:'all',gid:'',multi:true,kind:cxKind(k),t:Date.now(),status:'pending',want:0,ver:mine.length+1},cxRec(fresh));
    P.calls.push(c); cur=c; changed=true;
  } else cur=last||null;
  if(changed){ try{ trimCalls(); persist(); }catch(e){} }
  return {cur:cur,earlier:mine.filter(c=>c!==cur)};
}

/* ---------- display ---------- */
const cxPct=x=>x>=0.1?Math.round(x*100)+'%':x>=0.01?(x*100).toFixed(1)+'%':'<1%';
const cxStake=()=>{ const v=parseFloat(S.stake); return isFinite(v)&&v>0?v:10; };
function cxLegRow(l){
  const g=G[l.gid], res=l.res==='W'?' win':l.res==='L'?' loss':'', mark=l.res==='W'?'✓':l.res==='L'?'✗':l.res==='V'?'–':'';
  return '<div class="plr'+res+'"><div class="plw"><div class="plwh">'+esc(l.label)+'</div><div class="plsub">'+esc((LGN[l.lg]||String(l.lg||'').toUpperCase())+' · '+(l.game||cxGameTag(g)))+'</div></div>'+
    '<div class="plpr mono"><span>'+fo(l.price)+'</span><span class="plbk fd">FD</span></div><div class="plch"><b>'+Math.round(l.p*100)+'%</b></div><span class="cxmk">'+mark+'</span></div>';
}
function cxStatus(c){ return c.status==='hit'?'<span class="cxst ok">✓ Hit</span>':c.status==='miss'?'<span class="cxst bad">✗ Missed</span>':c.status==='void'?'<span class="cxst">Void</span>':cxStarted(c)?'<span class="cxst live">Locked · in play</span>':'<span class="cxst">Optimizing until first game</span>'; }
function cxCard(c,k){
  const st=cxStake(), win=st*(c.dec-1), on=c.legs.every(l=>inSlip(l.id)), wn=c.legs.filter(l=>l.res==='W').length, done=c.legs.filter(l=>l.res).length;
  const fd=(typeof plFdUrl==='function')?plFdUrl({legs:c.legs.map(l=>({book:l.bkn,link:l.lk}))}):{url:'',n:0};
  const sports=Array.from(new Set(c.legs.map(l=>LGN[l.lg]||l.lg))).join(', ');
  return '<div class="plcard cxcard'+(on?' on':'')+'"><div class="plh"><div><div class="plt">'+k+'x your money · '+c.legs.length+' legs</div><div class="pls">'+esc(sports)+'</div></div>'+
    '<div class="plo"><b>'+fo(c.am)+'</b><span>target +'+cxLo(k)+' to +'+cxHi(k)+'</span></div></div>'+
    '<div class="plstats"><div><b>'+cxPct(c.pAll)+'</b><span>all-hit chance</span><div class="plmeter"><i style="width:'+Math.min(100,Math.round(c.pAll*100))+'%"></i></div></div>'+
    '<div><b>$'+win.toFixed(2)+'</b><span>win on $'+st.toFixed(0)+'</span></div><div><b>'+(done?wn+'/'+c.legs.length:Math.round(100*c.legs.reduce((s,l)=>s+l.p,0)/c.legs.length)+'%')+'</b><span>'+(done?'legs hit':'avg leg')+'</span></div></div>'+
    '<div>'+cxStatus(c)+'</div><div class="plg">'+c.legs.map(cxLegRow).join('')+'</div>'+
    (c.status==='pending'&&!cxStarted(c)?'<div class="btnrow"><button class="btn'+(on?'':' solid')+'" data-act="cx-add" data-k="'+k+'">'+(on?'Remove from slip':'Add to slip')+'</button>'+(fd.url?'<a class="btn" href="'+esc(fd.url)+'" target="_blank" rel="noopener">Open on FanDuel'+(fd.n<c.legs.length?' ('+fd.n+' legs)':'')+'</a>':'')+'</div>':'')+'</div>';
}
function cxMini(c,k){ return '<div class="cxmini"><div class="cxmh"><b>'+k+'x · '+fo(c.am)+' · '+c.legs.length+' legs</b>'+cxStatus(c)+'</div><div class="plg">'+c.legs.map(cxLegRow).join('')+'</div></div>'; }
function cxYesterday(){
  const d=new Date(Date.parse(TODAY+'T12:00:00Z')-864e5).toISOString().slice(0,10);
  const cs=P.calls.filter(c=>c.date===d&&/^cx\d$/.test(c.kind)&&c.status!=='void'); if(!cs.length) return '';
  const hit=cs.filter(c=>c.status==='hit').length, done=cs.filter(c=>c.status!=='pending').length;
  return '<div class="small cxy"><b>Yesterday:</b> '+hit+' of '+done+' graded combos hit'+(done<cs.length?' ('+(cs.length-done)+' still open)':'')+' · '+cs.map(c=>c.kind.slice(2)+'x '+(c.status==='hit'?'✓':c.status==='miss'?'✗':'…')).join(' · ')+' <span class="muted">Full legs on yesterday\'s report (calendar).</span></div>';
}
function cxBody(){
  const all=cxBuildAll(); const k=CX.k;
  const seg='<div class="plseg">'+CX.targets.map(t=>{ const s=all[t]; return '<button class="plseg-b" data-act="cx-k" data-k="'+t+'" aria-pressed="'+(t===k)+'"><b>'+t+'x</b><span>'+(s?cxPct(s.pAll):'none')+'</span></button>'; }).join('')+'</div>';
  const r=cxFor(k,all[k]);
  let body;
  if(r.cur) body=cxCard(r.cur,k);
  else body='<div class="plempty small">No set of FanDuel legs from games still to come lands between +'+cxLo(k)+' and +'+cxHi(k)+' right now. It fills in as lines post.</div>';
  const earlier=r.earlier.length?'<details class="plhow"><summary class="small">Earlier '+k+'x combos today ('+r.earlier.length+')</summary>'+r.earlier.map(c=>cxMini(c,k)).join('')+'</details>':'';
  return seg+body+earlier+cxYesterday()+
    '<div class="plfoot">Combined odds must land from the target to at most 83 points over it (2x = +200 to +283). The app tries every FanDuel leg on the board across all sports and keeps the set with the highest chance that all of them hit, using each leg\'s no-vig FanDuel chance blended with the model and scaled by the graded record. It keeps re-optimizing until the first game of the combo starts, then locks it and grades it at the finals; the result shows on the next day\'s report. Legs are in different games where possible; the price shown is the plain multiply, so FanDuel may quote a little differently. Practice only.</div>';
}
function cxHtml(){
  let inner; try{ inner='<div id="cxbox">'+cxBody()+'</div>'; }catch(e){ try{ console.error('Line Scout: combos failed',e); }catch(_){} return ''; }
  return '<section class="game hpsec cxsec"><div class="sec">'+hpFold('cx','Combos · 2x to 5x your money','all sports · highest chance to hit the target',inner,true)+'</div></section>';
}
function cxRepaint(){ const b=document.getElementById('cxbox'); if(!b) return; try{ b.innerHTML=cxBody(); }catch(e){ try{ console.error(e); }catch(_){} } }

/* ---------- past-day report: the combos of that day with every leg ---------- */
function cxDayHtml(date){
  const cs=P.calls.filter(c=>c.date===date&&/^cx\d$/.test(c.kind)&&c.status!=='void').sort((a,b)=>a.kind<b.kind?-1:a.kind>b.kind?1:a.t-b.t);
  if(!cs.length) return '';
  const hit=cs.filter(c=>c.status==='hit').length, done=cs.filter(c=>c.status!=='pending').length;
  return '<section class="game"><div class="sec"><h3>Combos <span class="hint">'+hit+'/'+done+' hit</span></h3>'+cs.map(c=>cxMini(c,+c.kind.slice(2))).join('')+'</div></section>';
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act="cx-k"],[data-act="cx-add"]'); if(!t) return; e.stopPropagation(); e.preventDefault();
  const k=+t.getAttribute('data-k');
  if(t.getAttribute('data-act')==='cx-k'){ CX.k=k; cxRepaint(); return; }
  const c=cxToday(k).filter(x=>x.status==='pending'&&!cxStarted(x)).pop(); if(!c) return;
  if(c.legs.every(l=>inSlip(l.id))){ S.slip=S.slip.filter(x=>!c.legs.some(l=>l.id===x.id)); S.slipMsg=''; }
  else { const legs=c.legs.map(l=>legFor(l.id)).filter(Boolean);
    if(!legs.length){ S.slipMsg='Those legs are no longer posted.'; S.slipOpen=true; }
    else { S.slip=legs; S.betMode='parlay'; S.slipOpen=true; S.slipMsg='Loaded the '+k+'x combo ('+legs.length+(legs.length<c.legs.length?' of '+c.legs.length:'')+' legs, '+fo(c.am)+').'; } }
  renderSlip(); syncLegButtons(); cxRepaint();
},true);
try{ if(window.__LS) window.__LS.cx={CX:CX,pool:cxPool,search:cxSearch,build:cxBuildAll,forK:cxFor,body:cxBody}; }catch(e){}
