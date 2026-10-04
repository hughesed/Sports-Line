/* ================= SHARE: result cards (rivalry, tie, badge, winning slip) + the finish flash =================
   Cards are drawn on a canvas (1080x1350, the 4:5 shape Instagram, Facebook, X and Reddit all show well) and shared three ways:
   - phones/Safari/Chrome that can share files: the system share sheet (pick Instagram, Snapchat, Facebook, X, Reddit, Twitch ... from there)
   - X, Facebook and Reddit: a pre-filled web post (text + link); the card image is put on the clipboard when the browser allows it
   - Instagram, Snapchat, Twitch have no "post from a web page" link: the card is saved, the caption is copied, and the app/site opens
   Nothing is uploaded anywhere; the picture is made on the device. */
const SH={spec:null,blob:null,file:null,url:'',note:''};
const SH_FONT='Inter,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const SH_P1='#2f7bff', SH_P2='#ff7a2f', SH_GOLD='#ffc83d';
const SH_BADGE={champion:'#f5b82e',trash:'#8b97a8',active:'#3d8bff',convo:'#9a6bff',king:'#ff9a2e',hot:'#ff5a2e'};
function shSite(){ return /^https?:$/.test(location.protocol)?location.origin+location.pathname:''; }
function shMe(){ return SOC.me&&SOC.me.username||''; }

