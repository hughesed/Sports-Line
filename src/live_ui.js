/* ================= live legs ================= */
function liveLeg(tok){
  const p=tok.split(':'); const g=G[p[1]]; if(!g) return null;
  const st=stateOf(g); const lg=g.lg; const kind=p[2];
  const closedGame=st.final;
  const mk=(o)=>{ o.id=tok; o.gid=g.id; o.live=true; o.src='live'; o.avail=1; o.price=estPrice(clamp(o.pb,0.02,0.98)); o.closed=closedGame||!st.started||o.pb>0.985||o.pb<0.015; return o; };
  if(kind==='ml'||kind==='spr'||kind==='tot'){
    const M=teamProbs(g,st,true), B=teamProbs(g,st,false);
    if(kind==='ml'){ const side=p[3]; const t=g.teams[side]; const pm=side==='home'?M.win:1-M.win, pb=side==='home'?B.win:1-B.win;
      return mk({group:'L:'+g.id+':ml',label:t.abbr+' to win (live)',p:pm,pb:pb,spec:{k:'ml',side:side}}); }
    if(kind==='spr'){ const side=p[3]; const t=g.teams[side]; const line=side==='home'?g.lines.sprHome:g.lines.sprAway;
      const ph=M.cover(g.lines.sprHome), bh=B.cover(g.lines.sprHome);
      return mk({group:'L:'+g.id+':spr',label:t.abbr+' '+sg(line)+' (live)',p:side==='home'?ph:1-ph,pb:side==='home'?bh:1-bh,spec:{k:'spr',side:side,line:line}}); }
    const dir=p[3], line=parseFloat(p[4]); const po=M.over(line), bo=B.over(line);
    return mk({group:'L:'+g.id+':tot',label:(dir==='over'?'Over ':'Under ')+line+' (live)',p:dir==='over'?po:1-po,pb:dir==='over'?bo:1-bo,spec:{k:'tot',dir:dir,line:line}});
  }
  if(kind==='p'){
    const pl=findPlayer(g,p[3]); if(!pl) return null; const s=pl.stats.find(x=>x.key===p[4]); if(!s) return null;
    const dir=p[5], T=parseFloat(p[6]);
    const pm=propProb(g,st,pl,s,T,true), pb=propProb(g,st,pl,s,T,false);
    if(pm==null||pb==null) return {id:tok,gid:g.id,live:true,closed:true,group:'L:'+g.id+':'+pl.id+':'+s.key,label:surname(pl.name)+' (not playing)',p:0,pb:0.5,price:-110,src:'live',avail:1,spec:null};
    const over=dir==='ge';
    return mk({group:'L:'+g.id+':'+pl.id+':'+s.key,pid:pl.id,label:surname(pl.name)+' '+(over?T+'+ ':'under '+T+' ')+s.label.toLowerCase()+' (live)',p:over?pm:1-pm,pb:over?pb:1-pb,spec:{k:'prop',pid:pl.id,stat:s.key,T:T,dir:dir}});
  }
  return null;
}
function legFor(tok){
  if(tok.indexOf('o:')===0) return (typeof hpLeg==='function')?hpLeg(tok):null;
  if(tok.charAt(0)==='l'&&tok.charAt(1)===':') return liveLeg(tok);
  const parts = tok.split(':'); const k=parts[0]; const g=G[parts[1]]; if(!g) return null;
  const cr=g.crossroads, L=g.lines, lg=g.lg; const SRC=(L.src||{}), bkOf=x=>x==='FanDuel'?'FD':'DK';
  if(k==='g'){
    const kind=parts[2], side=parts[3];
    if(kind==='ml'){
      const t=g.teams[side]; const price= side==='home'?L.mlHome:L.mlAway;
      const p = side==='home'?cr.pHome:1-cr.pHome;
      return {id:tok,gid:g.id,group:g.id+':ml',label:t.abbr+' moneyline',p,avail:1,price,src:SRC.ml||'DraftKings',bk:bkOf(SRC.ml),spec:{k:'ml',side:side}};
    }
    if(kind==='spr'){
      const t=g.teams[side]; const line= side==='home'?L.sprHome:L.sprAway; const price= side==='home'?L.prHome:L.prAway;
      const ph = logistic((cr.projMargin+L.sprHome)/LOGI[g.key||lg]); const p = side==='home'?ph:1-ph;
      return {id:tok,gid:g.id,group:g.id+':spr',label:t.abbr+' '+sg(line),p,avail:1,price,src:SRC.spr||'DraftKings',bk:bkOf(SRC.spr),spec:{k:'spr',side:side,line:line}};
    }
    if(kind==='tot'){
      const po = logistic((cr.projTotal-L.total)/TOTS[g.key||lg]);
      const over = side==='over';
      return {id:tok,gid:g.id,group:g.id+':tot',label:(over?'Over ':'Under ')+L.total,p:over?po:1-po,avail:1,price:over?L.over:L.under,src:SRC.tot||'DraftKings',bk:bkOf(SRC.tot),spec:{k:'tot',dir:side,line:L.total}};
    }
  }
  if(k==='p'){
    const pl=findPlayer(g,parts[2]); if(!pl) return null;
    const st=pl.stats.find(s=>s.key===parts[3]); if(!st) return null;
    const kind=parts[4]; const nm=surname(pl.name);
    const group=g.id+':'+pl.id+':'+st.key;
    if(kind==='over') return {id:tok,gid:g.id,group,pid:pl.id,label:nm+' Over '+st.line+' '+st.label.toLowerCase(),p:st.pOver,avail:pl.avail,price:st.overPrice,src:st.lineSrc==='FanDuel'?'FanDuel':'est.',bk:st.lineSrc==='FanDuel'?'FD':undefined,link:st.fdOver||undefined,spec:{k:'prop',pid:pl.id,stat:st.key,T:Math.floor(st.line)+1,dir:'ge'}};
    if(kind==='under'&&st.underPrice!=null) return {id:tok,gid:g.id,group,pid:pl.id,label:nm+' Under '+st.line+' '+st.label.toLowerCase(),p:1-st.pOver,avail:pl.avail,price:st.underPrice,src:'FanDuel',bk:'FD',link:st.fdUnder||undefined,spec:{k:'prop',pid:pl.id,stat:st.key,T:Math.floor(st.line)+1,dir:'lt'}};
    if(kind==='safe' && st.safeAdj!=null) return {id:tok,gid:g.id,group,pid:pl.id,label:nm+' '+st.safeAdj+'+ '+st.label.toLowerCase(),p:st.pSafe,avail:pl.avail,price:st.safePrice,src:st.safeSrc,spec:{k:'prop',pid:pl.id,stat:st.key,T:st.safeAdj,dir:'ge'}};
    if(kind==='m'){
      const t=parseFloat(parts[5]); const m=st.miles.find(x=>x.t===t); if(!m) return null;
      const p=m.p!=null?clamp(m.p,0.03,0.95):clamp(((m.hit+1)/(m.n+2))*(1+0.5*st.matchup),0.03,0.95);
      return {id:tok,gid:g.id,group,pid:pl.id,label:nm+' '+t+'+ '+st.label.toLowerCase(),p,avail:pl.avail,price:m.price!=null?m.price:estPrice(p),src:m.price!=null?'DraftKings':'est.',spec:{k:'prop',pid:pl.id,stat:st.key,T:t,dir:'ge'}};
    }
  }
  return null;
}
function legSub(tok){ const l=legFor(tok); if(!l) return ''; if(l.live) return fo(l.price)+' · '+pct(l.p); return fo(l.price)+(l.src==='est.'?' est.':' '+(l.bk||'DK'))+' · '+pct(l.p); }
function legBtn(tok,title,sub,dis){
  const on=inSlip(tok);
  return '<button class="leg'+(on?' on':'')+'" data-act="leg" data-tok="'+esc(tok)+'" aria-pressed="'+on+'"'+(dis?' disabled':'')+'><span class="t">'+esc(title)+'</span><span class="pr">'+esc(sub)+'</span></button>';
}
const HID={n:0};
function liveBtn(tok,title){
  const l=legFor(tok); if(!l) return '';
  const on=inSlip(tok);
  if(!S.lvAll&&!on&&!l.closed&&l.p<LIVE_P){ HID.n++; return ''; }
  return '<button class="leg'+(on?' on':'')+'" data-act="leg" data-tok="'+esc(tok)+'" aria-pressed="'+on+'"'+((l.closed&&!on)?' disabled':'')+'><span class="t">'+esc(title)+'</span><span class="pr">'+(l.closed?'closed':fo(l.price)+' · '+pct(l.p))+'</span></button>';
}
function syncLegButtons(){
  document.querySelectorAll('[data-act="leg"]').forEach(b=>{
    const tok=b.getAttribute('data-tok'); const on=inSlip(tok);
    b.classList.toggle('on',on); b.setAttribute('aria-pressed',on);
    if(tok.charAt(0)==='l'){
      const l=legFor(tok); const pr=b.querySelector('.pr'); if(l&&pr){ pr.textContent=l.closed?'closed':fo(l.price)+' · '+pct(l.p); }
      if(l) b.disabled=l.closed&&!on;
    }
  });
}

