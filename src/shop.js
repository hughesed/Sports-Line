/* ================= shop, 30-day pass, gifts, direct messages, online/offline, profile visitors, battle invites =================
   Practice coins only. Needs supabase/patch_shop_v8.sql in the project; until it is applied every call fails with "function not found" and the
   screens show a setup note instead (nothing else in the app is affected). */
const SHP={tab:'shop',st:null,on:null,inbox:null,with:null,thread:[],msg:'',busy:false,vis:null,missing:false,unread:0,invite:null,to:{},note:{},pex:{},pexBusy:{},dailyFor:'',dm:''};
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
  if(S.view!=='profile'){ SHP.pex={}; SHP.pexBusy={}; }
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
  const h='<section class="game"><div class="sec"><h3>Shop &amp; messages <span class="hint">practice coins only</span></h3>';
  if(!SOC.on||SOC.state!=='ready') return h+socNote()+'</div></section>';
  if(!SOC.user) return h+'<div class="small">Sign in to use the shop, messages, and the online list.</div><div class="btnrow"><button class="btn solid" data-act="signin">Sign in</button></div></div></section>';
  return h+'<div class="seg" id="sh-tabs" role="group" aria-label="Section">'+shTabs()+'</div><div id="sh-body">'+shBody()+'</div></div></section>';
}
function shBody(){
  if(SHP.missing) return '<div class="flash">The shop needs a one-time database update (supabase/patch_shop_v8.sql). Until it is applied these screens stay empty. Everything else in the app works.</div>';
  const m=SHP.msg?'<div class="flash">'+esc(SHP.msg)+'</div>':'';
  return m+(SHP.tab==='shop'?shShopHtml():SHP.tab==='msg'?shMsgHtml():SHP.tab==='online'?shOnlineHtml():shVisHtml());
}
function shShopHtml(){
  const s=SHP.st; if(!s) return '<div class="small muted">Loading…</div>';
  const pass='<div class="shpass"><div><b>30-day pass</b> <span class="small muted">'+cn(s.pass_price)+' coins</span></div><ul class="small"><li>'+cn(20)+' coins a day instead of '+cn(10)+'</li><li>See who visited your page</li><li>'+s.discount_pct+'% off everything in the shop</li></ul>'+
    (s.pass?'<div class="small ok">Active until '+esc(shFmt(s.pass_until))+'. Buying again adds 30 more days.</div>':'')+'<button class="btn solid" data-act="sh-pass"'+(SHP.busy?' disabled':'')+'>'+(s.pass?'Add 30 days':'Buy the pass')+'</button></div>';
  const daily='<div class="small muted">Daily coins: '+(s.daily_ready?'ready, it is added automatically when you open the app.':'collected today.')+' You get '+s.daily_amount+' a day'+(s.pass?' with your pass':'')+'.</div>';
  const items='<div class="shgrid">'+(s.items||[]).map(i=>'<div class="shi"><span class="shE">'+esc(i.emoji)+'</span><b>'+esc(i.name)+'</b><span class="small muted">'+esc(i.blurb)+' Use it within '+i.days+' days.</span><span class="mono">'+COIN+' '+(i.pay<i.price?'<s class="muted">'+cn(i.price)+'</s> ':'')+cn(i.pay)+'</span><button class="btn" data-act="sh-buy" data-id="'+esc(i.id)+'"'+(SHP.busy?' disabled':'')+'>Buy</button></div>').join('')+'</div>';
  const mem=shMembers();
  const inv=(s.inventory||[]).filter(x=>!x.sent_at).map(x=>'<div class="shinv"><span class="shE">'+esc(x.emoji)+'</span><span><b>'+esc(x.name)+'</b><br><span class="small muted">send by '+esc(shFmt(x.use_by))+'</span></span>'+
    '<select data-in="sh-to" data-inv="'+x.id+'" aria-label="Send to"><option value="">Send to…</option>'+mem.map(p=>'<option value="'+p.id+'"'+((SHP.to[x.id]||SHP.giftTo)===p.id?' selected':'')+'>'+(p.online?'● ':'○ ')+esc(p.username)+'</option>').join('')+'</select>'+
    '<input class="num" data-in="sh-note" data-inv="'+x.id+'" maxlength="140" placeholder="Note (optional)" value="'+esc(SHP.note[x.id]||'')+'" aria-label="Note"><button class="btn solid" data-act="sh-send" data-inv="'+x.id+'">Send</button></div>').join('');
  const sent=(s.inventory||[]).filter(x=>x.sent_at).map(x=>'<div class="small muted">'+esc(x.emoji)+' '+esc(x.name)+' sent to '+esc(x.sent_to_name||'someone')+'</div>').join('');
  return '<div class="proj"><div class="kv"><div class="k">Coins</div><div class="v">'+COIN+' '+cn(s.balance)+'</div></div></div>'+daily+pass+'<h4 class="sub">Items</h4>'+items+
    '<h4 class="sub">Your items <span class="hint">sent items show in chat, in messages and on their profile</span></h4>'+(inv||'<div class="small muted">Nothing to send. Buy an item above.</div>')+(sent?'<h4 class="sub">Recently sent</h4>'+sent:'');
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
  return '<div class="shprof"><div class="small">'+shDot(x.online)+(x.online?'Online now':'Last seen '+shAgo(x.last_seen))+(x.pass?' · ⭐ Pass holder':'')+'</div>'+(g?'<h4 class="sub">Gifts right now</h4><div class="vcs">'+g+'</div>':'')+
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
  if(act==='sh-tab'){ stop(); SHP.tab=t.getAttribute('data-k'); SHP.msg=''; if(S.view!=='shop'){ S.view='shop'; render(); } else shPaint(); shLoadTab(); return; }
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
