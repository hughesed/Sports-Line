/* ================= BATTLE: simulated NFL / NBA / MLB / college football / college basketball games between two players (practice coins) =================
   Flow: create (wager escrowed; format Parlay or Same Game Parlay) -> someone accepts (matching wager) -> both build + lock a parlay from the battle's markets
   -> the database simulates the whole game and reveals it play by play over ~3 minutes -> the slip that pays more wins the pot.
   Spectators can bet on the game lines and on who wins the battle until the game starts. Rosters and injuries are frozen into the battle when it is created. */
const BT={lobby:null,id:null,det:null,timer:null,tick:null,sim:null,simTried:false,form:{sport:'nfl',home:'',pick:'',wager:'50',fmt:'parlay',q:'',vs:'players'},
  draft:{},saveT:null,spec:{tok:'',stake:'25'},msg:'',busy:false,seen:{},html:{},lastTick:0,skew:0,quote:{},acc:{},all:{},sawLive:{},flashed:{}};
const SPORTS3=[['nfl','NFL'],['nba','NBA'],['mlb','MLB'],['cfb','CFB'],['cbb','CBB']];
const SPLONG={nfl:'NFL',nba:'NBA',mlb:'MLB',cfb:'College football',cbb:"Men's college basketball"};
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
function btFormDefaults(){ const f=BT.form, ts=simTeams(f.sport); if(!ts.length) return; const pr=ts.filter(t=>t.props!==false); const pool=pr.length>=1?pr:ts;
  if(!ts.some(t=>t.abbr===f.home)) f.home=pool[0].abbr; }
function tchip(name,color){ return '<span class="tchip" style="background:'+esc(color||'#334155')+'">'+esc((name||'').slice(0,4))+'</span>'; }

/* ---------- the computer opponent ---------- */
const CPU_NAME='SportsLineCPU';
function loadCpu(){
  if(!SOC.sb||BT.cpuBusy) return; BT.cpuBusy=true;
  SOC.sb.rpc('cpu_status').then(r=>{ BT.cpuBusy=false; BT.cpuTried=true; if(!r.error&&r.data){ BT.cpu=r.data; BT.cpuMissing=false; } else BT.cpuMissing=true; btRender(); },()=>{ BT.cpuBusy=false; BT.cpuTried=true; BT.cpuMissing=true; });
}
function cpuNote(){
  const c=BT.cpu; let learn='';
  if(c){ const you=c.you; learn=' It learns from every battle: '+cn(c.legs_learned||0)+' legs studied so far'+(c.battles?', '+cn(c.battles)+' battle'+(c.battles===1?'':'s')+' played':'')+'.'+(you&&(you.w+you.l+you.t)?' Your record against it: '+you.w+'-'+you.l+(you.t?'-'+you.t:'')+'.':''); }
  else if(BT.cpuMissing) learn=' (The computer needs the v6 database patch: run supabase/patch_battle_v6.sql once.)';
  return '<div class="small muted">You choose the computer\'s team, or leave it on Random (an even matchup). It builds a balanced parlay from its best bets: at least 4 legs, and with Unlimited legs at most 14. It locks right away, and your parlay stays hidden from it.'+learn+' Practice mode: coins and your win/loss record count, not Elo, the Board or streaks. Maximum wager 1,000.</div>';
}

/* ---------- data ---------- */
function loadLobby(){
  if(!SOC.sb) return;
  const now=Date.now(); if(now-BT.lastTick>30000){ BT.lastTick=now; SOC.sb.rpc('battle_tick').then(()=>{},()=>{}); }
  SOC.sb.rpc('battle_lobby').then(r=>{ if(r.error){ BT.msg=r.error.message; btRender(); return; } BT.lobby=r.data; if(r.data&&r.data.now) BT.skew=Date.parse(r.data.now)-Date.now(); btRender(); navRefresh(); btCheckAlerts(r.data); });
}
function loadDetail(){
  if(!SOC.sb||!BT.id) return;
  const id=BT.id;
  SOC.sb.rpc('battle_detail',{p_id:id}).then(r=>{
    if(BT.id!==id) return;
    if(r.error){ BT.msg=r.error.message; btRender(); return; }
    BT.det=r.data; btCum(r.data&&r.data.events); if(r.data&&r.data.now) BT.skew=Date.parse(r.data.now)-Date.now();
    const b=r.data&&r.data.battle;
    if(b&&b.status==='open'&&SOC.user&&b.creator===SOC.user.id) BT.alerts.until=Date.now()+30*60000;      // keep watching for a challenger from other screens
    if(b&&b.status==='live'&&Date.parse(b.ends_at)<=btNow()+500&&!BT.settling){ BT.settling=true; SOC.sb.rpc('settle_battle',{p_id:id}).then(()=>{ BT.settling=false; loadDetail(); refreshMe(); },()=>{ BT.settling=false; }); }
    if(b&&BT.draft[id]==null){ const mine=(r.data.parlays||[]).find(p=>SOC.user&&p.user_id===SOC.user.id); if(mine){ BT.draft[id]=(mine.legs||[]).map(l=>l.tok);
      if(b.status==='building'&&!mine.locked&&!BT.draft[id].length&&b.max_legs!==undefined){ const my=(SOC.user.id===b.creator)?b.creator_side:(b.creator_side==='home'?'away':'home'); BT.draft[id]=['ml:'+my]; setTimeout(()=>saveParlay(id),50); } } }
    btRender();
  });
}
/* each play row carries only the player totals that changed on that play; add them up so every row holds the running totals */
function btCum(evs){ let acc={}; (evs||[]).forEach(e=>{ const s=e.stats; if(s&&typeof s==='object'){ const n=Object.assign({},acc); for(const pid in s) n[pid]=Object.assign({},acc[pid]||{},s[pid]); acc=n; } e.stats=acc; }); }
/* ---------- box score ---------- */
const BX_COLS={nfl:{QB:[['passYds','Pass'],['passTD','PaTD'],['rushYds','Rush']],RB:[['rushYds','Rush'],['rec','Rec'],['recYds','RecYd'],['tdany','TD']],WR:[['rec','Rec'],['recYds','RecYd'],['tdany','TD']]},
  nba:{P:[['pts','PTS'],['reb','REB'],['ast','AST'],['fg3','3PM'],['pra','PRA']]},
  mlb:{H:[['hits','H'],['runs','R'],['rbi','RBI'],['hr','HR'],['tb','TB'],['hrr','H+R+RBI']],SP:[['outs','IP'],['k','K']]}};