/* ================= bets: place, settle ================= */
function decOfLegs(legs){ return legs.filter(l=>l.res!=='V').reduce((d,l)=>d*decOf(l.price),1); }
function slipText(legs){ return legs.map(l=>(G[l.gid]?G[l.gid].title:'game')+': '+l.label+' '+fo(l.price)).join('\n'); }
function parseStake(){ const x=parseFloat(String(S.stake).replace(/[^0-9.]/g,'')); return isFinite(x)?r2(x):0; }
function slipGameStarted(leg){ const L=LS(leg.gid); return L.mode==='sim'&&L.started; }
function placeCheck(){
  const legs=S.slip; if(!legs.length) return 'Add at least one selection.';
  const stake=parseStake(); if(stake<0.01) return 'Enter a stake of at least $0.01.';
  const cost=S.betMode==='single'?r2(stake*legs.length):stake;
  if(cost>P.bank+1e-9) return 'Not enough practice money: this costs '+money(cost)+' and the bank is '+money(P.bank)+'.';
  for(const l of legs){
    const L=LS(l.gid);
    if(L.done||L.man.final) return (G[l.gid]?G[l.gid].title:'That game')+' is already final.';
    if(!l.live&&feedStarted(l.gid)) return 'That game has started. Use its live prices in the Live tab for '+(G[l.gid]?G[l.gid].title:'it')+'.';
    if(l.live){ const cur=legFor(l.id); if(cur&&cur.closed) return l.label+' is closed.'; }
  }
  return '';
}
function placeBet(){
  const err=placeCheck(); if(err){ S.slipMsg=err; renderSlip(); return; }
  const stake=parseStake(); const legs=S.slip.map(l=>({id:l.id,gid:l.gid,label:l.label,price:l.price,p:l.p,live:!!l.live,spec:l.spec,res:null}));
  const now=Date.now();
  const mk=(ls,st)=>({id:P.seq++,t:now,mode:ls.length>1?'parlay':'single',stake:st,legs:ls,status:'pending',payout:0});
  const made=[];
  if(S.betMode==='single') legs.forEach(l=>made.push(mk([l],stake))); else made.push(mk(legs,stake));
  const cost=r2(made.reduce((s,b)=>s+b.stake,0)); P.bank=r2(P.bank-cost);
  made.forEach(b=>P.bets.unshift(b)); if(P.bets.length>150) P.bets.length=150;
  S.slip=[]; S.slipOpen=false; S.slipMsg=''; S.flash='Placed '+made.length+' practice bet'+(made.length>1?'s':'')+' for '+money(cost)+'. It settles when ESPN shows the game final.';
  persist(); syncLegButtons(); renderSlip(); renderBank();
  if(S.view==='slips') render();
}
function saveSlip(){
  if(!S.slip.length){ S.slipMsg='Add at least one selection.'; renderSlip(); return; }
  P.saved.unshift({id:P.seq++,t:Date.now(),legs:S.slip.map(l=>({id:l.id,gid:l.gid,label:l.label,price:l.price,p:l.p,live:!!l.live,spec:l.spec,src:l.src,group:l.group,pid:l.pid,avail:l.avail}))});
  if(P.saved.length>60) P.saved.length=60;
  S.slipMsg='Saved to your slips.'; persist(); renderSlip();
  if(S.view==='slips') render();
}
function gradeLeg(leg,F){
  const sp=leg.spec; if(!sp) return 'V';
  if(sp.k==='ml'){ const m=F.home-F.away; if(m===0) return 'V'; return ((sp.side==='home')===(m>0))?'W':'L'; }
  if(sp.k==='spr'){ const m=F.home-F.away; const v=(sp.side==='home'?m:-m)+sp.line; if(v===0) return 'V'; return v>0?'W':'L'; }
  if(sp.k==='tot'){ const t=F.home+F.away; if(t===sp.line) return 'V'; return ((sp.dir==='over')===(t>sp.line))?'W':'L'; }
  if(sp.k==='prop'){ if(!F.played[sp.pid]) return 'V'; const x=(F.stat[sp.pid]||{})[sp.stat]||0; return (sp.dir==='ge'?x>=sp.T:x<sp.T)?'W':'L'; }
  return 'V';
}
function settleBets(gid,F){
  let won=0,lost=0,paid=0,voided=0;
  P.bets.forEach(b=>{
    if(b.status!=='pending') return;
    b.legs.forEach(l=>{ if(l.gid===gid&&!l.res) l.res=gradeLeg(l,F); });
    if(b.legs.some(l=>l.res==='L')){ b.status='lost'; b.payout=0; lost++; return; }
    if(b.legs.every(l=>l.res)){
      const live=b.legs.filter(l=>l.res!=='V');
      if(!live.length){ b.status='void'; b.payout=b.stake; P.bank=r2(P.bank+b.stake); voided++; return; }
      b.status='won'; b.payout=r2(b.stake*decOfLegs(b.legs)); P.bank=r2(P.bank+b.payout); won++; paid+=b.payout;
    }
  });
  return {won,lost,paid,voided};
}
function finishGame(gid){
  const g=G[gid]; const L=LS(gid);
  const F=finalOf(g); L.done=true; if(L.mode==='sim') L.f=1; else L.man.final=true;
  const res=settleBets(gid,F);
  const sim=RT[gid]&&RT[gid].sim; const ot=sim&&sim.ot?' (overtime)':'';
  L.msg='Final'+ot+': '+g.teams.away.abbr+' '+F.away+', '+g.teams.home.abbr+' '+F.home+'. '+(res.won+res.lost+res.voided? 'Settled '+(res.won?res.won+' won ('+money(res.paid)+' paid)':'')+(res.won&&res.lost?', ':'')+(res.lost?res.lost+' lost':'')+(res.voided?(res.won||res.lost?', ':'')+res.voided+' void':'')+'.':'No pending bets on this game.');
  persist();
}

