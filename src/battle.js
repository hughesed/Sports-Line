/* ================= BATTLE: simulated NFL / NBA / MLB games between two players (practice coins) =================
   Flow: create (wager escrowed) -> someone accepts (matching wager) -> both build + lock a parlay from the battle's markets
   -> the database simulates the whole game and reveals it play by play over ~3 minutes -> the slip that pays more wins the pot.
   Spectators can bet on the game lines and on who wins the battle until the game starts. */
const BT={lobby:null,id:null,det:null,timer:null,tick:null,sim:null,simTried:false,form:{sport:'nfl',home:'',away:'',wager:'50',side:'home'},
  draft:{},saveT:null,spec:{tok:'',stake:'25'},msg:'',busy:false,seen:{},html:{},lastTick:0,skew:0};
const SPORTS3=[['nfl','NFL'],['nba','NBA'],['mlb','MLB']];
function btLiveDot(){ return !!(BT.lobby&&BT.lobby.live&&BT.lobby.live.length); }
function btNow(){ return Date.now()+BT.skew; }
function loadSim(){
  if(BT.sim||BT.simTried) return; BT.simTried=true;
  fetch('data/sim.json?v='+encodeURIComponent((window.__LSDATA&&window.__LSDATA.meta&&window.__LSDATA.meta.generatedAt)||Date.now())).then(r=>r.ok?r.json():null).catch(()=>null).then(j=>{
    if(j&&j.sports&&Object.keys(j.sports).length){ BT.sim=j; btFormDefaults(); btRender(); return; }
    if(!SOC.sb) return;
    SOC.sb.from('sim_teams').select('sport,abbr,name,short,color').order('abbr').then(r=>{ if(r.error||!r.data) return; const sp={}; r.data.forEach(t=>{ (sp[t.sport]=sp[t.sport]||{teams:[]}).teams.push(t); }); BT.sim={sports:sp}; btFormDefaults(); btRender(); });
  });
}
function simTeams(sport){ return ((BT.sim&&BT.sim.sports[sport])||{teams:[]}).teams; }
function teamOf(sport,ab){ return simTeams(sport).find(t=>t.abbr===ab)||{abbr:ab,name:ab,color:'#334155'}; }
function btFormDefaults(){ const f=BT.form, ts=simTeams(f.sport); if(!ts.length) return; if(!ts.some(t=>t.abbr===f.home)) f.home=ts[0].abbr; if(!ts.some(t=>t.abbr===f.away)||f.away===f.home) f.away=(ts.find(t=>t.abbr!==f.home)||ts[0]).abbr; }
function tchip(name,color){ return '<span class="tchip" style="background:'+esc(color||'#334155')+'">'+esc((name||'').slice(0,4))+'</span>'; }

/* ---------- data ---------- */
function loadLobby(){
  if(!SOC.sb) return;
  const now=Date.now(); if(now-BT.lastTick>30000){ BT.lastTick=now; SOC.sb.rpc('battle_tick').then(()=>{},()=>{}); }
  SOC.sb.rpc('battle_lobby').then(r=>{ if(r.error){ BT.msg=r.error.message; btRender(); return; } BT.lobby=r.data; if(r.data&&r.data.now) BT.skew=Date.parse(r.data.now)-Date.now(); btRender(); navRefresh(); });
}
function loadDetail(){
  if(!SOC.sb||!BT.id) return;
  const id=BT.id;
  SOC.sb.rpc('battle_detail',{p_id:id}).then(r=>{
    if(BT.id!==id) return;
    if(r.error){ BT.msg=r.error.message; btRender(); return; }
    BT.det=r.data; if(r.data&&r.data.now) BT.skew=Date.parse(r.data.now)-Date.now();
    const b=r.data&&r.data.battle;
    if(b&&b.status==='live'&&Date.parse(b.ends_at)<=btNow()+500&&!BT.settling){ BT.settling=true; SOC.sb.rpc('settle_battle',{p_id:id}).then(()=>{ BT.settling=false; loadDetail(); refreshMe(); },()=>{ BT.settling=false; }); }
    if(b&&BT.draft[id]==null){ const mine=(r.data.parlays||[]).find(p=>SOC.user&&p.user_id===SOC.user.id); if(mine) BT.draft[id]=(mine.legs||[]).map(l=>l.tok); }
    btRender();
  });
}
function btSchedule(){
  clearTimeout(BT.timer); BT.timer=null;
  if(S.view!=='battle'||!SOC.sb||document.hidden) return;
  const b=BT.det&&BT.det.battle; const live=BT.id&&b&&b.status==='live';
  const ms=BT.id?(live?1500:(b&&(b.status==='final'||b.status==='cancelled')?15000:4000)):6000;
  BT.timer=setTimeout(()=>{ if(BT.id) loadDetail(); else loadLobby(); btSchedule(); },ms);
}
function btAfterRender(){
  if(S.view!=='battle'){ clearTimeout(BT.timer); BT.timer=null; return; }
  if(!SOC.sb) return;
  loadSim();
  if(BT.id){ if(!BT.det||BT.det.battle.id!==BT.id) loadDetail(); } else loadLobby();
  btSchedule();
  if(!BT.tick) BT.tick=setInterval(btTickClocks,1000);
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&S.view==='battle') { if(BT.id) loadDetail(); else loadLobby(); btSchedule(); } });
function btTickClocks(){
  document.querySelectorAll('[data-until]').forEach(el=>{ const ms=Date.parse(el.getAttribute('data-until'))-btNow(); el.textContent=ms<=0?'now':Math.floor(ms/60000)+':'+String(Math.floor(ms%60000/1000)).padStart(2,'0'); });
}

