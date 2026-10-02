/* ================= v3: boosts, calendar, reports, boards, chat, nav ================= */
const LEARN=__LEARN__;
const PASTP=__PASTP__;
const TODAY=(LEARN.days.find(d=>d.kind==='today')||{}).date||new Date().toISOString().slice(0,10);
const IC={
  cal:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  home:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  live:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  slip:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  board:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/></svg>',
  chat:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  clip:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8"/></svg>',
  bolt:'<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>'
};
const wd=d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(d+'T12:00:00').getDay()];
const dnum=d=>+d.slice(8);
const mon=d=>['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+d.slice(5,7)-1];
S.date=TODAY; S.calOpen=false; S.boost=null; S.boardTab='top'; S.learnOpen=false; S.chatDraft='';

/* ---------- boosts: real promo types, labeled by the book that runs them ---------- */
const BOOSTS=[
  {id:'dk50',book:'DraftKings',name:'SGP Profit Boost',pct:50,sgp:true,minLegs:3,rule:'3+ leg same-game parlay',src:'Action Network SGP guide'},
  {id:'bet50',book:'bet365',name:'Profit Boost (primetime)',pct:50,sgp:false,minLegs:2,rule:'Parlay on primetime games',src:'CBS Sports promo roundup, Sep 2025'},
  {id:'fan50',book:'Fanatics',name:'SGP Profit Boost (primetime)',pct:50,sgp:true,minLegs:2,rule:'Same-game parlay, primetime',src:'CBS Sports promo roundup, Sep 2025'},
  {id:'fd30',book:'FanDuel',name:'SGP Profit Boost',pct:30,sgp:true,minLegs:2,rule:'Same-game parlay',src:'FanDuel promo page, Sep 2024; Oddschecker, Oct 2025'},
  {id:'czr30',book:'Caesars',name:'Profit Boost',pct:30,sgp:false,minLegs:2,rule:'Listed for golf; practice use on any parlay',src:'rg.org profit-boost listing, Jun 2026'},
  {id:'fd25',book:'FanDuel',name:'SGP Profit Boost (NBA promo)',pct:25,sgp:true,minLegs:2,rule:'Same-game parlay',src:'rg.org parlay listing, Jun 2026'},
  {id:'dk20',book:'DraftKings',name:'Parlay Boost',pct:20,approx:true,sgp:false,minLegs:2,rule:'Parlay, SGP or SGPx; boost % varies by game',src:'CBS Sports promo roundup, Sep 2025'},
  {id:'mgm10',book:'BetMGM',name:'SGP Token / Parlay Boost',pct:10,approx:true,sgp:true,minLegs:2,rule:'Same-game parlay; token size varies',src:'CBS Sports roundup, Sep 2025; rg.org, Jun 2026'}
];
function slipGames(){ return new Set(S.slip.map(l=>l.gid)).size; }
function boostWhy(b){
  const n=S.slip.length;
  if(S.betMode==='single') return 'Not valid on singles';
  if(n<b.minLegs) return 'Needs '+b.minLegs+'+ legs';
  if(b.sgp&&slipGames()>1) return 'Needs all legs in one game';
  return '';
}
function dkLeg(l){ const p=String(l.id||'').split(':'); if(p[0]!=='g') return ''; const g=G[p[1]]; return (g&&g.lines&&g.lines.dk&&g.lines.dk[p[2]]&&g.lines.dk[p[2]][p[3]])||''; }
function activeBoost(){ const b=BOOSTS.find(x=>x.id===S.boost); if(!b) return null; return boostWhy(b)?null:b; }
function boostedDec(dec,b){ return b?1+(dec-1)*(1+b.pct/100):dec; }
function boostHtml(compact){
  if(!S.slip.length) return '';
  const act=activeBoost();
  const ord=b=>(act&&act.id===b.id)?0:(boostWhy(b)?2:1);
  const items=BOOSTS.map((b,i)=>[b,i]).sort((x,y)=>ord(x[0])-ord(y[0])||x[1]-y[1]).map(x=>x[0]).map(b=>{
    const why=boostWhy(b); const on=act&&act.id===b.id;
    return '<button class="boostc'+(on?' on':'')+'" data-act="boost" data-id="'+b.id+'"'+(why?' disabled':'')+' aria-pressed="'+!!on+'"><span class="bpc">+'+b.pct+'%</span><span class="bnm"><b>'+esc(b.book)+'</b> '+esc(b.name)+'</span><span class="bwh">'+(why?esc(why):on?'Added to slip':'Tap to add')+(b.approx?' · % varies':'')+'</span></button>';
  }).join('');
  return '<div class="booststrip"><div class="bhead">'+IC.bolt+' Boosts <span>'+(act?'+'+act.pct+'% on winnings from '+esc(act.book):'tap one to add it to this slip')+'</span></div><div class="boostrow">'+items+'</div>'+
    (compact?'':'<div class="slipnote">These are boost types sportsbooks have advertised (sources in the page footer). Real boosts change daily, need an account in an eligible state and often have caps. Here a boost raises the winnings (not the stake) in practice mode.</div>')+'</div>';
}

/* ---------- accounts, boards, chat (db) ---------- */
const social={db:null,me:null,id:null,boardSnap:[],chat:[],unsubB:null,unsubC:null,lastBoard:0,err:'',canWrite:null};
async function initSocial(db,user){
  social.db=db; subLive(db);
  try{ social.me=await user.me(); social.id=social.me&&social.me.id||null; }catch(e){}
  try{ social.canWrite=await user.can('data.write'); }catch(e){}
  if(!P.nick&&social.me&&social.me.name) P.nick=String(social.me.name).split(' ')[0].slice(0,18);
  if(S.view==='board') subBoard(); if(S.view==='chat') subChat();
  syncBoardSoon(true);
}
function myStats(){
  const pend=P.bets.filter(b=>b.status==='pending'); const atStake=pend.reduce((s,b)=>s+b.stake,0);
  const won=P.bets.filter(b=>b.status==='won'), lost=P.bets.filter(b=>b.status==='lost');
  const slipObj=b=>({stake:b.stake,payout:b.payout,odds:amerOfDec(decOfLegs(b.legs.map(l=>({price:l.price,res:l.res})))),boost:b.boost?b.boost.book+' +'+b.boost.pct+'%':null,t:b.t,legs:b.legs.slice(0,8).map(l=>({l:l.label,p:l.price,g:G[l.gid]?G[l.gid].teams.away.abbr+'@'+G[l.gid].teams.home.abbr:''}))});
  const best=won.slice().sort((a,b)=>(b.payout-b.stake)-(a.payout-a.stake)).slice(0,3).map(slipObj);
  const worst=lost.slice().sort((a,b)=>b.stake-a.stake).slice(0,3).map(slipObj);
  return {net:r2(P.bank+atStake-P.start),bank:r2(P.bank),start:r2(P.start),wins:won.length,losses:lost.length,open:pend.length,best:best,worst:worst};
}
let boardT=null;
function syncBoardSoon(now){
  if(!social.db||!social.id||!P.boardOn) return;
  clearTimeout(boardT); boardT=setTimeout(syncBoard,now?200:2500);
}
function syncBoard(){
  if(!social.db||!social.id||!P.boardOn) return;
  const wait=10000-(Date.now()-social.lastBoard); if(wait>0){ clearTimeout(boardT); boardT=setTimeout(syncBoard,wait); return; }
    social.lastBoard=Date.now(); const st=myStats(); const doc=Object.assign({name:(P.nick||'Player').slice(0,18)},st); const sig=JSON.stringify(doc); if(sig===social.sig){ return; } social.sig=sig; doc.t=Date.now();
  try{ social.db.collection('board').doc(social.id).set(doc).catch(e=>{ social.sig=null; social.err='Could not post to the boards: '+((e&&e.message)||'not allowed')+'. You may need Contributor access.'; if(S.view==='board') renderBoardBody(); }); }catch(e){}
}
function removeFromBoard(){ social.sig=null; if(social.db&&social.id){ try{ social.db.collection('board').doc(social.id).delete().catch(()=>{}); }catch(e){} } }
function subBoard(){
  if(!social.db||social.unsubB) return;
  try{ social.unsubB=social.db.collection('board').orderBy('net','desc').limit(200).onSnapshot(snap=>{ social.boardSnap=snap.docs.map(d=>Object.assign({id:d.id},d.data())); if(S.view==='board') renderBoardBody(); },e=>{ social.err='Boards unavailable: '+((e&&e.message)||''); if(S.view==='board') renderBoardBody(); }); }catch(e){}
}
function subChat(){
  if(!social.db||social.unsubC||!P.chatOn) return;
  try{ social.unsubC=social.db.collection('chat').orderBy('t','desc').limit(80).onSnapshot(snap=>{ social.chat=snap.docs.map(d=>Object.assign({id:d.id},d.data())).reverse(); if(S.view==='chat') renderChatBody(true); },e=>{ social.err='Chat unavailable: '+((e&&e.message)||''); if(S.view==='chat') renderChatBody(); }); }catch(e){}
}
const okImg=s=>typeof s==='string'&&/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(s)&&s.length<260000;
function boardRow(r,i,losers){
  const pos=r.net>=0; const mine=r.id===social.id;
  const slips=(losers?r.worst:r.best)||[];
  const slipHtml2=slips.length?slips.map(s=>'<div class="bs"><div class="small mono">'+(losers?'Lost '+money(s.stake):'Won '+money(s.payout-s.stake)+' on '+money(s.stake))+' · '+fo(s.odds)+(s.boost?' · boost '+esc(s.boost):'')+'</div>'+(s.legs||[]).map(l=>'<div class="small">'+esc(l.l)+' <span class="mono muted">'+fo(l.p)+'</span> <span class="muted">'+esc(l.g)+'</span></div>').join('')+'</div>').join(''):'<div class="small muted">No '+(losers?'losing':'winning')+' slips to show yet.</div>';
  return '<details class="brow'+(mine?' me':'')+'"><summary><span class="rk">'+(i+1)+'</span><span class="nm">'+esc(r.name||'Player')+(mine?' (you)':'')+'</span><span class="mono pf '+(pos?'g':'r')+'">'+(pos?'+':'−')+money(Math.abs(r.net))+'</span></summary><div class="bd"><div class="small muted">Bank '+money(r.bank)+' · started '+money(r.start)+' · '+r.wins+' won, '+r.losses+' lost, '+(r.open||0)+' open</div><h4 class="sub">'+(losers?'Biggest losing slips':'Winning slips')+'</h4>'+slipHtml2+'</div></details>';
}
function boardBodyHtml(){
  if(!social.db) return '<div class="small muted">Sign in to claude.ai to join the boards. Boards need the page\'s shared database, which is not available in this view, so only your own numbers exist here.</div>'+selfCard();
  const rows=social.boardSnap.filter(r=>typeof r.net==='number');
  const top=rows.filter(r=>r.net>0).sort((a,b)=>b.net-a.net).slice(0,10);
  const bot=rows.filter(r=>r.net<0).sort((a,b)=>a.net-b.net).slice(0,10);
  const list=S.boardTab==='top'?top:bot;
  return (social.err?'<div class="flash">'+esc(social.err)+'</div>':'')+
    (S.boardTab==='top'?'<h3 class="bt3">Top 10 gains <span class="hint">profit on practice money</span></h3>':'<h3 class="bt3">Top 10 losers <span class="hint">biggest practice losses</span></h3>')+
    (list.length?list.map((r,i)=>boardRow(r,i,S.boardTab!=='top')).join(''):'<div class="small muted">'+(S.boardTab==='top'?'Nobody is on the board yet. Turn on "Join the boards" below and place a practice bet.':'No losers yet. Losses show up here once players are in the red.')+'</div>')+
    '<div class="small muted">Practice results are reported by each player\'s own page, so this board is for fun. '+rows.length+' player'+(rows.length===1?'':'s')+' listed.</div>'+selfCard();
}
function selfCard(){
  const st=myStats(); const sign=social.me&&social.me.id;
  return '<div class="selfcard"><h4 class="sub">Your account</h4>'+
    '<div class="small">'+(sign?'Signed in as <b>'+esc(social.me.name||'your claude.ai account')+'</b>. Your bank and slips are saved to this account.':'Not signed in here, so your bank and slips are saved on this device only.')+' This page uses your claude.ai sign-in; it cannot run its own email-and-password login.</div>'+
    '<label class="fld">Board nickname <input class="num wide" data-in="nick" maxlength="18" value="'+esc(P.nick||'')+'" placeholder="Nickname" aria-label="Board nickname"></label>'+
    '<label class="tog"><input type="checkbox" data-in="boardOn"'+(P.boardOn?' checked':'')+(social.db?'':' disabled')+'> Join the boards (shows your nickname, profit and best slips)</label>'+
    '<label class="tog"><input type="checkbox" data-in="chatOn"'+(P.chatOn?' checked':'')+'> Turn on chat (optional)</label>'+
    '<div class="small muted">Your profit: '+(st.net>=0?'+':'−')+money(Math.abs(st.net))+' · '+st.wins+' won · '+st.losses+' lost · '+st.open+' open</div></div>';
}
function boardView(){
  return '<section class="game"><div class="sec"><div class="seg" role="group" aria-label="Board"><button data-act="boardtab" data-t="top" aria-pressed="'+(S.boardTab==='top')+'">Top 10 gains</button><button data-act="boardtab" data-t="bot" aria-pressed="'+(S.boardTab==='bot')+'">Top 10 losers</button></div><div id="board-body">'+boardBodyHtml()+'</div></div></section>';
}
function renderBoardBody(){ const el=document.getElementById('board-body'); if(el&&!isTyping()) el.innerHTML=boardBodyHtml(); }
function isTyping(){ const a=document.activeElement; return a&&a.tagName==='INPUT'&&a.type!=='checkbox'; }

function fmtClock(t){ return new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
function chatBodyHtml(){
  if(!P.chatOn) return '<div class="small muted">Chat is off. It is optional: turn it on to talk with everyone who has this page open. Messages are shared with all of them.</div><button class="btn pri" data-act="chat-on">Turn on chat</button>';
  if(!social.db) return '<div class="small muted">Chat needs the shared database, which is not available in this view. Sign in to claude.ai and open the page from your account.</div>';
  const msgs=social.chat.map(m=>{
    const mine=m.uid===social.id; const img=okImg(m.img)?'<img class="cimg" alt="Shared picture" src="'+m.img+'">':'';
    return '<div class="msg'+(mine?' mine':'')+'"><div class="mh"><b>'+esc(m.name||'Player')+'</b><span class="muted">'+esc(fmtClock(m.t||0))+'</span>'+(mine?'<button class="linkbtn" data-act="chat-del" data-id="'+esc(m.id)+'">Delete</button>':'')+'</div>'+(m.text?'<div class="mt">'+esc(m.text)+'</div>':'')+img+'</div>';
  }).join('');
  return (social.err?'<div class="flash">'+esc(social.err)+'</div>':'')+'<div class="chatbox" id="chatbox">'+(msgs||'<div class="small muted">No messages yet. Say hi.</div>')+'</div>'+
    '<div class="composer"><label class="attach" title="Attach a picture or GIF">'+IC.clip+'<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-in="chatfile" hidden></label><input class="num wide" id="chatin" data-in="chattext" maxlength="500" placeholder="Message" aria-label="Message" value="'+esc(S.chatDraft)+'"><button class="btn pri" data-act="chat-send">Send</button></div>'+
    '<div class="small muted" id="chatnote">Pictures are shrunk to fit. GIFs must be under about 140 KB (a GIF search can\'t run inside this page, so upload a file). Everyone with the page can read this chat.</div>';
}
function chatView(){ return '<section class="game"><div class="sec"><h3>Chat <span class="hint">optional</span></h3><div id="chat-body">'+chatBodyHtml()+'</div></div></section>'; }
function renderChatBody(scroll){ const el=document.getElementById('chat-body'); if(!el) return; if(isTyping()&&!scroll){ return; } const keep=S.chatDraft; el.innerHTML=chatBodyHtml(); const inp=document.getElementById('chatin'); if(inp) inp.value=keep; const bx=document.getElementById('chatbox'); if(bx&&scroll) bx.scrollTop=bx.scrollHeight; }
function fileToDataUri(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('Could not read that file.')); r.readAsDataURL(f); }); }
async function prepImage(f){
  if(f.type==='image/gif'){ if(f.size>140*1024) throw new Error('That GIF is '+Math.round(f.size/1024)+' KB. The limit is about 140 KB.'); return await fileToDataUri(f); }
  const src=await fileToDataUri(f);
  const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('Could not open that picture.')); i.src=src; });
  let max=640, q=0.72, out='';
  for(let k=0;k<6;k++){
    const sc=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.width*sc)); c.height=Math.max(1,Math.round(img.height*sc));
    const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height);
    out=c.toDataURL('image/jpeg',q); if(out.length<190000) return out; max*=0.8; q=Math.max(0.5,q-0.06);
  }
  throw new Error('That picture is too large even after shrinking.');
}
async function sendChat(img){
  const text=(S.chatDraft||'').trim().slice(0,500); if(!text&&!img) return;
  if(!social.db||!social.id){ social.err='Sign in to chat.'; renderChatBody(); return; }
  try{
    const doc={uid:social.id,name:(P.nick||'Player').slice(0,18),text:text,t:Date.now()}; if(img) doc.img=img;
    await social.db.collection('chat').add(doc); S.chatDraft=''; social.err='';
    const inp=document.getElementById('chatin'); if(inp) inp.value='';
  }catch(e){ social.err='Could not send: '+((e&&e.message)||'not allowed')+'. Sending needs Contributor access.'; renderChatBody(); }
}