BX_COLS.cfb=BX_COLS.nfl; BX_COLS.cbb=BX_COLS.nba;
const BX_GROUPS={nfl:[['QB','RB','WR']],nba:[['P']],mlb:[['H'],['SP']]}; BX_GROUPS.cfb=BX_GROUPS.nfl; BX_GROUPS.cbb=BX_GROUPS.nba;
function btBox(b,d,last){
  const ro=b.markets&&b.markets.roster; if(!ro||!last) return '';
  const st=last.stats||{}, cols=BX_COLS[b.sport]||{}, groups=BX_GROUPS[b.sport]||[];
  const star=new Set(); (d.parlays||[]).forEach(p=>(p.graded||p.legs||[]).forEach(l=>{ if(l.pid) star.add(l.pid); }));
  const fmtv=(k,v)=>k==='outs'?Math.floor(v/3)+'.'+(v%3):String(v);
  const people=Object.keys(ro).map(pid=>({pid:pid,n:ro[pid][0]||pid,side:ro[pid][1],role:ro[pid][2],rk:+ro[pid][3]||0}));
  let out='';
  ['away','home'].forEach(side=>{
    const T=teamOf(b.sport,side==='home'?b.home:b.away);
    out+='<div class="bxh">'+tchip(T.abbr,T.color)+' <b>'+esc(T.name||T.abbr)+'</b> <span class="muted small">'+(side==='home'?last.hs:last.as_)+'</span></div>';
    groups.forEach(g=>{
      const rows=people.filter(x=>x.side===side&&g.indexOf(x.role)>=0).sort((x,y)=>g.indexOf(x.role)-g.indexOf(y.role)||x.rk-y.rk); if(!rows.length) return;
      const ks=[]; g.forEach(r=>(cols[r]||[]).forEach(c=>{ if(!ks.some(q=>q[0]===c[0])) ks.push(c); }));
      out+='<div class="xscroll"><table class="bxt"><thead><tr><th>Player</th>'+ks.map(c=>'<th>'+esc(c[1])+'</th>').join('')+'</tr></thead><tbody>'+
        rows.map(x=>{ const have=(cols[x.role]||[]).map(c=>c[0]); const s=st[x.pid]||{};
          return '<tr'+(star.has(x.pid)?' class="mine"':'')+'><td class="bxn">'+esc(surname(x.n))+(star.has(x.pid)?' <span title="In a slip">★</span>':'')+'</td>'+ks.map(c=>'<td class="mono">'+(have.indexOf(c[0])<0?'<span class="muted">–</span>':fmtv(c[0],s[c[0]]||0))+'</td>').join('')+'</tr>'; }).join('')+'</tbody></table></div>';
    });
  });
  return '<div class="sec"><h3>Box score <span class="hint">★ = in a slip</span></h3>'+out+'</div>';
}
function btSchedule(){
  clearTimeout(BT.timer); BT.timer=null;
  if(S.view!=='battle'||!SOC.sb||document.hidden) return;
  const b=BT.det&&BT.det.battle; const live=BT.id&&b&&b.status==='live';
  const ms=BT.id?(live?1000:(b&&(b.status==='final'||b.status==='cancelled')?15000:4000)):6000;
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
function injLine(T,ab){
  const i=(T&&T.inj)||{}; const out=(i.out||[]), q=(i.q||[]); if(!out.length&&!q.length) return '';
  const nm=x=>esc(surname(x.name))+(x.pos?' <span class="muted">'+esc(x.pos)+'</span>':'');
  const part=(arr,lab)=>arr.length?'<b>'+lab+'</b> '+arr.slice(0,4).map(nm).join(', ')+(arr.length>4?' +'+(arr.length-4):''):'';
  return '<div class="small injl"><b>'+esc(ab)+'</b> '+[part(out,'Out:'),part(q,'Questionable:')].filter(Boolean).join(' · ')+'</div>';
}
function btFmtNote(fmt,legs){
  if(fmt==='sgp') return legs===0
    ? 'Same Game Parlay, unlimited legs: every option is open, including several picks from one market (a 200+ and a 250+ yard rung, both spreads\' alternates, spread + moneyline + total). The price is recalculated for the whole slip, so stacking more legs pays what the odds say. Picks that cannot both happen are refused.'
    : 'Same Game Parlay: at least 2 legs (up to the legs allowed), one pick per market, and the price accounts for how the legs move together. A QB\'s passing yards and his team winning pay less than the two prices multiplied. Choose Unlimited legs to open every option.';
  return 'Parlay: 1 to '+(legs?legs:'any number of')+' legs, prices multiply.';
}
function btCreateHtml(){
  const f=BT.form; const ts=simTeams(f.sport); const big=ts.length>40; const q=(f.q||'').trim().toLowerCase();
  const seg=SPORTS3.map(([k,l])=>'<button data-act="bt-sport" data-k="'+k+'" aria-pressed="'+(f.sport===k)+'" title="'+esc(SPLONG[k])+'">'+l+'</button>').join('');
  if(f.legs==null) f.legs=8; if(f.mins==null) f.mins=4;
  const H=teamOf(f.sport,f.home);
  const wchips=[10,50,100,250].map(v=>'<button class="x2" data-act="bt-wager" data-v="'+v+'">'+v+'</button>').join('');
  const fseg='<div class="seg" role="group" aria-label="Battle format"><button data-act="bt-fmt" data-k="parlay" aria-pressed="'+(f.fmt==='parlay')+'">Parlay</button><button data-act="bt-fmt" data-k="sgp" aria-pressed="'+(f.fmt==='sgp')+'">Same Game Parlay <span class="sgpb">SGP</span></button></div>';
  const noProps=ts.length&&H.props===false;
  const sp=(BT.sim&&BT.sim.sports[f.sport])||{}; const off=(f.sport==='nba'||f.sport==='cbb')&&[6,7,8,9].indexOf(new Date().getMonth())>=0;
  const cpu=(f.vs==='cpu');
  const vseg='<div class="fld">Play against<div class="seg" role="group" aria-label="Opponent"><button data-act="bt-vs" data-k="players" aria-pressed="'+(!cpu)+'">Players</button><button data-act="bt-vs" data-k="cpu" aria-pressed="'+cpu+'">🤖 Computer</button></div>'+(cpu?cpuNote():'')+'</div>';
  return '<section class="game"><div class="sec"><h3>Start a battle <span class="hint">practice coins</span></h3>'+vseg+
    '<div class="seg" role="group" aria-label="Sport">'+seg+'</div><div class="small muted">'+esc(SPLONG[f.sport])+(sp.season?' · player averages from the '+sp.season+' season'+(off?' (offseason: last season\'s numbers)':''):'')+'</div>'+
    (ts.length?(big?'<label class="fld">Find a team<input class="num wide" data-bt="q" value="'+esc(f.q||'')+'" placeholder="Type a school" aria-label="Find a team" autocomplete="off"></label>':'')+
      tpHtml(f,'home',ts,q,'Your team',null)+
      (cpu?tpHtml(f,'cpuAway',ts,q,'Computer\'s team',f.home,true):'')+
      (noProps?'<div class="small muted">'+esc(H.short||H.abbr)+' has no player data yet, so this battle would have team lines only (spread, total, moneyline).</div>':'<div class="small muted">Player props included: about 9 players per team, lines from current rosters.</div>')+
      injLine(H,H.abbr)+
      (cpu?'<div class="small muted">You pick both teams (or leave the computer\'s team on Random for an even matchup) and the settings. The lines are set at once.</div>':'<div class="small muted">You only pick your team and the settings. Whoever accepts picks the opposing team, and then the lines are set.</div>')+
      '<div class="fld">Format'+fseg+'<div class="small muted">'+btFmtNote(f.fmt,f.legs)+'</div></div>'+
      '<div class="fld">Legs allowed<div class="seg" role="group" aria-label="Legs allowed">'+[[4,'4'],[8,'8'],[12,'12'],[0,'Unlimited']].map(([k,l])=>'<button data-act="bt-legs" data-k="'+k+'" aria-pressed="'+(f.legs===k)+'">'+l+'</button>').join('')+'</div></div>'+
      '<div class="fld">Game length (minutes)<div class="seg" role="group" aria-label="Game length">'+[2,3,4,5,6,7,8].map(k=>'<button data-act="bt-mins" data-k="'+k+'" aria-pressed="'+(f.mins===k)+'">'+k+(k===4?' ·std':'')+'</button>').join('')+'</div></div>'+
      '<div class="stakerow2"><label>Wager <input class="num" data-bt="wager" inputmode="decimal" value="'+esc(f.wager)+'" aria-label="Wager in coins"> coins</label><span class="chips2">'+wchips+'</span></div>'+
      '<div class="btnrow"><button class="btn solid" data-act="bt-create"'+(BT.busy?' disabled':'')+'>'+(SOC.user?(cpu?'Play the computer':'Create battle'):'Sign in to battle')+'</button></div>'+
      (cpu?'<div class="small muted">Your wager is held until the battle ends and the computer matches it. Build your parlay and lock it: the game starts 5 seconds after you lock. If you do not lock within 15 minutes, everything is refunded.</div>':'<div class="small muted">Your wager is held until the battle ends. Then you wait for a challenger. If you leave this screen you get a pop-up the moment someone accepts. If nobody accepts within 30 minutes, or the parlays are not locked within 15 minutes of accepting, everything is refunded.</div>')
    :'<div class="small muted">Loading teams…</div>')+
    (BT.msg?'<div class="slipnote warnt">'+esc(BT.msg)+'</div>':'')+'</div></section>';
}
function btRow(b,kind){
  const me=SOC.user&&SOC.user.id; const mine=me&&(b.creator===me||b.opponent===me);
  const A=teamOf(b.sport,b.away), H=teamOf(b.sport,b.home); const wait=!b.away;
  const who=((b.creator_name===CPU_NAME||b.opponent_name===CPU_NAME)?'🤖 ':'')+esc(b.creator_name||'?')+(b.opponent_name?' vs '+esc(b.opponent_name):'');
  let right='';
  if(kind==='open'){
    if(b.status==='open'&&!mine) right='<span class="badge warn">'+(wait?'pick a team':'open')+'</span>';
    else if(b.status==='building') right='<span class="badge">building parlays</span>';
    else right='<span class="badge">waiting</span>';
  } else if(kind==='live'){ right='<span class="liveb"><i class="livedot"></i>'+(b.score?esc(b.score.as+'-'+b.score.hs):'LIVE')+'</span>'; }
  else { right=b.status==='cancelled'?'<span class="badge">refunded</span>':'<span class="badge '+(b.result&&b.result.split?'':'ok')+'">'+(b.result?esc(b.result.as+'-'+b.result.hs):'')+(b.result&&b.result.split?' split':'')+'</span>'; }
  const sub=kind==='recent'&&b.status==='final'&&!(b.result&&b.result.split)?'winner '+esc(b.winner===b.creator?b.creator_name:b.opponent_name):kind==='recent'&&b.cancel_reason?esc(b.cancel_reason):(b.nbets?b.nbets+' spectator bet'+(b.nbets>1?'s':''):'');
  return '<button class="btrow'+(mine?' mine':'')+'" data-act="bt-open" data-id="'+b.id+'"><span class="btm">'+(wait?'':tchip(A.abbr,A.color))+tchip(H.abbr,H.color)+'</span><span class="btt"><b>'+esc(SPN[b.sport]||b.sport)+' · '+(wait?esc(b.home)+' <span class="muted">waiting for a challenger</span>':esc(b.away)+' @ '+esc(b.home))+(b.fmt==='sgp'?' <span class="sgpb">SGP</span>':'')+'</b><span class="small muted">'+who+' · pot '+cn(b.wager*(b.opponent?2:1))+(sub?' · '+sub:'')+'</span></span>'+right+'</button>';
}
function btLobbyHtml(){
  const L=BT.lobby;
  const list=(arr,kind,empty)=>arr&&arr.length?arr.map(b=>btRow(b,kind)).join(''):'<div class="small muted">'+empty+'</div>';
  return btCreateHtml()+
    '<section class="game"><div class="sec"><h3>Open battles <span class="hint">accept one and pick your team</span></h3>'+(L?list(L.open,'open','No open battles. Start one above.'):'<div class="small muted">Loading…</div>')+'</div></section>'+
    '<section class="game"><div class="sec"><h3>Live now</h3>'+(L?list(L.live,'live','No battle is being played right now.'):'')+'</div></section>'+
    '<section class="game"><div class="sec"><h3>Recent results</h3>'+(L?list(BT.moreRecent?L.recent:(L.recent||[]).slice(0,6),'recent','No finished battles yet.')+(!BT.moreRecent&&(L.recent||[]).length>6?'<div class="btnrow"><button class="btn" data-act="bt-more">More ('+((L.recent.length)-6)+')</button></div>':''):'')+'</div></section>'+
    '<section class="game"><div class="sec"><h3>How battles work</h3><div class="small muted">1. Pick a sport (NFL, NBA, MLB, college football or college basketball), your team, a format (Parlay or Same Game Parlay), the legs allowed and a wager, then wait. 2. Another player accepts with the same wager and picks the opposing team. 3. Both build a parlay (1 to 6 legs) from the battle\'s lines and player props (over/under and X+ ladders) and lock it. In a Same Game Parlay the price accounts for correlated legs. 4. The game is simulated from the latest ratings and player averages and plays out over about 3 minutes. Each parlay is a 100-coin slip: the one that pays more takes the pot. If your winning parlay hits, you also receive 10% of that parlay\'s total payout in bonus coins. Battle wins and losses count toward your record and rating (Elo) per sport; the top rating with 3+ battles in a sport earns that sport\'s daily KING badge (five sports, five Kings). Spectator bets pay at their odds and count for the daily leaderboard, not for anyone\'s battle record. No one to play? Choose <b>Computer</b> when you start a battle: it picks a balanced parlay from its best bets (4 legs minimum, 14 maximum on Unlimited), learns from every battle, and counts toward your record but not Elo or the Board.</div>'+PRACTICE_NOTE+'</div></section>';
}
const bgrp=tok=>{ const p=tok.split(':'); return p[0]==='p'||p[0]==='x'?'p:'+p[1]+':'+p[2]:p[0]==='tt'?'tt:'+p[1]:p[0]; };
function mktBtn(tok,top,price,on,dis,act,aria){ return '<button class="odd'+(on?' on':'')+'" data-act="'+(act||'bt-leg')+'" data-tok="'+esc(tok)+'" aria-pressed="'+!!on+'"'+(aria?' aria-label="'+esc(aria)+'"':'')+(dis?' disabled':'')+'><span class="o1">'+esc(top)+'</span><span class="o2 mono">'+fo(price)+'</span></button>'; }
/* FanDuel-style order of the player sections for each sport (Game Lines always first) */
const PSEC={passYds:'Passing Yards',passTD:'Passing TDs',rushYds:'Rushing Yards',recYds:'Receiving Yards',rec:'Receptions',tdany:'Anytime Touchdown Scorer',pts:'Points',reb:'Rebounds',ast:'Assists',fg3:'Made Threes',pra:'Points + Rebounds + Assists',hits:'Hits',hrr:'Hits + Runs + RBIs',tb:'Total Bases',hr:'Home Runs',rbi:'RBIs',runs:'Runs Scored',k:'Strikeouts',outs:'Outs Recorded'};
const PORD={nfl:['tdany','passYds','passTD','rushYds','recYds','rec'],nba:['pts','reb','ast','fg3','pra'],mlb:['hits','hrr','hr','tb','rbi','runs','k','outs']}; PORD.cfb=PORD.nfl; PORD.cbb=PORD.nba;
function selIn(sel,key){ return sel.filter(t=>{ const p=t.split(':'); return key==='lines'?(p[0]==='ml'||p[0]==='spr'||p[0]==='tot'):key==='tt'?p[0]==='tt':(p[0]==='p'||p[0]==='x')&&p[2]===key; }).length; }
function accSection(b,key,title,body,sel,o){
  const open=BT.acc[key]!=null?!!BT.acc[key]:!!o.def; const n=selIn(sel||[],key);
  return '<div class="acc"><button class="accH" data-act="bt-acc" data-k="'+esc(key)+'" aria-expanded="'+open+'"><b>'+esc(title)+'</b>'+(n?'<span class="picked">'+n+' picked</span>':'')+(o.sgp?'<span class="sgpb">SGP</span>':'')+'<span class="chev" aria-hidden="true">'+(open?'⌃':'⌄')+'</span></button>'+(open?'<div class="accB">'+body+'</div>':'')+'</div>';
}
function injSection(b,sel){
  const I=(b.markets&&b.markets.inj)||{}; const any=['home','away'].some(s=>I[s]&&((I[s].out||[]).length||(I[s].q||[]).length)); if(!any) return '';
  const body=['away','home'].map(s=>injLine({inj:I[s]},b[s])).join('')+'<div class="small muted">Out players are not in the lists below and the team\'s strength is adjusted. Questionable players are priced a little lower. Frozen when the battle was created.</div>';
  return accSection(b,'inj','Injury report',body,sel,{def:false});
}
function btMarketsHtml(b,sel,act,o){ o=o||{lines:true,props:true};
  const m=b.markets, A=teamOf(b.sport,b.away), H=teamOf(b.sport,b.home); const on=t=>sel.indexOf(t)>=0; const sgp=b.fmt==='sgp'&&!!act&&act==='bt-leg';
  const btn=(t,top,pr)=>mktBtn(t,top,pr,on(t),!act,act||'bt-leg');
  let h='';
  if(o.lines){
    const g='<div class="ogrid"><div class="ohead"><span></span><span>'+(b.sport==='mlb'?'Run line':'Spread')+'</span><span>Total</span><span>Money</span></div>'+
    '<div class="orow"><div class="team">'+tchip(A.abbr,A.color)+'<div class="tn"><div class="n">'+esc(A.short||A.abbr)+'</div><div class="r">away · ~'+Math.round(m.ea)+'</div></div></div>'+btn('spr:away',sg(m.spr.awayLine),m.spr.away)+btn('tot:over','O '+m.tot.line,m.tot.over)+btn('ml:away','ML',m.ml.away)+'</div>'+
    '<div class="orow"><div class="team">'+tchip(H.abbr,H.color)+'<div class="tn"><div class="n">'+esc(H.short||H.abbr)+'</div><div class="r">home · ~'+Math.round(m.eh)+'</div></div></div>'+btn('spr:home',sg(m.spr.homeLine),m.spr.home)+btn('tot:under','U '+m.tot.line,m.tot.under)+btn('ml:home','ML',m.ml.home)+'</div></div>';
    h+=o.props||o.accordion?accSection(b,'lines','Game Lines',g,sel,{def:true,sgp:sgp}):g;
  }
  if(o.props&&m.tt){
    const unit=b.sport==='mlb'?'runs':'points';
    const tg='<div class="ogrid"><div class="ohead"><span></span><span>Over</span><span>Under</span><span></span></div>'+['away','home'].map(s=>{ const T=s==='away'?A:H, x=m.tt[s]; if(!x) return '';
      return '<div class="orow"><div class="team">'+tchip(T.abbr,T.color)+'<div class="tn"><div class="n">'+esc(T.short||T.abbr)+'</div><div class="r">team total '+unit+' · ~'+Math.round(s==='away'?m.ea:m.eh)+'</div></div></div>'+btn('tt:'+s+':over','O '+x.line,x.over)+btn('tt:'+s+':under','U '+x.line,x.under)+'<span></span></div>'; }).join('')+'</div>';
    h+=accSection(b,'tt','Team Totals'+(b.sport==='mlb'?' (runs)':''),tg,sel,{def:false,sgp:sgp});
  }
  if(o.win&&m.winner) h+='<div class="legs win2">'+btn('win:creator',(m.winner.creatorName||'Creator')+' wins the battle',m.winner.creator)+btn('win:opponent',(m.winner.opponentName||'Opponent')+' wins the battle',m.winner.opponent)+'</div>';
  if(o.props&&(m.props||[]).length){
    h+=injSection(b,sel);
    const bySt={}; m.props.forEach(p=>{ (bySt[p.stat]=bySt[p.stat]||[]).push(p); });
    const order=(PORD[b.sport]||[]).filter(k=>bySt[k]).concat(Object.keys(bySt).filter(k=>(PORD[b.sport]||[]).indexOf(k)<0));
    const pinj={}; (m.players||[]).forEach(pl=>{ if(pl.inj) pinj[pl.pid]=pl; });
    order.forEach((st,ix)=>{
      const ps=bySt[st].slice().sort((x,y)=>y.mean-x.mean); const yn=!!ps[0].yn; const showAll=!!BT.all[st]; const shown=showAll?ps:ps.slice(0,5);
      const ns=[...new Set([].concat(...ps.map(p=>(p.rungs||[]).map(r=>r.n))))].sort((a,c)=>a-c);
      const hdr='<div class="xrow xhd"><div class="xn"></div><div class="xs">'+(yn?'':'<span>Over</span><span>Under</span>')+ns.map(n=>'<span>'+(yn&&n===1?'Yes':n+'+')+'</span>').join('')+'</div></div>';
      const rows=shown.map(p=>{ const r=p.rungs||[]; const ij=pinj[p.pid];
        const sub=esc(p.abbr)+(yn?'':' · avg '+n1(p.mean));
        const cells=(yn?'':btn('p:'+p.pid+':'+p.stat+':over',String(p.line),p.over)+btn('p:'+p.pid+':'+p.stat+':under',String(p.line),p.under))+
          ns.map(n=>{ const q=r.find(x=>x.n===n); if(!q) return '<span class="xnone">-</span>'; const tok='x:'+p.pid+':'+p.stat+':'+n; const lbl=surname(p.name)+(yn?' ':' '+n+'+ ')+p.label.toLowerCase();
            return '<button class="odd xb'+(on(tok)?' on':'')+'" data-act="'+(act||'bt-leg')+'" data-tok="'+esc(tok)+'" aria-pressed="'+on(tok)+'" aria-label="'+esc(lbl+' '+fo(q.price))+'"'+(!act?' disabled':'')+'><span class="o2 mono">'+fo(q.price)+'</span></button>'; }).join('');
        return '<div class="xrow"><div class="xn"><b>'+esc(surname(p.name))+(ij?' <span class="qb" title="'+esc((ij.inj||'')+(ij.note?': '+ij.note:''))+'">Q</span>':'')+'</b><span class="muted small">'+sub+'</span></div><div class="xs">'+cells+'</div></div>'; }).join('');
      const more=ps.length>5?'<button class="seeall" data-act="bt-all" data-k="'+esc(st)+'">'+(showAll?'Show fewer':'See all '+ps.length+' players')+'</button>':'';
      h+=accSection(b,st,PSEC[st]||ps[0].label,'<div class="xscroll">'+hdr+rows+'</div>'+more,sel,{def:ix===0&&!o.lines,sgp:sgp});
    });
  }
  return h;
}
function legLabel(b,tok){
  const m=b.markets, p=tok.split(':');
  if(p[0]==='ml') return b[p[1]]+' to win'; if(p[0]==='spr') return b[p[1]]+' '+sg(m.spr[p[1]+'Line']); if(p[0]==='tot') return (p[1]==='over'?'Over ':'Under ')+m.tot.line;
  if(p[0]==='win') return ((m.winner||{})[p[1]+'Name']||p[1])+' wins the battle';
  if(p[0]==='tt'){ const x=(m.tt||{})[p[1]]; return b[p[1]]+' team total '+(p[2]==='over'?'Over ':'Under ')+(x?x.line:''); }
  const pr=(m.props||[]).find(x=>x.pid===p[1]&&x.stat===p[2]); if(!pr) return tok;
  if(p[0]==='x') return surname(pr.name)+(pr.yn?' ':' '+p[3]+'+ ')+pr.label.toLowerCase();
  return surname(pr.name)+' '+(p[3]==='over'?'Over ':'Under ')+pr.line+' '+pr.label.toLowerCase();
}
function legPrice(b,tok){ const m=b.markets, p=tok.split(':'); if(p[0]==='tt'){ const x=(m.tt||{})[p[1]]; return x?x[p[2]]:null; } if(p[0]==='x'){ const pr=(m.props||[]).find(x=>x.pid===p[1]&&x.stat===p[2]); const r=pr&&(pr.rungs||[]).find(x=>x.n===+p[3]); return r?r.price:null; } if(p[0]==='ml') return m.ml[p[1]]; if(p[0]==='spr') return m.spr[p[1]]; if(p[0]==='tot') return m.tot[p[1]]; if(p[0]==='win') return (m.winner||{})[p[1]]; const pr=(m.props||[]).find(x=>x.pid===p[1]&&x.stat===p[2]); return pr?pr[p[3]]:null; }
/* live status of one leg from the latest visible play (score + running player lines); the saved leg carries its own line, so this works after the prop list is gone */
function legNow(b,l,ev,fin){
  if(!ev) return {s:'',t:''}; const hs=ev.hs, as=ev.as_; const k=l.kind;
  const res=x=>({s:x,t:x==='W'?'hit':x==='L'?'miss':x==='V'?'push':''});
  if(k==='ml'){ if(!fin) return {s:'',t:(l.side==='home'?hs-as:as-hs)>0?'leading':(hs===as?'tied':'trailing')}; return res(hs===as?'V':((l.side==='home')===(hs>as)?'W':'L')); }
  if(k==='spr'){ const v=(l.side==='home'?hs-as:as-hs)+(+l.line); if(!fin) return {s:'',t:v>0?'covering':'not covering'}; return res(v===0?'V':v>0?'W':'L'); }
  if(k==='tot'){ const t=hs+as; if(l.dir==='over'&&t>l.line) return res('W'); if(l.dir==='under'&&t>l.line) return res('L'); if(!fin) return {s:'',t:t+' so far'}; return res(l.dir==='under'?'W':'L'); }
  if(k==='tt'){ const x=l.side==='home'?hs:as; if(l.dir==='over'&&x>l.line) return res('W'); if(l.dir==='under'&&x>l.line) return res('L'); if(!fin) return {s:'',t:x+' so far'}; return res(x===+l.line?'V':l.dir==='under'?'W':'L'); }
  const cur=((ev.stats||{})[l.pid]||{})[l.stat]||0;
  if(k==='x'){ if(cur>=+l.n) return res('W'); if(!fin) return {s:'',t:cur+' so far'}; return res('L'); }
  if(k==='p'){ if(l.dir==='over'&&cur>l.line) return res('W'); if(l.dir==='under'&&cur>l.line) return res('L'); if(!fin) return {s:'',t:cur+' so far'}; return res(l.dir==='under'?'W':'L'); }
  return {s:'',t:''};
}
function btNaive(legs){ return legs.reduce((d,l)=>d*decOf(l.price),1); }
function parlayCard(b,p,ev,fin){
  const legs=(p.graded||p.legs||[]); const dec=btNaive(legs); const q=p.quote; const sg2=b.fmt==='sgp'&&q&&q.mult!=null; const pay=sg2?+q.mult:dec;
  const head='<div class="bh"><b>'+uLink(p.username||'?')+'</b>'+(b.fmt==='sgp'?'<span class="sgpb">SGP</span>':'')+(p.payout!=null?'<span class="badge '+(+p.payout>0?'ok':'bad')+'">pays '+cn(p.payout)+' · '+(p.hits||0)+' hit</span>':'<span class="muted small">100 pays '+cn(100*pay)+' ('+fo(amerOfDec(pay))+')'+(sg2&&dec>pay*1.005?' · straight '+cn(100*dec):'')+'</span>')+'</div>';
  const mine=SOC.user&&p.user_id===SOC.user.id&&p.payout!=null&&+p.payout>0;
  return '<div class="bet pcard">'+head+(mine?'<div class="btnrow"><button class="shbtn" data-act="sh-open" data-k="slip" data-src="bparl" data-uid="'+esc(p.user_id)+'">Share my winning slip</button></div>':'')+legs.map(l=>{ const st=l.res?{s:l.res,t:''}:legNow(b,l,ev,fin); return '<div class="bl">'+legStatusIcon({res:st.s||null})+'<span>'+esc(l.label)+' <span class="mono muted">'+fo(l.price)+'</span>'+(st.t?' <span class="small muted">· '+esc(st.t)+'</span>':'')+'</span></div>'; }).join('')+'</div>';
}
/* the slip's price while building: straight multiplication (Parlay) or the server's correlated price (Same Game Parlay) next to it */
function btPriceBox(b,sel){
  if(!sel.length) return '';
  const nv=sel.reduce((x,t)=>x*decOf(legPrice(b,t)),1);
  if(b.fmt!=='sgp') return '<div class="pricebox"><div>Parlay price <b class="mono">'+fo(amerOfDec(nv))+'</b> · 100 coins pay <b class="mono">'+cn(100*nv)+'</b></div></div>';
  if(sel.length<2) return '<div class="pricebox sgpbox"><span class="sgpb">SGP</span> Add at least 2 legs for the Same Game Parlay price.</div>';
  const q=BT.quote[b.id]; const fresh=q&&JSON.stringify((q.toks||[]))===JSON.stringify(sel.slice().sort());
  if(!fresh) return '<div class="pricebox sgpbox"><span class="sgpb">SGP</span> Pricing these legs…<div class="small muted">Straight multiplication would pay '+cn(100*nv)+' for 100 coins.</div></div>';
  const less=1-q.mult/nv;
  return '<div class="pricebox sgpbox"><div><span class="sgpb">SGP</span> price <b class="mono">'+fo(amerOfDec(+q.mult))+'</b> · 100 coins pay <b class="mono">'+cn(100*q.mult)+'</b>'+(q.capped?' <span class="small muted">(payout cap)</span>':'')+'</div>'+
    '<div class="small muted">Straight multiplication: '+fo(amerOfDec(nv))+' · pays '+cn(100*nv)+'. '+(less>0.005?'The SGP pays '+Math.round(less*100)+'% less because these legs tend to happen together.':'These legs barely affect each other, so the price is about the same.')+'</div></div>';
}

/* ---------- who is winning: the two slips compared live (a busted slip is out; otherwise expected payout = chance the legs still hold x what the slip pays) ---------- */
function btSlipState(b,p,ev,fin){
  const legs=(p.graded||p.legs||[]); const dec=btNaive(legs); const q=p.quote; const mult=(b.fmt==='sgp'&&q&&q.mult!=null)?+q.mult:dec;
  let hit=0,miss=0,live=0,prob=1;
  legs.forEach(l=>{ const st=l.res?{s:l.res,t:''}:legNow(b,l,ev,fin);
    if(st.s==='W') hit++; else if(st.s==='L'){ miss++; prob=0; } else if(st.s==='V'){ /* push: leg drops out */ }
    else { live++; const t=st.t||''; prob*=/leading|covering/.test(t)?0.66:/trailing|not covering/.test(t)?0.34:0.5; } });
  return {name:p.username||'?',uid:p.user_id,n:legs.length,hit:hit,miss:miss,live:live,prob:prob,mult:mult,ex:prob*mult};
}
function btStanding(b,d,ev,fin){
  const ps=d.parlays||[]; const pc=ps.find(p=>p.user_id===b.creator), po=ps.find(p=>p.user_id===b.opponent); if(!pc||!po) return null;
  const c=btSlipState(b,pc,ev,fin), o=btSlipState(b,po,ev,fin); let share; // share = creator's side of the bar, 0..100
  if(fin&&b.result&&b.result.creator){ share=b.result.split?50:(b.winner===b.creator?100:0); }
  else if(c.ex+o.ex>0) share=100*c.ex/(c.ex+o.ex);
  else share=100*(c.hit+.5)/(c.hit+o.hit+1);
  if(!fin) share=Math.min(96,Math.max(4,share));
  return {c:c,o:o,share:share,tie:fin&&b.result&&b.result.split};
}
function btSlipLine(s,dead){ return dead?'slip busted ('+s.miss+' missed)':s.hit+' hit · '+s.live+' to play'+(s.miss?' · '+s.miss+' missed':''); }
function btStandHtml(b,d,ev,fin){
  const st=btStanding(b,d,ev,fin); if(!st) return '';
  const c=st.c, o=st.o, sh=Math.round(st.share);
  const lead=fin?(st.tie?'Tied':(sh>50?c.name:o.name)+' won'):(Math.abs(sh-50)<4?'Too close to call':(sh>50?c.name:o.name)+' is winning');
  const pill=(x,pct)=>pct>=18?esc(x.name)+' '+pct+'%':'';
  return '<div class="sec standing" role="group" aria-label="Who is winning"><h3>Who is winning <span class="hint">'+esc(lead)+'</span></h3>'+
    '<div class="stbar" role="img" aria-label="'+esc(c.name+' '+sh+' percent, '+o.name+' '+(100-sh)+' percent')+'"><div class="sb1" style="width:'+sh+'%">'+pill(c,sh)+'</div><div class="sb2" style="width:'+(100-sh)+'%">'+pill(o,100-sh)+'</div></div>'+
    '<div class="stcols"><div class="stc"><b class="c1">'+esc(c.name)+'</b><span class="small muted">'+esc(btSlipLine(c,c.miss>0))+'</span></div><div class="stc r"><b class="c2">'+esc(o.name)+'</b><span class="small muted">'+esc(btSlipLine(o,o.miss>0))+'</span></div></div>'+
    (fin?'':'<div class="small muted">Live read of both slips: a missed leg busts a slip; otherwise it weighs how each open leg is tracking against what the slip pays.</div>')+'</div>';
}
function btSections(){
  const d=BT.det; if(!d||!d.battle) return null;
  const b=d.battle, me=SOC.user&&SOC.user.id, isC=me&&b.creator===me, isO=me&&b.opponent===me, part=isC||isO;
  const A=teamOf(b.sport,b.away), H=teamOf(b.sport,b.home); const evs=d.events||[]; const last=evs[evs.length-1]; const fin=b.status==='final';
  const sideName=s=>s==='home'?b.home:b.away;
  const sec={};
  const timer=b.status==='open'?'<span class="small muted">expires in <b data-until="'+new Date(Date.parse(b.created_at)+30*60000).toISOString()+'"></b></span>':b.status==='building'?'<span class="small muted">lock within <b data-until="'+new Date(Date.parse(b.accepted_at)+15*60000).toISOString()+'"></b></span>':b.status==='live'?'<span class="liveb"><i class="livedot"></i>LIVE</span>':'';
  sec.head='<div class="sec"><div class="btnrow"><button class="btn" data-act="bt-back">‹ All battles</button>'+((b.status==='live'||fin)?'<button class="btn" data-act="bt-snd" aria-pressed="'+!!SND.on+'">'+(SND.on?'🔊 Sound on':'🔇 Sound off')+'</button>':'')+'</div><h3>'+esc(SPLONG[b.sport]||SPN[b.sport])+' battle #'+b.id+' '+(b.fmt==='sgp'?'<span class="sgpb">SGP</span> ':'')+timer+'</h3>'+
    '<div class="vsrow"><div class="vsp">'+uLink(b.creator_name||'?')+'<span class="small muted">'+(b.away?'backs ':'plays ')+esc(sideName(b.creator_side))+'</span></div><div class="pot">'+COIN+' <b>'+cn(b.wager*(b.opponent?2:1))+'</b><span class="small muted">pot</span></div><div class="vsp">'+(b.opponent?uLink(b.opponent_name||'?')+'<span class="small muted">plays '+esc(sideName(b.opponent_side))+'</span>':'<span class="muted">waiting for a challenger</span>')+'</div></div>'+
    (b.status==='cancelled'?'<div class="flash">Cancelled: '+esc(b.cancel_reason||'')+'. Wagers and spectator bets were refunded.</div>':'')+
    (BT.msg?'<div class="slipnote warnt">'+esc(BT.msg)+'</div>':'')+'</div>';
  if(b.status==='live'||fin){
    const hs=last?last.hs:0, as=last?last.as_:0, wp=last&&last.wp!=null?Math.round(last.wp*100):50;
    sec.board='<div class="sec"><div class="viz"><div class="score"><div class="sc"><div class="cr-lab">'+esc(b.away)+'</div><div class="big mono">'+as+'</div></div><div class="clk"><div class="mono">'+esc(last?last.clock||'':'')+'</div><div class="cr-lab">'+(fin?'':'simulated')+'</div></div><div class="sc"><div class="cr-lab">'+esc(b.home)+'</div><div class="big mono">'+hs+'</div></div></div>'+
      '<div class="wp" role="img" aria-label="'+esc(b.home+' win chance '+wp+' percent')+'"><div class="wpa" style="width:'+(100-wp)+'%;background:'+esc(A.color)+'">'+(100-wp>=14?esc(b.away)+' '+(100-wp)+'%':'')+'</div><div class="wph" style="width:'+wp+'%;background:'+esc(H.color)+'">'+(wp>=14?esc(b.home)+' '+wp+'%':'')+'</div></div>'+
      '<div class="playchip" id="chip-b'+b.id+'"><b>'+esc(last?anLabelOf(last):'')+'</b><span>'+esc(last?last.text:'Waiting for the first play…')+'</span></div><div class="cel" id="cel-b'+b.id+'"></div></div>'+
      (fin?btWinnerHtml(b,d):'<div class="small muted">Plays appear as their time comes; the server keeps future plays hidden.</div>')+'</div>';
    sec.box=btBox(b,d,last);
    if((d.parlays||[]).length>1) sec.stand=btStandHtml(b,d,last,fin);
    sec.feed='<div class="sec"><h3>Play by play <span class="hint">'+evs.length+' plays</span></h3><div class="feed">'+evs.slice().reverse().map(e=>'<div class="fe '+esc(e.kind)+'"><span class="mono fc">'+esc(e.clock||'')+'</span><span>'+(anIconOf(e)?'<i class="fi">'+anIconOf(e)+'</i> ':'')+esc(e.text)+'</span><span class="mono fs">'+e.as_+'-'+e.hs+'</span></div>').join('')+'</div></div>';
    sec.parl='<div class="sec"><h3>Parlays <span class="hint">100-coin slips</span></h3>'+(d.parlays||[]).sort((x,y)=>x.user_id===b.creator?-1:1).map(p=>parlayCard(b,p,last,fin)).join('')+'</div>';
  } else if(b.status==='open'||b.status==='building'){
    let act='';
    if(b.status==='open'){
      if(!me) act='<div class="btnrow"><button class="btn solid" data-act="signin">Sign in to accept</button></div>';
      else if(isC) act='<div class="small">You picked <b>'+esc(b.home)+'</b>. Waiting for a challenger to pick the opposing team and accept. You can leave this screen: a pop-up will tell you the moment someone accepts.</div>'+btSettingsHtml(b)+'<div class="btnrow"><button class="btn" data-act="bt-cancel">Cancel and refund</button></div>';
      else if(b.away){ const oth=b.creator_side==='home'?'away':'home'; act='<div class="small"><b>'+esc(b.creator_name||'They')+'</b> backs <b>'+esc(sideName(b.creator_side))+'</b>. Accept the same wager ('+cn(b.wager)+' coins) and you get <b>'+esc(sideName(oth))+'</b>. Then you both build your parlays.</div><div class="btnrow"><button class="btn solid" data-act="bt-accept" data-k="'+oth+'">Accept · back '+esc(sideName(oth))+'</button></div>'; }
      else { const ts=simTeams(b.sport); const f2={sport:b.sport,pick:BT.form.pick,dd:BT.form.dd}; const qq=(BT.form.q||'').trim().toLowerCase(); const pk=teamOf(b.sport,BT.form.pick);
        act='<div class="small"><b>'+esc(b.creator_name||'They')+'</b> is playing <b>'+esc(teamOf(b.sport,b.home).name||b.home)+'</b> and is waiting for a challenger. Pick the team you want to play, then accept the same wager ('+cn(b.wager)+' coins). Then you both build your parlays.</div>'+btSettingsHtml(b)+
          (ts.length>40?'<label class="fld">Find a team<input class="num wide" data-bt="q" value="'+esc(BT.form.q||'')+'" placeholder="Type a school" aria-label="Find a team" autocomplete="off"></label>':'')+
          tpHtml(f2,'pick',ts,qq,'Your team',b.home)+
          (BT.form.pick&&pk.props===false?'<div class="small muted">'+esc(pk.short||pk.abbr)+' has no player data yet, so this battle would have team lines only.</div>':'')+
          '<div class="btnrow"><button class="btn solid" data-act="bt-accept"'+(BT.form.pick?'':' disabled')+'>'+(BT.form.pick?'Accept · play as '+esc(pk.short||pk.abbr):'Pick your team to accept')+'</button></div>'; }
    } else if(part){
      const mine=(d.parlays||[]).find(p=>p.user_id===me); const other=b.creator===me?b.opponent_name:b.creator_name;
      const locked=mine&&mine.locked; const sel=BT.draft[b.id]||[];
      const min=b.fmt==='sgp'?2:1; const ok=sel.length>=min;
      act='<div class="small">'+(locked?(b.both_locked_at?'<b data-bt-cd="'+(Date.parse(b.both_locked_at)+5000)+'">Both locked. Starting in 5s</b>. Tap Unlock to change something.':'Your parlay is locked. Waiting for '+esc(other)+'… You can unlock until both of you are locked in for 5 seconds.'):'Build your '+(b.fmt==='sgp'?'Same Game Parlay: ':'parlay: ')+capTxt(b,b.fmt==='sgp'?min:1)+(btFree(b)?'':' (one per market)')+', then lock it. '+esc(other)+' cannot see it until the game starts.')+'</div>'+
        (sel.length?'<div class="mylegs">'+sel.map(t=>'<div class="myleg"><span>'+esc(legLabel(b,t))+' <span class="mono muted">'+fo(legPrice(b,t))+'</span></span>'+(locked?'':'<button class="x" data-act="bt-leg" data-tok="'+esc(t)+'" aria-label="Remove '+esc(legLabel(b,t))+'">Remove</button>')+'</div>').join('')+'</div>':'')+btPriceBox(b,sel)+
        '<div class="btnrow">'+(locked?'<button class="btn" data-act="bt-unlock">Unlock to change</button>':'')+'<button class="btn solid" data-act="bt-lock"'+(locked||!ok?' disabled':'')+'>'+(locked?'Locked':ok?'Lock my parlay ('+sel.length+')':'Pick '+(min-sel.length)+' more leg'+(min-sel.length>1?'s':''))+'</button><button class="btn" data-act="bt-cancel">Cancel battle</button></div>';
      sec.mk='<div class="sec"><h3>Battle markets <span class="hint">'+(locked?'locked':'tap to add')+'</span></h3>'+(b.fmt==='sgp'?'<div class="sgptab"><span class="sgpb">SGP</span> Same Game Parlay: pick legs from any section. The price comes from the simulator and accounts for legs that move together.'+(btFree(b)?' Unlimited legs: every option is open, and you can take several picks from one market. The more you stack, the more the price adjusts.':'')+'</div>':'')+(BT.swapMsg?'<div class="slipnote">'+esc(BT.swapMsg)+'</div>':'')+btMarketsHtml(b,sel,locked?null:'bt-leg')+'</div>';
    } else act='<div class="small muted">'+esc(b.creator_name)+' and '+esc(b.opponent_name)+' are building their parlays. The game starts when both lock.</div>';
    sec.act='<div class="sec">'+act+'</div>';
    if(!sec.mk&&b.away) sec.mk='<div class="sec"><h3>Battle markets <span class="hint">fair-ish lines from the ratings</span></h3>'+btMarketsHtml(b,[],null)+'</div>';
    if(me&&!part&&b.away){
      const tok=BT.spec.tok; const pr=tok?legPrice(b,tok):null;
      sec.spec='<div class="sec"><h3>Spectator bet <span class="hint">before the game starts</span></h3>'+btMarketsHtml(b,tok?[tok]:[],'bt-spec',{lines:true})+
        (b.markets.winner?btMarketsHtml(b,tok?[tok]:[],'bt-spec',{win:true}):'<div class="small muted">"Who wins the battle" opens once someone accepts.</div>')+
        '<div class="stakerow2"><label>Stake <input class="num" data-bt="spstake" inputmode="decimal" value="'+esc(BT.spec.stake)+'" aria-label="Spectator stake in coins"> coins</label><button class="btn solid" data-act="bt-specbet"'+(tok?'':' disabled')+'>'+(tok?'Bet '+esc(legLabel(b,tok))+' '+fo(pr):'Pick a market')+'</button></div>'+
        '<div class="small muted">Spectator bets pay at their odds and count toward the daily leaderboard, not toward the players\' battle records.</div></div>';
    }
  }
  const bets=d.bets||[];
  if(bets.length) sec.bets='<div class="sec"><h3>Spectator bets <span class="hint">'+bets.length+'</span></h3>'+bets.map(s=>'<div class="bl">'+legStatusIcon({res:s.status==='won'?'W':s.status==='lost'?'L':s.status==='void'?'V':null})+'<span>'+uLink(s.username)+' '+esc(s.label)+' <span class="mono muted">'+fo(s.price)+'</span> · '+cn(s.stake)+(s.status==='won'?' → '+cn(s.payout):'')+'</span>'+(s.status==='won'&&SOC.me&&s.username===SOC.me.username?' <button class="shbtn" data-act="sh-open" data-k="slip" data-src="spec" data-id="'+esc(s.id)+'">Share</button>':'')+'</div>').join('')+'</div>';
  return sec;
}
function btSettingsHtml(b){
  return '<div class="small muted">'+(b.fmt==='sgp'?'Same Game Parlay':'Parlay')+' · '+(b.max_legs===0?'unlimited legs':'up to '+(b.max_legs||6)+' legs')+' · '+(b.duration_min||4)+'-minute game · '+cn(b.wager)+' coin wager</div>';
}
function btWinnerHtml(b,d){
  const r=b.result||{}; if(!r.creator) return '<div class="small muted">Settling…</div>';
  const wn=r.split?null:(b.winner===b.creator?b.creator_name:b.opponent_name);
  return '<div class="winbar">'+(r.split?'🤝 Tied: the pot is split and both wagers go back.':'🏆 '+esc(wn)+' wins '+cn(b.wager*2)+' coins'+(r.bonus>0?' + '+cn(r.bonus)+' bonus coins':'') )+'<div class="small">'+esc(b.creator_name)+': slip pays '+cn(r.creator.payout)+' ('+r.creator.hits+' hit) · '+esc(b.opponent_name)+': '+cn(r.opponent.payout)+' ('+r.opponent.hits+' hit)'+(r.bonus>0?' · winner gets 10% of the winning parlay payout as a bonus':'')+'</div>'+
    '<div class="btnrow"><button class="btn solid" data-act="sh-open" data-k="battle">Share result</button><button class="btn" data-act="vsf-open">Replay finish</button></div></div>';
}
const BT_ORDER=['head','board','box','stand','act','mk','spec','parl','feed','bets'];
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
    const pos=[...box.querySelectorAll('.xscroll')].map(e=>e.scrollLeft); box.innerHTML=h; BT.html[k]=h; box.querySelectorAll('.xscroll').forEach((e,i)=>{ if(pos[i]) e.scrollLeft=pos[i]; }); });
  btAnimate(); btTickClocks();
}
function btAnimate(){
  const d=BT.det; if(!d||!d.battle) return; const b=d.battle; const evs=d.events||[]; const last=evs[evs.length-1];
  if(b.status==='live') BT.sawLive[b.id]=true;
  if(b.status==='final'&&b.result&&b.result.creator&&!BT.flashed[b.id]){ BT.flashed[b.id]=true; // the finish flash: when you watched it end, or opened a battle that ended in the last 10 minutes
    const fresh=BT.sawLive[b.id]||(b.ends_at&&btNow()-Date.parse(b.ends_at)<600000); if(fresh) setTimeout(()=>{ if(S.view==='battle'&&BT.id===b.id) vsfShow(); },BT.sawLive[b.id]?1500:300); }
  if(b.status==='live'||b.status==='final') anEnsureStage(b);
  if(!last) return;
  const seen=BT.seen[b.id]; BT.seen[b.id]=last.seq;
  if(seen==null||seen>=last.seq) return;
  const news=evs.filter(e=>e.seq>seen);
  anBump(b,news); anEnqueue(b,news);
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
function btOpen(id){ if(BT.id!==id){ BT.form.pick=''; BT.form.dd=null; BT.swapMsg=''; } BT.id=id; BT.det=null; BT.msg=''; BT.html={}; BT.spec={tok:'',stake:BT.spec.stake}; S.view='battle'; render(); window.scrollTo(0,0); }
function saveParlay(id){ clearTimeout(BT.saveT); BT.saveT=setTimeout(()=>{ const legs=(BT.draft[id]||[]).slice(); SOC.sb.rpc('set_battle_parlay',{p_id:id,p_legs:legs}).then(r=>{ if(r.error){ BT.msg=r.error.message; } else { BT.msg=''; if(r.data&&r.data.quote) BT.quote[id]=r.data.quote; } btRender(); loadDetail(); }); },350); }
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act]'); if(!t) return; const act=t.getAttribute('data-act'); if(act.indexOf('bt-')!==0) return;
  e.stopPropagation(); e.preventDefault();
  const f=BT.form;
  if(act==='bt-sport'){ f.sport=t.getAttribute('data-k'); f.q=''; f.cpuAway=''; btFormDefaults(); btRender(); return; }
  if(act==='bt-more'){ BT.moreRecent=true; btRender(); return; }
  if(act==='bt-tdd'){ const k=t.getAttribute('data-k'); BT.form.dd=(BT.form.dd===k?null:k); btRender(); return; }
  if(act==='bt-tsel'){ BT.form[t.getAttribute('data-k')]=t.getAttribute('data-v'); if(BT.form.cpuAway===BT.form.home) BT.form.cpuAway=''; BT.form.dd=null; btRender(); return; }
  if(act==='bt-legs'){ f.legs=parseInt(t.getAttribute('data-k'),10); btRender(); return; }
  if(act==='bt-mins'){ f.mins=parseInt(t.getAttribute('data-k'),10); btRender(); return; }
  if(act==='bt-fmt'){ f.fmt=t.getAttribute('data-k'); btRender(); return; }
  if(act==='bt-wager'){ f.wager=t.getAttribute('data-v'); btRender(); return; }
  if(act==='bt-vs'){ f.vs=t.getAttribute('data-k')==='cpu'?'cpu':'players'; BT.msg=''; if(f.vs==='cpu'){ if((parseFloat(String(f.wager).replace(/[^0-9.]/g,''))||0)>1000) f.wager='1000'; if(!BT.cpuTried) loadCpu(); } btRender(); return; }
  if(act==='bt-create'&&f.vs==='cpu'){ if(!SOC.user){ openModal('in'); return; } if(!f.home){ BT.msg='Pick your team.'; btRender(); return; }
    btCall('create_cpu_battle',{p_sport:f.sport,p_home:f.home,p_away:f.cpuAway||null,p_wager:parseFloat(String(f.wager).replace(/[^0-9.]/g,''))||0,p_fmt:f.fmt,p_max_legs:f.legs==null?8:f.legs,p_minutes:f.mins||4},d=>{ refreshMe(); loadCpu(); btOpen(d.id); }); return; }
  if(act==='bt-create'){ if(!SOC.user){ openModal('in'); return; } if(!f.home){ BT.msg='Pick your team.'; btRender(); return; }
    btCall('create_battle',{p_sport:f.sport,p_home:f.home,p_wager:parseFloat(String(f.wager).replace(/[^0-9.]/g,''))||0,p_fmt:f.fmt,p_max_legs:f.legs==null?8:f.legs,p_minutes:f.mins||4},d=>{ BT.alerts.until=Date.now()+30*60000; BT.alerts.last=0; refreshMe(); btOpen(d.id); }); return; }
  if(act==='bt-open'){ btOpen(+t.getAttribute('data-id')); return; }
  if(act==='bt-popgo'){ const id=+t.getAttribute('data-id'); btPopHide(id); btOpen(id); return; }
  if(act==='bt-popx'){ btPopHide(+t.getAttribute('data-id')); return; }
  if(act==='bt-snd'){ SND.on=!SND.on; sndSave(); if(SND.on){ sndUnlock(); sfx('whistle',0); } else sndStop(); document.querySelectorAll('[data-act="bt-snd"]').forEach(n=>{ n.textContent=SND.on?'🔊 Sound on':'🔇 Sound off'; n.setAttribute('aria-pressed',String(!!SND.on)); }); return; }
  if(act==='bt-back'){ BT.id=null; BT.det=null; BT.msg=''; BT.html={}; render(); return; }
  const b=BT.det&&BT.det.battle; if(!b) return;
  if(act==='bt-accept'){ if(!b.away&&!BT.form.pick){ BT.msg='Pick your team first.'; btRender(); return; } btCall('accept_battle',{p_id:b.id,p_team:b.away?null:BT.form.pick}); return; }
  if(act==='bt-cancel'){ if(!confirm('Cancel this battle? Wagers and spectator bets are refunded.')) return; btCall('cancel_battle',{p_id:b.id}); return; }
  if(act==='bt-unlock'){ btCall('unlock_battle_parlay',{p_id:b.id},()=>btOpen(b.id)); return; }
  if(act==='bt-lock'){ clearTimeout(BT.saveT); SOC.sb.rpc('set_battle_parlay',{p_id:b.id,p_legs:BT.draft[b.id]||[]}).then(r=>{ if(r.error){ BT.msg=r.error.message; btRender(); return; } btCall('lock_battle_parlay',{p_id:b.id}); }); return; }
  if(act==='bt-leg'){ const tok=t.getAttribute('data-tok'); let sel=(BT.draft[b.id]||[]).slice(); const i=sel.indexOf(tok);
    if(i>=0) sel.splice(i,1); else { if(btFree(b)){ const gone=sel.filter(x=>btClash(b,x,tok)); sel=sel.filter(x=>gone.indexOf(x)<0); BT.swapMsg=gone.length?'Swapped out '+gone.map(x=>legLabel(b,x)).join(', ')+' (it cannot happen with your new pick).':''; } else sel=sel.filter(x=>bgrp(x)!==bgrp(tok)); if(sel.length>=capN(b)){ BT.msg='This battle allows at most '+capN(b)+' legs.'; btRender(); return; } sel.push(tok); }
    BT.draft[b.id]=sel; BT.msg=''; if(!btFree(b)||i>=0) BT.swapMsg=''; btRender(); saveParlay(b.id); return; }
  if(act==='bt-acc'){ const k=t.getAttribute('data-k'); const cur=BT.acc[k]!=null?BT.acc[k]:(k==='lines'); BT.acc[k]=!cur; BT.html={}; btRender(); return; }
  if(act==='bt-all'){ const k=t.getAttribute('data-k'); BT.all[k]=!BT.all[k]; BT.html={}; btRender(); return; }
  if(act==='bt-spec'){ const tok=t.getAttribute('data-tok'); BT.spec.tok=BT.spec.tok===tok?'':tok; btRender(); return; }
  if(act==='bt-specbet'){ const st=parseFloat(String(BT.spec.stake).replace(/[^0-9.]/g,''))||0; btCall('place_spectator_bet',{p_id:b.id,p_tok:BT.spec.tok,p_stake:st},d=>{ BT.spec.tok=''; S.flash='Spectator bet placed: '+d.label+' '+fo(d.price)+'.'; renderBank(); refreshMe(); loadDetail(); }); return; }
},true);
document.addEventListener('change',function(e){ const t=e.target; const k=t.getAttribute&&t.getAttribute('data-bt'); if(!k) return; if(k==='home'||k==='away'){ BT.form[k]=t.value; btRender(); } });
document.addEventListener('input',function(e){ const t=e.target; const k=t.getAttribute&&t.getAttribute('data-bt'); if(!k) return; if(k==='wager') BT.form.wager=t.value; if(k==='spstake') BT.spec.stake=t.value;
  if(k==='q'){ BT.form.q=t.value; const f=BT.form, ts=simTeams(f.sport), q=t.value.trim().toLowerCase(); const lab=x=>(x.name||x.abbr)+(x.props===false?' (lines only)':'');
    ['away','home'].forEach(sd=>{ const sel=document.querySelector('select[data-bt="'+sd+'"]'); if(!sel) return; const cur=f[sd]; sel.innerHTML=ts.filter(x=>x.abbr===cur||!q||(x.name||'').toLowerCase().indexOf(q)>=0||(x.abbr||'').toLowerCase().indexOf(q)>=0).map(x=>'<option value="'+esc(x.abbr)+'"'+(x.abbr===cur?' selected':'')+'>'+esc(lab(x))+'</option>').join(''); }); } });