/* ================= candidates: best live bets ================= */
function candidates(g,st){
  const out=[]; const M=teamProbs(g,st,true), B=teamProbs(g,st,false);
  const add=(tok,why,sides,pace)=>{ const l=legFor(tok); if(!l||l.closed) return; const dec=decOf(l.price); const ev=l.p*dec-1; const cn=ctxNotesFor(g,st,sides||['home','away'],pace); if(cn.length) why+=' Game flow: '+cn.join(' '); out.push({tok,leg:l,ev,why}); };
  ['home','away'].forEach(side=>{
    const t=g.teams[side]; add('l:'+g.id+':ml:'+side,'Model '+pct(side==='home'?M.win:1-M.win)+' vs baseline '+pct(side==='home'?B.win:1-B.win)+'. Projected final '+t.abbr+' '+(side==='home'?M.projHome:M.projAway).toFixed(1)+' with the time left and both injury reports.',['home','away'],true);
    add('l:'+g.id+':spr:'+side,'Model final margin '+g.teams.home.abbr+' '+sg(M.projMargin)+' vs baseline '+sg(B.projMargin)+'; the line is '+g.teams.home.abbr+' '+sg(-g.lines.sprHome)+'.',['home','away'],false);
  });
  const lineT=Math.floor(M.projTotal)+0.5;
  ['over','under'].forEach(d=>{ add('l:'+g.id+':tot:'+d+':'+g.lines.total,'Model total '+n1(M.projTotal)+' vs baseline '+n1(B.projTotal)+' (line '+g.lines.total+'), '+Math.round((1-st.f)*100)+'% of the game left.',['home','away'],true); if(lineT!==g.lines.total) add('l:'+g.id+':tot:'+d+':'+lineT,'Live line '+lineT+': model total '+n1(M.projTotal)+', baseline '+n1(B.projTotal)+'.',['home','away'],true); });
  g.players.forEach(pl=>{
    if(st.act[pl.id]==='dnp'||st.gone[pl.id]) return;
    pl.stats.forEach(s=>{
      const c=(st.cur[pl.id]||{})[s.key]||0; const mu=propMu(g,st,pl,s,true), mb=propMu(g,st,pl,s,false);
      const cand=ladder(g,st,pl,s).map(x=>x.T);
      cand.forEach(T=>{
        const h=s.v15.filter(x=>x!=null&&x>=T).length; const n=s.v15.filter(x=>x!=null).length;
        let why=surname(pl.name)+' has '+c+' and needs '+(T-c)+' more '+s.label.toLowerCase()+'. Model expects about '+n1(mu)+' more with '+Math.round((1-st.f)*100)+'% of the game left (baseline '+n1(mb)+'). Reached '+T+'+ in '+h+' of his last '+n+' games.';
        if(pl.boostNotes&&pl.boostNotes.length) why+=' Teammate absence boost: '+pl.boostNotes.join(', ')+'.';
        if(pl.status.kind!=='ok'&&st.act[pl.id]!=='in') why+=' Listed '+pl.status.label+'.';
        add('l:'+g.id+':p:'+pl.id+':'+s.key+':ge:'+T,why,[pl.side],true);
      });
    });
  });
  const seen={}; const picks=[];
  const lo=S.lvAll?0.4:LIVE_P;
  out.filter(o=>o.leg.p>=lo&&o.leg.p<=0.97&&(o.leg.pb==null||o.leg.pb<=0.9)&&o.ev>0.02).sort((a,b)=>b.ev-a.ev).forEach(o=>{ if(seen[o.leg.group]) return; seen[o.leg.group]=1; picks.push(o); });
  const top=picks.slice(0,6);
  if(top.length<3){ // not enough value spots: fill with the likeliest 60%+ legs, flagged as no price edge
    out.filter(o=>o.leg.p>=lo&&o.leg.p<=0.9&&!top.includes(o)&&!seen[o.leg.group]).sort((a,b)=>b.leg.p-a.leg.p).forEach(o=>{ if(top.length>=3||seen[o.leg.group]) return; seen[o.leg.group]=1; o.lean=true; top.push(o); });
  }
  try{ logLiveCalls(g,st,top); }catch(e){}
  return top;
}

