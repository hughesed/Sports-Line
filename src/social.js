/* ================= accounts, server bets, leaderboard, badges, chat, profiles (Supabase) =================
   PRACTICE COINS ONLY: no real money, nothing to buy, no cash-out.
   Config comes from data/config.json (written by the bot from the GitHub variables SUPABASE_URL + SUPABASE_ANON_KEY).
   Without it the page works exactly as before (local practice bank) and the social tabs say "Sign-in not set up yet". */
const SB_JS='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const SB_SRI='sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok';
const SOC={state:'loading',on:false,sb:null,user:null,me:null,err:'',bets:null,betsT:0,lb:null,lbT:0,chat:[],chatMode:'off',chatErr:'',chatTimer:null,chan:null,
  lastId:0,mentions:[],seenMention:0,prof:{},profName:'',modal:null,suggest:[],sending:false,draft:'',img:null,boardTab:'win'};
const BADGE={champion:{e:'🏆',n:'Champion',d:'Biggest winner of the day (net coins won, ET day). Awarded at midnight ET.'},
  trash:{e:'🗑️',n:'Trash can',d:'Biggest loser of the day. Awarded at midnight ET.'},
  active:{e:'⚡',n:'Most active',d:'Most actions in a day: bets, battles, spectator bets and chat messages (3 or more).'},
  convo:{e:'💬',n:'Conversation',d:'Most @mentions received in chat in a day (2 or more).'},
  king:{e:'👑',n:'King',d:'#1 battle rating (Elo) in a sport at the daily reset, with 3+ rated battles. One per sport: NFL, NBA, MLB, college football (CFB) and college basketball (CBB), so up to five Kings a day.'},
  hot:{e:'🔥',n:'Hot streak',d:'5 winning slips or battles in a row (at most one per day).'}};
const cn=x=>{ const v=Math.round((+x||0)*100)/100; return v.toLocaleString('en-US',{minimumFractionDigits:(v%1)?2:0,maximumFractionDigits:2}); };
const sgn=x=>(x>0?'+':x<0?'−':'')+cn(Math.abs(x));
const COIN='<span class="coin" aria-hidden="true">🪙</span>';
try{ SOC.seenMention=+(localStorage.getItem('linescout.mention.seen')||0)||0; }catch(e){}

/* ---------- boot ---------- */
function startSocial(){
  fetch('data/config.json?t='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null).then(cfg=>{
    const url=cfg&&String(cfg.supabaseUrl||'').trim(), key=cfg&&String(cfg.supabaseAnonKey||'').trim();
    if(!url||!key){ SOC.state='off'; socRerender(); return; }
    SOC.on=true; SOC.state='loading'; render();
    loadSupabaseJs().then(()=>{
      SOC.sb=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'linescout.auth.v1'}});
      SOC.sb.auth.onAuthStateChange((ev,session)=>{ const u=session&&session.user||null; if((u&&u.id)!==(SOC.user&&SOC.user.id)){ SOC.user=u; SOC.me=null; SOC.bets=null; onUser(); } });
      return SOC.sb.auth.getSession().then(r=>{ SOC.user=(r.data&&r.data.session&&r.data.session.user)||null; SOC.state='ready'; onUser(); });
    }).then(()=>{ SOC.sb.rpc('finalize_days').then(()=>{},()=>{}); }).catch(e=>{ SOC.state='error'; SOC.err='Could not load sign-in ('+((e&&e.message)||e)+'). Check your connection and reload.'; render(); });
  });
  setInterval(()=>{ if(document.hidden||!SOC.sb) return; if(SOC.user){ refreshMe(); if(S.view!=='chat') loadMentions(); } if(S.view==='board') loadBoard(true); if(S.view==='slips'&&SOC.user) loadMyBets(true); },45000);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&SOC.sb&&SOC.user){ refreshMe(); if(S.view==='chat') pollChat(); } });
}
function loadSupabaseJs(){
  if(window.supabase&&window.supabase.createClient) return Promise.resolve();
  return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=SB_JS; s.integrity=SB_SRI; s.crossOrigin='anonymous'; s.onload=()=>res(); s.onerror=()=>rej(new Error('the sign-in library did not load')); document.head.appendChild(s); });
}
function onUser(){
  stopChat();
  if(!SOC.user){ SOC.me=null; render(); return; }
  refreshMe().then(()=>{ render(); if(S.view==='chat') startChat(); loadMentions(); });
}
function refreshMe(){
  if(!SOC.sb||!SOC.user) return Promise.resolve();
  return SOC.sb.from('profiles').select('id,username,balance,created_at,streak').eq('id',SOC.user.id).maybeSingle().then(r=>{
    if(r.error){ SOC.err=r.error.message; return; }
    if(!r.data){ SOC.me=null; openModal('name'); return; }
    const old=SOC.me&&SOC.me.balance; SOC.me=r.data; SOC.me.balance=+r.data.balance;
    if(old!==SOC.me.balance) renderBank();
  });
}
function socPending(){ if(!SOC.on) return null; if(!SOC.user||!SOC.bets) return SOC.user?null:0; return SOC.bets.filter(b=>b.status==='pending').length; }
function socUnseen(){ return SOC.user?SOC.mentions.filter(m=>m.id>SOC.seenMention).length:0; }
function socRerender(){ if(['board','chat','battle','profile','slips'].indexOf(S.view)>=0) render(); else { const h=document.getElementById('hdr'); if(h) render(); } }
function socAfterRender(){
  if(!SOC.on) return;
  if(S.view==='board') loadBoard(false);
  if(S.view==='slips'&&SOC.user) loadMyBets(false);
  if(S.view==='chat'){ if(SOC.user) startChat(); markMentionsSeen(); const bx=document.getElementById('chatbox'); if(bx) bx.scrollTop=bx.scrollHeight; }
  else stopChat();
  if(S.view==='profile') loadProfile(S.profName,false);
  if(typeof btAfterRender==='function') btAfterRender();
}
function socNote(){
  if(SOC.state==='off') return '<div class="flash">Sign-in not set up yet. Accounts, coins, the leaderboard, chat and Battles start working once the site owner connects a free Supabase project (README, "Accounts, chat, leaderboard and Battles"). Everything else on the page works now.</div>';
  if(SOC.state==='loading') return '<div class="small muted">Connecting…</div>';
  if(SOC.state==='error') return '<div class="flash">'+esc(SOC.err)+'</div>';
  return '';
}
const PRACTICE_NOTE='<div class="small muted pnote">Practice coins only: no real money, nothing to buy, no cash-out.</div>';