/* ---------- betslip: smaller, scrollable, with a handle you can pull down to minimize (or tap) ---------- */
const _renderSlip0=renderSlip;
renderSlip=function(){ _renderSlip0.apply(this,arguments); const el=document.getElementById('slip'); if(!el||el.hidden||!S.slip.length) return;
  if(!el.querySelector('.slipgrab')) el.insertAdjacentHTML('afterbegin','<div class="slipgrab" data-act="slip" role="button" aria-label="Pull down to minimize the bet slip"><i></i></div>'); };
(function(){ let y0=null,t0=0;
  document.addEventListener('touchstart',e=>{ const g=e.target.closest&&e.target.closest('#slip .slipgrab,#slip .slipsum'); y0=g?e.touches[0].clientY:null; t0=Date.now(); },{passive:true});
  document.addEventListener('touchend',e=>{ if(y0==null) return; const dy=e.changedTouches[0].clientY-y0; y0=null;
    if(dy>36&&S.slipOpen){ S.slipOpen=false; renderSlip(); e.preventDefault(); } else if(dy<-36&&!S.slipOpen){ S.slipOpen=true; renderSlip(); e.preventDefault(); } },{passive:false});
})();

/* ---------- battle v2 helpers: leg cap, nav counts, 5-second countdown ---------- */
/* unlimited Same Game Parlay: every option is selectable; only picks that can never both happen replace each other */
function btFree(b){ return b.fmt==='sgp'&&b.max_legs===0; }
function btBand(b,tok){ const p=tok.split(':'); if(p[0]==='x') return {k:p[1]+':'+p[2],ge:+p[3]};
  if(p[0]==='p'){ const pr=((b.markets&&b.markets.props)||[]).find(x=>x.pid===p[1]&&x.stat===p[2]); if(!pr) return null; const k=Math.floor(+pr.line)+1; return p[3]==='over'?{k:p[1]+':'+p[2],ge:k}:{k:p[1]+':'+p[2],lt:k}; } return null; }