/* ---------- calendar ---------- */
function calHtml(){
  const cells=LEARN.days.map(d=>{
    const sel=d.date===S.date; const tag=d.kind==='today'?'Today':'';
    return '<button class="dcell'+(sel?' sel':'')+(d.kind==='today'?' tod':'')+'" data-act="date" data-d="'+d.date+'"'+(d.ok?'':' disabled')+' aria-pressed="'+sel+'" aria-label="'+esc(wd(d.date)+' '+mon(d.date)+' '+dnum(d.date)+(d.ok?', '+d.n+(d.n===1?' game':' games'):', no data'))+'">'+(d.kind==='today'&&anyLive()?'<i class="livedot"></i>':'')+(callCount(d.date)?'<i class="cdot" title="Tracked picks"></i>':'')+'<span class="w">'+wd(d.date)+'</span><span class="n">'+dnum(d.date)+'</span><span class="c">'+(d.ok?(d.kind==='past'?d.n+' final':d.n+(d.n===1?' game':' games')):'none')+'</span></button>';
  }).join('');
  return '<div class="cal"><div class="calhead"><b>Pick a day</b><span class="muted small">7 days back, 4 ahead. Greyed days have no data.</span></div><div class="dgrid">'+cells+'</div></div>';
}


/* ---------- player SGP recap (past days) ---------- */
const SGPT={
  nfl:[['py','pass yds',[200,250,300],1],['ry','rush yds',[50,75,100],1.1],['ly','rec yds',[50,75,100],1.1],['rec','rec',[4,6,8],0.9]],
  wnba:[['pts','pts',[10,15,20,25],1],['reb','reb',[5,7,9],1.1],['ast','ast',[4,6,8],1.1],['fg3','3PM',[2,3,4],1.2]],
  mlb:[['h','hits',[1,2,3],1],['rbi','RBI',[1,2,3],1.1],['hr','HR',[1],2.5],['r','runs',[1,2],0.8],['k','K',[5,7,9],1.1]]
};
function sgpLegs(g){
  const rows=PASTP[g.id]; if(!rows||!rows.length) return null;
  const best={};
  rows.forEach(p=>{
    (SGPT[g.lg]||[]).forEach(([k,lab,tiers,w])=>{
      const v=p[k]; if(v==null) return; let idx=-1; tiers.forEach((t,i)=>{ if(v>=t) idx=i; }); if(idx<0) return;
      if(g.lg==='mlb'&&k==='k'&&p.outs!=null&&p.outs<9) return;
      const sc=(idx+1)*w+(tiers.length>1?idx*0.25:0);
      const o=best[p.i]; if(!o||sc>o.sc) best[p.i]={sc,p,txt:tiers[idx]+'+ '+lab,had:v,k};
    });
    if(g.lg==='nfl'){ const td=(p.rtd||0)+(p.ltd||0); if(td>=1){ const sc=2.2; const o=best[p.i]; if(!o||sc>o.sc) best[p.i]={sc,p,txt:'anytime TD',had:td+' TD',k:'td'}; } }
  });
  const list=Object.keys(best).map(k=>best[k]).sort((a,b)=>b.sc-a.sc);
  if(list.length<2) return null;
  return {legs:list.slice(0,4),more:list.slice(4,7)};
}
function sgpRecapHtml(g){
  const r=sgpLegs(g); if(!r) return '';
  const chip=o=>'<span class="vc ok" title="Had '+esc(String(o.had))+'">✓ '+esc(o.p.n)+' '+esc(o.txt)+' <span class="muted">('+esc(String(o.had))+')</span></span>';
  return '<div class="sgpr"><div class="small"><b>Player SGP that hit</b> <span class="muted">'+r.legs.length+' legs, '+esc(g.away)+' @ '+esc(g.home)+'</span></div><div class="vcs">'+r.legs.map(chip).join('')+'</div>'+
    (r.more.length?'<div class="small muted">Also cleared: '+r.more.map(o=>esc(o.p.n)+' '+esc(o.txt)).join(' · ')+'</div>':'')+'</div>';
}