/* ---------- header: Sign in / coin balance ---------- */
function hdrAcctHtml(){
  if(!SOC.on) return '<span class="bank" title="Practice money">'+IC.bolt+'<b id="bankchip" class="mono">'+money(P.bank)+'</b></span>';
  if(!SOC.user) return '<button class="acctbtn" data-act="signin" aria-label="Sign in">Sign in</button>';
  const b=SOC.me?cn(SOC.me.balance):'…';
  return '<button class="bank coinbtn" data-act="profile" data-u="'+esc(SOC.me?SOC.me.username:'')+'" aria-label="Your practice coins: '+esc(b)+'. Open your profile">'+COIN+'<b id="bankchip" class="mono">'+esc(b)+'</b></button>';
}
function renderBank(){
  const el=document.getElementById('bankchip');
  if(el) el.textContent=SOC.on?(SOC.me?cn(SOC.me.balance):'…'):money(P.bank);
  const t=document.getElementById('toast'); if(t){ t.textContent=S.flash||''; t.hidden=!S.flash; if(S.flash){ clearTimeout(S.flashT); S.flashT=setTimeout(()=>{ S.flash=''; renderBank(); },6000); } }
}

/* ---------- slip: server bets for signed-in users ---------- */
function placeCheck(){
  if(!SOC.on) return placeCheckLocal();
  if(!SOC.user) return 'Sign in to bet. Practice coins only, free.';
  if(!SOC.me) return 'Pick a username first.';
  const legs=S.slip; if(!legs.length) return 'Add at least one selection.';
  const stake=parseStake(); if(stake<0.01) return 'Enter a stake of at least 0.01 coins.';
  const cost=S.betMode==='single'?r2(stake*legs.length):stake;
  if(cost>SOC.me.balance+1e-9) return 'Not enough coins: this costs '+cn(cost)+' and you have '+cn(SOC.me.balance)+'.';
  for(const l of legs){
    const L=LS(l.gid);
    if(L.done||L.man.final) return (G[l.gid]?G[l.gid].title:'That game')+' is already final.';
    if(!l.live&&feedStarted(l.gid)) return 'That game has started. Use its live prices in the Live tab for '+(G[l.gid]?G[l.gid].title:'it')+'.';
    if(l.live){ const cur=legFor(l.id); if(cur&&cur.closed) return l.label+' is closed.'; if(cur&&cur.price>400) return l.label+' is above the +400 practice cap for live prices.'; }
  }
  return '';
}
function calcHtml(){
  if(!SOC.on) return calcHtmlLocal();
  const c=calc(); const err=placeCheck(); const bal=SOC.me?SOC.me.balance:0;
  return '<div class="calc"><span>Cost <b class="mono">'+cn(c.cost)+'</b></span><span>Pays <b class="mono">'+cn(c.toWin)+'</b>'+(c.boost?' <span class="bst">+'+c.boost.pct+'% '+esc(c.boost.book)+'</span>':'')+'</span><span>Coins <b class="mono">'+(SOC.user?cn(bal):'–')+'</b></span>'+(c.single?'':'<span>All hit ~<b class="mono">'+(c.pall<0.01?'<1%':Math.round(c.pall*100)+'%')+'</b></span>')+'</div>'+
    (err&&(parseStake()>0||!SOC.user)?'<div class="slipnote warnt">'+esc(err)+'</div>':'');
}
function slipHtml(){
  let h=slipHtmlLocal(); if(!SOC.on||!h) return h;
  h=h.replace('>Place practice bet</button>','>'+(SOC.user?'Place practice bet':'Sign in to bet')+'</button>').replace('Stake $<input','Stake <input').replace('aria-label="Stake in dollars"','aria-label="Stake in practice coins"').replace(/\$10 pays \$/,'10 coins pay ');
  return h;
}
async function placeBetServer(){
  if(!SOC.user){ openModal('in'); return; }
  const err=placeCheck(); if(err){ S.slipMsg=err; renderSlip(); return; }
  if(SOC.sending) return; SOC.sending=true;
  const legs=S.slip.map(l=>l.live?{tok:l.id,price:l.price,label:l.label}:l.id);
  const sent={}; S.slip.forEach(l=>{ sent[l.id]=l.price; });
  const bb=S.betMode==='single'?null:activeBoost();
  S.slipMsg='Placing…'; renderSlip();
  const r=await SOC.sb.rpc('place_bet',{p_legs:legs,p_stake:parseStake(),p_mode:S.betMode==='single'?'single':'parlay',p_boost:bb?bb.id:null});
  SOC.sending=false;
  if(r.error){ S.slipMsg=r.error.message||'Could not place the bet.'; renderSlip(); return; }
  const d=r.data; if(SOC.me) SOC.me.balance=+d.balance;
  const moved=(d.legs||[]).filter(l=>sent[l.tok]!=null&&sent[l.tok]!==l.price).map(l=>l.label+' '+fo(l.price));
  const nb=(d.bets||[]).length;
  S.slip=[]; S.boost=null; S.slipOpen=false; S.slipMsg='';
  S.flash='Placed '+nb+' practice bet'+(nb>1?'s':'')+' for '+cn(d.cost)+' coins.'+(moved.length?' Price updated by the server: '+moved.join(', ')+'.':'')+' The bot settles it after the final.';
  syncLegButtons(); renderSlip(); renderBank(); SOC.bets=null; loadMyBets(true);
  if(S.view==='slips') render(); else { const n=document.getElementById('nav'); if(n) n.innerHTML=navHtml(); }
}
function loadMyBets(force){
  if(!SOC.sb||!SOC.user) return;
  if(!force&&SOC.bets&&Date.now()-SOC.betsT<20000) return;
  SOC.betsT=Date.now();
  SOC.sb.from('bets').select('id,placed_at,stake,mode,boost,status,payout,settled_at,bet_legs(id,tok,gid,label,price,live,res)').eq('user_id',SOC.user.id).order('id',{ascending:false}).limit(60).then(r=>{
    if(r.error){ SOC.err=r.error.message; return; }
    const sig=JSON.stringify(r.data); if(sig===SOC.betsSig) return; SOC.betsSig=sig; SOC.bets=r.data||[];
    if(S.view==='slips'&&!isTypingNow()) render(); else { const n=document.getElementById('nav'); if(n) n.innerHTML=navHtml(); }
  });
}
function isTypingNow(){ const a=document.activeElement; return !!(a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA')&&a.type!=='checkbox'); }
function srvBetHtml(b){
  const legs=(b.bet_legs||[]).slice().sort((x,y)=>x.id-y.id);
  const dec=legs.filter(l=>l.res!=='V').reduce((d,l)=>d*decOf(l.price),1);
  const cls={pending:'warn',won:'ok',lost:'bad',void:''}[b.status]; const txt={pending:'Pending',won:'Won '+cn(b.payout),lost:'Lost',void:'Refunded'}[b.status];
  const games=[...new Set(legs.map(l=>l.gid))];
  return '<div class="bet"><div class="bh"><b>'+(legs.length>1?(games.length>1?'Parlay':'Same-game parlay')+' · '+legs.length+' legs':'Straight bet')+'</b><span class="badge '+cls+'">'+esc(txt)+'</span></div>'+
    '<div class="small muted">Stake '+cn(b.stake)+' coins · odds '+fo(amerOfDec(dec))+' · pays '+cn(b.stake*boostedDec(dec,b.boost))+(b.boost?' with +'+b.boost.pct+'% '+esc(b.boost.book)+' boost':'')+' · '+esc(fmtTime(Date.parse(b.placed_at)))+'</div>'+
    legs.map(l=>'<div class="bl">'+legStatusIcon(l)+'<span>'+esc(l.label)+' <span class="mono muted">'+fo(l.price)+(l.live?' live':'')+'</span><br><span class="muted small">'+esc(G[l.gid]?G[l.gid].title:'game '+l.gid)+(l.res==='V'?' · void':'')+'</span></span></div>').join('')+
    (b.status==='won'?'<div class="btnrow"><button class="shbtn" data-act="sh-open" data-k="slip" data-src="bet" data-id="'+esc(b.id)+'">Share this winning slip</button></div>':'')+(b.status==='pending'?'<div class="small muted">Settled by the bot after the final (it checks results about every 30 minutes, every 2 hours overnight).</div>':'')+'</div>';
}
function slipsView(){
  if(!SOC.on) return slipsViewLocal();
  const saved='<section class="game"><div class="sec"><h3>Selected slips <span class="hint">saved on this phone</span></h3>'+(P.saved.length?P.saved.map(savedHtml).join(''):'<div class="small muted">Nothing saved yet. Build a slip from the Games or Live tab and tap Save slip.</div>')+'</div></section>';
  const old=P.bets.length?'<section class="game"><div class="sec"><h3>Bets on this phone <span class="hint">from before accounts</span></h3><div class="small muted">These used the old phone-only bank and still settle here; new bets use your coins.</div>'+P.bets.slice(0,20).map(betHtml).join('')+'</div></section>':'';
  if(!SOC.user) return '<section class="game"><div class="sec"><h3>My bets</h3>'+socNote()+'<div class="small">Sign in to place practice bets with coins. New accounts start with 1,000 coins, and anyone under 100 coins is topped up to 100 at midnight ET.</div><div class="btnrow"><button class="btn solid" data-act="signin">Sign in or create an account</button></div>'+PRACTICE_NOTE+'</div></section>'+saved+old;
  const me=SOC.me||{balance:0}; const bets=SOC.bets;
  const pend=bets?bets.filter(b=>b.status==='pending'):[]; const atStake=pend.reduce((s,b)=>s+(+b.stake),0);
  return '<section class="game"><div class="sec"><h3>Your coins <span class="hint">practice only</span></h3><div class="bankbig mono">'+COIN+' '+cn(me.balance)+'</div>'+
    '<div class="proj"><div class="kv"><div class="k">On open bets</div><div class="v">'+cn(atStake)+'</div></div><div class="kv"><div class="k">Open</div><div class="v">'+pend.length+'</div></div><div class="kv"><div class="k">Profile</div><div class="v"><button class="linkbtn" data-act="profile" data-u="'+esc(me.username||'')+'">'+esc(me.username||'')+'</button></div></div></div>'+
    '<div class="small muted">Your balance lives on the server, so it is the same on every device. Coins only change through bets, battles and the daily top-up (anyone under 100 is topped up to 100 at midnight ET).</div>'+PRACTICE_NOTE+'</div></section>'+
    '<section class="game"><div class="sec"><h3>Placed bets <span class="hint">'+(bets?pend.length+' open · '+(bets.length-pend.length)+' settled':'loading')+'</span></h3>'+
    (bets?(bets.length?bets.map(srvBetHtml).join(''):'<div class="small muted">No practice bets yet. Add selections, then tap Place practice bet.</div>'):'<div class="small muted">Loading…</div>')+'</div></section>'+saved+old;
}

/* ---------- sign in / sign up / username ---------- */
function openModal(kind){ SOC.modal={kind:kind,msg:'',busy:false,avail:null}; drawModal(); }
function closeModal(){ SOC.modal=null; const m=document.getElementById('socmodal'); if(m) m.remove(); }
function drawModal(){
  let m=document.getElementById('socmodal');
  if(!SOC.modal){ if(m) m.remove(); return; }
  if(!m){ m=document.createElement('div'); m.id='socmodal'; m.className='modal'; document.body.appendChild(m); }
  const k=SOC.modal.kind; const v=id=>{ const e=document.getElementById(id); return e?e.value:''; };
  const keep={em:v('su-email'),pw:v('su-pass'),un:v('su-name')};
  const nameFld='<label class="fld">Username <input id="su-name" class="num wide" maxlength="18" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="3-18 letters, numbers or _" value="'+esc(keep.un)+'"><span class="small" id="su-avail">'+(SOC.modal.avail==null?'Shown to other players. Letters, numbers and _ only.':SOC.modal.avail?'<span class="okt">Available</span>':'<span class="badt">Taken or not allowed</span>')+'</span></label>';
  let body='';
  if(k==='name'){
    body='<h2>Pick a username</h2><div class="small">Your account has no username yet (the one you chose may have been taken a moment earlier). Pick one to get your 1,000 practice coins.</div>'+nameFld+
      '<div class="btnrow"><button class="btn solid" data-act="su-claim">Save username</button><button class="btn" data-act="su-out">Sign out</button></div>';
  } else {
    const up=k==='up';
    body='<div class="seg" role="group" aria-label="Account"><button data-act="su-tab" data-k="in" aria-pressed="'+!up+'">Sign in</button><button data-act="su-tab" data-k="up" aria-pressed="'+up+'">Create account</button></div>'+
      '<label class="fld">Email <input id="su-email" class="num wide" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="'+esc(keep.em)+'"></label>'+
      '<label class="fld">Password <input id="su-pass" class="num wide" type="password" autocomplete="'+(up?'new-password':'current-password')+'" minlength="6" value="'+esc(keep.pw)+'"></label>'+
      (up?nameFld:'')+
      '<div class="btnrow"><button class="btn solid" data-act="'+(up?'su-up':'su-in')+'">'+(up?'Create account':'Sign in')+'</button><button class="btn" data-act="su-close">Not now</button></div>'+
      (up?'<div class="small muted">New accounts get 1,000 practice coins.</div>':'');
  }
  m.innerHTML='<div class="mbox" role="dialog" aria-modal="true" aria-label="Account"><button class="mx" data-act="su-close" aria-label="Close">×</button>'+body+
    '<div class="slipnote warnt" id="su-msg" role="status">'+esc(SOC.modal.msg||'')+'</div>'+PRACTICE_NOTE+'</div>';
  const f=m.querySelector(k==='name'?'#su-name':'#su-email'); if(f&&!f.value) setTimeout(()=>{ try{ f.focus(); }catch(e){} },30);
}
function suMsg(t){ if(SOC.modal) SOC.modal.msg=t; const e=document.getElementById('su-msg'); if(e) e.textContent=t; }
const nameOk=n=>/^[A-Za-z0-9_]{3,18}$/.test(n);
let availT=null;
function checkAvail(){
  clearTimeout(availT); const e=document.getElementById('su-name'); if(!e||!SOC.sb) return; const n=e.value.trim();
  const a=document.getElementById('su-avail');
  if(!nameOk(n)){ if(SOC.modal) SOC.modal.avail=null; if(a) a.innerHTML=n?'<span class="badt">3-18 letters, numbers or _</span>':'Shown to other players. Letters, numbers and _ only.'; return; }
  availT=setTimeout(()=>{ SOC.sb.rpc('username_available',{p_name:n}).then(r=>{ if(!SOC.modal) return; SOC.modal.avail=!!r.data; const a2=document.getElementById('su-avail'); if(a2) a2.innerHTML=r.data?'<span class="okt">Available</span>':'<span class="badt">Taken</span>'; }); },350);
}
async function doSignUp(){
  const em=(document.getElementById('su-email')||{}).value||'', pw=(document.getElementById('su-pass')||{}).value||'', un=((document.getElementById('su-name')||{}).value||'').trim();
  if(!/^\S+@\S+\.\S+$/.test(em)) return suMsg('Enter your email address.');
  if(pw.length<6) return suMsg('Use a password of at least 6 characters.');
  if(!nameOk(un)) return suMsg('Usernames are 3 to 18 letters, numbers or _.');
  suMsg('Checking the username…');
  const av=await SOC.sb.rpc('username_available',{p_name:un}); if(av.data===false) return suMsg('That username is taken. Try another.');
  suMsg('Creating your account…');
  const r=await SOC.sb.auth.signUp({email:em.trim(),password:pw,options:{data:{username:un}}});
  if(r.error) return suMsg(r.error.message||'Could not create the account.');
  if(!r.data.session){ SOC.modal.kind='in'; drawModal(); return suMsg('Account created. Check your email for a confirmation link, then sign in here. (Site owner: turn off "Confirm email" in Supabase so this step is not needed.)'); }
  closeModal(); S.flash='Welcome, '+un+'! You have 1,000 practice coins.'; renderBank();
}
async function doSignIn(){
  const em=(document.getElementById('su-email')||{}).value||'', pw=(document.getElementById('su-pass')||{}).value||'';
  if(!em||!pw) return suMsg('Enter your email and password.');
  suMsg('Signing in…');
  const r=await SOC.sb.auth.signInWithPassword({email:em.trim(),password:pw});
  if(r.error) return suMsg(r.error.message==='Invalid login credentials'?'Wrong email or password.':r.error.message);
  closeModal();
}
async function doClaim(){
  const un=((document.getElementById('su-name')||{}).value||'').trim();
  if(!nameOk(un)) return suMsg('Usernames are 3 to 18 letters, numbers or _.');
  const r=await SOC.sb.rpc('claim_username',{p_name:un});
  if(r.error) return suMsg(r.error.message);
  closeModal(); refreshMe().then(()=>render());
}
async function signOut(){ stopChat(); try{ await SOC.sb.auth.signOut(); }catch(e){} SOC.user=null; SOC.me=null; SOC.bets=null; SOC.mentions=[]; S.view='pre'; render(); }

/* ---------- leaderboard + badges ---------- */
function loadBoard(force){
  if(!SOC.sb) return; if(!force&&SOC.lb&&Date.now()-SOC.lbT<20000) return; SOC.lbT=Date.now();
  SOC.sb.rpc('leaderboard').then(r=>{ if(r.error){ SOC.err=r.error.message; return; } const sig=JSON.stringify(r.data); if(sig===SOC.lbSig) return; SOC.lbSig=sig; SOC.lb=r.data; if(S.view==='board'){ const b=document.getElementById('board-body'); if(b) b.innerHTML=boardBodyHtml(); } });
}
function uLink(name,cls){ return '<button class="ulink'+(cls?' '+cls:'')+'" data-act="profile" data-u="'+esc(name)+'">'+esc(name)+'</button>'; }
function badgeChip(kind,count,sport,title){ const b=BADGE[kind]; if(!b) return ''; return '<span class="bdg bdg-'+kind+'" title="'+esc(b.n+(sport?' ('+sport.toUpperCase()+')':'')+': '+b.d+(title?' · '+title:''))+'"><i aria-hidden="true">'+b.e+'</i>'+esc(b.n)+(sport?' '+esc(sport.toUpperCase()):'')+(count>1?' <b>×'+count+'</b>':'')+'</span>'; }
function badgeLegend(){ return '<details class="d"><summary>What the badges mean</summary><div class="legend">'+Object.keys(BADGE).map(k=>'<div class="lg1">'+badgeChip(k,1)+'<span class="small muted">'+esc(BADGE[k].d)+'</span></div>').join('')+'<div class="small muted">Badges stack: each award is kept with its date (and sport for King), and profiles show ×count. Days run midnight to midnight Eastern time.</div></div></details>'; }
function boardBodyHtml(){
  const lb=SOC.lb; if(!lb) return '<div class="small muted">Loading the board…</div>';
  const rows=(arr,win)=>arr.length?arr.map((r,i)=>'<div class="lbrow'+(SOC.me&&r.id===SOC.me.id?' me':'')+'"><span class="rk">'+(i+1)+'</span>'+uLink(r.username)+'<span class="mono pf '+(win?'g':'r')+'">'+sgn(+r.net)+'</span></div>').join(''):'<div class="small muted">'+(win?'No winners yet today. Profit counts on the day a bet or battle settles.':'Nobody is down today yet.')+'</div>';
  const tab=SOC.boardTab;
  const y=lb.yesterday||{}; const yb=(y.badges||[]);
  const yHtml=yb.length?'<div class="vcs">'+yb.map(b=>'<span class="ybadge">'+badgeChip(b.kind,1,b.sport)+' '+uLink(b.username)+(b.detail?' <span class="muted small">'+esc(b.detail)+'</span>':'')+(SOC.me&&b.username===SOC.me.username?' <button class="shbtn" data-act="sh-open" data-k="badge" data-b="'+esc(b.kind)+'" data-u="'+esc(b.username)+'" data-sp="'+esc(b.sport||'')+'">Share</button>':'')+'</span>').join('')+'</div>':'<div class="small muted">'+(y.final?'Nobody qualified yesterday.':'Yesterday is finalized shortly after midnight ET.')+'</div>';
  const at=(lb.alltime||[]);
  const atHtml=at.length?'<div class="attable" role="table" aria-label="All-time badges"><div class="atr ath" role="row"><span>Player</span>'+['champion','trash','active','convo','king','hot'].map(k=>'<span title="'+esc(BADGE[k].n)+'">'+BADGE[k].e+'</span>').join('')+'</div>'+
    at.map(r=>'<div class="atr" role="row">'+uLink(r.username)+['champion','trash','active','convo','king','hot'].map(k=>'<span class="mono">'+(r[k]||'·')+'</span>').join('')+'</div>').join('')+'</div>':'<div class="small muted">No badges awarded yet. The first ones are handed out at the first midnight ET after people start playing.</div>';
  return '<div class="small muted">'+esc(fmtDay(lb.day))+' · Eastern time · '+(lb.players||0)+' player'+(lb.players===1?'':'s')+' active today · resets at midnight ET</div>'+
    '<div class="seg" role="group" aria-label="Board"><button data-act="lbtab" data-t="win" aria-pressed="'+(tab==='win')+'">Top 10 winners</button><button data-act="lbtab" data-t="lose" aria-pressed="'+(tab==='lose')+'">Top 10 losers</button></div>'+
    '<div class="lblist">'+(tab==='win'?rows(lb.winners||[],true):rows(lb.losers||[],false))+'</div>'+
    '<h4 class="sub">Yesterday</h4>'+yHtml+
    '<h4 class="sub">All-time badges</h4>'+atHtml+badgeLegend()+PRACTICE_NOTE;
}
function fmtDay(d){ if(!d) return ''; const t=new Date(d+'T12:00:00'); return t.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); }
function boardView(){
  if(!SOC.on||SOC.state!=='ready') return '<section class="game"><div class="sec"><h3>Daily leaderboard</h3>'+socNote()+localSelfCard()+'</div></section>';
  return '<section class="game"><div class="sec"><h3>Daily leaderboard <span class="hint">net coins won today</span></h3><div id="board-body">'+boardBodyHtml()+'</div></div></section>';
}
function localSelfCard(){ const pend=P.bets.filter(b=>b.status==='pending'); const atStake=pend.reduce((s,b)=>s+b.stake,0); const net=P.bank+atStake-P.start; return '<div class="small muted">Your phone-only practice bank: '+money(P.bank)+' ('+(net>=0?'+':'−')+money(Math.abs(net))+').</div>'; }

/* ---------- chat (signed-in), realtime with a polling fallback ---------- */
const CHAT_MAX=120, IMG_MAX=122880;
function chatView(){
  let h='<section class="game"><div class="sec"><h3>Chat <span class="hint" id="chatmode">'+chatModeText()+'</span></h3>';
  if(!SOC.on||SOC.state!=='ready') return h+socNote()+'</div></section>';
  if(!SOC.user) return h+'<div class="small">Chat is for signed-in players. Sign in to read and write messages, @mention people and see who mentioned you.</div><div class="btnrow"><button class="btn solid" data-act="signin">Sign in</button></div></div></section>';
  return h+'<div id="chat-body">'+chatBodyHtml()+'</div></div></section>';
}
function chatModeText(){ return SOC.chatMode==='rt'?'<span class="livedot"></span> live':SOC.chatMode==='poll'?'updates every 4 s':''; }
function mentionHtml(t){
  const me=SOC.me?SOC.me.username.toLowerCase():'';
  return esc(t).replace(/(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,18})/g,(m,pre,n)=>pre+'<button class="mention'+(n.toLowerCase()===me?' you':'')+'" data-act="profile" data-u="'+n+'">@'+n+'</button>');
}
const okImg=s=>typeof s==='string'&&/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(s)&&s.length<=IMG_MAX;
function msgHtml(m){
  const mine=SOC.user&&m.user_id===SOC.user.id; const me=SOC.me?SOC.me.username.toLowerCase():'';
  const hits=!mine&&me&&new RegExp('@'+me+'(?![A-Za-z0-9_])','i').test(m.body||'');
  if(m.deleted) return '<div class="msg del" data-id="'+m.id+'"><div class="mh">'+uLink(m.username)+'<span class="muted">'+esc(fmtClock(Date.parse(m.created_at)))+'</span></div><div class="mt muted small">message deleted</div></div>';
  return '<div class="msg'+(mine?' mine':'')+(hits?' atme':'')+'" data-id="'+m.id+'"><div class="mh">'+uLink(m.username)+'<span class="muted">'+esc(fmtClock(Date.parse(m.created_at)))+'</span>'+(hits?'<span class="mbadge">mentioned you</span>':'')+(mine?'<button class="linkbtn" data-act="chat-del" data-id="'+m.id+'">Delete</button>':'')+'</div>'+
    (m.body?'<div class="mt">'+mentionHtml(m.body)+'</div>':'')+(okImg(m.img)?'<img class="cimg" alt="Picture from '+esc(m.username)+'" src="'+m.img+'">':'')+'</div>';
}
function fmtClock(t){ return new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
function chatBodyHtml(){
  const un=socUnseen(); const lastM=SOC.mentions[0];
  return (SOC.chatErr?'<div class="flash">'+esc(SOC.chatErr)+'</div>':'')+
    (un&&lastM?'<div class="menbar">'+lastM.from_name+' mentioned you'+(un>1?' (+'+(un-1)+' more)':'')+'</div>':'')+
    '<div class="chatbox" id="chatbox" aria-live="polite">'+(SOC.chat.length?SOC.chat.map(msgHtml).join(''):'<div class="small muted">No messages yet. Say hi.</div>')+'</div>'+
    '<div class="sugg" id="chatsugg" role="listbox" aria-label="Usernames"></div>'+
    '<div class="composer"><label class="attach" title="Attach a small picture">'+IC.clip+'<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-in="chatfile" hidden aria-label="Attach a picture"></label><input class="num wide" id="chatin" data-in="chattext" maxlength="500" placeholder="Message · type @ to mention" aria-label="Message" autocomplete="off" value="'+esc(SOC.draft)+'"><button class="btn pri" data-act="chat-send">Send</button></div>'+
    '<div class="small muted" id="chatnote">Up to 500 characters, one message every 2 seconds. Pictures are shrunk to about 120 KB. Tap a name to see a profile.</div>';
}
function renderChat(scroll){
  const bx=document.getElementById('chatbox'); if(!bx){ return; }
  const atBottom=bx.scrollHeight-bx.scrollTop-bx.clientHeight<60;
  bx.innerHTML=SOC.chat.length?SOC.chat.map(msgHtml).join(''):'<div class="small muted">No messages yet. Say hi.</div>';
  if(scroll||atBottom) bx.scrollTop=bx.scrollHeight;
  const md=document.getElementById('chatmode'); if(md) md.innerHTML=chatModeText();
}
function mergeMsgs(list){
  const by={}; SOC.chat.forEach(m=>by[m.id]=m); list.forEach(m=>by[m.id]=m);
  SOC.chat=Object.keys(by).map(k=>by[k]).sort((a,b)=>a.id-b.id).slice(-CHAT_MAX);
  SOC.lastId=SOC.chat.length?SOC.chat[SOC.chat.length-1].id:SOC.lastId;
}
function startChat(){
  if(!SOC.sb||!SOC.user||SOC.chatTimer||SOC.chan) return;
  SOC.sb.from('chat_messages').select('*').order('id',{ascending:false}).limit(60).then(r=>{ if(r.error){ SOC.chatErr=r.error.message; return; } mergeMsgs((r.data||[]).reverse()); renderChat(true); });
  let decided=false;
  const fallback=()=>{ if(decided&&SOC.chatMode==='poll') return; decided=true; SOC.chatMode='poll'; if(SOC.chan){ try{ SOC.sb.removeChannel(SOC.chan); }catch(e){} SOC.chan=null; } if(!SOC.chatTimer) SOC.chatTimer=setInterval(pollChat,4000); renderChat(false); };
  try{
    SOC.chan=SOC.sb.channel('ls-chat').on('postgres_changes',{event:'*',schema:'public',table:'chat_messages'},p=>{ if(p.new&&p.new.id){ mergeMsgs([p.new]); renderChat(false); } })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'mentions',filter:'user_id=eq.'+SOC.user.id},p=>{ if(p.new){ SOC.mentions.unshift(p.new); navRefresh(); } })
      .subscribe(st=>{ if(st==='SUBSCRIBED'){ decided=true; SOC.chatMode='rt'; renderChat(false); } else if(st==='CHANNEL_ERROR'||st==='TIMED_OUT'||st==='CLOSED') fallback(); });
  }catch(e){ fallback(); }
  setTimeout(()=>{ if(SOC.chatMode!=='rt') fallback(); },5000);
}
let pollN=0;
function pollChat(){
  if(!SOC.sb||!SOC.user||document.hidden) return;
  pollN++;
  const q=(pollN%4===0||!SOC.lastId)?SOC.sb.from('chat_messages').select('*').order('id',{ascending:false}).limit(60):SOC.sb.from('chat_messages').select('*').gt('id',SOC.lastId).order('id',{ascending:false}).limit(60);
  q.then(r=>{ if(r.error) return; if(r.data&&r.data.length){ mergeMsgs(r.data.reverse()); renderChat(false); } });
  if(pollN%4===0) loadMentions();
}
function stopChat(){ if(SOC.chatTimer){ clearInterval(SOC.chatTimer); SOC.chatTimer=null; } if(SOC.chan&&SOC.sb){ try{ SOC.sb.removeChannel(SOC.chan); }catch(e){} } SOC.chan=null; SOC.chatMode='off'; }
function loadMentions(){ if(!SOC.sb||!SOC.user) return; SOC.sb.from('mentions').select('id,msg_id,from_name,created_at').order('id',{ascending:false}).limit(20).then(r=>{ if(!r.error){ SOC.mentions=r.data||[]; navRefresh(); if(S.view==='chat') markMentionsSeen(); } }); }
function markMentionsSeen(){ const top=SOC.mentions.length?SOC.mentions[0].id:0; if(top>SOC.seenMention){ setTimeout(()=>{ SOC.seenMention=top; try{ localStorage.setItem('linescout.mention.seen',String(top)); }catch(e){} navRefresh(); },4000); } }
function navRefresh(){ const n=document.getElementById('nav'); if(n) n.innerHTML=navHtml(); }
async function sendChatMsg(){
  const inp=document.getElementById('chatin'); const text=((inp&&inp.value)||SOC.draft||'').trim();
  if(!text&&!SOC.img) return; if(SOC.sending) return; SOC.sending=true;
  const r=await SOC.sb.rpc('send_chat',{p_body:text,p_img:SOC.img||null}); SOC.sending=false;
  const note=document.getElementById('chatnote');
  if(r.error){ if(note) note.textContent=r.error.message; return; }
  SOC.draft=''; SOC.img=null; if(inp) inp.value=''; clearTimeout(suggT); hideSugg(); if(note) note.textContent='Sent.';
  if(SOC.chatMode!=='rt') pollChat();
}
/* @mention autocomplete */
let suggT=null;
function mentionQuery(){ const inp=document.getElementById('chatin'); if(!inp) return null; const pos=inp.selectionStart==null?inp.value.length:inp.selectionStart; const m=inp.value.slice(0,pos).match(/(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{0,18})$/); return m?{q:m[2],end:pos,start:pos-m[2].length-1}:null; }
function updateSugg(){
  clearTimeout(suggT); const mq=mentionQuery(); if(!mq){ hideSugg(); return; }
  suggT=setTimeout(()=>{
    let q=SOC.sb.from('profiles').select('username').order('username').limit(6); if(mq.q) q=q.ilike('username',mq.q.replace(/_/g,'\\_')+'%');
    q.then(r=>{ const el=document.getElementById('chatsugg'); if(!el||r.error||!mentionQuery()) return; const mine=SOC.me?SOC.me.username:''; const list=(r.data||[]).map(x=>x.username).filter(n=>n!==mine);
      el.innerHTML=list.map(n=>'<button class="sg" role="option" data-act="mention-pick" data-u="'+esc(n)+'">@'+esc(n)+'</button>').join(''); el.classList.toggle('on',list.length>0); });
  },180);
}
function hideSugg(){ const el=document.getElementById('chatsugg'); if(el){ el.innerHTML=''; el.classList.remove('on'); } }
function pickMention(n){ const inp=document.getElementById('chatin'); const mq=mentionQuery(); if(!inp||!mq) return; inp.value=inp.value.slice(0,mq.start)+'@'+n+' '+inp.value.slice(mq.end); SOC.draft=inp.value; const p=mq.start+n.length+2; inp.focus(); try{ inp.setSelectionRange(p,p); }catch(e){} hideSugg(); }
function fileToDataUri(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('Could not read that file.')); r.readAsDataURL(f); }); }
async function prepImage(f){
  if(f.type==='image/gif'){ const u=await fileToDataUri(f); if(u.length>IMG_MAX) throw new Error('That GIF is too big (the limit is about 90 KB).'); return u; }
  const src=await fileToDataUri(f);
  const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('Could not open that picture.')); i.src=src; });
  let max=560, q=0.7, out='';
  for(let k=0;k<7;k++){
    const sc=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(img.width*sc)); c.height=Math.max(1,Math.round(img.height*sc));
    const ctx=c.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height);
    out=c.toDataURL('image/jpeg',q); if(out.length<=IMG_MAX) return out; max*=0.8; q=Math.max(0.45,q-0.06);
  }
  throw new Error('That picture is too large even after shrinking.');
}