function btClash(b,a,c){ if(a===c) return true; const pa=a.split(':'), pc=c.split(':');
  if(pa[0]===pc[0]&&(pa[0]==='ml'||pa[0]==='spr'||pa[0]==='tot')) return pa[1]!==pc[1];
  if(pa[0]==='tt'&&pc[0]==='tt') return pa[1]===pc[1]&&pa[2]!==pc[2];
  const x=btBand(b,a), y=btBand(b,c); if(x&&y&&x.k===y.k) return (x.ge!=null&&y.lt!=null&&x.ge>=y.lt)||(y.ge!=null&&x.lt!=null&&y.ge>=x.lt); return false; }
function capN(b){ return b.max_legs===0?40:(b.max_legs||6); }
function capTxt(b,min){ return b.max_legs===0?'tap '+min+' or more legs (no limit)':'tap '+min+' to '+capN(b)+' legs'; }
function btPending(){ const L=BT.lobby; return L&&L.open?L.open.length:0; }              // battles waiting for an opponent or for parlays
function chatNew(){ try{
  const me=SOC.user&&SOC.user.id, msgs=SOC.chat||[]; if(!me||!msgs.length) return 0;
  const top=msgs.reduce((a,m)=>Math.max(a,m.id||0),0);
  if(S.view==='chat'){ localStorage.setItem('ls_chat_seen',String(top)); return 0; }
  const seen=parseInt(localStorage.getItem('ls_chat_seen')||'-1',10); if(seen<0){ localStorage.setItem('ls_chat_seen',String(top)); return 0; }
  return msgs.filter(m=>(m.id||0)>seen&&m.user_id!==me).length; }catch(e){ return 0; } }