/* ================= live view ================= */
function availHtml(g,st){
  const list=g.players.filter(p=>p.status.kind!=='ok'||st.act[p.id]==='dnp'||st.gone[p.id]);
  if(!list.length) return '';
  return '<div class="badges">'+list.map(p=>{
    const a=st.act[p.id]; let t,c;
    if(st.gone[p.id]){ t='left injured'; c='bad'; } else if(a==='dnp'){ t='inactive'; c='bad'; } else if(a==='in'&&p.status.kind!=='ok'){ t='active'; c='ok'; } else { t=p.status.label.toLowerCase(); c=p.status.kind==='out'?'bad':'warn'; }
    return '<span class="badge '+c+'" title="'+esc(p.status.note||'')+'">'+esc(surname(p.name))+': '+esc(t)+'</span>';
  }).join('')+'</div>';
}
function lowBtn(){ return '<button class="linkbtn" data-act="lv-all" aria-pressed="'+!!S.lvAll+'">'+(S.lvAll?'Show only 60%+ bets':'Show lower-chance bets too')+'</button>'; }
function bestHtml(g){
  const st=stateOf(g); const rows=candidates(g,st);
  const head='<h3>Best live bets <span class="hint">'+(S.lvAll?'all chances':'60%+ chance')+' · pace, penalties, offense, injuries</span></h3>'+lowBtn();
  if(st.final) return head+'<div class="small muted">The game is final.</div>';
  if(!rows.length) return head+'<div class="small muted">Nothing is at 60% or better right now. '+(S.lvAll?'':'Tap above to see lower-chance bets.')+'</div>';
  return head+'<div class="safelist">'+rows.map(o=>{ const on=inSlip(o.tok); return '<button class="it best'+(on?' on':'')+'" data-act="leg" data-tok="'+esc(o.tok)+'" aria-pressed="'+on+'"><span class="bt"><b>'+esc(o.leg.label)+'</b><span class="why">'+esc(o.why)+'</span></span><span class="mono bp">'+fo(o.leg.price)+'<br><span class="muted">'+pct(o.leg.p)+(o.lean?' · no price edge':' · EV '+(o.ev>=0?'+':'')+Math.round(o.ev*100)+'%')+'</span></span></button>'; }).join('')+'</div>'+
    '<div class="small muted">Prices here are a practice baseline (season averages and book totals, 4.5% hold). "EV" is how much the model\'s chance beats that price.</div>';
}
function marketsHtml(g){
  const st=stateOf(g); const open=!!S.lvOpen[g.id]; const a=g.teams.away,h=g.teams.home;
  const M=teamProbs(g,st,true); const liveLine=Math.floor(M.projTotal)+0.5;
  HID.n=0;
  let s='<h3>All live markets <span class="hint">'+(S.lvAll?'every one is selectable':'60%+ only')+'</span></h3><div class="legs">'+
    liveBtn('l:'+g.id+':ml:away',a.abbr+' to win')+liveBtn('l:'+g.id+':ml:home',h.abbr+' to win')+
    liveBtn('l:'+g.id+':spr:away',a.abbr+' '+sg(g.lines.sprAway))+liveBtn('l:'+g.id+':spr:home',h.abbr+' '+sg(g.lines.sprHome))+
    liveBtn('l:'+g.id+':tot:over:'+g.lines.total,'Over '+g.lines.total)+liveBtn('l:'+g.id+':tot:under:'+g.lines.total,'Under '+g.lines.total)+
    (liveLine!==g.lines.total?liveBtn('l:'+g.id+':tot:over:'+liveLine,'Over '+liveLine+' (live line)')+liveBtn('l:'+g.id+':tot:under:'+liveLine,'Under '+liveLine+' (live line)'):'')+
    '</div>'+(HID.n&&!S.lvAll?'<div class="small muted">'+HID.n+' lower-chance market'+(HID.n===1?' is':'s are')+' hidden. <button class="linkbtn" data-act="lv-all">Show them</button></div>':'')+
    '<button class="linkbtn" data-act="lv-open" data-gid="'+g.id+'">'+(open?'Hide player props':'Show player props ('+g.players.length+' players)')+'</button>';
  if(open) s+=g.players.map(pl=>playerLive(g,pl,st)).join('');
  return s;
}
function playerLive(g,pl,st){
  const key=g.id+pl.id; const sk=S.lvStat[key]&&pl.stats.some(s=>s.key===S.lvStat[key])?S.lvStat[key]:pl.stats[0].key; const s=pl.stats.find(x=>x.key===sk);
  const a=st.act[pl.id]; const gone=st.gone[pl.id];
  const badge=gone?'<span class="badge bad">Left injured</span>':a==='dnp'?'<span class="badge bad">Inactive</span>':a==='in'?'<span class="badge ok">Playing</span>':'<span class="badge '+({questionable:'warn',dtd:'warn',doubtful:'bad',out:'bad'}[pl.status.kind]||'')+'">'+esc(pl.status.label)+'</span>';
  const cur=pl.stats.map(x=>x.label+' '+((st.cur[pl.id]||{})[x.key]||0)).join(' · ');
  const tabs=pl.stats.map(x=>'<button data-act="lv-stat" data-key="'+key+'" data-stat="'+x.key+'" aria-pressed="'+(x.key===sk)+'">'+esc(x.label)+'</button>').join('');
  let btns='';
  if(a==='dnp'||(a==='out')) btns='<div class="small muted">Not playing: bets on him are void.</div>';
  else {
    const arr=ladder(g,st,pl,s);
    const over=Math.floor(s.line)+1;
    const toks=[['l:'+g.id+':p:'+pl.id+':'+s.key+':ge:'+over,'Over '+s.line],['l:'+g.id+':p:'+pl.id+':'+s.key+':lt:'+over,'Under '+s.line]].concat(arr.filter(x=>x.T!==over).map(x=>['l:'+g.id+':p:'+pl.id+':'+s.key+':ge:'+x.T,x.T+'+']));
    const bh=toks.map(t=>liveBtn(t[0],t[1])).join(''); btns=bh?'<div class="alt">'+bh+'</div>':'<div class="small muted">No 60%+ lines for this stat right now.</div>';
  }
  return '<div class="pl"><div class="pl-h"><div class="pl-n">'+esc(pl.name)+'<small>'+esc(pl.pos)+' · '+esc(pl.abbr)+'</small></div><div class="badges">'+badge+'</div></div><div class="small muted mono">'+esc(cur)+'</div><div class="tabs2" role="group" aria-label="Stat">'+tabs+'</div>'+btns+'</div>';
}