/* ---------- reports (past days) ---------- */
const LN_DEF={nfl:32,wnba:15,mlb:30};
const lnOf=lg=>((LEARN.leagues[lg]||{}).nTeams)||LN_DEF[lg]||30;
const LGN={nfl:'NFL',wnba:'WNBA',mlb:'MLB',nba:'NBA',cfb:'College football',cbb:'College basketball'};
const LGT=[['all','All'],['nfl','NFL'],['cfb','CFB'],['nba','NBA'],['cbb','CBB'],['wnba','WNBA'],['mlb','MLB']];
const keyOf=g=>g.key||g.lg;
function fmtLine(x){ return x==null?'n/a':(x>0?'+'+x:String(x)); }
function chipOk(label,ok,tip){ const cls=ok===true?'ok':ok===false?'bad':''; return '<span class="vc '+cls+'" title="'+esc(tip||'')+'">'+(ok===true?'✓ ':ok===false?'✗ ':'– ')+esc(label)+'</span>'; }
function dayTally(games){
  const t={ml:[0,0],spr:[0,0],tot:[0,0],mll:[0,0],close:[0,0],ups:[0,0],upf:[0,0]};
  games.forEach(g=>{
    const v=g.v; t.ml[1]++; if(v.ml.ok) t.ml[0]++;
    if(v.spr&&v.spr.ok!==null){ t.spr[1]++; if(v.spr.ok) t.spr[0]++; }
    if(v.tot&&v.tot.ok!==null){ t.tot[1]++; if(v.tot.ok) t.tot[0]++; }
    if(v.mlLean){ t.mll[1]++; if(v.mlLean.ok) t.mll[0]++; }
    if(v.close.called){ t.close[1]++; if(v.close.actual) t.close[0]++; }
    const homeFav=g.pH>=0.5; const underWon=homeFav?(g.hs<g.as_):(g.hs>g.as_);
    if(underWon){ t.ups[0]++; if(Math.min(g.pH,1-g.pH)>=0.35) t.upf[0]++; }
    t.ups[1]++;
  });
  return t;
}
function tallyHtml(t){
  const row=(lab,a)=>'<div class="kv"><div class="k">'+lab+'</div><div class="v">'+a[0]+'/'+a[1]+'</div></div>';
  return '<div class="proj">'+row('Winner picks',t.ml)+(t.spr[1]?row('Spread leans',t.spr):'')+(t.tot[1]?row('Total leans',t.tot):'')+(t.mll[1]?row('ML leans',t.mll):'')+(t.close[1]?row('Close-game calls',t.close):'')+
    '<div class="kv"><div class="k">Upsets</div><div class="v">'+t.ups[0]+' of '+t.ups[1]+'</div><div class="s">flagged ahead (35%+): '+t.upf[0]+'</div></div></div>';
}
function reportGame(g){
  const hn=g.home, an=g.away; const win=g.hs>g.as_?hn:an; const margin=Math.abs(g.hs-g.as_);
  const v=g.v; const N=lnOf(g.lg); const chips=[];
  chips.push(chipOk('Pick '+v.ml.pick+' '+Math.round(v.ml.p*100)+'%',v.ml.ok,'Moneyline pick from the blended win chance'));
  if(v.spr) chips.push(chipOk('Spread lean '+v.spr.pick+' '+fmtLine(v.spr.line),v.spr.ok,'Model margin differed from the closing line by '+v.spr.gap));
  if(v.tot) chips.push(chipOk('Total lean '+v.tot.pick+' '+v.tot.line,v.tot.ok,'Model total differed from the line by '+v.tot.gap));
  if(v.mlLean) chips.push(chipOk('ML lean '+v.mlLean.pick,v.mlLean.ok,'Model chance beat the book by '+Math.round(v.mlLean.gap*100)+' points'));
  if(v.close.called) chips.push(chipOk('Called close',v.close.actual,'Final margin '+v.close.margin));
  const homeFav=g.pH>=0.5, underWon=homeFav?(g.hs<g.as_):(g.hs>g.as_), pu=Math.min(g.pH,1-g.pH);
  if(underWon) chips.push(chipOk('Upset '+Math.round(pu*100)+'% chance',pu>=0.35,'Underdog won. Flagged ahead of time when the chance was 35% or more.'));
  const rk=g.rk||{}; const hr=rk.home, ar=rk.away;
  const why=(hr&&ar)?'As of that day: '+an+' offense #'+ar[0]+'/'+N+', defense #'+ar[1]+'. '+hn+' offense #'+hr[0]+', defense #'+hr[1]+'. '+(g.mt?'Model total '+g.ft+(g.book&&g.book.total?' (book '+g.book.total+')':'')+', actual '+(g.hs+g.as_)+'.':''):'';
  return '<div class="rg"><div class="rgh"><b>'+esc(an)+' @ '+esc(hn)+'</b><span class="mono">'+g.as_+'–'+g.hs+'</span><span class="badge">'+g.lg.toUpperCase()+'</span></div>'+
    '<div class="small muted">Model: '+esc(hn)+' '+sg(-g.fm)+' · '+Math.round(g.pH*100)+'% '+esc(hn)+(g.book?' · book '+(g.book.spr!=null?esc(hn)+' '+fmtLine(g.book.spr)+', ':'')+(g.book.total?'O/U '+g.book.total:''):'')+' · result: '+esc(win)+' by '+margin+'</div>'+
    '<div class="vcs">'+chips.join('')+'</div>'+(why?'<div class="small muted">'+esc(why)+'</div>':'')+sgpRecapHtml(g)+'</div>';
}
function leagueOK(lg){ return S.league==='all'||S.league===lg; }
function reportView(date){
  const games=(LEARN.window[date]||[]).filter(g=>leagueOK(g.lg)).sort((a,b)=>a.lg.localeCompare(b.lg));
  const all=[].concat.apply([],Object.keys(LEARN.window).map(k=>LEARN.window[k])).filter(g=>leagueOK(g.lg));
  const t=dayTally(games), tw=dayTally(all);
  return '<section class="game"><div class="sec"><h3>'+wd(date)+' '+mon(date)+' '+dnum(date)+' · what worked <span class="hint">'+games.length+' final'+(games.length===1?'':'s')+'</span></h3>'+
    (games.length?tallyHtml(t)+'<div class="small muted">Predictions use only what was known before each game. Leans compare the model with the closing line. A ✓ means the lean beat that line. Player SGPs use standard cutoffs (like 250+ passing yards or 20+ points), not that day\'s book lines, which were not saved.</div>':'<div class="small muted">No games in this league on that day.</div>')+
    '</div></section>'+
    callsDayHtml(date)+
    (games.length?'<section class="game"><div class="sec"><h3>Game by game</h3>'+games.map(reportGame).join('')+'</div></section>':'')+
    '<section class="game"><div class="sec"><h3>Last 7 days together <span class="hint">'+all.length+' games</span></h3>'+tallyHtml(tw)+'</div></section>'+callsSummaryHtml()+selfCheckHtml()+learnPanel();
}
function liveRecordHtml(){
  /* the bot's own graded record: every pre-game prediction it logs is graded when the final arrives, and the win-chance scale is nudged (never more than 15%) by how those did */
  const lv=LEARN.live; if(!lv||!lv.n) return '<div class="small muted">Bot self-check: it logs its numbers before kickoff and grades them at the final. No graded games yet; the first ones arrive after the next finals.</div>';
  const pc=x=>x==null?'n/a':Math.round(x*100)+'%';
  const per=Object.keys(LEARN.leagues).filter(leagueOK).map(k=>{ const v=LEARN.leagues[k].live; return v&&v.n?'<span class="mono">'+LGN[k]+' '+v.n+' · '+pc(v.accML)+' vs book '+pc(v.accBook)+'</span>':''; }).filter(Boolean).join(' · ');
  return '<div class="small muted"><b>Bot self-check (live, graded after each final):</b> '+lv.n+' games · winner picks '+pc(lv.accML)+', book '+pc(lv.accBook)+(lv.maeM!=null?' · margin error '+n1(lv.maeM)+' vs book '+n1(lv.maeBookM):'')+'. '+per+'</div>';
}
function learnPanel(){
  const L=LEARN.leagues; const nm=LGN;
  const pc=x=>x==null?'n/a':Math.round(x*100)+'%';
  const rows=Object.keys(L).filter(leagueOK).map(lg=>{
    const x=L[lg], s=x.summary, ln=x.leans||{};
    const lean=(k,lab)=>ln[k]?lab+' '+ln[k].hit+'/'+ln[k].n+' ('+Math.round(100*ln[k].hit/ln[k].n)+'%)'+(ln[k].n>=50&&ln[k].hit/ln[k].n<0.52?' · paused':''):'';
    const leans=[lean('spread','Spread'),lean('total','Total'),lean('mlLean','ML')].filter(Boolean).join(' · ');
    const mon_=(x.monthly||[]).map(m=>'<span class="mo" title="'+m.m+': '+m.n+' games"><i style="height:'+Math.round(m.acc*100)+'%"></i><b>'+m.m.slice(5)+'</b></span>').join('');
    return '<div class="lrow"><div class="lh"><b>'+nm[lg]+'</b><span class="muted small">'+x.n+' games learned from</span></div>'+
      '<div class="proj"><div class="kv"><div class="k">Picks winners</div><div class="v">'+pc(s.accFinal)+'</div><div class="s">book alone '+pc(s.accBook)+(s.n?' · '+s.n+' games':'')+'</div></div>'+
      '<div class="kv"><div class="k">Margin error</div><div class="v">'+(s.maeFinalM!=null?n1(s.maeFinalM):'n/a')+'</div><div class="s">book '+(s.maeBookM!=null?n1(s.maeBookM):'n/a')+'</div></div>'+
      '<div class="kv"><div class="k">Total error</div><div class="v">'+(s.maeFinalT!=null?n1(s.maeFinalT):'n/a')+'</div><div class="s">book '+(s.maeBookT!=null?n1(s.maeBookT):'n/a')+'</div></div></div>'+
      '<div class="small muted">Weight on the model vs the book: margin '+(x.blend.m==null?'n/a':Math.round(x.blend.m*100)+'%')+', total '+(x.blend.t==null?'n/a':Math.round(x.blend.t*100)+'%')+', win chance '+(x.blend.p==null?'n/a':Math.round(x.blend.p*100)+'%')+' (fitted on past games, never below 15%). Tuning changed the squared error from '+x.mse0+' to '+x.mse1+'.</div>'+
      (leans?'<div class="small muted">Lean record vs the closing line: '+esc(leans)+'. Lean types under 52% over 50+ games are switched off.</div>':'')+
      (mon_?'<div class="mos" role="img" aria-label="Winner-pick accuracy by month">'+mon_+'</div>':'')+'</div>';
  }).join('');
  const open=S.learnOpen;
  return '<section class="game"><div class="sec"><h3>How the model learns <button class="linkbtn" data-act="learn">'+(open?'Hide':'Show')+'</button></h3>'+(open?
    '<div class="small muted">Every game updates each team\'s offense and defense ratings, one game at a time, and the settings (learning rate, home edge, off-season carry-over) are re-tuned on past results. Then the model is blended with the closing line using weights fitted on past games. Today\'s lines are anchored the same way, with injuries added on top.</div>'+rows+
    liveRecordHtml()+
    '<div class="small muted">What it can and cannot do: the model is rated against the closing line over past games, and it does not call upsets reliably; the book was about as accurate as the model across the season. The honest goal is calibrated chances, not certainty.</div>'
    :'<div class="small muted">Accuracy against the closing line, lean records, and how much weight the model gets.</div>')+'</div></section>';
}