setInterval(()=>{ try{
  if(SOC.user&&!SOC.chatOn&&typeof startChat==='function'){ SOC.chatOn=1; startChat(); }
  const el=document.querySelector('[data-bt-cd]');
  if(el){ const ts=+el.getAttribute('data-bt-cd'), left=Math.ceil((ts-btNow())/1000);
    if(left>0) el.textContent='Both locked. Starting in '+left+'s';
    else { el.textContent='Starting…'; BT.cd=BT.cd||{}; if(!BT.cd[ts]){ BT.cd[ts]=1; SOC.sb.rpc('battle_tick').then(()=>{ if(BT.id) btOpen(BT.id); }); } } }
  BT.navN=(BT.navN||0)+1; if(BT.navN%4===0&&typeof navRefresh==='function'&&!(typeof isTypingNow==='function'&&isTypingNow())) navRefresh();
}catch(e){} },1000);


/* ---------- team logo dropdowns, profile pictures ---------- */
const LOGO_LG={nfl:'nfl',nba:'nba',mlb:'mlb'};
function tlogo(sport,t,sz){ sz=sz||30; if(!t) return ''; const lg=LOGO_LG[sport]; const ab=String(t.abbr||'');
  return '<span class="tl" style="width:'+sz+'px;height:'+sz+'px;background:'+esc(t.color||'#3b4a6b')+'"><b>'+esc(ab.slice(0,3))+'</b>'+(lg?'<img class="tlg" alt="" loading="lazy" src="https://a.espncdn.com/i/teamlogos/'+lg+'/500/'+esc(ab.toLowerCase())+'.png" onerror="this.style.display=\'none\'">':'')+'</span>'; }