/* ---------- profiles ---------- */
function openProfile(name){ if(!name) return; S.profName=name; S.view='profile'; render(); window.scrollTo(0,0); }
function loadProfile(name,force){
  if(!SOC.sb||!name) return; const c=SOC.prof[name.toLowerCase()];
  if(!force&&c&&Date.now()-c.t<15000) return;
  SOC.sb.rpc('get_profile',{p_username:name}).then(r=>{ SOC.prof[name.toLowerCase()]={t:Date.now(),d:r.error?{error:r.error.message}:(r.data||{missing:true})}; if(S.view==='profile'&&S.profName===name) { const el=document.getElementById('prof-body'); if(el) el.innerHTML=profileBodyHtml(name); } });
}
function profileView(){
  if(!SOC.on||SOC.state!=='ready') return '<section class="game"><div class="sec"><h3>Profile</h3>'+socNote()+'</div></section>';
  return '<section class="game"><div class="sec"><div class="btnrow"><button class="btn" data-act="view" data-k="board">‹ Board</button></div><div id="prof-body">'+profileBodyHtml(S.profName)+'</div></div></section>';
}
const SPN={nfl:'NFL',nba:'NBA',mlb:'MLB',cfb:'CFB',cbb:'CBB'};
function profileBodyHtml(name){
  const c=SOC.prof[(name||'').toLowerCase()]; if(!c) return '<div class="small muted">Loading '+esc(name)+'…</div>';
  const d=c.d; if(d.error) return '<div class="flash">'+esc(d.error)+'</div>'; if(d.missing) return '<div class="small muted">No player called '+esc(name)+'.</div>';
  const mine=SOC.me&&SOC.me.id===d.id;
  const bl=Object.keys(d.badges||{}); const bh=bl.length?'<div class="vcs">'+['champion','trash','active','convo','king','hot'].filter(k=>d.badges[k]).map(k=>badgeChip(k,d.badges[k])).join('')+'</div>':'<div class="small muted">No badges yet.</div>';
  const kings=(d.badge_list||[]).filter(b=>b.kind==='king'); const kingBy={}; kings.forEach(b=>{ kingBy[b.sport]=(kingBy[b.sport]||0)+1; });
  const bt=d.battle||{}; const recs=['nfl','nba','mlb','cfb','cbb'].map(s=>{ const r=bt[s]; return '<div class="kv"><div class="k">'+SPN[s]+' battles</div><div class="v">'+(r?r.w+'-'+r.l+(r.t?'-'+r.t:''):'0-0')+'</div><div class="s">Elo '+(r?Math.round(r.elo):1200)+(kingBy[s]?' · 👑×'+kingBy[s]:'')+'</div></div>'; }).join('');
  const bats=(d.battles||[]).map(b=>{ const res=b.status==='final'?(b.result&&b.result.split?'Split':(b.winner===d.id?'Won':'Lost')):b.status==='live'?'Live':b.status==='cancelled'?'Cancelled':'Open';
    return '<button class="rlink" data-act="bt-open" data-id="'+b.id+'"><span><b>'+esc(SPN[b.sport]||b.sport)+'</b> '+esc(b.away)+' @ '+esc(b.home)+(b.vs?' vs '+esc(b.vs):'')+'</span><span class="badge '+(res==='Won'?'ok':res==='Lost'?'bad':'')+'">'+res+(b.result&&b.status==='final'?' · '+b.result.as+'-'+b.result.hs:'')+'</span></button>'; }).join('');
  const sl=d.slips||{}; const slips=(sl.recent||[]).map((s,ix)=>'<div class="bl">'+legStatusIcon({res:s.status==='won'?'W':s.status==='lost'?'L':s.status==='void'?'V':null})+'<span>'+esc((s.legs||[]).map(l=>l.label).join(' + '))+'<br><span class="muted small">'+cn(s.stake)+' coins · '+esc(s.status)+(s.status==='won'?' '+cn(s.payout):'')+'</span></span></div>').join('');
  return '<div class="profh"><div class="avatar" aria-hidden="true">'+esc(d.username.slice(0,1).toUpperCase())+'</div><div><h2 class="pname">'+esc(d.username)+'</h2><div class="small muted">Joined '+esc(new Date(d.joined).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}))+'</div></div></div>'+
    '<div class="proj"><div class="kv"><div class="k">Coins</div><div class="v">'+COIN+' '+cn(d.balance)+'</div></div><div class="kv"><div class="k">Today</div><div class="v" style="color:var(--'+(d.today_net>=0?'over':'under')+')">'+sgn(+d.today_net)+'</div></div><div class="kv"><div class="k">All-time net</div><div class="v" style="color:var(--'+(d.alltime_net>=0?'over':'under')+')">'+sgn(+d.alltime_net)+'</div></div></div>'+
    '<h4 class="sub">Badges</h4>'+bh+(bl.length?'<div class="shrow"><span class="small muted">Share:</span>'+['champion','trash','active','convo','king','hot'].filter(k=>d.badges[k]).map(k=>'<button class="shbtn" data-act="sh-open" data-k="badge" data-b="'+k+'" data-u="'+esc(d.username)+'">'+BADGE[k].e+' '+esc(BADGE[k].n)+'</button>').join('')+'</div>':'')+badgeLegend()+
    '<h4 class="sub">Battle record</h4><div class="proj">'+recs+'</div>'+
    '<h4 class="sub">Recent battles</h4>'+(bats||'<div class="small muted">No battles yet.</div>')+
    '<h4 class="sub">Slips <span class="hint">'+(sl.won||0)+' won · '+(sl.lost||0)+' lost · '+(sl.pending||0)+' open</span></h4>'+(slips||'<div class="small muted">No practice bets yet.</div>')+
    (mine?'<div class="btnrow"><button class="btn" data-act="signout">Sign out</button></div>':'')+PRACTICE_NOTE;
}