/* ---------- views ---------- */
function battleView(){
  const intro='<div class="small muted">Two players, one simulated game built from the latest team ratings and player averages. Both build a parlay from the battle\'s markets (a 100-coin slip each, so payouts compare fairly). The slip that pays more wins the whole pot; if both lose, more legs hit wins; still tied, the pot is split.</div>';
  if(!SOC.on||SOC.state!=='ready') return '<section class="game"><div class="sec"><h3>Battle</h3>'+socNote()+intro+'</div></section>';
  return '<div id="bt-body" class="btwrap">'+(BT.id?btDetailHtml():btLobbyHtml())+'</div>';
}
function btRender(){
  if(S.view!=='battle') return; const el=document.getElementById('bt-body'); if(!el) return;
  if(BT.id){ btPatchDetail(el); return; }
  if(isTypingNow()&&el.contains(document.activeElement)) return;
  const h=btLobbyHtml(); if(h!==BT.html.lobby){ BT.html.lobby=h; el.innerHTML=h; }
}
function btCreateHtml(){
  const f=BT.form; const ts=simTeams(f.sport);
  const opt=sel=>ts.map(t=>'<option value="'+esc(t.abbr)+'"'+(t.abbr===sel?' selected':'')+'>'+esc(t.name||t.abbr)+'</option>').join('');
  const seg=SPORTS3.map(([k,l])=>'<button data-act="bt-sport" data-k="'+k+'" aria-pressed="'+(f.sport===k)+'">'+l+'</button>').join('');
  const A=teamOf(f.sport,f.away), H=teamOf(f.sport,f.home);
  const wchips=[10,50,100,250].map(v=>'<button class="x2" data-act="bt-wager" data-v="'+v+'">'+v+'</button>').join('');
  return '<section class="game"><div class="sec"><h3>Start a battle <span class="hint">practice coins</span></h3>'+
    '<div class="seg" role="group" aria-label="Sport">'+seg+'</div>'+
    (ts.length?'<div class="btteams"><label class="fld">Away<select class="num wide" data-bt="away" aria-label="Away team">'+opt(f.away)+'</select></label><span class="at">@</span><label class="fld">Home<select class="num wide" data-bt="home" aria-label="Home team">'+opt(f.home)+'</select></label></div>'+
      '<div class="fld">You back<div class="seg" role="group" aria-label="Team you back"><button data-act="bt-side" data-k="away" aria-pressed="'+(f.side==='away')+'">'+esc(A.short||A.abbr)+'</button><button data-act="bt-side" data-k="home" aria-pressed="'+(f.side==='home')+'">'+esc(H.short||H.abbr)+'</button></div></div>'+
      '<div class="stakerow2"><label>Wager <input class="num" data-bt="wager" inputmode="decimal" value="'+esc(f.wager)+'" aria-label="Wager in coins"> coins</label><span class="chips2">'+wchips+'</span></div>'+
      '<div class="btnrow"><button class="btn solid" data-act="bt-create"'+(BT.busy?' disabled':'')+'>'+(SOC.user?'Create battle':'Sign in to battle')+'</button></div>'+
      '<div class="small muted">Your wager is held until the battle ends. If nobody accepts within 30 minutes, or the parlays are not locked within 15 minutes of accepting, everything is refunded.</div>'
    :'<div class="small muted">Loading teams…</div>')+
    (BT.msg?'<div class="slipnote warnt">'+esc(BT.msg)+'</div>':'')+'</div></section>';
}
function btRow(b,kind){
  const me=SOC.user&&SOC.user.id; const mine=me&&(b.creator===me||b.opponent===me);
  const A=teamOf(b.sport,b.away), H=teamOf(b.sport,b.home);
  const who=esc(b.creator_name||'?')+(b.opponent_name?' vs '+esc(b.opponent_name):'');
  let right='';
  if(kind==='open'){
    if(b.status==='open'&&!mine) right='<span class="badge warn">open</span>';
    else if(b.status==='building') right='<span class="badge">building parlays</span>';
    else right='<span class="badge">waiting</span>';
  } else if(kind==='live'){ right='<span class="liveb"><i class="livedot"></i>'+(b.score?esc(b.score.as+'-'+b.score.hs):'LIVE')+'</span>'; }
  else { right=b.status==='cancelled'?'<span class="badge">refunded</span>':'<span class="badge '+(b.result&&b.result.split?'':'ok')+'">'+(b.result?esc(b.result.as+'-'+b.result.hs):'')+(b.result&&b.result.split?' split':'')+'</span>'; }
  const sub=kind==='recent'&&b.status==='final'&&!(b.result&&b.result.split)?'winner '+esc(b.winner===b.creator?b.creator_name:b.opponent_name):kind==='recent'&&b.cancel_reason?esc(b.cancel_reason):(b.nbets?b.nbets+' spectator bet'+(b.nbets>1?'s':''):'');
  return '<button class="btrow'+(mine?' mine':'')+'" data-act="bt-open" data-id="'+b.id+'"><span class="btm">'+tchip(A.abbr,A.color)+tchip(H.abbr,H.color)+'</span><span class="btt"><b>'+esc(SPN[b.sport]||b.sport)+' · '+esc(b.away)+' @ '+esc(b.home)+'</b><span class="small muted">'+who+' · pot '+cn(b.wager*(b.opponent?2:1))+(sub?' · '+sub:'')+'</span></span>'+right+'</button>';
}
function btLobbyHtml(){
  const L=BT.lobby;
  const list=(arr,kind,empty)=>arr&&arr.length?arr.map(b=>btRow(b,kind)).join(''):'<div class="small muted">'+empty+'</div>';
  return btCreateHtml()+
    '<section class="game"><div class="sec"><h3>Open battles <span class="hint">accept one or bet on it</span></h3>'+(L?list(L.open,'open','No open battles. Start one above.'):'<div class="small muted">Loading…</div>')+'</div></section>'+
    '<section class="game"><div class="sec"><h3>Live now</h3>'+(L?list(L.live,'live','No battle is being played right now.'):'')+'</div></section>'+
    '<section class="game"><div class="sec"><h3>Recent results</h3>'+(L?list(L.recent,'recent','No finished battles yet.'):'')+'</div></section>'+
    '<section class="game"><div class="sec"><h3>How battles work</h3><div class="small muted">1. Pick a sport and two teams, choose the team you back and a wager. 2. Another player accepts with the same wager. 3. Both build a parlay (1 to 6 legs) from the battle\'s lines and player props and lock it. 4. The game is simulated from the latest ratings and player averages and plays out over about 3 minutes. Each parlay is a 100-coin slip: the one that pays more takes the pot. Battle wins and losses count toward your record and rating (Elo) per sport; the top rating with 3+ battles earns the daily KING badge. Spectator bets pay at their odds and count for the daily leaderboard, not for anyone\'s battle record.</div>'+PRACTICE_NOTE+'</div></section>';
}
const bgrp=tok=>{ const p=tok.split(':'); return p[0]==='p'?'p:'+p[1]+':'+p[2]:p[0]; };
function mktBtn(tok,top,price,on,dis){ return '<button class="odd'+(on?' on':'')+'" data-act="bt-leg" data-tok="'+esc(tok)+'" aria-pressed="'+!!on+'"'+(dis?' disabled':'')+'><span class="o1">'+esc(top)+'</span><span class="o2 mono">'+fo(price)+'</span></button>'; }
function btMarketsHtml(b,sel,act,o){ o=o||{lines:true,props:true};
  const m=b.markets, A=teamOf(b.sport,b.away), H=teamOf(b.sport,b.home); const on=t=>sel.indexOf(t)>=0;
  const btn=(t,top,pr)=>mktBtn(t,top,pr,on(t),!act).replace('data-act="bt-leg"','data-act="'+(act||'bt-leg')+'"');
  let h=!o.lines?'':'<div class="ogrid"><div class="ohead"><span></span><span>'+(b.sport==='mlb'?'Run line':'Spread')+'</span><span>Total</span><span>Money</span></div>'+
    '<div class="orow"><div class="team">'+tchip(A.abbr,A.color)+'<div class="tn"><div class="n">'+esc(A.short||A.abbr)+'</div><div class="r">away · ~'+Math.round(m.ea)+'</div></div></div>'+btn('spr:away',sg(m.spr.awayLine),m.spr.away)+btn('tot:over','O '+m.tot.line,m.tot.over)+btn('ml:away','ML',m.ml.away)+'</div>'+
    '<div class="orow"><div class="team">'+tchip(H.abbr,H.color)+'<div class="tn"><div class="n">'+esc(H.short||H.abbr)+'</div><div class="r">home · ~'+Math.round(m.eh)+'</div></div></div>'+btn('spr:home',sg(m.spr.homeLine),m.spr.home)+btn('tot:under','U '+m.tot.line,m.tot.under)+btn('ml:home','ML',m.ml.home)+'</div></div>';
  if(o.win&&m.winner) h+='<div class="legs win2">'+btn('win:creator',(m.winner.creatorName||'Creator')+' wins the battle',m.winner.creator)+btn('win:opponent',(m.winner.opponentName||'Opponent')+' wins the battle',m.winner.opponent)+'</div>';
  if(o.props&&(m.props||[]).length){
    h+='<div class="props3">'+m.props.map(p=>'<div class="prow"><div class="pn"><b>'+esc(surname(p.name))+'</b> <span class="muted small">'+esc(p.abbr)+' · '+esc(p.label)+' · avg '+n1(p.mean)+'</span></div><div class="pb">'+
      btn('p:'+p.pid+':'+p.stat+':over','Over '+p.line,p.over)+btn('p:'+p.pid+':'+p.stat+':under','Under '+p.line,p.under)+'</div></div>').join('')+'</div>';
  }
  return h;
}
function legLabel(b,tok){
  const m=b.markets, p=tok.split(':');
  if(p[0]==='ml') return b[p[1]]+' to win'; if(p[0]==='spr') return b[p[1]]+' '+sg(m.spr[p[1]+'Line']); if(p[0]==='tot') return (p[1]==='over'?'Over ':'Under ')+m.tot.line;
  if(p[0]==='win') return ((m.winner||{})[p[1]+'Name']||p[1])+' wins the battle';
  const pr=(m.props||[]).find(x=>x.pid===p[1]&&x.stat===p[2]); return pr?surname(pr.name)+' '+(p[3]==='over'?'Over ':'Under ')+pr.line+' '+pr.label.toLowerCase():tok;
}
function legPrice(b,tok){ const m=b.markets, p=tok.split(':'); if(p[0]==='ml') return m.ml[p[1]]; if(p[0]==='spr') return m.spr[p[1]]; if(p[0]==='tot') return m.tot[p[1]]; if(p[0]==='win') return (m.winner||{})[p[1]]; const pr=(m.props||[]).find(x=>x.pid===p[1]&&x.stat===p[2]); return pr?pr[p[3]]:null; }
/* live status of one leg from the latest visible play (score + running player lines) */
function legNow(b,tok,ev,fin){
  if(!ev) return {s:'',t:''}; const p=tok.split(':'); const m=b.markets; const hs=ev.hs, as=ev.as_;
  const res=x=>({s:x,t:x==='W'?'hit':x==='L'?'miss':x==='V'?'push':''});
  if(p[0]==='ml'){ if(!fin) return {s:'',t:(p[1]==='home'?hs-as:as-hs)>0?'leading':(hs===as?'tied':'trailing')}; return res(hs===as?'V':((p[1]==='home')===(hs>as)?'W':'L')); }
  if(p[0]==='spr'){ const v=(p[1]==='home'?hs-as:as-hs)+m.spr[p[1]+'Line']; if(!fin) return {s:'',t:v>0?'covering':'not covering'}; return res(v===0?'V':v>0?'W':'L'); }
  if(p[0]==='tot'){ const t=hs+as; if(p[1]==='over'&&t>m.tot.line) return res('W'); if(p[1]==='under'&&t>m.tot.line) return res('L'); if(!fin) return {s:'',t:t+' so far'}; return res(p[1]==='under'?'W':'L'); }
  if(p[0]==='p'){ const pr=(m.props||[]).find(x=>x.pid===p[1]&&x.stat===p[2]); const cur=((ev.stats||{})[p[1]]||{})[p[2]]||0; if(!pr) return {s:'',t:''};
    if(p[3]==='over'&&cur>pr.line) return res('W'); if(p[3]==='under'&&cur>pr.line) return res('L'); if(!fin) return {s:'',t:cur+' so far'}; return res(p[3]==='under'?'W':'L'); }
  return {s:'',t:''};
}
function parlayCard(b,p,ev,fin){
  const legs=(p.graded||p.legs||[]); const dec=legs.reduce((d,l)=>d*decOf(l.price),1);
  const head='<div class="bh"><b>'+uLink(p.username||'?')+'</b>'+(p.payout!=null?'<span class="badge '+(+p.payout>0?'ok':'bad')+'">pays '+cn(p.payout)+' · '+(p.hits||0)+' hit</span>':'<span class="muted small">100 pays '+cn(100*dec)+' ('+fo(amerOfDec(dec))+')</span>')+'</div>';
  return '<div class="bet pcard">'+head+legs.map(l=>{ const st=l.res?{s:l.res,t:''}:legNow(b,l.tok,ev,fin); return '<div class="bl">'+legStatusIcon({res:st.s||null})+'<span>'+esc(l.label)+' <span class="mono muted">'+fo(l.price)+'</span>'+(st.t?' <span class="small muted">· '+esc(st.t)+'</span>':'')+'</span></div>'; }).join('')+'</div>';
}
function btSections(){
  const d=BT.det; if(!d||!d.battle) return null;
  const b=d.battle, me=SOC.user&&SOC.user.id, isC=me&&b.creator===me, isO=me&&b.opponent===me, part=isC||isO;
  const A=teamOf(b.sport,b.away), H=teamOf(b.sport,b.home); const evs=d.events||[]; const last=evs[evs.length-1]; const fin=b.status==='final';
  const sideName=s=>s==='home'?b.home:b.away;
  const sec={};
  const timer=b.status==='open'?'<span class="small muted">expires in <b data-until="'+new Date(Date.parse(b.created_at)+30*60000).toISOString()+'"></b></span>':b.status==='building'?'<span class="small muted">lock within <b data-until="'+new Date(Date.parse(b.accepted_at)+15*60000).toISOString()+'"></b></span>':b.status==='live'?'<span class="liveb"><i class="livedot"></i>LIVE</span>':'';
  sec.head='<div class="sec"><div class="btnrow"><button class="btn" data-act="bt-back">‹ All battles</button></div><h3>'+esc(SPN[b.sport])+' battle #'+b.id+' '+timer+'</h3>'+
    '<div class="vsrow"><div class="vsp">'+uLink(b.creator_name||'?')+'<span class="small muted">backs '+esc(sideName(b.creator_side))+'</span></div><div class="pot">'+COIN+' <b>'+cn(b.wager*(b.opponent?2:1))+'</b><span class="small muted">pot</span></div><div class="vsp">'+(b.opponent?uLink(b.opponent_name||'?')+'<span class="small muted">backs '+esc(sideName(b.opponent_side))+'</span>':'<span class="muted">waiting for an opponent</span>')+'</div></div>'+
    (b.status==='cancelled'?'<div class="flash">Cancelled: '+esc(b.cancel_reason||'')+'. Wagers and spectator bets were refunded.</div>':'')+
    (BT.msg?'<div class="slipnote warnt">'+esc(BT.msg)+'</div>':'')+'</div>';
  if(b.status==='live'||fin){
    const hs=last?last.hs:0, as=last?last.as_:0, wp=last&&last.wp!=null?Math.round(last.wp*100):50;
    sec.board='<div class="sec"><div class="viz"><div class="score"><div class="sc"><div class="cr-lab">'+esc(b.away)+'</div><div class="big mono">'+as+'</div></div><div class="clk"><div class="mono">'+esc(last?last.clock||'':'')+'</div><div class="cr-lab">'+(fin?'':'simulated')+'</div></div><div class="sc"><div class="cr-lab">'+esc(b.home)+'</div><div class="big mono">'+hs+'</div></div></div>'+
      '<div class="wp" role="img" aria-label="'+esc(b.home+' win chance '+wp+' percent')+'"><div class="wpa" style="width:'+(100-wp)+'%;background:'+esc(A.color)+'">'+(100-wp>=14?esc(b.away)+' '+(100-wp)+'%':'')+'</div><div class="wph" style="width:'+wp+'%;background:'+esc(H.color)+'">'+(wp>=14?esc(b.home)+' '+wp+'%':'')+'</div></div>'+
      '<div class="playchip" id="chip-b'+b.id+'"><b>'+esc(last?(last.kind==='score'?'SCORE':last.kind==='final'?'FINAL':last.kind==='period'?'BREAK':'PLAY'):'')+'</b><span>'+esc(last?last.text:'Waiting for the first play…')+'</span></div><div class="cel" id="cel-b'+b.id+'"></div></div>'+
      (fin?btWinnerHtml(b,d):'<div class="small muted">Plays appear as their time comes; the server keeps future plays hidden.</div>')+'</div>';
    sec.feed='<div class="sec"><h3>Play by play <span class="hint">'+evs.length+' plays</span></h3><div class="feed">'+evs.slice().reverse().map(e=>'<div class="fe '+esc(e.kind)+'"><span class="mono fc">'+esc(e.clock||'')+'</span><span>'+esc(e.text)+'</span><span class="mono fs">'+e.as_+'-'+e.hs+'</span></div>').join('')+'</div></div>';
    sec.parl='<div class="sec"><h3>Parlays <span class="hint">100-coin slips</span></h3>'+(d.parlays||[]).sort((x,y)=>x.user_id===b.creator?-1:1).map(p=>parlayCard(b,p,last,fin)).join('')+'</div>';
  } else if(b.status==='open'||b.status==='building'){
    let act='';
    if(b.status==='open'){
      if(!me) act='<div class="btnrow"><button class="btn solid" data-act="signin">Sign in to accept</button></div>';
      else if(isC) act='<div class="small">Waiting for someone to accept. Share the Battle tab with a friend.</div><div class="btnrow"><button class="btn" data-act="bt-cancel">Cancel and refund</button></div>';
      else act='<div class="small">Accept with the same wager ('+cn(b.wager)+' coins). Pick the team you back:</div><div class="btnrow"><button class="btn solid" data-act="bt-accept" data-k="'+(b.creator_side==='home'?'away':'home')+'">Accept · back '+esc(sideName(b.creator_side==='home'?'away':'home'))+'</button><button class="btn" data-act="bt-accept" data-k="'+b.creator_side+'">Back '+esc(sideName(b.creator_side))+' too</button></div>';
    } else if(part){
      const mine=(d.parlays||[]).find(p=>p.user_id===me); const other=b.creator===me?b.opponent_name:b.creator_name;
      const locked=mine&&mine.locked; const sel=BT.draft[b.id]||[];
      act='<div class="small">'+(locked?'Your parlay is locked. Waiting for '+esc(other)+'…':'Build your parlay: tap 1 to 6 legs (one per market), then lock it. '+esc(other)+' cannot see it until the game starts.')+'</div>'+
        '<div class="btnrow"><button class="btn solid" data-act="bt-lock"'+(locked||!sel.length?' disabled':'')+'>'+(locked?'Locked':'Lock my parlay ('+sel.length+')')+'</button><button class="btn" data-act="bt-cancel">Cancel battle</button></div>'+
        (sel.length?'<div class="small mono">'+sel.map(t=>esc(legLabel(b,t))+' '+fo(legPrice(b,t))).join(' · ')+'</div><div class="small muted">100 coins would pay '+cn(100*sel.reduce((x,t)=>x*decOf(legPrice(b,t)),1))+'</div>':'');
      sec.mk='<div class="sec"><h3>Battle markets <span class="hint">'+(locked?'locked':'tap to add')+'</span></h3>'+btMarketsHtml(b,sel,locked?null:'bt-leg')+'</div>';
    } else act='<div class="small muted">'+esc(b.creator_name)+' and '+esc(b.opponent_name)+' are building their parlays. The game starts when both lock.</div>';
    sec.act='<div class="sec">'+act+'</div>';
    if(!sec.mk) sec.mk='<div class="sec"><h3>Battle markets <span class="hint">fair-ish lines from the ratings</span></h3>'+btMarketsHtml(b,[],null)+'</div>';
    if(me&&!part){
      const tok=BT.spec.tok; const pr=tok?legPrice(b,tok):null;
      sec.spec='<div class="sec"><h3>Spectator bet <span class="hint">before the game starts</span></h3>'+btMarketsHtml(b,tok?[tok]:[],'bt-spec',{lines:true})+
        (b.markets.winner?btMarketsHtml(b,tok?[tok]:[],'bt-spec',{win:true}):'<div class="small muted">"Who wins the battle" opens once someone accepts.</div>')+
        '<div class="stakerow2"><label>Stake <input class="num" data-bt="spstake" inputmode="decimal" value="'+esc(BT.spec.stake)+'" aria-label="Spectator stake in coins"> coins</label><button class="btn solid" data-act="bt-specbet"'+(tok?'':' disabled')+'>'+(tok?'Bet '+esc(legLabel(b,tok))+' '+fo(pr):'Pick a market')+'</button></div>'+
        '<div class="small muted">Spectator bets pay at their odds and count toward the daily leaderboard, not toward the players\' battle records.</div></div>';
    }
  }
  const bets=d.bets||[];
  if(bets.length) sec.bets='<div class="sec"><h3>Spectator bets <span class="hint">'+bets.length+'</span></h3>'+bets.map(s=>'<div class="bl">'+legStatusIcon({res:s.status==='won'?'W':s.status==='lost'?'L':s.status==='void'?'V':null})+'<span>'+uLink(s.username)+' '+esc(s.label)+' <span class="mono muted">'+fo(s.price)+'</span> · '+cn(s.stake)+(s.status==='won'?' → '+cn(s.payout):'')+'</span></div>').join('')+'</div>';
  return sec;
}
function btWinnerHtml(b,d){
  const r=b.result||{}; if(!r.creator) return '<div class="small muted">Settling…</div>';
  const wn=r.split?null:(b.winner===b.creator?b.creator_name:b.opponent_name);
  return '<div class="winbar">'+(r.split?'🤝 Tied: the pot is split and both wagers go back.':'🏆 '+esc(wn)+' wins '+cn(b.wager*2)+' coins')+'<div class="small">'+esc(b.creator_name)+': slip pays '+cn(r.creator.payout)+' ('+r.creator.hits+' hit) · '+esc(b.opponent_name)+': '+cn(r.opponent.payout)+' ('+r.opponent.hits+' hit)</div></div>';
}
const BT_ORDER=['head','board','act','mk','spec','parl','feed','bets'];
function btDetailHtml(){
  const sec=btSections(); if(!sec) return '<section class="game"><div class="sec"><div class="btnrow"><button class="btn" data-act="bt-back">‹ All battles</button></div><div class="small muted">Loading the battle…</div></div></section>';
  BT.html={}; return '<section class="game">'+BT_ORDER.map(k=>sec[k]?'<div id="bts-'+k+'">'+(BT.html[k]=sec[k])+'</div>':'<div id="bts-'+k+'"></div>').join('')+'</section>';
}
function btPatchDetail(el){
  const sec=btSections(); if(!sec){ el.innerHTML=btDetailHtml(); return; }
  if(!el.querySelector('#bts-head')){ el.innerHTML=btDetailHtml(); btAnimate(); return; }
  BT_ORDER.forEach(k=>{ const h=sec[k]||''; if(BT.html[k]===h) return; const box=el.querySelector('#bts-'+k); if(!box) return;
    if(box.contains(document.activeElement)&&isTypingNow()) return;
    if(k==='board'&&box.querySelector('.score')&&sec.board){ // update in place so the celebration overlay keeps running
      const tmp=document.createElement('div'); tmp.innerHTML=h; const n=tmp.querySelector('.viz'), o=box.querySelector('.viz');
      if(n&&o){ ['.score','.wp'].forEach(s=>{ const a=o.querySelector(s), c=n.querySelector(s); if(a&&c) a.replaceWith(c); }); const oc=o.querySelector('.playchip'), nc=n.querySelector('.playchip'); if(oc&&nc&&oc.innerHTML!==nc.innerHTML){ oc.innerHTML=nc.innerHTML; oc.className=nc.className; restart(oc,'pop'); }
        const rest=[...tmp.firstChild.children].slice(1).map(x=>x.outerHTML).join(''); [...box.firstChild.children].slice(1).forEach(x=>x.remove()); box.firstChild.insertAdjacentHTML('beforeend',rest); BT.html[k]=h; return; }
    }
    box.innerHTML=h; BT.html[k]=h; });
  btAnimate(); btTickClocks();
}
function btAnimate(){
  const d=BT.det; if(!d||!d.battle) return; const b=d.battle; const evs=d.events||[]; const last=evs[evs.length-1]; if(!last) return;
  const seen=BT.seen[b.id]; BT.seen[b.id]=last.seq;
  if(seen==null||seen>=last.seq) return;
  const news=evs.filter(e=>e.seq>seen);
  const sc=news.filter(e=>e.kind==='score').pop();
  if(sc&&!document.hidden){ const side=sc.hs>(evs.find(e=>e.seq===sc.seq-1)||{hs:0}).hs?'h':'a';
    const lab=b.sport==='nfl'?(/touchdown/i.test(sc.text)?'TOUCHDOWN!':/field goal/i.test(sc.text)?'FIELD GOAL':'SCORE!'):b.sport==='mlb'?(/homer|grand slam/i.test(sc.text)?'HOME RUN!':'RUN SCORES'):(/three/i.test(sc.text)?'THREE!':'BUCKET');
    if(b.sport!=='nba'||/three|throws it down/i.test(sc.text)) celebrateB(b, lab, side); }
  if(news.some(e=>e.kind==='final')&&!document.hidden) celebrateB(b,'FINAL','h');
}
function celebrateB(b,label,side){
  const el=document.getElementById('cel-b'+b.id); if(!el) return; const tc=teamOf(b.sport,side==='a'?b.away:b.home).color||'#4d98ff';
  const cols=['#ffb62e',tc,'#2fcb7e','#fff','#f06d66']; let c=''; for(let i=0;i<30;i++){ const a=Math.random()*360, dd=40+Math.random()*110, dl=Math.random()*.3; c+='<i style="--a:'+a.toFixed(0)+'deg;--d:'+dd.toFixed(0)+'px;--dl:'+dl.toFixed(2)+'s;--c:'+cols[i%5]+'"></i>'; }
  el.innerHTML='<div class="celt">'+esc(label)+'</div>'+c; restart(el,'go'); clearTimeout(el._t); el._t=setTimeout(()=>{ el.classList.remove('go'); el.innerHTML=''; },2800);
}