/* ---------- previews (future days) ---------- */
function previewGame(g){
  const b=g.book||{}; const N=lnOf(g.lg); const t=new Date(g.date); const tm=t.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})+' ET';
  const hn=(g.names&&g.names.home)||g.home, an=(g.names&&g.names.away)||g.away; const ph=Math.round(g.pH*100);
  if(g.tbd) return '<div class="rg"><div class="rgh"><b>'+esc(g.away)+' @ '+esc(g.home)+'</b><span class="muted small">'+esc(tm)+'</span></div><div class="small muted">Teams not set yet.</div></div>';
  return '<div class="rg"><div class="rgh"><b>'+esc(an)+' @ '+esc(hn)+'</b><span class="muted small">'+esc(tm)+'</span><span class="badge">'+g.lg.toUpperCase()+'</span></div>'+
    '<div class="odds3"><div><span class="k">Book</span><span class="mono">'+(b.spr!=null?esc(g.home)+' '+fmtLine(b.spr):(b.mlH!=null?esc(g.home)+' '+fo(b.mlH):'n/a'))+'</span></div><div><span class="k">Total</span><span class="mono">'+(b.total||'n/a')+'</span></div><div><span class="k">Model</span><span class="mono">'+esc(g.home)+' '+ph+'%</span></div><div><span class="k">Proj. total</span><span class="mono">'+g.ft+'</span></div></div>'+
    (g.ctx?previewCtx(g):'')+
    (g.rk&&g.rk.home&&g.rk.away?'<div class="small muted">Learned ratings: '+esc(g.away)+' offense #'+g.rk.away[0]+'/'+N+', defense #'+g.rk.away[1]+' · '+esc(g.home)+' offense #'+g.rk.home[0]+', defense #'+g.rk.home[1]+'. Injuries are not applied until game day.</div>':'')+'</div>';
}
function previewView(date){
  const games=((LEARN.sched||{})[date]||[]).filter(g=>leagueOK(g.lg)).sort((a,b)=>a.date.localeCompare(b.date));
  return '<section class="game"><div class="sec"><h3>'+wd(date)+' '+mon(date)+' '+dnum(date)+' · preview <span class="hint">'+games.length+' game'+(games.length===1?'':'s')+'</span></h3>'+
    '<div class="small muted">Early look from the learned model and the current book lines. Player props, injury adjustments and the SGP builder open on game day.</div>'+(games.length?games.map(previewGame).join(''):'<div class="small muted">No games listed for this league.</div>')+'</div></section>';
}