/* ---------- events (capture phase: these run before the older handlers and replace them when accounts are on) ---------- */
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act]'); if(!t) return;
  const act=t.getAttribute('data-act');
  const stop=()=>{ e.stopPropagation(); e.preventDefault(); };
  if(act==='signin'){ stop(); if(!SOC.sb){ S.flash=SOC.state==='off'?'Sign-in is not set up on this site yet.':'Still connecting…'; renderBank(); return; } openModal('in'); return; }
  if(act==='su-tab'){ stop(); SOC.modal.kind=t.getAttribute('data-k'); SOC.modal.msg=''; drawModal(); return; }
  if(act==='su-close'){ stop(); if(SOC.modal&&SOC.modal.kind==='name') return; closeModal(); return; }
  if(act==='su-up'){ stop(); doSignUp(); return; }
  if(act==='su-in'){ stop(); doSignIn(); return; }
  if(act==='su-claim'){ stop(); doClaim(); return; }
  if(act==='su-out'){ stop(); closeModal(); signOut(); return; }
  if(act==='signout'){ stop(); signOut(); return; }
  if(act==='profile'){ stop(); const u=t.getAttribute('data-u'); if(u) openProfile(u); return; }
  if(act==='lbtab'){ stop(); SOC.boardTab=t.getAttribute('data-t'); const b=document.getElementById('board-body'); if(b) b.innerHTML=boardBodyHtml(); return; }
  if(act==='chat-send'){ stop(); sendChatMsg(); return; }
  if(act==='chat-del'){ stop(); const id=+t.getAttribute('data-id'); SOC.sb.rpc('delete_chat',{p_id:id}).then(r=>{ if(r.error){ const n=document.getElementById('chatnote'); if(n) n.textContent=r.error.message; return; } const m=SOC.chat.find(x=>x.id===id); if(m){ m.deleted=true; m.body=''; m.img=null; renderChat(false); } }); return; }
  if(act==='mention-pick'){ stop(); pickMention(t.getAttribute('data-u')); return; }
  if(!SOC.on) return;
  if(act==='place'){ stop(); placeBetServer(); return; }
  if(act==='stake-chip'){ stop(); if(!SOC.me){ S.slipMsg='Sign in to bet.'; renderSlip(); return; } const v=t.getAttribute('data-v'); const b=SOC.me.balance; const amt=v==='max'?b:b*(+v/100); S.stake=String(Math.max(0.01,Math.floor(amt*100)/100)); renderSlip(); return; }
},true);
document.addEventListener('input',function(e){
  const t=e.target; if(!t) return;
  if(t.id==='su-name'){ checkAvail(); return; }
  if(t.getAttribute&&t.getAttribute('data-in')==='chattext'){ SOC.draft=t.value; updateSugg(); }
});
document.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&e.target&&e.target.id==='chatin'){ e.preventDefault(); const s=document.querySelector('#chatsugg .sg'); if(s&&mentionQuery()){ pickMention(s.getAttribute('data-u')); return; } sendChatMsg(); }
  if(e.key==='Enter'&&e.target&&/^su-/.test(e.target.id||'')&&SOC.modal){ e.preventDefault(); const k=SOC.modal.kind; if(k==='name') doClaim(); else if(k==='up') doSignUp(); else doSignIn(); }
  if(e.key==='Escape'&&SOC.modal&&SOC.modal.kind!=='name') closeModal();
});
document.addEventListener('change',async function(e){
  const t=e.target; if(!t.getAttribute||t.getAttribute('data-in')!=='chatfile') return;
  const f=t.files&&t.files[0]; t.value=''; if(!f) return;
  const note=document.getElementById('chatnote'); if(note) note.textContent='Preparing your picture…';
  try{ SOC.img=await prepImage(f); await sendChatMsg(); }catch(err){ SOC.img=null; if(note) note.textContent=String(err.message||err); }
});