/* ---------- canvas helpers ---------- */
function shRR(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
function shTxt(c,t,x,y,o){ o=o||{}; t=String(t==null?'':t); const orig=t; let size=o.size||32; const wt=o.weight||600; const maxW=o.maxW||1e9; const min=o.min||14;
  c.font=wt+' '+size+'px '+SH_FONT; while(c.measureText(t).width>maxW&&size>min){ size-=2; c.font=wt+' '+size+'px '+SH_FONT; }
  while(c.measureText(t).width>maxW&&t.length>1) t=t.slice(0,-1).replace(/\s+$/,''); if(t!==orig) t+='…';
  c.fillStyle=o.color||'#fff'; c.textAlign=o.align||'left'; c.textBaseline=o.base||'alphabetic';
  if('letterSpacing' in c) c.letterSpacing=(o.ls||0)+'px'; if(o.shadow){ c.shadowColor='rgba(0,0,0,.45)'; c.shadowBlur=o.shadow; c.shadowOffsetY=3; }
  c.fillText(t,x,y); c.shadowColor='transparent'; c.shadowBlur=0; c.shadowOffsetY=0; if('letterSpacing' in c) c.letterSpacing='0px'; return size; }
function shWrap(c,t,maxW,size,wt,maxLines){ c.font=wt+' '+size+'px '+SH_FONT; const w=String(t).split(/\s+/); const lines=[]; let cur='';
  w.forEach(x=>{ const n=cur?cur+' '+x:x; if(c.measureText(n).width>maxW&&cur){ lines.push(cur); cur=x; } else cur=n; }); if(cur) lines.push(cur);
  if(lines.length>maxLines){ lines.length=maxLines; lines[maxLines-1]=lines[maxLines-1].replace(/\s+\S*$/,'')+'…'; } return lines; }
function shCoin(c,x,y,r){ c.save(); c.beginPath(); c.arc(x,y,r,0,7); c.fillStyle=SH_GOLD; c.fill(); c.lineWidth=Math.max(2,r*.14); c.strokeStyle='#b8860b'; c.stroke(); c.fillStyle='#8a5d00'; c.font='800 '+Math.round(r*1.2)+'px '+SH_FONT; c.textAlign='center'; c.textBaseline='middle'; c.fillText('$',x,y+r*.06); c.restore(); }
function shCrown(c,x,y,w,col){ const h=w*.62; c.save(); c.beginPath(); c.moveTo(x-w/2,y+h); c.lineTo(x-w/2,y+h*.25); c.lineTo(x-w*.25,y+h*.62); c.lineTo(x,y); c.lineTo(x+w*.25,y+h*.62); c.lineTo(x+w/2,y+h*.25); c.lineTo(x+w/2,y+h); c.closePath(); c.fillStyle=col||SH_GOLD; c.shadowColor='rgba(0,0,0,.4)'; c.shadowBlur=14; c.fill(); c.restore(); }
function shMark(c,x,y,r,res){ // result mark in a circle: tick (hit), cross (miss), dash (push / not graded)
  const hit=res==='W'||res===''||res==null, miss=res==='L'; c.save(); c.beginPath(); c.arc(x,y,r,0,7); c.fillStyle=hit?'#1fbf75':miss?'#e5484d':'#7b8798'; c.fill();
  c.strokeStyle='#fff'; c.lineWidth=Math.max(3,r*.2); c.lineCap='round'; c.lineJoin='round'; c.beginPath();
  if(hit){ c.moveTo(x-r*.42,y+r*.02); c.lineTo(x-r*.1,y+r*.34); c.lineTo(x+r*.46,y-r*.32); } else if(miss){ c.moveTo(x-r*.34,y-r*.34); c.lineTo(x+r*.34,y+r*.34); c.moveTo(x+r*.34,y-r*.34); c.lineTo(x-r*.34,y+r*.34); } else { c.moveTo(x-r*.35,y); c.lineTo(x+r*.35,y); }
  c.stroke(); c.restore(); }
function shBg(c,W,H,tint){ const g=c.createLinearGradient(0,0,0,H); g.addColorStop(0,'#0b1426'); g.addColorStop(1,'#050a14'); c.fillStyle=g; c.fillRect(0,0,W,H);
  if(tint){ const r=c.createRadialGradient(W/2,H*.38,40,W/2,H*.38,W*.8); r.addColorStop(0,tint+'66'); r.addColorStop(1,tint+'00'); c.fillStyle=r; c.fillRect(0,0,W,H); } }
function shFoot(c,W,H,line){ if(line) shTxt(c,line,W/2,H-100,{size:34,weight:800,align:'center',color:'#fff',maxW:960});
  shTxt(c,'LINE SCOUT',48,H-42,{size:30,weight:800,color:SH_GOLD,ls:3});
  const site=shSite().replace(/^https?:\/\//,'').replace(/\/$/,''); shTxt(c,'Practice coins · no real money'+(site?' · '+site:''),W-48,H-42,{size:24,weight:500,align:'right',color:'rgba(255,255,255,.7)',maxW:700,min:16}); }
function shLeg(c,x,y,w,rowH,l,sz){ shMark(c,x+sz*.55,y,sz*.55,l.res); const pr=l.price!=null&&l.price!==''?fo(l.price):'';
  if(pr) shTxt(c,pr,x+w,y,{size:sz*.92,weight:700,align:'right',color:'rgba(255,255,255,.75)',base:'middle'});
  shTxt(c,l.label,x+sz*1.5,y,{size:sz,weight:600,color:l.res==='L'?'rgba(255,255,255,.6)':'#fff',maxW:w-sz*1.5-(pr?sz*4.4:0),base:'middle',min:16}); }

/* ---------- the cards ---------- */
function shDraw(sp){ const W=1080,H=1350; const cv=document.createElement('canvas'); cv.width=W; cv.height=H; const c=cv.getContext('2d');
  if(sp.kind==='battle') shDrawBattle(c,W,H,sp); else if(sp.kind==='badge') shDrawBadge(c,W,H,sp); else shDrawSlip(c,W,H,sp); return cv; }

function shDrawBattle(c,W,H,sp){
  const A=sp.a, B=sp.b, tie=sp.tie; shBg(c,W,H);
  // top: two corners split on a diagonal; the loser's side is dimmed
  c.save(); c.beginPath(); c.rect(0,0,W,580); c.clip();
  c.fillStyle=SH_P1; c.beginPath(); c.moveTo(0,0); c.lineTo(620,0); c.lineTo(440,580); c.lineTo(0,580); c.closePath(); c.fill();
  c.fillStyle=SH_P2; c.beginPath(); c.moveTo(620,0); c.lineTo(W,0); c.lineTo(W,580); c.lineTo(440,580); c.closePath(); c.fill();
  const sh=c.createLinearGradient(0,0,0,580); sh.addColorStop(0,'rgba(5,10,20,.15)'); sh.addColorStop(1,'rgba(5,10,20,.7)'); c.fillStyle=sh; c.fillRect(0,0,W,580);
  if(!tie){ c.fillStyle='rgba(5,10,20,.55)'; c.beginPath(); if(A.win){ c.moveTo(620,0); c.lineTo(W,0); c.lineTo(W,580); c.lineTo(440,580); } else { c.moveTo(0,0); c.lineTo(620,0); c.lineTo(440,580); c.lineTo(0,580); } c.closePath(); c.fill(); }
  c.restore();
  c.strokeStyle='rgba(255,255,255,.9)'; c.lineWidth=6; c.beginPath(); c.moveTo(620,0); c.lineTo(440,580); c.stroke();
  shRR(c,300,26,480,98,24); c.fillStyle='rgba(5,10,20,.72)'; c.fill();
  shTxt(c,tie?'DEAD HEAT':'RIVALRY',W/2,68,{size:30,weight:800,align:'center',ls:8,color:'rgba(255,255,255,.92)'});
  shTxt(c,sp.head,W/2,108,{size:26,weight:600,align:'center',color:'rgba(255,255,255,.9)',maxW:450,min:16});
  [[A,250],[B,830]].forEach(([P,cx])=>{ const cy=250, r=P.win?96:84;
    if(P.win) shCrown(c,cx,cy-r-62,92);
    c.save(); c.beginPath(); c.arc(cx,cy,r,0,7); c.fillStyle='rgba(5,10,20,.55)'; c.fill(); c.lineWidth=P.win?10:5; c.strokeStyle=P.win?SH_GOLD:'rgba(255,255,255,.7)'; c.stroke(); c.restore();
    shTxt(c,(P.name||'?').slice(0,1).toUpperCase(),cx,cy+4,{size:r*1.05,weight:800,align:'center',base:'middle',color:'#fff'});
    shTxt(c,P.name,cx,cy+r+62,{size:P.win?58:50,weight:800,align:'center',maxW:440,shadow:8,min:28});
    shTxt(c,P.side?'backed '+P.side:'',cx,cy+r+100,{size:27,weight:600,align:'center',color:'rgba(255,255,255,.85)',maxW:420});
    const tag=tie?'TIE':P.win?'WINNER':'LOST'; c.font='800 28px '+SH_FONT; const tw=c.measureText(tag).width+56; shRR(c,cx-tw/2,cy+r+120,tw,48,24); c.fillStyle=tie?'#e8edf5':P.win?SH_GOLD:'#2b3547'; c.fill();
    shTxt(c,tag,cx,cy+r+145,{size:28,weight:800,align:'center',base:'middle',color:tie||P.win?'#101826':'#aab4c3',ls:2}); });
  shTxt(c,'VS',540,270,{size:120,weight:900,align:'center',base:'middle',color:'#fff',shadow:16});
  shRR(c,300,544,480,64,32); c.fillStyle='#0b1426'; c.fill(); c.lineWidth=3; c.strokeStyle='rgba(255,255,255,.5)'; c.stroke();
  shTxt(c,sp.score,540,577,{size:32,weight:800,align:'center',base:'middle',maxW:440,min:20});
  shCoin(c,92,652,22); shTxt(c,sp.pot,128,653,{size:30,weight:800,base:'middle',color:SH_GOLD}); shTxt(c,sp.fmtTxt,W-48,653,{size:26,weight:600,align:'right',base:'middle',color:'rgba(255,255,255,.7)'});
  if(!tie){
    const W1=A.win?A:B, L1=A.win?B:A; let y=686;
    const n1=Math.max(1,W1.legs.length), row1=Math.max(46,Math.min(72,Math.floor(300/n1))), sz1=Math.round(row1*.6); const h1=24+66+n1*row1+18;
    shRR(c,40,y,1000,h1,22); c.fillStyle='rgba(255,200,61,.10)'; c.fill(); c.lineWidth=4; c.strokeStyle=SH_GOLD; c.stroke();
    shTxt(c,'THE WINNING PARLAY',70,y+44,{size:26,weight:800,color:SH_GOLD,ls:3}); shTxt(c,W1.name+' · pays '+W1.pay+' · '+W1.hitTxt,1010,y+44,{size:26,weight:700,align:'right',maxW:640,min:16});
    W1.legs.forEach((l,i)=>shLeg(c,70,y+24+66+i*row1+row1/2-14,940,row1,l,sz1));
    y+=h1+16; const n2=Math.max(1,L1.legs.length), row2=Math.max(36,Math.min(54,Math.floor(210/n2))), sz2=Math.round(row2*.62); const h2=20+52+n2*row2+12;
    shRR(c,40,y,1000,h2,22); c.fillStyle='rgba(255,255,255,.05)'; c.fill(); c.lineWidth=2; c.strokeStyle='rgba(255,255,255,.22)'; c.stroke();
    shTxt(c,L1.name.toUpperCase()+'’S PARLAY',70,y+38,{size:22,weight:800,color:'rgba(255,255,255,.7)',ls:2,maxW:520,min:14}); shTxt(c,'paid '+L1.pay+' · '+L1.hitTxt,1010,y+38,{size:24,weight:700,align:'right',color:'rgba(255,255,255,.75)',maxW:480,min:16});
    L1.legs.forEach((l,i)=>shLeg(c,70,y+20+52+i*row2+row2/2-8,940,row2,l,sz2));
  } else {
    const cols=[[A,40],[B,560]]; const y=686; const n=Math.max(A.legs.length,B.legs.length,1); const row=Math.max(44,Math.min(70,Math.floor(300/n))); const sz=Math.round(row*.55); const h=20+56+n*row+14;
    cols.forEach(([P,x])=>{ shRR(c,x,y,480,h,22); c.fillStyle='rgba(255,255,255,.06)'; c.fill(); c.lineWidth=3; c.strokeStyle=P===A?SH_P1:SH_P2; c.stroke();
      shTxt(c,P.name.toUpperCase()+'’S PARLAY',x+24,y+40,{size:22,weight:800,ls:2,maxW:432,min:14}); shTxt(c,P.pay+' · '+P.hitTxt,x+24,y+68,{size:22,weight:600,color:'rgba(255,255,255,.75)',maxW:432,min:14});
      P.legs.forEach((l,i)=>shLeg(c,x+24,y+20+64+i*row+row/2-8,432,row,l,sz)); });
    shTxt(c,'Neither slip could separate them: the pot is split.',540,y+h+44,{size:30,weight:700,align:'center',color:'rgba(255,255,255,.9)',maxW:960});
  }
  shFoot(c,W,H,sp.cta);
}

function shDrawBadge(c,W,H,sp){
  const col=SH_BADGE[sp.bk]||SH_GOLD; shBg(c,W,H,col);
  shTxt(c,'ACHIEVEMENT UNLOCKED',W/2,120,{size:34,weight:800,align:'center',ls:8,color:'rgba(255,255,255,.85)'});
  c.save(); c.beginPath(); c.arc(W/2,470,250,0,7); c.fillStyle=col+'33'; c.fill(); c.lineWidth=8; c.strokeStyle=col; c.stroke(); c.restore();
  shTxt(c,sp.emoji,W/2,480,{size:300,weight:400,align:'center',base:'middle'});
  shTxt(c,sp.title.toUpperCase(),W/2,830,{size:sp.title.length>9?100:124,weight:900,align:'center',maxW:960,shadow:12,color:'#fff'});
  shTxt(c,'earned by '+sp.user,W/2,908,{size:48,weight:700,align:'center',maxW:900,color:col});
  if(sp.count>1){ const t='×'+sp.count+' all-time'; c.font='800 40px '+SH_FONT; const w=c.measureText(t).width+64; shRR(c,W/2-w/2,944,w,70,35); c.fillStyle=col; c.fill(); shTxt(c,t,W/2,980,{size:40,weight:800,align:'center',base:'middle',color:'#101826'}); }
  shWrap(c,sp.desc,880,34,500,3).forEach((l,i)=>shTxt(c,l,W/2,1068+i*46,{size:34,weight:500,align:'center',color:'rgba(255,255,255,.82)'}));
  shFoot(c,W,H,null);
}

function shDrawSlip(c,W,H,sp){
  shBg(c,W,H,'#1fbf75'); shTxt(c,'WINNING SLIP',W/2,120,{size:36,weight:800,align:'center',ls:8,color:'#5df0a8'});
  shTxt(c,sp.user+(sp.sub?' · '+sp.sub:''),W/2,176,{size:34,weight:600,align:'center',color:'rgba(255,255,255,.85)',maxW:940});
  { let fs=190; const str='+'+sp.payout; c.font='900 '+fs+'px '+SH_FONT; while(c.measureText(str).width>720&&fs>90){ fs-=6; c.font='900 '+fs+'px '+SH_FONT; }
    const tw=c.measureText(str).width, tot=120+28+tw, x0=(W-tot)/2; shCoin(c,x0+56,365,56); shTxt(c,str,x0+148,365,{size:fs,weight:900,base:'middle',shadow:14}); }
  shTxt(c,sp.meta,W/2,490,{size:34,weight:600,align:'center',color:'rgba(255,255,255,.85)',maxW:940});
  const legs=sp.legs.slice(0,8), row=76, y0=560; const h=legs.length*row+36; shRR(c,40,y0,1000,h,24); c.fillStyle='rgba(255,255,255,.07)'; c.fill(); c.lineWidth=2; c.strokeStyle='rgba(93,240,168,.55)'; c.stroke();
  legs.forEach((l,i)=>shLeg(c,76,y0+18+i*row+row/2,930,row,l,34));
  if(sp.legs.length>8) shTxt(c,'+ '+(sp.legs.length-8)+' more legs',W/2,y0+h+44,{size:30,weight:600,align:'center',color:'rgba(255,255,255,.75)'});
  shFoot(c,W,H,sp.cta);
}

/* ---------- specs (what goes on a card) from the data already on the page ---------- */
const SH_BDESC={champion:'Biggest winner of the day on Line Scout, crowned at midnight ET.',trash:'Biggest loser of the day. It takes guts to swing this big.',active:'Most active bettor of the day.',convo:'Talked the most with @mentions in chat.',king:'Top-ranked in battles against other players.',hot:'On a hot winning streak.'};
function shSlipRows(legs){ return (legs||[]).map(l=>({label:l.label,price:l.price,res:l.res||''})); }
function shBattleSpec(){
  const d=BT.det; if(!d||!d.battle) return null; const b=d.battle, r=b.result; if(b.status!=='final'||!r||!r.creator) return null;
  const tie=!!r.split, me=SOC.user&&SOC.user.id; const side=s=>b[s]||'';
  const mk=(uid,name,sd,res)=>{ const p=(d.parlays||[]).find(x=>x.user_id===uid)||{}; const legs=shSlipRows(p.graded||p.legs); return {uid:uid,name:name||'?',side:side(sd),win:!tie&&b.winner===uid,legs:legs,pay:cn(res.payout),hitTxt:res.hits+' of '+legs.length+' hit'}; };
  const A=mk(b.creator,b.creator_name,b.creator_side,r.creator), B=mk(b.opponent,b.opponent_name,b.opponent_side,r.opponent);
  const W1=A.win?A:B, L1=A.win?B:A; const sport=SPN[b.sport]||b.sport;
  const head=sport+' · '+b.away+' @ '+b.home+(b.fmt==='sgp'?' · Same Game Parlay':'');
  let cap, cta;
  if(tie){ const you=me&&(A.uid===me||B.uid===me); const o=A.uid===me?B:A;
    cap='🤝 Dead heat! '+(you?'Me vs '+o.name:A.name+' vs '+B.name)+' in a Line Scout '+sport+' battle ('+b.away+' @ '+b.home+', '+r.as+'-'+r.hs+'). Both slips finished level, so the pot was split. Practice coins only.'; cta='Think you can break the tie?'; }
  else { const mineWin=me&&W1.uid===me, mineLose=me&&L1.uid===me;
    cap=(mineWin?'🏆 I beat '+L1.name:mineLose?'💀 '+W1.name+' beat me':'🏆 '+W1.name+' beat '+L1.name)+' in a Line Scout '+sport+' battle ('+b.away+' @ '+b.home+', '+r.as+'-'+r.hs+'). The winning parlay: '+W1.legs.length+' legs, paid '+W1.pay+' coins vs '+L1.pay+'. Practice coins only.'; cta=mineWin?'Think you can beat me? Challenge me in Battle.':'Challenge '+W1.name+' in Battle.'; }
  return {kind:'battle',tie:tie,a:A,b:B,head:head,score:b.away+' '+r.as+' – '+r.hs+' '+b.home+' · FINAL',pot:cn(b.wager*2)+' coin pot',fmtTxt:b.fmt==='sgp'?'Same Game Parlay':'Parlay',cta:cta,caption:cap,file:'line-scout-'+(tie?'tie':'rivalry')+'-'+b.id,title:tie?'Share this tie':'Share the rivalry'};
}
function shBadgeSpec(user,bk,sport,detail){
  const bd=BADGE[bk]; if(!bd) return null; const pc=SOC.prof[(user||'').toLowerCase()]; const d=pc&&pc.d; const count=d&&d.badges&&d.badges[bk]?+d.badges[bk]:1;
  const sp=sport?String(sport).toUpperCase():''; const title=bd.n+(sp?' '+sp:'');
  return {kind:'badge',bk:bk,emoji:bd.e,title:title,user:user,count:count,desc:SH_BDESC[bk]||bd.d,caption:bd.e+' '+(user===shMe()?'I just earned':user+' earned')+' the '+title+' badge on Line Scout'+(count>1?' ('+count+' times now)':'')+'. '+bd.d+' Practice coins only.',file:'line-scout-badge-'+bk,title2:'Share this badge'};
}
function shSlipSpec(src,ds){
  let user=shMe(), legs=[], stake=null, payout=null, sub='', mult=null;
  if(src==='bet'){ const b=(SOC.bets||[]).find(x=>String(x.id)===ds.id); if(!b||b.status!=='won') return null; legs=shSlipRows((b.bet_legs||[]).slice().sort((x,y)=>x.id-y.id)); stake=+b.stake; payout=+b.payout; sub=legs.length>1?legs.length+'-leg parlay':'straight bet'; }
  else if(src==='local'){ const b=P.bets[+ds.i]; if(!b||b.status!=='won') return null; user='my picks'; legs=shSlipRows(b.legs); stake=+b.stake; payout=+b.payout; sub=legs.length>1?legs.length+'-leg parlay':'straight bet'; }
  else if(src==='prof'){ const pc=SOC.prof[(ds.u||'').toLowerCase()]; const s=pc&&pc.d&&pc.d.slips&&(pc.d.slips.recent||[])[+ds.i]; if(!s||s.status!=='won') return null; user=ds.u; legs=shSlipRows(s.legs); stake=+s.stake; payout=+s.payout; sub=legs.length>1?legs.length+'-leg parlay':'straight bet'; }
  else if(src==='spec'){ const b=BT.det&&(BT.det.bets||[]).find(x=>String(x.id)===ds.id); if(!b||b.status!=='won') return null; legs=[{label:b.label,price:b.price,res:'W'}]; stake=+b.stake; payout=+b.payout; sub='battle bet'; }
  else if(src==='bparl'){ const d=BT.det; const p=d&&(d.parlays||[]).find(x=>String(x.user_id)===ds.uid); if(!p||!(+p.payout>0)) return null; user=p.username||user; legs=shSlipRows(p.graded||p.legs); stake=100; payout=+p.payout; sub='battle parlay'; }
  else return null;
  if(!legs.length) return null; legs.forEach(l=>{ if(l.res==='') l.res='W'; });
  const dec=legs.filter(l=>l.res!=='V').reduce((a,l)=>a*(l.price!=null?decOf(l.price):1),1); const am=legs.every(l=>l.price!=null)?fo(amerOfDec(dec)):'';
  const meta=(stake!=null?'Stake '+cn(stake)+' coins':'')+(am?' · odds '+am:'')+(legs.length>1?' · all '+legs.length+' legs hit':'');
  return {kind:'slip',user:user,sub:sub,payout:cn(payout),legs:legs,meta:meta,cta:'Beat my slip on Line Scout',caption:'✅ '+(user===shMe()||user==='my picks'?'My':user+'’s')+' '+sub+' just cashed on Line Scout: '+legs.slice(0,3).map(l=>l.label).join(' + ')+(legs.length>3?' + '+(legs.length-3)+' more':'')+' paid '+cn(payout)+' coins'+(stake!=null?' on a '+cn(stake)+' stake':'')+'. Practice coins only.',file:'line-scout-slip'};
}

/* ---------- share sheet ---------- */
function shNote(t){ SH.note=t; const e=document.getElementById('shnote'); if(e) e.textContent=t; }
function shClose(){ const m=document.getElementById('shmodal'); if(m) m.remove(); if(SH.url){ try{ URL.revokeObjectURL(SH.url); }catch(e){} } SH.url=''; SH.blob=null; SH.file=null; SH.spec=null; }
function shBtn(p,label,cls,sub){ return '<button class="shgo '+cls+'" data-act="sh-go" data-p="'+p+'"><b>'+label+'</b>'+(sub?'<span>'+sub+'</span>':'')+'</button>'; }
function shModalHtml(sp,ready){
  const canNative=!!navigator.share;
  return '<div class="shbox"><button class="shx" data-act="sh-close" aria-label="Close">×</button><h3>'+esc(sp.title2||sp.title||'Share')+'</h3>'+
    '<div class="shprev">'+(ready?'<img alt="Share card preview" src="'+SH.url+'">':'<div class="small muted">Making your card…</div>')+'</div>'+
    '<label class="fld">Text to post<textarea id="shcap" rows="4">'+esc(sp.caption)+'</textarea></label>'+
    '<div class="shgrid">'+(canNative?shBtn('native','Share…','sh-nat','Choose any app'):'')+shBtn('x','X','sh-x','post')+shBtn('fb','Facebook','sh-fb','post')+shBtn('reddit','Reddit','sh-rd','post')+shBtn('ig','Instagram','sh-ig','save + open')+shBtn('snap','Snapchat','sh-sn','save + open')+shBtn('twitch','Twitch','sh-tw','save + open')+shBtn('save','Save image','sh-sv','PNG')+shBtn('copy','Copy text','sh-cp','')+'</div>'+
    '<div class="small muted" id="shnote">'+esc(SH.note||'')+'</div>'+
    '<div class="small muted">X, Facebook and Reddit open a pre-filled post. Instagram, Snapchat and Twitch have no web posting link, so those save the card and copy your text, then open the site: add the picture there. On a phone, <b>Share…</b> sends the card straight into any installed app.</div></div>';
}
async function shOpen(sp){
  if(!sp){ S.flash='Nothing to share yet.'; renderBank(); return; }
  shClose(); SH.spec=sp; SH.note=''; const m=document.createElement('div'); m.id='shmodal'; m.className='shm'; m.setAttribute('role','dialog'); m.setAttribute('aria-modal','true'); m.setAttribute('aria-label','Share'); m.innerHTML=shModalHtml(sp,false); document.body.appendChild(m);
  try{ if(document.fonts&&document.fonts.load) await Promise.race([document.fonts.load('800 40px Inter'),new Promise(r=>setTimeout(r,900))]); }catch(e){}
  if(SH.spec!==sp) return;
  try{
    const cv=shDraw(sp); const blob=await new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new Error('no image')),'image/png'));
    if(SH.spec!==sp) return; SH.blob=blob; SH.url=URL.createObjectURL(blob); try{ SH.file=new File([blob],sp.file+'.png',{type:'image/png'}); }catch(e){ SH.file=null; }
    const cap=document.getElementById('shcap'); const keep=cap?cap.value:sp.caption; const el=document.getElementById('shmodal'); if(el){ el.innerHTML=shModalHtml(sp,true); const c2=document.getElementById('shcap'); if(c2) c2.value=keep; }
  }catch(e){ shNote('Could not make the picture on this browser. You can still copy the text.'); }
}
function shDownload(){ if(!SH.blob||!SH.spec) return false; const a=document.createElement('a'); a.href=SH.url; a.download=SH.spec.file+'.png'; document.body.appendChild(a); a.click(); a.remove(); return true; }
function shRace(pm){ return Promise.race([pm,new Promise(r=>setTimeout(()=>r(false),1500))]); } /* a clipboard request can hang when the browser asks for permission or the tab is not focused */
function shCopy(t){ try{ if(navigator.clipboard&&navigator.clipboard.writeText) return shRace(navigator.clipboard.writeText(t).then(()=>true,()=>false)); }catch(e){} return Promise.resolve(false); }
function shCopyImg(){ try{ if(SH.blob&&window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write) return shRace(navigator.clipboard.write([new ClipboardItem({'image/png':SH.blob})]).then(()=>true,()=>false)); }catch(e){} return Promise.resolve(false); }
function shShort(t,n){ return t.length>n?t.slice(0,n-1).replace(/\s+\S*$/,'')+'…':t; }
async function shNative(cap,url,quiet){
  const data={title:'Line Scout',text:cap}; if(url) data.url=url;
  try{
    if(SH.file&&navigator.canShare&&navigator.canShare({files:[SH.file]})){ await navigator.share(Object.assign({files:[SH.file]},data)); return true; }
    if(navigator.share&&!quiet){ await navigator.share(data); shNote('This browser cannot attach pictures to the share sheet, so only the text was shared. Tap Save image to add the card.'); return true; }
  }catch(e){ if(e&&e.name==='AbortError') return true; }
  return false;
}
async function shGo(p){
  const sp=SH.spec; if(!sp) return; const cap=((document.getElementById('shcap')||{}).value||sp.caption).trim(); const url=shSite(); const enc=encodeURIComponent; const full=cap+(url?' '+url:'');
  if(p==='save'){ shNote(shDownload()?'Card saved to your downloads or photos.':'The picture is not ready yet.'); return; }
  if(p==='copy'){ shNote((await shCopy(full))?'Text copied.':'Could not copy: select the text above and copy it.'); return; }
  if(p==='native'){ if(!(await shNative(cap,url))){ shDownload(); shNote('Sharing is not available here. The card was saved: attach it to your post.'); } return; }
  const web={x:'https://x.com/intent/tweet?text='+enc(shShort(cap,235))+(url?'&url='+enc(url):''),fb:'https://www.facebook.com/sharer/sharer.php?u='+enc(url||'https://www.facebook.com/')+'&quote='+enc(cap),reddit:'https://www.reddit.com/submit?'+(url?'url='+enc(url)+'&':'')+'title='+enc(shShort(cap,290))};
  if(web[p]){ // open the post first (a popup needs the tap), then put the card on the clipboard
    window.open(web[p],'_blank','noopener'); const ok=await shCopyImg(); shNote(ok?'Post window opened. The card image is on your clipboard: paste it into the post.':'Post window opened. Tap Save image and attach the card to the post (web links cannot attach pictures).'); return; }
  const apps={ig:['Instagram','https://www.instagram.com/'],snap:['Snapchat','https://www.snapchat.com/'],twitch:['Twitch','https://www.twitch.tv/']}; const a=apps[p]; if(!a) return;
  if(await shNative(cap,url,true)){ shNote('Pick '+a[0]+' in the share sheet.'); return; }
  const saved=shDownload(); window.open(a[1],'_blank','noopener'); const cp=await shCopy(full);
  shNote(a[0]+' cannot take a post from a web link. '+(saved?'The card was saved':'The card is not ready')+(cp?' and your text copied':'')+': open '+a[0]+' and add the picture'+(cp?', then paste the text.':'.'));
}