function tpHtml(f,kind,ts,q,label,other,rnd){
  const sel=ts.find(t=>t.abbr===f[kind])||(kind==='home'?ts[0]:null); const open=f.dd===kind;
  const list=ts.filter(t=>t.abbr!==other&&(!q||(t.name||'').toLowerCase().indexOf(q)>=0||(t.abbr||'').toLowerCase().indexOf(q)>=0));
  return '<div class="tp"><div class="tpl">'+esc(label||'Team')+'</div><button class="tpb" data-act="bt-tdd" data-k="'+kind+'" aria-haspopup="listbox" aria-expanded="'+open+'">'+(sel?tlogo(f.sport||BT.form.sport,sel):(rnd?'🎲 ':''))+'<span class="tpn">'+esc(sel?sel.name:(rnd?'Random (an even matchup)':'Choose your team'))+'</span><span class="tpc" aria-hidden="true">&#9662;</span></button>'+
    (open?'<div class="tpm" role="listbox">'+(rnd?'<button class="tpo'+(!sel?' on':'')+'" role="option" data-act="bt-tsel" data-k="'+kind+'" data-v="">🎲 <span>Random (an even matchup)</span></button>':'')+(list.length?list.map(t=>'<button class="tpo'+(t.abbr===f[kind]?' on':'')+'" role="option" data-act="bt-tsel" data-k="'+kind+'" data-v="'+esc(t.abbr)+'">'+tlogo(f.sport||BT.form.sport,t)+'<span>'+esc(t.name||t.abbr)+(t.props===false?' <i class="muted">(lines only)</i>':'')+'</span></button>').join(''):'<div class="small muted" style="padding:10px">No team matches.</div>')+'</div>':'')+'</div>';
}
document.addEventListener('click',function(e){ if(BT.form&&BT.form.dd&&!(e.target.closest&&e.target.closest('.tp'))){ BT.form.dd=null; btRender(); } },true);

