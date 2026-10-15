/* ================= live games on the home board =================
   A game that has kicked off shows its score, clock and situation (the ESPN feed this page polls every few seconds) and FanDuel's CURRENT in-play lines
   (the bot's live pull, stored in data/odds.json with the time it was pulled), never the lines the game had before it started. The pregame lines stay in
   the card's data only so open bets keep settling against them; the early lines are on the calendar (the day before). Lines here are view only: live practice
   bets are made on the Live tab, which prices them from the state of the game. */
const LL={freshMin:15,last:0,sig:{}};
const llNow=()=>Date.now();
/* 'pre' (not started, pregame lines and the SGP builder), 'live', 'started' (the clock says it kicked off but the feed has no score yet), 'final' */
function llState(g){
  const f=FEED[g.id];
  if(f&&f.st){ if(f.st.s==='in') return 'live'; if(f.st.s==='post') return 'final'; return 'pre'; }
  if(gDone(g)) return 'final';
  const t=Date.parse(g.iso||''); return (isFinite(t)&&llNow()>=t+3*60e3)?'started':'pre';
}
const llFd=x=>{ const b=x&&x.books&&x.books.fanduel; return b&&b.odds!=null?b:null; };
function llAgeText(min){ if(min==null) return ''; if(min<1) return 'just now'; if(min<60) return Math.round(min)+' min ago'; return Math.floor(min/60)+' h '+Math.round(min%60)+' min ago'; }
/* FanDuel's current in-play lines for a game, from the odds file: {kind:'ok'|'paused'|'notlive'|'nofeed', rows, ageMin} */
function llLines(g){
  let e=null; try{ e=bkEvent(g); }catch(err){}
  if(!e) return {kind:'nofeed'};
  const O=(window.__LSDATA&&window.__LSDATA.odds)||{};
  const pulled=Date.parse(e.asOf||O.liveAt||O.generatedAt||''); const ageMin=isFinite(pulled)?Math.max(0,(llNow()-pulled)/60000):null;
  if(!e.live) return {kind:'notlive',ageMin:ageMin};
  const M=e.main||{}, ml=M.ml||{}, sp=M.spread||{}, tot=M.total||{};
  const rows={spr:{away:llFd(sp.away),home:llFd(sp.home)},tot:{over:llFd(tot.over),under:llFd(tot.under)},ml:{away:llFd(ml.away),home:llFd(ml.home)}};
  const any=[rows.spr.away,rows.spr.home,rows.tot.over,rows.tot.under,rows.ml.away,rows.ml.home].some(Boolean);
  return {kind:any?'ok':'paused',rows:rows,ageMin:ageMin};
}
const llOdd=(top,sub)=>'<div class="odd ro"><span class="o1">'+esc(top)+'</span><span class="o2 mono">'+esc(sub)+'</span></div>';
function llGrid(g,L){
  const r=L.rows, lgName=(g.key||g.lg)==='mlb'?'Run line':(g.key||g.lg)==='nhl'?'Puck line':'Spread';
  const spr=b=>b?llOdd(b.line!=null?sg(+b.line):'–',fo(b.odds)):llOdd('–','');
  const tt=(b,pre)=>b?llOdd(b.line!=null?pre+b.line:'–',fo(b.odds)):llOdd('–','');
  const mlc=b=>b?llOdd('ML',fo(b.odds)):llOdd('–','');
  const row=(t,side)=>'<div class="orow"><div class="team">'+chipOf(t)+'<div class="tn"><div class="n">'+esc(t.short)+'</div><div class="r">'+(side==='away'?'away':'home')+'</div></div></div>'+
    spr(r.spr[side])+tt(side==='away'?r.tot.over:r.tot.under,side==='away'?'O ':'U ')+mlc(r.ml[side])+'</div>';
  return '<div class="ogrid"><div class="ohead"><span></span><span>'+lgName+'</span><span>Total</span><span>Money</span></div>'+row(g.teams.away,'away')+row(g.teams.home,'home')+'</div>';
}
/* score, clock and what is happening right now */
function llScoreHtml(g){
  const f=FEED[g.id], a=g.teams.away, h=g.teams.home;
  if(!f||!f.st) return '<div class="llscore"><div class="llhead"><span class="liveb"><i class="livedot"></i>IN PROGRESS</span></div><div class="small muted">Waiting for the live score from ESPN…</div></div>';
  const live=f.st.s==='in', fin=f.st.s==='post';
  const det=String(f.st.det||'').trim()||(fin?'Final':'');
  const sit=f.sit||{}; let sline='';
  if(sit.dn||sit.sdn) sline=(sit.poss?esc(sit.poss)+' ball · ':'')+esc(sit.dn||sit.sdn)+(sit.rz?' · <b>red zone</b>':'');
  else if(sit.on){ const run=['1st','2nd','3rd'].filter((x,i)=>sit.on[i]); sline='Count '+(sit.b||0)+'-'+(sit.s||0)+' · '+(sit.o||0)+' out'+((sit.o||0)===1?'':'s')+' · '+(run.length?'runners on '+run.join(', '):'bases empty')+(sit.bat?' · '+esc(sit.bat)+(sit.pit?' vs '+esc(sit.pit):''):''); }
  const lp=(f.plays||[]).slice(-1)[0]; let last=sit.lp||(lp&&lp.tx)||''; if(last.length>150) last=last.slice(0,147)+'...';
  return '<div class="llscore"><div class="llhead">'+(live?'<span class="liveb"><i class="livedot"></i>LIVE</span>':fin?'<span class="badge">Final</span>':'<span class="badge">Not started</span>')+'<span class="llclock">'+esc(det)+'</span></div>'+
    '<div class="llboard"><div class="lltm">'+chipOf(a)+'<b>'+esc(a.abbr)+'</b></div><div class="llpt mono">'+(f.as==null?'–':f.as)+'</div><div class="llsep">–</div><div class="llpt mono">'+(f.hs==null?'–':f.hs)+'</div><div class="lltm r"><b>'+esc(h.abbr)+'</b>'+chipOf(h)+'</div></div>'+
    (sline?'<div class="small llsit">'+sline+'</div>':'')+(last?'<div class="small muted llsit">Last play: '+esc(last)+'</div>':'')+'</div>';
}
/* the inside of the card's lines section for a game that is not pregame */
function llInner(g){
  const st=llState(g), score=llScoreHtml(g);
  if(st==='final') return '<h3>Final <span class="hint">pregame lines are on the calendar</span></h3>'+score+'<div class="small muted">This game is over. Its early lines are on the calendar once the day is over (pick the day in the header). Open slips settle on My bets.</div>';
  const L=llLines(g); let body;
  if(L.kind==='ok'){
    const stale=L.ageMin!=null&&L.ageMin>LL.freshMin;
    body=llGrid(g,L)+'<div class="small llmeta'+(stale?' llstale':'')+'">FanDuel live lines, pulled '+esc(llAgeText(L.ageMin))+(stale?'. Older than usual: the next update is on its way, so the line may have moved.':'. They refresh about every 5 minutes while the game is on.')+'</div>';
  } else if(L.kind==='paused') body='<div class="small llnote">FanDuel has no live line posted for this game right now (the markets are paused). The lines come back by themselves.</div>';
  else if(L.kind==='notlive') body='<div class="small llnote">FanDuel\'s in-play lines are not in yet. They arrive within a few minutes of kickoff'+(L.ageMin!=null?' (last sportsbook pull '+esc(llAgeText(L.ageMin))+')':'')+'. The pregame lines are not shown once a game has started.</div>';
  else body='<div class="small llnote">This game is not in the sportsbook feed, so there are no live FanDuel lines for it.</div>';
  return '<h3>Live lines <span class="hint">'+fdMark()+' · current, view only</span></h3>'+score+body+'<div class="btnrow"><button class="btn solid" data-act="view" data-k="live" data-gid="'+esc(g.id)+'">Watch this game live ›</button></div><div class="small muted">Live practice bets are on the <button class="linkbtn" data-act="view" data-k="live" data-gid="'+esc(g.id)+'">Live tab</button>, priced from the score and clock.</div>';
}
/* the lines section of a game card: pregame games keep the lines grid you can tap into the slip; a game in play gets its score and FanDuel's current lines */
function llLinesSec(g){
  if(llState(g)==='pre') return '<div class="sec"><h3>Lines <span class="hint">'+linesSrcHtml(g)+' · tap to add to slip</span></h3>'+linesTable(g)+'</div>'+(typeof socMarketsHtml==='function'?socMarketsHtml(g):'');
  return '<div class="sec llive" data-ll="'+esc(g.id)+'">'+llInner(g)+'</div>';
}
/* the SGP builder belongs to pregame lines; once the game is on, bets are made on the Live tab */
function llDrawerPart(g,open){
  if(llState(g)==='pre') return '<button class="drawerbtn" data-act="drawer" data-gid="'+g.id+'" aria-expanded="'+open+'"><span>SGP builder</span><span class="mono">'+countSelections(g)+' selections '+(open?'(hide)':'(open)')+'</span></button>'+(open?drawer(g):'');
  return '<button class="drawerbtn" data-act="view" data-k="live" data-gid="'+esc(g.id)+'"><span>Watch &amp; bet this game live</span><span class="mono">Open game ›</span></button>';
}
/* keep the score and live lines fresh in place (no full redraw): every few seconds, only the cards whose text changed */
function llPaint(){
  if(S.view!=='pre'||S.date!==TODAY||typeof G==='undefined') return;
  let redraw=false;
  Object.keys(G).forEach(id=>{ const g=G[id], el=document.getElementById('game-'+id); if(!el||!g||!g.teams) return;
    const st=llState(g), box=el.querySelector('.llive');
    if((st==='pre')===!!box){ redraw=true; return; }              // a game just kicked off (or its feed vanished): the card's shape changes
    if(!box) return;
    const html=llInner(g); if(box.getAttribute('data-h')===html) return;
    box.setAttribute('data-h',html); box.innerHTML=html; });
  if(redraw&&llNow()-LL.last>20e3){ LL.last=llNow(); try{ if(!(typeof isTypingNow==='function'&&isTypingNow())) render(); }catch(e){} }
}
setInterval(function(){ if(!document.hidden) llPaint(); },3000);