/* ---------- shell ---------- */
function oddsGrid(g){
  const L=g.lines,a=g.teams.away,h=g.teams.home; const lgName=g.lg==='mlb'?'Run line':'Spread';
  const btn=(tok,top,sub)=>{ const on=inSlip(tok); return '<button class="odd'+(on?' on':'')+'" data-act="leg" data-tok="'+esc(tok)+'" aria-pressed="'+on+'"><span class="o1">'+esc(top)+'</span><span class="o2 mono">'+esc(sub)+'</span></button>'; };
  const row=(t,side)=>{
    const sp=side==='home'?L.sprHome:L.sprAway, pr=side==='home'?L.prHome:L.prAway, ml=side==='home'?L.mlHome:L.mlAway;
    const tot=side==='away'?'O '+L.total:'U '+L.total, tp=side==='away'?L.over:L.under;
    return '<div class="orow"><div class="team">'+chipOf(t)+'<div class="tn"><div class="n">'+esc(t.short)+'</div><div class="r">'+esc(t.record)+(side==='away'?' · away':' · home')+'</div></div></div>'+
      btn('g:'+g.id+':spr:'+side,sg(sp),fo(pr))+btn('g:'+g.id+':tot:'+(side==='away'?'over':'under'),tot,fo(tp))+btn('g:'+g.id+':ml:'+side,'ML',fo(ml))+'</div>';
  };
  return '<div class="ogrid"><div class="ohead"><span></span><span>'+lgName+'</span><span>Total</span><span>Money</span></div>'+row(a,'away')+row(h,'home')+'</div>';
}
function linesTable(g){ return oddsGrid(g); }
function learnedBox(g){
  const ln=g.crossroads.learn; if(!ln) return '';
  const h=g.teams.home.abbr,a=g.teams.away.abbr; const N=g.n||lnOf(keyOf(g));
  const hs=ln.leanStats||{}; const bits=[]; if(hs.spread) bits.push('spread '+hs.spread.hit+'/'+hs.spread.n); if(hs.total) bits.push('total '+hs.total.hit+'/'+hs.total.n);
  return '<details class="d lbox"><summary>Learned model vs the book ('+ln.n+' games of training)</summary><ul>'+
    '<li>Raw model margin '+esc(h)+' '+sg(-ln.baseMargin)+' from learned ratings, '+sg(-ln.injMargin)+' for injuries and context = '+sg(-ln.rawMargin)+'. Book '+sg(-ln.bookMargin)+'.</li>'+
    '<li>Blend: '+Math.round(ln.w.m*100)+'% model for margin, '+Math.round(ln.w.t*100)+'% for total, '+Math.round(ln.w.p*100)+'% for win chance, the rest the book. Weights come from past results.</li>'+
    '<li>Learned ratings: '+esc(a)+' offense #'+ln.rk.away[0]+'/'+N+', defense #'+ln.rk.away[1]+' · '+esc(h)+' offense #'+ln.rk.home[0]+', defense #'+ln.rk.home[1]+'.</li>'+
    (bits.length?'<li>Past lean record vs the line: '+bits.join(', ')+'. Types under 52% are not shown as leans.</li>':'')+'</ul></details>';
}
function navHtml(){
  const pend=P.bets.filter(b=>b.status==='pending').length;
  const it=(k,ic,l,badge,dot)=>'<button class="nv" data-act="view" data-k="'+k+'" aria-pressed="'+(S.view===k)+'">'+IC[ic]+'<span>'+l+'</span>'+(badge?'<i class="nb">'+badge+'</i>':'')+(dot?'<i class="livedot" title="A game is live"></i>':'')+'</button>';
  return it('pre','home','Games')+it('live','live','Live',null,anyLive())+it('slips','slip','My bets',pend||'')+it('board','board','Boards')+it('chat','chat','Chat');
}
function render(){
  const gs = DATA.games.filter(g=>S.league==='all'||keyOf(g)===S.league);
  const counts={all:DATA.games.length}; DATA.games.forEach(g=>{counts[keyOf(g)]=(counts[keyOf(g)]||0)+1;});
  const ltabs=LGT.map(([k,l])=>'<button class="tab" data-act="league" data-k="'+k+'" aria-pressed="'+(S.league===k)+'">'+l+'</button>').join('');
  let body='';
  if(S.view==='pre') body = S.date===TODAY?gs.map(gameCard).join(''):(S.date<TODAY?reportView(S.date):previewView(S.date));
  else if(S.view==='live') body=liveView();
  else if(S.view==='slips') body=slipsView();
  else if(S.view==='board') body=boardView();
  else body=chatView();
  const showLeague=S.view==='pre'||S.view==='live';
  const dlabel=S.date===TODAY?'Today':wd(S.date)+' '+mon(S.date)+' '+dnum(S.date);
  document.getElementById('hdr').innerHTML='<div class="hd-in"><div class="hd-row"><button class="calbtn" data-act="cal" aria-expanded="'+S.calOpen+'" aria-label="Pick a day">'+IC.cal+'<span>'+esc(dlabel)+'</span></button><h1 class="logo">LINE<b>SCOUT</b></h1><span class="bank" title="Practice money">'+IC.bolt+'<b id="bankchip" class="mono">'+money(P.bank)+'</b></span></div>'+
    (S.calOpen?calHtml():'')+(showLeague?'<div class="tabs" role="group" aria-label="League">'+ltabs+'</div>':'')+'</div>';
  $app.innerHTML=(S.view==='pre'&&S.date===TODAY?infoBlock()+potdHtml()+trackRecordHtml():'')+body+
    '<div class="foot"><div>Source: ESPN game logs (up to 15 games shown, last 10 feed the model), standings, results, live play-by-play, injury reports and DraftKings lines. Pregame numbers are a snapshot, so lines and injury news will change before game time.</div>'+
    '<div>Boost types shown are ones sportsbooks have advertised: <a href="https://www.cbssports.com/betting/news/nfl-sportsbook-boosts-promo-codes-for-week-1-best-draftkings-bet365-betmgm-betting-promotions" target="_blank" rel="noopener">CBS Sports</a>, <a href="https://www.actionnetwork.com/education/best-sportsbooks-same-game-parlays" target="_blank" rel="noopener">Action Network</a>, <a href="https://www.oddschecker.com/us/insight/football/nfl/20251020-fanduel-sportsbook-choose-your-own-reward-promotion-2x-25pp-profit-boosts-or-30pp-sgp-profit-boost-on-monday-night-football" target="_blank" rel="noopener">Oddschecker</a>, <a href="https://rg.org/bonuses/parlay-bonuses" target="_blank" rel="noopener">rg.org</a>. They are not live offers.</div>'+
    '<div>Practice money is pretend. Live scores and plays come from ESPN and can lag or contain errors. For information only. Sportsbook buttons may open partner links. Sports betting involves risk, so only stake what you can afford to lose. 21+. Help: 1-800-GAMBLER. This app is not affiliated with any sportsbook.</div></div>';
  document.getElementById('nav').innerHTML=navHtml();
  renderSlip(); renderBank(); if(S.view==='live') afterLiveRender();
  calRefresh(); logPre();
  if(S.view==='board') subBoard(); if(S.view==='chat'){ subChat(); const bx=document.getElementById('chatbox'); if(bx) bx.scrollTop=bx.scrollHeight; }
}