SOC.av=SOC.av||{}; let avQ={}, avT=null, avBusy=false;
uLink=function(name,cls){ const n=String(name||''); return '<span class="ulw"><span class="av" data-n="'+esc(n)+'" aria-hidden="true"><i>'+esc(n.slice(0,1).toUpperCase())+'</i></span><button class="ulink'+(cls?' '+cls:'')+'" data-act="profile" data-u="'+esc(n)+'">'+esc(n)+'</button></span>'; };
function paintAv(){
  document.querySelectorAll('.av[data-n]:not([data-p])').forEach(el=>{
    const n=(el.getAttribute('data-n')||'').toLowerCase(); const v=SOC.av[n];
    if(v===undefined){ avQ[n]=1; el.style.background='hsl('+([...n].reduce((a,c)=>a+c.charCodeAt(0),0)*37%360)+',42%,40%)'; return; }
    el.setAttribute('data-p','1');
    if(v) el.innerHTML='<img alt="" src="'+v+'">'; else el.style.background='hsl('+([...n].reduce((a,c)=>a+c.charCodeAt(0),0)*37%360)+',42%,40%)';
  });
  const names=Object.keys(avQ).filter(n=>SOC.av[n]===undefined).slice(0,50);
  if(!names.length||avBusy||!SOC.sb) return; avBusy=true; avQ={};
  SOC.sb.rpc('get_avatars',{p_names:names}).then(r=>{ avBusy=false; names.forEach(n=>{ SOC.av[n]=''; }); if(!r.error) (r.data||[]).forEach(x=>{ SOC.av[String(x.username).toLowerCase()]=x.avatar||''; }); paintAv(); },()=>{ avBusy=false; names.forEach(n=>{ SOC.av[n]=''; }); });
}
new MutationObserver(()=>{ clearTimeout(avT); avT=setTimeout(paintAv,80); }).observe(document.body,{childList:true,subtree:true});
document.addEventListener('change',function(e){ const t=e.target; if(!t||!t.getAttribute||t.getAttribute('data-in')!=='avfile'||!t.files||!t.files[0]) return;
  const url=URL.createObjectURL(t.files[0]), img=new Image();
  img.onload=()=>{ const c=document.createElement('canvas'); c.width=c.height=96; const g=c.getContext('2d'), m=Math.min(img.width,img.height); g.drawImage(img,(img.width-m)/2,(img.height-m)/2,m,m,0,0,96,96); URL.revokeObjectURL(url);
    const data=c.toDataURL('image/jpeg',0.75);
    SOC.sb.rpc('set_avatar',{p_avatar:data}).then(r=>{ if(r.error){ S.flash=r.error.message; try{ renderBank(); }catch(x){} return; } SOC.av[SOC.me.username.toLowerCase()]=data; document.querySelectorAll('.av[data-p]').forEach(el=>el.removeAttribute('data-p')); paintAv(); }); };
  img.onerror=()=>{ S.flash='That picture could not be read.'; try{ renderBank(); }catch(x){} }; img.src=url; t.value=''; });