/* ---------- the finish flash: both players, winner and loser (or a tie), with a share button ---------- */
function vsfClose(){ const e=document.getElementById('vsflash'); if(e) e.remove(); }
function vsfShow(){
  const d=BT.det; if(!d||!d.battle) return; const b=d.battle, r=b.result; if(!r||!r.creator) return; vsfClose();
  const tie=!!r.split, me=SOC.user&&SOC.user.id; const cw=b.winner===b.creator;
  const P=[{name:b.creator_name||'?',uid:b.creator,side:b[b.creator_side],res:r.creator,c:'c1'},{name:b.opponent_name||'?',uid:b.opponent,side:b[b.opponent_side],res:r.opponent,c:'c2'}];
  const W1=tie?null:(cw?P[0]:P[1]);
  const title=tie?'DEAD HEAT':(me&&W1.uid===me?'YOU WIN':me&&(P[0].uid===me||P[1].uid===me)?'TOUGH ONE':'FINAL');
  const card=x=>{ const win=!tie&&x===W1, lose=!tie&&!win; return '<div class="vsf-p '+(tie?'tie':win?'win':'lose')+' '+x.c+'">'+(win?'<svg class="vsf-crown" viewBox="0 0 64 40" aria-hidden="true"><path d="M4 38V10l14 13L32 2l14 21 14-13v28z" fill="#ffc83d"/></svg>':'')+'<div class="vsf-av">'+esc(x.name.slice(0,1).toUpperCase())+'</div><div class="vsf-nm">'+esc(x.name)+'</div><div class="vsf-tag">'+(tie?'TIE':win?'WINNER':'LOST')+'</div><div class="vsf-pay mono">slip paid '+cn(x.res.payout)+'<br>'+x.res.hits+' hit</div></div>'; };
  let conf=''; if(!tie){ const cols=['#ffc83d','#2f7bff','#ff7a2f','#2fcb7e','#fff']; for(let i=0;i<46;i++){ const a=Math.random()*360, dd=90+Math.random()*230, dl=(0.25+Math.random()*.35).toFixed(2); conf+='<i style="--a:'+a.toFixed(0)+'deg;--d:'+dd.toFixed(0)+'px;--dl:'+dl+'s;--c:'+cols[i%5]+'"></i>'; } }
  const el=document.createElement('div'); el.id='vsflash'; el.className='vsflash'; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-label','Battle result');
  el.innerHTML='<div class="vsf-conf" aria-hidden="true">'+conf+'</div><div class="vsf-in"><div class="vsf-t">'+title+'</div><div class="vsf-row">'+card(P[0])+'<div class="vsf-vs">VS</div>'+card(P[1])+'</div>'+
    '<div class="vsf-sc mono">'+esc(b.away)+' '+r.as+' – '+r.hs+' '+esc(b.home)+'</div><div class="vsf-line">'+(tie?'The pot is split. Both wagers go back.':esc(W1.name)+' takes the '+cn(b.wager*2)+' coin pot')+'</div>'+
    '<div class="btnrow vsf-btns"><button class="btn solid" data-act="sh-open" data-k="battle">Share this '+(tie?'tie':'result')+'</button><button class="btn" data-act="vsf-close">Close</button></div></div>';
  document.body.appendChild(el);
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  const t=e.target.closest&&e.target.closest('[data-act]'); if(!t) return; const act=t.getAttribute('data-act');
  if(act.indexOf('sh-')!==0&&act.indexOf('vsf-')!==0) return;
  e.stopPropagation(); e.preventDefault();
  if(act==='vsf-close'){ vsfClose(); return; }
  if(act==='vsf-open'){ vsfShow(); return; }
  if(act==='sh-close'){ shClose(); return; }
  if(act==='sh-go'){ shGo(t.getAttribute('data-p')); return; }
  if(act==='sh-open'){ const k=t.getAttribute('data-k'); let sp=null;
    if(k==='battle') sp=shBattleSpec();
    else if(k==='badge') sp=shBadgeSpec(t.getAttribute('data-u'),t.getAttribute('data-b'),t.getAttribute('data-sp'));
    else if(k==='slip') sp=shSlipSpec(t.getAttribute('data-src'),{id:t.getAttribute('data-id'),i:t.getAttribute('data-i'),u:t.getAttribute('data-u'),uid:t.getAttribute('data-uid')});
    shOpen(sp); return; }
},true);
document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ if(document.getElementById('shmodal')) shClose(); else vsfClose(); } });