/* ---------- events for the new features ---------- */
document.addEventListener('click',function(e){
  const t=e.target.closest('[data-act]'); if(!t) return;
  const act=t.getAttribute('data-act');
  if(act==='cal'){ S.calOpen=!S.calOpen; render(); return; }
  if(act==='date'){ S.date=t.getAttribute('data-d'); S.calOpen=false; S.view='pre'; render(); window.scrollTo(0,0); return; }
  if(act==='learn'){ S.learnOpen=!S.learnOpen; render(); return; }
  if(act==='boost'){ const id=t.getAttribute('data-id'); S.boost=(S.boost===id)?null:id; S.slipMsg=''; S.forceSlip=true; renderSlip(); S.forceSlip=false; return; }
  if(act==='boardtab'){ S.boardTab=t.getAttribute('data-t'); const b=document.getElementById('board-body'); document.querySelectorAll('[data-act=boardtab]').forEach(x=>x.setAttribute('aria-pressed',x.getAttribute('data-t')===S.boardTab)); if(b) b.innerHTML=boardBodyHtml(); return; }
  if(act==='chat-on'){ P.chatOn=true; persist(); subChat(); renderChatBody(true); return; }
  if(act==='chat-send'){ sendChat(null); return; }
  if(act==='chat-del'){ const id=t.getAttribute('data-id'); if(social.db) social.db.collection('chat').doc(id).delete().catch(()=>{}); return; }
});
document.addEventListener('input',function(e){
  const t=e.target; const k=t.getAttribute&&t.getAttribute('data-in'); if(!k) return;
  if(k==='chattext'){ S.chatDraft=t.value; return; }
  if(k==='nick'){ P.nick=t.value.slice(0,18); persist(); syncBoardSoon(false); return; }
  if(k==='boardOn'){ P.boardOn=t.checked; persist(); if(P.boardOn){ syncBoardSoon(true); subBoard(); } else removeFromBoard(); return; }
  if(k==='chatOn'){ P.chatOn=t.checked; persist(); if(P.chatOn) subChat(); return; }
});
document.addEventListener('change',async function(e){
  const t=e.target; if(!t.getAttribute||t.getAttribute('data-in')!=='chatfile') return;
  const f=t.files&&t.files[0]; t.value=''; if(!f) return;
  const note=document.getElementById('chatnote'); if(note) note.textContent='Preparing your picture...';
  try{ const img=await prepImage(f); await sendChat(img); if(note) note.textContent='Sent.'; }catch(err){ social.err=String(err.message||err); renderChatBody(); }
});
document.addEventListener('keydown',function(e){ if(e.key==='Enter'&&e.target&&e.target.id==='chatin'){ e.preventDefault(); sendChat(null); } });