if(/[?&]debug=1/.test(location.search)) window.__bt={BT,SOC,S,render:()=>render()};


/* ---------- challenger alert: a pop-up on ANY screen of the app when someone accepts the battle you started ---------- */
BT.alerts={shown:{},last:0};
function btSeenGet(){ try{ return JSON.parse(localStorage.getItem('ls_bt_alerted')||'[]'); }catch(e){ return []; } }
function btSeenAdd(id){ try{ const a=btSeenGet(); if(a.indexOf(id)<0){ a.push(id); localStorage.setItem('ls_bt_alerted',JSON.stringify(a.slice(-60))); } }catch(e){} }
function btPopHide(id){ btSeenAdd(id); delete BT.alerts.shown[id]; const el=document.getElementById('btpop'); if(el&&el.getAttribute('data-id')==String(id)) el.className=''; }
function btPopup(b){
  const T=teamOf(b.sport,b.away), H=teamOf(b.sport,b.home);
  let el=document.getElementById('btpop'); if(!el){ el=document.createElement('div'); el.id='btpop'; el.setAttribute('role','alert'); el.setAttribute('aria-live','assertive'); document.body.appendChild(el); }
  el.setAttribute('data-id',b.id);
  el.innerHTML='<div class="btp-i"><div class="btp-t">⚔️ You have a match!</div><div class="btp-b"><b>'+esc(b.opponent_name||'Someone')+'</b> accepted your '+esc(SPN[b.sport]||b.sport)+' battle and picked <b>'+esc(T.name||b.away||'')+'</b> against your <b>'+esc(H.name||b.home)+'</b>. Build and lock your parlay within 15 minutes.</div>'+
    '<div class="btp-a"><button class="btn solid" data-act="bt-popgo" data-id="'+b.id+'">Go to battle</button><button class="btn" data-act="bt-popx" data-id="'+b.id+'">Later</button></div></div>';
  el.className='on';
  try{ if(navigator.vibrate) navigator.vibrate([120,60,120]); }catch(e){}
  try{ if(typeof sfx==='function') sfx('whistle',0); }catch(e){}
}
function btCheckAlerts(L){
  const me=SOC.user&&SOC.user.id; if(!me||!L||!L.open) return;
  L.open.forEach(b=>{
    if(b.creator!==me||b.status!=='building'||!b.opponent) return;
    if(BT.alerts.shown[b.id]||btSeenGet().indexOf(b.id)>=0) return;
    if(S.view==='battle'&&BT.id===b.id){ btSeenAdd(b.id); return; }       // already looking at it
    BT.alerts.shown[b.id]=1; btPopup(b);
  });
}
function btWatch(){
  if(!SOC.sb||!SOC.user||document.hidden) return;
  const me=SOC.user.id, L=BT.lobby;
  const waiting=!!(L&&L.open&&L.open.some(b=>b.creator===me&&b.status==='open'))||(BT.alerts.until||0)>Date.now();
  if(Date.now()-BT.alerts.last<(waiting?5000:30000)) return;
  if(S.view==='battle'&&!BT.id) return;                                   // the lobby screen already polls and checks
  BT.alerts.last=Date.now();
  SOC.sb.rpc('battle_lobby').then(r=>{ if(r.error||!r.data) return; BT.lobby=r.data; if(r.data.now) BT.skew=Date.parse(r.data.now)-Date.now(); btCheckAlerts(r.data); try{ navRefresh(); }catch(e){} },()=>{});
}
setInterval(btWatch,2500);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ BT.alerts.last=0; setTimeout(btWatch,300); } });


/* the browser only lets sound start after a tap: the first tap on the battle screen unlocks it */
document.addEventListener('click',function(){ try{ if(S.view==='battle'&&SND.on&&!SND.ctx) sndUnlock(); }catch(e){} },true);
