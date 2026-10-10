/* ================= shop, 30-day pass, gifts, direct messages, online/offline, profile visitors, battle invites =================
   Practice coins only. Needs supabase/patch_shop_v8.sql in the project; until it is applied every call fails with "function not found" and the
   screens show a setup note instead (nothing else in the app is affected). */
const SHP={pick:'',tab:'shop',st:null,on:null,inbox:null,with:null,thread:[],msg:'',busy:false,vis:null,missing:false,unread:0,invite:null,to:{},note:{},pex:{},pexBusy:{},dailyFor:'',dm:''};
const shFmt=t=>{ try{ return new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric'}); }catch(e){ return ''; } };
const shAgo=t=>{ if(!t) return 'a while ago'; const m=Math.max(0,Math.round((Date.now()-Date.parse(t))/60000)); return m<2?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'; };
function shErr(e){ const m=String((e&&e.message)||e||''); if(/could not find|schema cache|does not exist|not exist/i.test(m)) SHP.missing=true; return m; }
function shCall(fn,args){ return SOC.sb.rpc(fn,args||{}).then(r=>{ if(r.error) throw r.error; return r.data; }); }
function shReady(){ return !!(SOC.on&&SOC.sb&&SOC.user&&SOC.me); }
function shBadge(){ return SHP.unread||''; }
function shPaint(){ if(S.view==='shop'){ const b=document.getElementById('sh-body'); if(b&&!(document.activeElement&&b.contains(document.activeElement)&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) b.innerHTML=shBody(); const t=document.getElementById('sh-tabs'); if(t) t.innerHTML=shTabs(); }
  const s=document.getElementById('sh-strip'); if(s) s.innerHTML=shStripInner(); const bx=document.getElementById('sh-thread'); if(bx){ const atEnd=bx.scrollHeight-bx.scrollTop-bx.clientHeight<60; bx.innerHTML=shThreadHtml(); if(atEnd) bx.scrollTop=bx.scrollHeight; } }
function shFlash(m){ SHP.msg=m; shPaint(); }

/* ---------- loaders ---------- */
function shLoadShop(){ if(!shReady()) return; shCall('shop_state').then(d=>{ SHP.st=d; if(SOC.me&&d&&d.balance!=null){ SOC.me.balance=+d.balance; renderBank(); } shPaint(); }).catch(e=>{ SHP.msg=shErr(e); shPaint(); }); }
function shLoadOnline(){ if(!shReady()||SHP.missing) return; shCall('who_online').then(d=>{ SHP.on=d||[]; shPaint(); }).catch(shErr); }
function shLoadInbox(){ if(!shReady()) return; shCall('dm_inbox').then(d=>{ SHP.inbox=d||[]; SHP.unread=SHP.inbox.reduce((n,x)=>n+(+x.unread||0),0); navRefresh(); shPaint(); }).catch(e=>{ SHP.msg=shErr(e); shPaint(); }); }
function shLoadThread(){ if(!shReady()||!SHP.with) return; const w=SHP.with.id; shCall('dm_thread',{p_with:w,p_after:0}).then(d=>{ if(!SHP.with||SHP.with.id!==w) return; const n=(d||[]).length; const changed=n!==SHP.thread.length; SHP.thread=d||[]; if(changed){ shPaint(); const bx=document.getElementById('sh-thread'); if(bx) bx.scrollTop=bx.scrollHeight; } }).catch(e=>{ SHP.msg=shErr(e); shPaint(); }); }
function shLoadVis(){ if(!shReady()) return; shCall('my_visitors').then(d=>{ SHP.vis=d; shPaint(); }).catch(e=>{ SHP.msg=shErr(e); shPaint(); }); }
function shLoadTab(){ if(SHP.tab==='shop'){ shLoadShop(); shLoadOnline(); } else if(SHP.tab==='msg'){ if(SHP.with) shLoadThread(); else shLoadInbox(); } else if(SHP.tab==='online') shLoadOnline(); else if(SHP.tab==='vis') shLoadVis(); }
function shAfterRender(){
  if(S.view!=='profile'){ SHP.pex={}; SHP.pexBusy={}; SHP.room={}; SHP.roomBusy={}; }
  if(S.view==='vault'&&SOC.user) vtLoad();
  if(S.view==='chat') shLoadOnline();
  if(S.view==='shop'&&SOC.user) shLoadTab();
}
/* presence, the daily coins and the unread badge */
function shTick(){
  if(!shReady()||document.hidden||SHP.missing) return;
  shCall('touch_presence').catch(shErr);
  if(SHP.dailyFor!==SOC.user.id){ SHP.dailyFor=SOC.user.id; shCall('claim_daily').then(d=>{ if(d&&d.claimed){ S.flash='+'+d.amount+' daily coins'+(d.pass?' (pass bonus)':''); if(SOC.me) SOC.me.balance=+d.balance; renderBank(); } }).catch(shErr); }
  shCall('dm_unread').then(n=>{ const v=+n||0; if(v!==SHP.unread){ SHP.unread=v; navRefresh(); } }).catch(shErr);
  if(S.view==='chat'||(S.view==='shop'&&SHP.tab!=='msg')) shLoadOnline();
  if(S.view==='shop'&&SHP.tab==='msg'&&!SHP.with) shLoadInbox();
}
setInterval(shTick,45000); setTimeout(shTick,3500);
setInterval(()=>{ if(S.view==='shop'&&SHP.tab==='msg'&&SHP.with&&!document.hidden) shLoadThread(); },5000);

/* ---------- online / offline ---------- */
const shDot=on=>'<i class="shdot '+(on?'on':'off')+'" title="'+(on?'online':'offline')+'"></i>';
function shMembers(){ return (SHP.on||[]).filter(m=>!SOC.me||m.id!==SOC.me.id); }
function shChip(m){ return '<button class="shchip" data-act="sh-msg-user" data-id="'+m.id+'" data-n="'+esc(m.username)+'">'+shDot(m.online)+esc(m.username)+(m.pass?' ⭐':'')+'</button>'; }
function shStripInner(){
  if(SHP.missing||!SHP.on) return ''; const ms=shMembers(); const on=ms.filter(m=>m.online), off=ms.filter(m=>!m.online);
  return '<details class="d"><summary>Online now ('+on.length+') · Offline ('+off.length+')</summary>'+(on.length?'<div class="shrow">'+on.map(shChip).join('')+'</div>':'<div class="small muted">Nobody else is online right now.</div>')+
    (off.length?'<div class="small muted">Offline</div><div class="shrow">'+off.slice(0,40).map(shChip).join('')+'</div>':'')+'<div class="small muted">Tap a name to message them. Online means active in the last 2 minutes.</div></details>';
}
function shChatStrip(){ return '<div id="sh-strip">'+shStripInner()+'</div>'; }

/* ---------- views ---------- */
function shTabs(){ return [['shop','Shop'],['msg','Messages'+(SHP.unread?' ('+SHP.unread+')':'')],['online','Online'],['vis','Visitors']].map(x=>'<button data-act="sh-tab" data-k="'+x[0]+'" aria-pressed="'+(SHP.tab===x[0])+'">'+x[1]+'</button>').join(''); }
function shopView(){
  const h='<section class="game"><div class="sec">';
  if(!SOC.on||SOC.state!=='ready') return h+socNote()+'</div></section>';
  if(!SOC.user) return h+'<div class="small">Sign in to use the shop, messages, and the online list.</div><div class="btnrow"><button class="btn solid" data-act="signin">Sign in</button></div></div></section>';
  return h+'<div class="seg" id="sh-tabs" role="group" aria-label="Section">'+shTabs()+'</div><div id="sh-body">'+shBody()+'</div></div></section>';
}
function shBody(){
  if(SHP.missing) return '<div class="flash">The shop needs a one-time database update (supabase/patch_shop_v8.sql). Until it is applied you can look around but not buy. Everything else in the app works.</div>'+(SHP.tab==='shop'?shShopHtml():'');
  const m=SHP.msg?'<div class="flash">'+esc(SHP.msg)+'</div>':'';
  return m+(SHP.tab==='shop'?shShopHtml():SHP.tab==='msg'?shMsgHtml():SHP.tab==='online'?shOnlineHtml():shVisHtml());
}
const SH_CAT=[['corn',"It's corn",'🌽',5,'fun'],['wink','Wink wink','😉',5,'fun'],['heart','Heart','❤️',10,'fun'],['clap','Clap clap','👏',10,'fun'],['icecream','Ice cream','🍦',10,'fun'],['chili','Chili','🌶️',15,'fun'],['rose','Rose','🌹',25,'fun'],['donut','Doughnut','🍩',30,'fun'],['pizza','Pizza slice','🍕',40,'fun'],['cook','Let em cook','👨‍🍳',50,'fun'],['fire','Hot streak','🔥',60,'fun'],['rocket','Rocket','🚀',80,'fun'],['trophy','Trophy','🏆',100,'fun'],['diamond','Diamond','💎',120,'fun'],['goat','GOAT','🐐',150,'fun'],['crown','Crown','👑',250,'fun'],['car','Sports car','🏎️',400,'fun'],['football','Football','🏈',15,'sport'],['basketball','Basketball','🏀',15,'sport'],['baseball','Baseball','⚾',15,'sport'],['hockey','Hockey stick','🏒',15,'sport'],['soccer','Soccer ball','⚽',15,'sport'],['golf','Golf flag','⛳',20,'sport'],['glove','Boxing glove','🥊',30,'sport'],['sneakers','Sneakers','👟',40,'sport'],['gold','Gold medal','🥇',60,'sport'],['belt','Champ belt','🏅',90,'sport'],['hotdog','Hot dog','🌭',10,'fan'],['popcorn','Popcorn','🍿',10,'fan'],['nachos','Nachos','🌮',10,'fan'],['finger','Foam finger','👆',15,'fan'],['bell','Cowbell','🔔',15,'fan'],['paint','Face paint','🎨',15,'fan'],['flag','Pennant','🚩',20,'fan'],['mega','Megaphone','📣',20,'fan'],['cap','Fan cap','🧢',30,'fan'],['scarf','Team scarf','🧣',35,'fan'],['ticket','Season ticket','🎟️',40,'fan'],['jersey','Jersey','👕',60,'fan'],['ring','Champion ring','💍',300,'fan'],['stadium','Stadium','🏟️',200,'fan'],['lion','Blue Lion','🦁',75,'team'],['eagle','Gridiron Eagle','🦅',75,'team'],['bear','Prairie Bear','🐻',75,'team'],['cheese','Cheese Hat','🧀',40,'team'],['cowboy','Lone Star Cowboy','🤠',75,'team'],['dolphin','Dolphin','🐬',75,'team'],['raven','Raven','🐦‍⬛',75,'team'],['tiger','Tiger','🐯',75,'team'],['bull','Bull','🐂',75,'team'],['pirate','Pirate Flag','🏴‍☠️',75,'team'],['ram','Ram','🐏',75,'team'],['panther','Panther','🐆',75,'team'],['horse','Wild Horse','🐎',75,'team'],['bat','Night Bat','🦇',75,'team'],['gear','Motor City Gear','⚙️',50,'team']];
const SH_TABS=[['all','All'],['sport','Sports'],['fan','Fan gear'],['team','Teams'],['fun','Fun']];
const shCatOf=id=>{ const c=SH_CAT.find(x=>x[0]===id); return c?c[4]:'fun'; };
function shTier(p){ return p<=10?1:p<=30?2:p<=60?3:p<=120?4:5; }
function shShopHtml(){
  const real=SHP.st&&!SHP.missing;
  const s=real?SHP.st:{balance:SOC.me?SOC.me.balance:0,pass_price:1000,discount_pct:20,pass:false,daily_ready:false,daily_amount:10,inventory:[],items:SH_CAT.map(x=>({id:x[0],name:x[1],emoji:x[2],price:x[3],pay:x[3],days:2+Math.floor(x[3]/50),blurb:''}))};
  const cats='<div class="gcats">'+SH_TABS.map(c=>'<button data-act="sh-cat" data-id="'+c[0]+'" aria-pressed="'+((SHP.cat||'all')===c[0])+'">'+c[1]+'</button>').join('')+'</div>';
  if(!SHP.st&&!SHP.missing) return '<div class="small muted">Loading…</div>';
  const pick=(s.items||[]).find(i=>i.id===SHP.pick);
  const pass='<div class="gpass"><div class="gpt"><b>👑 30-day pass</b><span>'+COIN+' '+cn(s.pass_price)+'</span></div><div class="gpl">'+cn(20)+' coins a day instead of '+cn(10)+' · see who visits your page · '+s.discount_pct+'% off every gift</div>'+
    (s.pass?'<div class="gpon">Active until '+esc(shFmt(s.pass_until))+'</div>':'')+'<button class="gpb" data-act="sh-pass"'+(SHP.busy||!real?' disabled':'')+'>'+(s.pass?'Add 30 days':'Get the pass')+'</button></div>';
  const tiles=cats+'<div class="ggrid">'+(s.items||[]).filter(i=>(SHP.cat||'all')==='all'||shCatOf(i.id)===SHP.cat).map(i=>'<button class="gt t'+shTier(i.price)+(SHP.pick===i.id?' on':'')+'" data-act="sh-pick" data-id="'+esc(i.id)+'" aria-pressed="'+(SHP.pick===i.id)+'"><span class="gE">'+esc(i.emoji)+'</span><b>'+esc(i.name)+'</b><span class="gp"><i class="gc"></i>'+(i.pay<i.price?'<s>'+cn(i.price)+'</s> ':'')+cn(i.pay)+'</span></button>').join('')+'</div>';
  const bar='<div class="gbar">'+(pick?'<span class="gbl"><span class="gE2">'+esc(pick.emoji)+'</span><span><b>'+esc(pick.name)+'</b><br><small>send it within '+pick.days+' days</small></span></span><button class="gbuy" data-act="sh-buy" data-id="'+esc(pick.id)+'"'+(SHP.busy||!real?' disabled':'')+'><i class="gc"></i> Buy '+cn(pick.pay)+'</button>':'<span class="gbl gmute">Tap a gift to pick it</span>')+'<span class="gbal2"><i class="gc"></i><b>'+cn(s.balance)+'</b></span></div>';
  const mem=shMembers();
  const inv=(s.inventory||[]).filter(x=>!x.sent_at).map(x=>'<div class="ginv"><span class="gE2">'+esc(x.emoji)+'</span><span class="gil"><b>'+esc(x.name)+'</b><small>send by '+esc(shFmt(x.use_by))+'</small></span>'+
    '<select data-in="sh-to" data-inv="'+x.id+'" aria-label="Send to"><option value="">Send to…</option>'+mem.map(p=>'<option value="'+p.id+'"'+((SHP.to[x.id]||SHP.giftTo)===p.id?' selected':'')+'>'+(p.online?'● ':'○ ')+esc(p.username)+'</option>').join('')+'</select>'+
    '<input class="num" data-in="sh-note" data-inv="'+x.id+'" maxlength="140" placeholder="Note (optional)" value="'+esc(SHP.note[x.id]||'')+'" aria-label="Note"><button class="gsend" data-act="sh-send" data-inv="'+x.id+'">Send</button></div>').join('');
  const sent=(s.inventory||[]).filter(x=>x.sent_at).map(x=>'<span class="gsent">'+esc(x.emoji)+' '+esc(x.name)+' → '+esc(x.sent_to_name||'someone')+'</span>').join('');
  return '<div class="gshop"><div class="ghd"><div><b>Send a gift</b><span>Buy with practice coins, send in chat or messages</span></div></div>'+pass+tiles+bar+
    '<div class="gsec">Your gifts <small>sent gifts show in chat and on their profile</small></div>'+(inv||'<div class="gmute2">Nothing to send yet. Pick a gift above.</div>')+(sent?'<div class="gsec">Recently sent</div><div class="gsents">'+sent+'</div>':'')+
    '<div class="gmute2">Daily coins: '+(s.daily_ready?'ready, added automatically when you open the app':'collected today')+' · '+s.daily_amount+' a day'+(s.pass?' with your pass':'')+'</div></div>';
}
function shMsgHtml(){
  if(SHP.with){
    return '<div class="btnrow"><button class="btn" data-act="sh-back">‹ Messages</button><button class="btn" data-act="profile" data-u="'+esc(SHP.with.name)+'">'+esc(SHP.with.name)+'\'s profile</button></div>'+
      '<div class="chatbox" id="sh-thread" aria-live="polite">'+shThreadHtml()+'</div>'+
      '<div class="composer"><input class="num wide" id="shdm" data-in="sh-dm" maxlength="500" placeholder="Message '+esc(SHP.with.name)+'" aria-label="Message" autocomplete="off" value="'+esc(SHP.dm)+'"><button class="btn solid" data-act="sh-dm-send">Send</button></div>';
  }
  const ib=SHP.inbox; if(!ib) return '<div class="small muted">Loading…</div>';
  return (ib.length?ib.map(x=>'<button class="rlink" data-act="sh-open" data-id="'+x.user_id+'" data-n="'+esc(x.username)+'"><span>'+shDot(x.online)+'<b>'+esc(x.username)+'</b> <span class="muted small">'+esc((x.mine?'You: ':'')+x.last)+'</span></span><span>'+(x.unread>0?'<span class="badge warn">'+x.unread+' new</span> ':'')+'<span class="muted small">'+esc(shAgo(x.created_at))+'</span></span></button>').join(''):'<div class="small muted">No messages yet. Open the Online tab and tap a name.</div>');
}
function shThreadHtml(){
  if(!SHP.thread.length) return '<div class="small muted">No messages yet. Say hi.</div>';
  return SHP.thread.map(m=>{ let b='';
    if(m.gift_name) b+='<div class="mt">'+esc(m.gift_emoji)+' <b>'+esc(m.gift_name)+'</b> '+(m.mine?'sent':'for you')+(Date.parse(m.gift_until)>Date.now()?' <span class="muted small">active until '+esc(shFmt(m.gift_until))+'</span>':' <span class="muted small">expired</span>')+'</div>';
    if(m.body) b+='<div class="mt">'+esc(m.body)+'</div>';
    if(m.battle_id) b+='<div class="btnrow"><button class="btn solid" data-act="bt-open" data-id="'+m.battle_id+'">Open battle</button></div>';
    return '<div class="msg'+(m.mine?' mine':'')+'"><div class="mh"><span class="muted">'+esc(fmtClock(Date.parse(m.created_at)))+'</span></div>'+b+'</div>'; }).join('');
}
function shOnlineHtml(){
  if(!SHP.on) return '<div class="small muted">Loading…</div>'; const ms=shMembers(); if(!ms.length) return '<div class="small muted">No other members yet.</div>';
  const row=m=>'<div class="shmem">'+shDot(m.online)+'<b>'+esc(m.username)+'</b>'+(m.pass?' ⭐':'')+'<span class="small muted">'+(m.online?'online':'seen '+shAgo(m.last_seen))+'</span><span class="shacts">'+
    '<button class="btn" data-act="sh-msg-user" data-id="'+m.id+'" data-n="'+esc(m.username)+'">Message</button><button class="btn" data-act="sh-challenge" data-id="'+m.id+'" data-n="'+esc(m.username)+'">Send a battle</button><button class="btn" data-act="profile" data-u="'+esc(m.username)+'">Profile</button></span></div>';
  return ms.filter(m=>m.online).map(row).join('')+ms.filter(m=>!m.online).map(row).join('');
}
function shVisHtml(){
  const v=SHP.vis; if(!v) return '<div class="small muted">Loading…</div>';
  if(v.locked) return '<div class="small">'+(v.count?'<b>'+v.count+'</b> player'+(v.count===1?'':'s')+' looked at your profile in the last 30 days. ':'')+'The 30-day pass shows you exactly who.</div><div class="btnrow"><button class="btn solid" data-act="sh-tab" data-k="shop">See the pass</button></div>';
  return (v.list&&v.list.length)?v.list.map(x=>'<div class="shmem"><b>'+uLink(x.username)+'</b><span class="small muted">'+esc(shAgo(x.last_at))+(x.n>1?' · '+x.n+' visits':'')+'</span></div>').join(''):'<div class="small muted">Nobody has visited your profile yet.</div>';
}

/* ---------- profile: online dot, pass badge, active gifts, message / gift / battle buttons ---------- */
function shProfileBlock(d){
  if(SHP.missing||!SOC.user||!SOC.me) return '';
  const x=SHP.pex[d.id]; if(!x){ shLoadPex(d); return ''; }
  const mine=SOC.me.id===d.id;
  const g=(x.gifts||[]).map(i=>'<span class="vc">'+esc(i.emoji)+' '+esc(i.name)+' <span class="muted">from '+esc(i.from_name||'?')+' · until '+esc(shFmt(i.until))+'</span></span>').join('');
  return vtProfileRoom(d)+'<div class="shprof"><div class="small">'+shDot(x.online)+(x.online?'Online now':'Last seen '+shAgo(x.last_seen))+(x.pass?' · ⭐ Pass holder':'')+'</div>'+(g?'<h4 class="sub">Gifts right now</h4><div class="vcs">'+g+'</div>':'')+
    (mine?'':'<div class="btnrow"><button class="btn" data-act="sh-msg-user" data-id="'+d.id+'" data-n="'+esc(d.username)+'">Message</button><button class="btn" data-act="sh-gift-user" data-id="'+d.id+'" data-n="'+esc(d.username)+'">Send a gift</button><button class="btn" data-act="sh-challenge" data-id="'+d.id+'" data-n="'+esc(d.username)+'">Send a battle</button></div>')+'</div>';
}
function shLoadPex(d){
  if(SHP.pexBusy[d.id]) return; SHP.pexBusy[d.id]=1;
  if(SOC.me&&SOC.me.id!==d.id) shCall('record_visit',{p_profile:d.id}).catch(shErr);
  shCall('profile_extras',{p_user:d.id}).then(x=>{ SHP.pex[d.id]=x||{gifts:[]}; const el=document.getElementById('prof-body'); if(el&&S.view==='profile') el.innerHTML=profileBodyHtml(S.profName); }).catch(e=>{ shErr(e); SHP.pex[d.id]={gifts:[]}; });
}

/* ---------- send a battle to a person ---------- */
function shInviteHtml(b){
  if(SHP.missing||!shReady()||!SHP.on) { if(!SHP.on) shLoadOnline(); return ''; }
  const mem=shMembers(); if(!mem.length) return '';
  return '<div class="shinvite"><b>Send this battle to a player</b><div class="small muted">Only they can accept it, and they get a message with a link.</div><div class="btnrow"><select data-in="sh-binv" aria-label="Player">'+mem.map(p=>'<option value="'+p.id+'"'+(SHP.invite&&SHP.invite.id===p.id?' selected':'')+'>'+(p.online?'● ':'○ ')+esc(p.username)+'</option>').join('')+'</select><button class="btn solid" data-act="sh-invite" data-id="'+b.id+'">Send battle</button></div>'+(b.invited?'<div class="small ok">Already sent to a player.</div>':'')+'</div>';
}
function shAfterCreate(id){ if(!SHP.invite) return; const t=SHP.invite; SHP.invite=null; shCall('invite_battle',{p_battle:id,p_user:t.id}).then(()=>{ S.flash='Battle sent to '+t.name; renderBank(); }).catch(e=>{ S.flash=shErr(e); renderBank(); }); }

/* ---------- events (capture phase, own acts only) ---------- */
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act^="sh-"]'); if(!t) return; const act=t.getAttribute('data-act'); const stop=()=>{ e.stopPropagation(); e.preventDefault(); };
  if(!shReady()){ if(act.indexOf('sh-')===0){ stop(); if(SOC.sb) openModal('in'); } return; }
  const id=t.getAttribute('data-id'), nm=t.getAttribute('data-n');
  if(act==='sh-tab'){ stop(); SHP.tab=t.getAttribute('data-k'); SHP.msg=''; S.comm='shop'; if(S.view!=='shop'){ S.view='shop'; render(); } else shPaint(); shLoadTab(); return; }
  if(act==='sh-cat'){ stop(); SHP.cat=id; shPaint(); return; }
  if(act==='sh-pick'){ stop(); SHP.pick=(SHP.pick===id?'':id); shPaint(); return; }
  if(act==='sh-back'){ stop(); SHP.with=null; SHP.thread=[]; shLoadInbox(); shPaint(); return; }
  if(act==='sh-open'||act==='sh-msg-user'){ stop(); SHP.with={id:id,name:nm}; SHP.thread=[]; SHP.tab='msg'; SHP.msg=''; if(S.view!=='shop'){ S.view='shop'; render(); window.scrollTo(0,0); } else shPaint(); shLoadThread(); return; }
  if(act==='sh-gift-user'){ stop(); SHP.tab='shop'; SHP.msg='Pick an item below and choose '+nm+' in the list.'; if(!SHP.on) shLoadOnline(); SHP.giftTo=id; S.view='shop'; render(); window.scrollTo(0,0); return; }
  if(act==='sh-challenge'){ stop(); SHP.invite={id:id,name:nm}; S.view='battle'; S.flash='Create a battle below. It will be sent to '+nm+'.'; render(); window.scrollTo(0,0); return; }
  if(act==='sh-dm-send'){ stop(); const inp=document.getElementById('shdm'); const body=(inp&&inp.value||'').trim(); if(!body||!SHP.with) return; if(inp) inp.value=''; SHP.dm=''; shCall('send_dm',{p_to:SHP.with.id,p_body:body}).then(()=>shLoadThread()).catch(er=>{ SHP.msg=shErr(er); if(inp) inp.value=body; shPaint(); }); return; }
  if(act==='sh-buy'){ stop(); if(SHP.busy) return; SHP.busy=true; shCall('buy_item',{p_item:id}).then(d=>{ SHP.busy=false; SHP.msg='Bought. You have '+d.days+' days to send it.'; shLoadShop(); }).catch(er=>{ SHP.busy=false; SHP.msg=shErr(er); shPaint(); }); return; }
  if(act==='sh-pass'){ stop(); if(SHP.busy) return; SHP.busy=true; shCall('buy_pass').then(()=>{ SHP.busy=false; SHP.msg='Pass active for 30 more days.'; shLoadShop(); }).catch(er=>{ SHP.busy=false; SHP.msg=shErr(er); shPaint(); }); return; }
  if(act==='sh-send'){ stop(); const inv=t.getAttribute('data-inv'); const to=SHP.to[inv]||(document.querySelector('select[data-inv="'+inv+'"]')||{}).value; if(!to){ SHP.msg='Pick who to send it to.'; shPaint(); return; }
    shCall('send_item',{p_inv:+inv,p_to:to,p_note:SHP.note[inv]||''}).then(()=>{ SHP.msg='Sent. It is in the chat and on their profile.'; delete SHP.to[inv]; delete SHP.note[inv]; shLoadShop(); }).catch(er=>{ SHP.msg=shErr(er); shPaint(); }); return; }
  if(act==='sh-invite'){ stop(); const sel=document.querySelector('select[data-in="sh-binv"]'); if(!sel||!sel.value) return; shCall('invite_battle',{p_battle:+id,p_user:sel.value}).then(()=>{ BT.msg='Battle sent.'; if(typeof btOpen==='function') btOpen(+id); }).catch(er=>{ BT.msg=shErr(er); btRender(); }); return; }
},true);
document.addEventListener('input',function(e){ const t=e.target; if(!t.getAttribute) return; const k=t.getAttribute('data-in'); if(k==='sh-note') SHP.note[t.getAttribute('data-inv')]=t.value; if(k==='sh-dm') SHP.dm=t.value; });
document.addEventListener('change',function(e){ const t=e.target; if(!t.getAttribute) return; if(t.getAttribute('data-in')==='sh-to') SHP.to[t.getAttribute('data-inv')]=t.value; });
document.addEventListener('keydown',function(e){ if(e.key==='Enter'&&e.target&&e.target.id==='shdm'){ e.preventDefault(); const b=document.querySelector('[data-act="sh-dm-send"]'); if(b) b.click(); } });

/* keep the selected tab visible in the sliding bottom bar */
(function(){ function fit(){ try{ const n=document.getElementById('nav'); const a=n&&n.querySelector('.nv[aria-pressed="true"]'); if(a&&n.scrollWidth>n.clientWidth){ const L=a.offsetLeft-(n.clientWidth-a.offsetWidth)/2; n.scrollTo({left:Math.max(0,L)}); } }catch(e){} }
  try{ const n=document.getElementById('nav'); if(n) new MutationObserver(fit).observe(n,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed']}); }catch(e){} })();


/* ---------- Community: Chat, Shop and your Profile in one tab ---------- */
const COMM_VIEWS={chat:1,shop:1,vault:1,profile:1};
function commBar(){
  const mine=SOC.me&&SOC.me.username; const own=S.view==='profile'&&mine&&S.profName===mine;
  const b=(k,l,on,badge)=>'<button data-act="comm" data-k="'+k+'" aria-pressed="'+on+'">'+l+(badge?'<i class="nb">'+badge+'</i>':'')+'</button>';
  const men=typeof socUnseen==='function'?socUnseen():0;
  return '<div class="commbar" role="group" aria-label="Community">'+b('chat','💬 Chat',S.view==='chat',men?'@'+men:((typeof chatNew==='function'&&chatNew())||''))+b('shop','🎁 Shop',S.view==='shop',shBadge())+b('vault','🗄️ Vault',S.view==='vault')+b('profile','🙂 Profile',S.view==='profile')+'</div>';
}
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act="comm"]'); if(!t) return; e.stopPropagation(); e.preventDefault();
  const k=t.getAttribute('data-k'); S.comm=k;
  if(k==='profile'){ const me=SOC.me&&SOC.me.username; if(me){ openProfile(me); return; } if(SOC.sb&&!SOC.user){ openModal('in'); return; } S.view='profile'; render(); window.scrollTo(0,0); return; }
  S.view=k; render(); window.scrollTo(0,0);
},true);


/* ---------- the vault: gifts people sent you, and a room you decorate (others see it on your profile) ---------- */
const VT={data:null,sel:null,slot:null,busy:false,msg:'',saveT:null,room:{}};
const VT_WALL={navy:'Navy',sunset:'Sunset',forest:'Forest',royal:'Royal',neon:'Neon',brick:'Brick'}, VT_FLOOR={wood:'Wood',turf:'Turf',court:'Court',carpet:'Carpet',tile:'Tile'};
function vtLoad(){ if(!shReady()) return; shCall('my_vault').then(d=>{ VT.data=d; shPaintVault(); }).catch(e=>{ VT.msg=shErr(e); shPaintVault(); }); }
function shPaintVault(){ if(S.view!=='vault') return; const b=document.getElementById('vt-body'); if(b) b.innerHTML=vtBody(); }
function vtRoomHtml(room,items,edit){
  /* items: [{slot,emoji,name,from_name}] */
  const by={}; (items||[]).forEach(i=>{ by[i.slot]=i; });
  let cells=''; for(let n=0;n<24;n++){ const it=by[n]; cells+='<button class="vtc'+(it?' has':'')+(edit&&VT.slot===n?' sel':'')+'" '+(edit?'data-act="vt-slot" data-id="'+n+'"':'disabled')+' title="'+(it?esc(it.name+(it.from_name?' from '+it.from_name:'')):'')+'">'+(it?'<span>'+esc(it.emoji)+'</span>':'')+'</button>'; }
  return '<div class="vtroom w-'+esc(room.wall||'navy')+' f-'+esc(room.floor||'wood')+'"><div class="vtgrid">'+cells+'</div></div>';
}
function vtItemsFromData(d){ const slots=(d.room&&d.room.slots)||{}; const g={}; (d.gifts||[]).forEach(x=>{ g[x.id]=x; }); const out=[]; Object.keys(slots).forEach(k=>{ const x=g[slots[k]]; if(x) out.push({slot:+k,emoji:x.emoji,name:x.name,from_name:x.from_name,id:x.id}); }); return out; }
function vtBody(){
  if(SHP.missing) return '<div class="flash">The vault needs the one-time database update (supabase/patch_shop_v8.sql). Until it is applied you can look around but not save.</div>'+vtPreview();
  const d=VT.data; if(!d) return '<div class="small muted">Loading your vault…</div>';
  const room=d.room||{wall:'navy',floor:'wood',slots:{}}; const items=vtItemsFromData(d); const placed=new Set(items.map(i=>i.id));
  const tray=(d.gifts||[]).map(x=>'<button class="vtg'+(VT.sel===x.id?' on':'')+(placed.has(x.id)?' used':'')+'" data-act="vt-pick" data-id="'+x.id+'" title="'+esc(x.name+' from '+(x.from_name||'?'))+'"><span>'+esc(x.emoji)+'</span><small>'+esc(x.name)+'</small><i>'+esc(x.from_name||'')+'</i></button>').join('');
  const chip=(map,cur,act)=>Object.keys(map).map(k=>'<button class="vtch" data-act="'+act+'" data-id="'+k+'" aria-pressed="'+(cur===k)+'">'+map[k]+'</button>').join('');
  return (VT.msg?'<div class="flash">'+esc(VT.msg)+'</div>':'')+
    '<div class="vthead"><b>Your room</b><span>'+(d.gifts||[]).length+' gift'+((d.gifts||[]).length===1?'':'s')+' in your vault · everyone who opens your profile sees this room</span></div>'+
    vtRoomHtml(room,items,true)+
    '<div class="vthint">'+(VT.sel?'Now tap a spot in the room to place it.':VT.slot!=null?'Now tap a gift below to put it in that spot.':'Tap a gift below, then a spot. Tap a placed gift to take it down.')+'</div>'+
    '<div class="vtopts"><div class="vtl">Wall</div><div class="vtrow">'+chip(VT_WALL,room.wall,'vt-wall')+'</div><div class="vtl">Floor</div><div class="vtrow">'+chip(VT_FLOOR,room.floor,'vt-floor')+'</div></div>'+
    '<div class="vthead"><b>Gifts you got</b><span>from the shop, sent by other players</span></div>'+(tray?'<div class="vttray">'+tray+'</div>':'<div class="gmute3">Nothing here yet. When someone sends you a gift it lands in your vault. Send a gift to a friend and ask them to send one back.</div>');
}
function vtPreview(){ const prev=[{slot:2,emoji:'🏆',name:'Trophy'},{slot:5,emoji:'🦁',name:'Blue Lion'},{slot:14,emoji:'🍕',name:'Pizza'},{slot:20,emoji:'🏈',name:'Football'}]; return vtRoomHtml({wall:'navy',floor:'wood'},prev,false); }
function vaultView(){
  const h='<section class="game"><div class="sec">';
  if(!SOC.on||SOC.state!=='ready') return h+socNote()+'</div></section>';
  if(!SOC.user) return h+'<div class="small">Sign in to open your vault and decorate your room.</div><div class="btnrow"><button class="btn solid" data-act="signin">Sign in</button></div></div></section>';
  return h+'<div id="vt-body">'+vtBody()+'</div></div></section>';
}
function vtSave(){ if(!VT.data) return; clearTimeout(VT.saveT); VT.saveT=setTimeout(()=>{ const r=VT.data.room; shCall('save_room',{p_wall:r.wall,p_floor:r.floor,p_slots:r.slots}).then(x=>{ if(x&&x.slots) VT.data.room.slots=x.slots; }).catch(e=>{ VT.msg=shErr(e); shPaintVault(); }); },500); }
function vtPlace(){
  const d=VT.data; if(!d||VT.sel==null||VT.slot==null) return; const r=d.room; r.slots=Object.assign({},r.slots);
  Object.keys(r.slots).forEach(k=>{ if(r.slots[k]===VT.sel) delete r.slots[k]; });
  r.slots[VT.slot]=VT.sel; VT.sel=null; VT.slot=null; vtSave(); shPaintVault();
}
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act^="vt-"]'); if(!t) return; e.stopPropagation(); e.preventDefault();
  const act=t.getAttribute('data-act'), id=t.getAttribute('data-id'), d=VT.data; if(!d) return; const r=d.room;
  if(act==='vt-pick'){ VT.sel=(VT.sel===+id?null:+id); if(VT.sel!=null&&VT.slot!=null) vtPlace(); else shPaintVault(); return; }
  if(act==='vt-slot'){ const n=+id; const cur=r.slots[n]; if(cur!=null&&VT.sel==null){ r.slots=Object.assign({},r.slots); delete r.slots[n]; vtSave(); shPaintVault(); return; } VT.slot=n; if(VT.sel!=null) vtPlace(); else shPaintVault(); return; }
  if(act==='vt-wall'){ r.wall=id; vtSave(); shPaintVault(); return; }
  if(act==='vt-floor'){ r.floor=id; vtSave(); shPaintVault(); return; }
},true);
/* a visitor's view of someone's room, on their profile */
function vtProfileRoom(d){
  const x=SHP.room&&SHP.room[d.id]; if(!x){ if(!SHP.roomBusy) SHP.roomBusy={}; if(!SHP.roomBusy[d.id]){ SHP.roomBusy[d.id]=1; shCall('get_room',{p_user:d.id}).then(r=>{ (SHP.room=SHP.room||{})[d.id]=r||{items:[]}; const el=document.getElementById('prof-body'); if(el&&S.view==='profile') el.innerHTML=profileBodyHtml(S.profName); }).catch(er=>{ shErr(er); (SHP.room=SHP.room||{})[d.id]={items:[]}; }); } return ''; }
  if(!x.items||(!x.items.length&&!x.total)) return '';
  return '<h4 class="sub">'+esc(d.username)+'\'s room <span class="hint">'+(x.total||0)+' gift'+(x.total===1?'':'s')+' in the vault</span></h4>'+vtRoomHtml(x,x.items,false);
}