/* ---------- context factors (rest, contract/trade news, dominant opposing players) ---------- */
const CTXK={rest:'Rest',workload:'Workload',trade:'Trade',dispute:'Contract dispute',unsure:'Contract talk',extension:'Extension',cut:'Roster move'};
const fmtp=x=>(x>0?'+':x<0?'\u2212':'')+Math.abs(x).toFixed(Math.abs(x)<0.1&&x!==0?2:1);
function ctxStarText(s,N,unit){
  const c=s.cats[0]; const rk=c.rank===1?'#1':'#'+c.rank;
  return esc(s.name)+(s.pos?' ('+esc(s.pos)+')':'')+' is '+rk+' in the league in '+esc(c.label)+(c.disp?' ('+esc(String(c.disp))+')':'')+'. '+(unit==='defense'?'Their defense matchup':'Their offense matchup')+' rank is #'+s.rank+'/'+N+'.';
}
function ctxSide(g,side){
  const cx=g.crossroads.ctx[side], t=g.teams[side], o=g.teams[side==='home'?'away':'home']; const N=g.n||lnOf(keyOf(g));
  const items=(cx.items||[]).map(i=>'<li><span class="ctxk '+esc(i.kind)+'">'+esc(CTXK[i.kind]||i.kind)+'</span> '+esc(i.text)+' <b class="mono">'+fmtp(i.pts)+'</b>'+(i.date?' <span class="muted small">'+esc(i.src||'')+' · '+esc(i.date)+'</span>':'')+'</li>').join('');
  const stars=(cx.stars||[]).map(s=>'<li><span class="ctxk star">Their star</span> '+ctxStarText(s,N,s.unit)+' Effect on '+esc(t.abbr)+': <b class="mono">'+fmtp(s.pts)+'</b></li>').join('');
  const net=-(cx.off+cx.deff);
  return '<div class="ctxs"><div class="ctxh"><b>'+esc(t.abbr)+'</b> <span class="muted small">net on margin</span> <b class="mono">'+fmtp(net)+'</b></div>'+((items||stars)?'<ul>'+items+stars+'</ul>':'<div class="small muted">Nothing notable.</div>')+'</div>';
}
function ctxBox(g){
  const cx=g.crossroads.ctx; if(!cx) return '';
  const n=(cx.away.items||[]).length+(cx.home.items||[]).length+(cx.away.stars||[]).length+(cx.home.stars||[]).length;
  const sum=g.teams.away.abbr+' '+fmtp(-(cx.away.off+cx.away.deff))+', '+g.teams.home.abbr+' '+fmtp(-(cx.home.off+cx.home.deff));
  return '<details class="d ctxbox"'+(n?' open':'')+'><summary>Context: rest, contract and trade news, star players ('+esc(sum)+')</summary>'+ctxSide(g,'away')+ctxSide(g,'home')+
    '<div class="small muted">Small judgment weights (capped near one point per team), not learned from past games. Rest and workload come from the schedule and game logs. Contract and trade items come from ESPN news and league transaction feeds and are only counted when a named player is involved. A team facing a star gets credit or blame depending on how strong its matching unit is: a weak defense gives up more to a dominant scorer than an elite one does.</div></details>';
}
function previewCtx(g){
  const cx=g.ctx; if(!cx) return '';
  const side=(ab,c)=>{ const bits=[]; (c.items||[]).slice(0,2).forEach(i=>bits.push(esc(CTXK[i.kind]||i.kind)+': '+esc(i.text.length>70?i.text.slice(0,68)+'…':i.text)+' ('+fmtp(i.pts)+')')); (c.stars||[]).slice(0,1).forEach(s=>bits.push('facing '+esc(s.name)+', #'+s.rank+' in '+esc(s.cat)+' ('+fmtp(s.pts)+')')); return bits.length?'<div class="small muted"><b>'+esc(ab)+'</b> '+bits.join(' · ')+'</div>':''; };
  const a=side(g.away,cx.away), h=side(g.home,cx.home);
  return (a||h)?'<div class="ctxp">'+a+h+'</div>':'';
}