/* ---------- actions ---------- */
async function btCall(fn,args,ok){
  if(!SOC.user){ openModal('in'); return; } if(BT.busy) return; BT.busy=true; BT.msg='';
  const r=await SOC.sb.rpc(fn,args); BT.busy=false;
  if(r.error){ BT.msg=r.error.message; btRender(); return; }
  if(r.data&&r.data.balance!=null&&SOC.me){ SOC.me.balance=+r.data.balance; renderBank(); }
  if(ok) ok(r.data); else { refreshMe(); if(BT.id) loadDetail(); else loadLobby(); }
}
function btOpen(id){ BT.id=id; BT.det=null; BT.msg=''; BT.html={}; BT.spec={tok:'',stake:BT.spec.stake}; S.view='battle'; render(); window.scrollTo(0,0); }
function saveParlay(id){ clearTimeout(BT.saveT); BT.saveT=setTimeout(()=>{ SOC.sb.rpc('set_battle_parlay',{p_id:id,p_legs:BT.draft[id]||[]}).then(r=>{ if(r.error){ BT.msg=r.error.message; } else BT.msg=''; loadDetail(); }); },350); }
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act]'); if(!t) return; const act=t.getAttribute('data-act'); if(act.indexOf('bt-')!==0) return;
  e.stopPropagation(); e.preventDefault();
  const f=BT.form;
  if(act==='bt-sport'){ f.sport=t.getAttribute('data-k'); btFormDefaults(); btRender(); return; }
  if(act==='bt-side'){ f.side=t.getAttribute('data-k'); btRender(); return; }
  if(act==='bt-wager'){ f.wager=t.getAttribute('data-v'); btRender(); return; }
  if(act==='bt-create'){ if(!SOC.user){ openModal('in'); return; } if(f.home===f.away){ BT.msg='Pick two different teams.'; btRender(); return; }
    btCall('create_battle',{p_sport:f.sport,p_home:f.home,p_away:f.away,p_wager:parseFloat(String(f.wager).replace(/[^0-9.]/g,''))||0,p_side:f.side},d=>{ refreshMe(); btOpen(d.id); }); return; }
  if(act==='bt-open'){ btOpen(+t.getAttribute('data-id')); return; }
  if(act==='bt-back'){ BT.id=null; BT.det=null; BT.msg=''; BT.html={}; render(); return; }
  const b=BT.det&&BT.det.battle; if(!b) return;
  if(act==='bt-accept'){ btCall('accept_battle',{p_id:b.id,p_side:t.getAttribute('data-k')}); return; }
  if(act==='bt-cancel'){ if(!confirm('Cancel this battle? Wagers and spectator bets are refunded.')) return; btCall('cancel_battle',{p_id:b.id}); return; }
  if(act==='bt-lock'){ clearTimeout(BT.saveT); SOC.sb.rpc('set_battle_parlay',{p_id:b.id,p_legs:BT.draft[b.id]||[]}).then(r=>{ if(r.error){ BT.msg=r.error.message; btRender(); return; } btCall('lock_battle_parlay',{p_id:b.id}); }); return; }
  if(act==='bt-leg'){ const tok=t.getAttribute('data-tok'); let sel=(BT.draft[b.id]||[]).slice(); const i=sel.indexOf(tok);
    if(i>=0) sel.splice(i,1); else { sel=sel.filter(x=>bgrp(x)!==bgrp(tok)); if(sel.length>=6){ BT.msg='A battle parlay has at most 6 legs.'; btRender(); return; } sel.push(tok); }
    BT.draft[b.id]=sel; BT.msg=''; btRender(); saveParlay(b.id); return; }
  if(act==='bt-spec'){ const tok=t.getAttribute('data-tok'); BT.spec.tok=BT.spec.tok===tok?'':tok; btRender(); return; }
  if(act==='bt-specbet'){ const st=parseFloat(String(BT.spec.stake).replace(/[^0-9.]/g,''))||0; btCall('place_spectator_bet',{p_id:b.id,p_tok:BT.spec.tok,p_stake:st},d=>{ BT.spec.tok=''; S.flash='Spectator bet placed: '+d.label+' '+fo(d.price)+'.'; renderBank(); refreshMe(); loadDetail(); }); return; }
},true);
document.addEventListener('change',function(e){ const t=e.target; const k=t.getAttribute&&t.getAttribute('data-bt'); if(!k) return; if(k==='home'||k==='away'){ BT.form[k]=t.value; btRender(); } });
document.addEventListener('input',function(e){ const t=e.target; const k=t.getAttribute&&t.getAttribute('data-bt'); if(!k) return; if(k==='wager') BT.form.wager=t.value; if(k==='spstake') BT.spec.stake=t.value; });
