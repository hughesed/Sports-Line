/* ================= Battle animations =================
   A small SVG scene (field / court / diamond) above the play feed.  Every new play that becomes visible is classified, queued and played for
   about 1-2 seconds: ball flights, flags, runners, banners.  The queue thins itself when plays arrive faster than they can be shown
   (small plays go first, big plays - touchdowns, home runs, threes, the final - are always kept).  Reduced motion: banner only. */
const AN={q:{},dim:{},log:[],drop:0};
try{ window.__AN=AN; }catch(e){}
const AN_NS='http://www.w3.org/2000/svg';
const AN_LABEL={fd:'FIRST DOWN',flag:'FLAG',sack:'SACK',foul:'FOUL',steal:'STEAL',block:'BLOCK',run:'RUN',strikeout:'STRIKEOUT',walk:'WALK',safe:'SAFE',out:'OUT',score:'SCORE',final:'FINAL',period:'BREAK',start:'TIP',snap:'UPDATE'};
const AN_ICON={fd:'⬆',flag:'🚩',sack:'💥',foul:'🛑',steal:'🖐',block:'✋',run:'🔥',strikeout:'K',walk:'🚶',safe:'🟢',out:'🔴',score:'★',final:'🏁'};
function anReduced(){ try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } }
function anEl(tag,at,parent){ const n=document.createElementNS(AN_NS,tag); for(const k in (at||{})) n.setAttribute(k,at[k]); if(parent) parent.appendChild(n); return n; }
function anFam(sport){ return sport==='nfl'||sport==='cfb'?'fb':sport==='mlb'?'bb':'bk'; }
function anColor(b,side){ try{ return teamOf(b.sport,side==='home'?b.home:b.away).color||'#4d98ff'; }catch(e){ return '#4d98ff'; } }

/* ---- scenes (viewBox 320 x 120) ---- */
function anScene(b){
  const f=anFam(b.sport), ca=anColor(b,'away'), ch=anColor(b,'home'); let s='';
  if(f==='fb'){
    s+='<rect x="0" y="0" width="320" height="120" fill="#2e7d4f"/><rect x="8" y="10" width="30" height="100" fill="'+ca+'" opacity=".85"/><rect x="282" y="10" width="30" height="100" fill="'+ch+'" opacity=".85"/>';
    for(let i=0;i<=10;i++){ const x=38+i*24.4; s+='<line x1="'+x+'" y1="10" x2="'+x+'" y2="110" stroke="#fff" stroke-opacity="'+(i%5===0?.8:.35)+'" stroke-width="'+(i%5===0?1.4:.8)+'"/>'; }
    s+='<text x="23" y="64" font-size="9" font-weight="800" fill="#fff" text-anchor="middle" transform="rotate(-90 23 60)">'+esc(b.away)+'</text><text x="297" y="64" font-size="9" font-weight="800" fill="#fff" text-anchor="middle" transform="rotate(90 297 60)">'+esc(b.home)+'</text>';
    s+='<rect x="2" y="50" width="6" height="2" fill="#ffd23a"/><rect x="312" y="50" width="6" height="2" fill="#ffd23a"/>';
  } else if(f==='bk'){
    s+='<rect x="0" y="0" width="320" height="120" fill="#c58a4a"/><rect x="8" y="8" width="304" height="104" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.5"/><line x1="160" y1="8" x2="160" y2="112" stroke="#fff" stroke-opacity=".8"/><circle cx="160" cy="60" r="14" fill="none" stroke="#fff" stroke-opacity=".8"/>';
    s+='<rect x="8" y="38" width="46" height="44" fill="'+ca+'" fill-opacity=".35" stroke="#fff" stroke-opacity=".8"/><rect x="266" y="38" width="46" height="44" fill="'+ch+'" fill-opacity=".35" stroke="#fff" stroke-opacity=".8"/>';
    s+='<path d="M8 22 H34 A50 50 0 0 1 34 98 H8" fill="none" stroke="#fff" stroke-opacity=".8"/><path d="M312 22 H286 A50 50 0 0 0 286 98 H312" fill="none" stroke="#fff" stroke-opacity=".8"/>';
    s+='<circle cx="22" cy="60" r="5" fill="none" stroke="#ff6a2a" stroke-width="2"/><circle cx="298" cy="60" r="5" fill="none" stroke="#ff6a2a" stroke-width="2"/>';
  } else {
    s+='<rect x="0" y="0" width="320" height="120" fill="#2e7d4f"/><path d="M20 98 Q160 -34 300 98 L160 118 Z" fill="#37915b"/><path d="M20 98 Q160 -34 300 98" fill="none" stroke="#f4d03f" stroke-width="2.5"/>';
    s+='<polygon points="160,104 214,66 160,30 106,66" fill="#c9915c"/><polygon points="160,94 202,66 160,38 118,66" fill="#37915b"/><circle cx="160" cy="66" r="5" fill="#c9915c"/>';
    [[214,66],[160,30],[106,66]].forEach(p=>{ s+='<rect x="'+(p[0]-4)+'" y="'+(p[1]-4)+'" width="8" height="8" fill="#fff" transform="rotate(45 '+p[0]+' '+p[1]+')"/>'; });
    s+='<polygon points="160,100 165,105 160,110 155,105" fill="#fff"/>';
  }
  return s;
}
function anStageHtml(b){
  return '<div class="stage" id="stg-b'+b.id+'" data-f="'+anFam(b.sport)+'"><svg viewBox="0 0 320 120" class="stsvg" role="img" aria-label="Animated '+esc(SPN[b.sport]||'')+' scene">'+anScene(b)+'<g class="fx"></g></svg><div class="stbanner" aria-live="polite"></div></div>';
}
function anEnsureStage(b){
  if(document.getElementById('stg-b'+b.id)){ try{ afStart(b); }catch(e){} return true; }
  const viz=document.querySelector('#bts-board .viz'); if(!viz) return false; const chip=viz.querySelector('.playchip'); if(!chip) return false;
  chip.insertAdjacentHTML('beforebegin',anStageHtml(b)); try{ afStart(b); }catch(e){} return true;
}

/* ---- classify an event into an animation ---- */
function anClassify(sport,e){
  const k=e.kind, t=e.text||'', f=anFam(sport);
  if(k==='final') return {type:'final',pri:3};
  if(k==='fd'||k==='flag'||k==='sack'||k==='foul'||k==='steal'||k==='block'||k==='strikeout'||k==='walk'||k==='safe'||k==='out') return {type:k,pri:(k==='steal'||k==='block'||k==='safe')?2:1};
  if(k==='run') return {type:'run',pri:2};
  if(k==='score'){
    if(f==='fb') return /touchdown/i.test(t)?{type:'td',pri:3}:/field goal/i.test(t)?{type:'fg',pri:2}:{type:'td',pri:3};
    if(f==='bk') return /three/i.test(t)?{type:'three',pri:3}:/throws it down/i.test(t)?{type:'dunk',pri:2}:/at the line/i.test(t)?{type:'ft',pri:1}:{type:'bucket',pri:2};
    return /walk-off/i.test(t)?{type:'walkoff',pri:3}:/homers|grand slam/i.test(t)?{type:'hr',pri:3}:{type:'runscore',pri:3};
  }
  if(k==='play'){
    if(f==='fb'){ if(/interception/i.test(t)) return {type:'int',pri:2}; if(/fumble/i.test(t)) return {type:'fumble',pri:2}; if(/punts/i.test(t)) return {type:'punt',pri:1}; if(/misses/i.test(t)) return {type:'fgmiss',pri:1}; if(/stopped/i.test(t)) return {type:'stop',pri:1}; }
    if(f==='bb'){ if(/singles/i.test(t)) return {type:'hit1',pri:2}; if(/doubles/i.test(t)) return {type:'hit2',pri:2}; if(/triples/i.test(t)) return {type:'hit3',pri:2}; }
  }
  return null;
}

/* ---- tiny animation helpers ---- */
function anMove(node,pts,ms,ease,cb){
  if(anReduced()){ node.style.transform='translate('+pts[pts.length-1][0]+'px,'+pts[pts.length-1][1]+'px)'; if(cb) setTimeout(cb,0); return; }
  const fr=pts.map(p=>({transform:'translate('+p[0]+'px,'+p[1]+'px)'})); const a=node.animate(fr,{duration:ms,easing:ease||'linear',fill:'forwards'}); if(cb) a.onfinish=cb;
}
function anArc(a,b,peak,n){ const o=[]; for(let i=0;i<=(n||16);i++){ const u=i/(n||16); o.push([a[0]+(b[0]-a[0])*u, a[1]+(b[1]-a[1])*u-4*peak*u*(1-u)]); } return o; }
function anPop(node,keys,ms){ if(anReduced()) return; node.animate(keys,{duration:ms,easing:'cubic-bezier(.2,1.4,.4,1)',fill:'forwards'}); }
function anBanner(st,text,cls){
  const bn=st.querySelector('.stbanner'); if(!bn) return; bn.className='stbanner show '+(cls||''); bn.textContent=text;
  if(!anReduced()) bn.animate([{transform:'translate(-50%,-50%) scale(.3)',opacity:0},{transform:'translate(-50%,-50%) scale(1.12)',opacity:1,offset:.25},{transform:'translate(-50%,-50%) scale(1)',opacity:1,offset:.8},{transform:'translate(-50%,-50%) scale(1)',opacity:0}],{duration:1500,easing:'ease-out',fill:'forwards'});
  clearTimeout(bn._t); bn._t=setTimeout(()=>{ bn.className='stbanner'; },anReduced()?1400:1600);
}
function anBall(fx,x,y,r,fill){ return anEl('ellipse',{cx:0,cy:0,rx:r*1.45,ry:r,fill:fill||'#8a4b21',stroke:'#fff','stroke-width':.8,style:'transform:translate('+x+'px,'+y+'px)'},fx); }
function anDot(fx,x,y,fill,r){ return anEl('circle',{cx:0,cy:0,r:r||4.5,fill:fill,stroke:'#fff','stroke-width':1.2,style:'transform:translate('+x+'px,'+y+'px)'},fx); }
function anBurst(fx,x,y,col,n){ if(anReduced()) return; for(let i=0;i<(n||10);i++){ const c=anEl('circle',{cx:x,cy:y,r:2.2,fill:col||'#ffd23a'},fx); const a=i/(n||10)*Math.PI*2, d=14+Math.random()*16; c.animate([{transform:'translate(0,0)',opacity:1},{transform:'translate('+Math.cos(a)*d+'px,'+Math.sin(a)*d+'px)',opacity:0}],{duration:700,easing:'ease-out',fill:'forwards'}); } }
function anShake(node){ if(anReduced()||!node||!node.animate) return; node.animate([{transform:'translateX(0)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(-3px)'},{transform:'translateX(0)'}],{duration:420}); }

/* ---- the plays ---- */
/* who gained from a play: +1 the home team, -1 the visitors, 0 nobody in particular.  e.side is the team the play is about. */
const AN_LOSS={sack:1,int:1,fumble:1,fgmiss:1,stop:1,strikeout:1,out:1,foul:1};
const AN_BIG={td:1,hr:1,walkoff:1,three:1,dunk:1,final:1};
function anGainer(b,ty,e){
  if(ty==='final') return 0;
  if(ty==='flag'){ const m=/flag!?\s+([A-Z]{2,4})\b/i.exec(String(e&&e.text||'')); if(m){ const ab=m[1].toUpperCase(); if(ab===String(b.home).toUpperCase()) return -1; if(ab===String(b.away).toUpperCase()) return 1; } return 0; }
  const side=e&&e.side; if(side!=='home'&&side!=='away') return 0; const sg=side==='home'?1:-1;
  return AN_LOSS[ty]?-sg:sg;
}
/* the crowd: constant murmur (see ambStart), a roar when the home team gains, boos when the visitors do */
function anCrowd(b,ty,e){
  const g=anGainer(b,ty,e); if(!g) return; const big=!!AN_BIG[ty], minor=ty==='fd'||ty==='ft'||ty==='walk'||ty==='safe'||ty==='strikeout'||ty==='out'||ty==='foul'||ty==='punt'||ty==='hit1';
  if(g>0){ if(minor){ sfx('crowd',0,false); ambSwell(1.5,1.8); } else crowdFor(true,big); }
  else { if(minor){ sfx('groan',0); ambSwell(1.3,1.6); } else crowdFor(false,big); }
}
/* sound for each kind of play: stadium sounds that fit the sport (football: kicks, whistles, pads; basketball: swish, rim, buzzer; baseball: bat crack, mitt, organ) */
function anSound(b,ty,e){
  if(typeof sfx!=='function'||!SND.on) return; const f=anFam(b.sport);
  const S=(n,ms)=>sfx(n,ms||0);
  if(ty==='final'){ if(f==='bk') S('buzzer'); else S('whistle2'); S('fanfare',500); crowdFor(true,true); return; }
  if(f==='fb'){
    if(ty==='td'){ S('fanfare'); }
    else if(ty==='fg'){ S('kick'); }
    else if(ty==='fgmiss'||ty==='stop'){ S('groan'); }
    else if(ty==='fd'){ S('chime'); }
    else if(ty==='flag'){ S('whistle2'); }
    else if(ty==='sack'){ S('sack'); }
    else if(ty==='int'||ty==='fumble'){ S('catch'); S('tackle',250); }
    else if(ty==='punt'){ S('kick'); }
  } else if(f==='bk'){
    if(ty==='three'){ S('swish',650); }
    else if(ty==='dunk'){ S('squeak'); S('slam',380); }
    else if(ty==='bucket'){ S('swish',500); }
    else if(ty==='ft'){ S('dribble',0); S('swish',650); }
    else if(ty==='foul'){ S('whistle'); }
    else if(ty==='steal'){ S('squeak'); S('pass',150); }
    else if(ty==='block'){ S('crack',250); }
    else if(ty==='run'){ S('horn'); }
  } else {
    if(ty==='hit1'||ty==='hit2'||ty==='hit3'){ S('batcrack'); if(ty!=='hit1') S('organ',700); }
    else if(ty==='hr'||ty==='walkoff'){ S('batcrack'); S('big',200); S('organ',900); }
    else if(ty==='runscore'){ S('organ'); }
    else if(ty==='steal'){ S('slide'); }
    else if(ty==='safe'){ S('slide'); }
    else if(ty==='out'){ S('mitt'); }
    else if(ty==='strikeout'){ S('mitt',380); S('chime',450); }
    else if(ty==='walk'){ S('chime'); }
  }
  anCrowd(b,ty,e);
}
/* a short spoken call for scoring plays and period breaks (uses the same voice as the big screen) */
function anSay(b,e){
  if(!e||!SND.on||typeof say!=='function'||!HAS_TTS||document.hidden) return;
  if(e.kind==='score'){ let t=String(e.text||'').replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim(); if(!t||t.length>90) return; say(t+'!',true); }
  else if(e.kind==='period'){ say(String(e.text||'').slice(0,60),false); }
  else if(e.kind==='final'){ say('And that is the final.',true); }
}
function anPlay(b,d,e,done0,scale){
  const done=()=>{ done0(); };
  try{ AN.log.push(d.type); }catch(err){}
  try{ anSound(b,d.type,e); }catch(err){}
  const st=document.getElementById('stg-b'+b.id); if(!st){ done(); return; }
  const fx=st.querySelector('.fx'); fx.innerHTML=''; const side=e.side||'home'; let who=''; try{ who=anWho(b,e); }catch(err){} const f=anFam(b.sport); const col=anColor(b,side);
  const away=side==='away'; const dir=away?1:-1;               // football: the away team attacks the home (right-hand) end zone
  let ms=1500, ty=d.type;
  if(ty==='final'){ anBanner(st,'FINAL','big'); try{ celebrateB(b,'','h'); }catch(err){} setTimeout(done,anReduced()?900:1900); return; }
  if(f==='fb'){
    const y=60+(Math.random()-.5)*30, x0=away?70:250;
    if(ty==='td'){ const ball=anBall(fx,x0,y,4); anMove(ball,[[x0,y],[away?290:30,y-6]],1100,'ease-in'); if(who){ const rn=afPlayer(fx,x0,y+4,col,{name:who,r:4}); anMove(rn,[[x0,y+4],[away?290:30,y-2]],1100,'ease-in'); } setTimeout(()=>{ anBurst(fx,away?292:28,y-6,'#ffd23a',16); },1000); anBanner(st,'TOUCHDOWN!','big'); ms=1700; }
    else if(ty==='fg'){ const x1=away?300:20; anEl('path',{d:'M'+x1+' 40 V58 M'+(x1-7)+' 42 V58 M'+(x1+7)+' 42 V58 M'+(x1-7)+' 58 H'+(x1+7),stroke:'#ffd23a','stroke-width':1.6,fill:'none'},fx); const ball=anBall(fx,x0,y,3.6); anMove(ball,anArc([x0,y],[x1,48],34,18),1000,'linear'); if(who) afPlayer(fx,x0-(away?8:-8),y+4,col,{name:who,r:4}); anBanner(st,'FIELD GOAL!','mid'); ms=1500; }
    else if(ty==='fd'){ const lx=(away?150:170)+Math.random()*30; const ln=anEl('rect',{x:0,y:12,width:3,height:96,fill:'#ffd23a'},fx); anMove(ln,[[lx-30*dir,0],[lx,0]],500,'ease-out'); anBanner(st,'FIRST DOWN','sm'); ms=900; }
    else if(ty==='flag'){ const fl=anEl('g',{},fx); anEl('path',{d:'M0 -22 L0 0 M0 -22 L16 -16 L0 -10',stroke:'#ffd23a','stroke-width':3,fill:'#ffd23a'},fl); anMove(fl,[[150,-10],[150,64],[160,60],[154,64]],800,'ease-out'); anBanner(st,(e.text||'FLAG').split(':')[1]?('FLAG: '+e.text.split(':')[1].trim().split(',')[0].toUpperCase()):'FLAG','warn'); ms=1300; }
    else if(ty==='sack'){ const x=160+(Math.random()-.5)*80; anBurst(fx,x,60,'#ff5a52',14); anDot(fx,x,60,'#ff5a52',6); anBanner(st,'SACK!','bad'); anShake(st.querySelector('svg')); ms=1100; }
    else if(ty==='int'||ty==='fumble'){ const ball=anBall(fx,160,60,3.8); anMove(ball,[[160,60],[away?60:260,40],[away?30:290,70]],900,'ease-in-out'); anBanner(st,ty==='int'?'INTERCEPTED!':'FUMBLE!','bad'); ms=1300; }
    else if(ty==='punt'){ const ball=anBall(fx,x0,y,3.4); anMove(ball,anArc([x0,y],[away?260:60,60],40,18),1000); anBanner(st,'PUNT','sm'); ms=1100; }
    else if(ty==='fgmiss'||ty==='stop'){ anBanner(st,ty==='stop'?'STOPPED!':'NO GOOD','bad'); ms=900; }
    else { done(); return; }
  } else if(f==='bk'){
    const tx=away?22:298;                                          // the away team shoots at the left hoop, the home team at the right
    const shoot=(from,peak,ms2)=>{ if(who) afPlayer(fx,from[0]+(away?-6:6),from[1]+5,col,{name:who,r:3.8}); const ball=anBall(fx,from[0],from[1],3.6,'#e8742c'); anMove(ball,anArc(from,[tx,60],peak,18),ms2,'linear',()=>{ anBurst(fx,tx,60,'#fff',7); }); return ball; };
    const rx=away?(Math.random()<.5?70:60):(Math.random()<.5?250:260);
    if(ty==='three'){ shoot([away?86:234,24+Math.random()*72],40,950); anBanner(st,'THREE!','big'); ms=1500; }
    else if(ty==='dunk'){ const p=afPlayer(fx,away?60:260,60,col,{name:who||undefined,r:5.2}); anMove(p,[[away?60:260,60],[tx+(away?14:-14),50],[tx+(away?5:-5),44],[tx+(away?14:-14),64]],700,'ease-in-out'); anBurst(fx,tx,58,'#ffd23a',10); anBanner(st,'DUNK!','big'); ms=1300; }
    else if(ty==='bucket'){ shoot([away?(46+Math.random()*10):(274-Math.random()*10),44+Math.random()*34],16,650); anBanner(st,'BUCKET','mid'); ms=1000; }
    else if(ty==='ft'){ shoot([away?52:268,60],10,550); anBanner(st,'FREE THROWS','sm'); ms=900; }
    else if(ty==='foul'){ anEl('circle',{cx:160,cy:60,r:10,fill:'#ff5a52',stroke:'#fff','stroke-width':2},fx).animate(anReduced()?[]:[{transform:'scale(.2)',transformOrigin:'160px 60px',opacity:0},{transform:'scale(1.4)',transformOrigin:'160px 60px',opacity:1},{transform:'scale(1)',transformOrigin:'160px 60px',opacity:1}],{duration:500,fill:'forwards'}); anEl('text',{x:160,y:64,'text-anchor':'middle','font-size':12,'font-weight':900,fill:'#fff'},fx).textContent='!'; anBanner(st,'FOUL!','bad'); anShake(st.querySelector('svg')); ms=1200; }
    else if(ty==='steal'){ const bl=anBall(fx,rx,40,3.6,'#e8742c'); const o=anDot(fx,rx-14*(away?1:-1),44,'#ddd',4); void o; anMove(bl,[[rx,40],[160,70],[away?250:70,60]],800,'ease-in'); anBanner(st,'STEAL!','mid'); ms=1200; }
    else if(ty==='block'){ const bl=anBall(fx,tx+(away?-30:30),50,3.6,'#e8742c'); const h=anEl('rect',{x:-4,y:-8,width:8,height:16,rx:3,fill:col,stroke:'#fff'},fx); anMove(h,[[tx+(away?-20:20),70],[tx+(away?-20:20),46]],300,'ease-out'); anMove(bl,[[tx+(away?-30:30),50],[tx+(away?-18:18),48],[tx+(away?-60:60),84]],700,'ease-out'); anBanner(st,'BLOCKED!','bad'); ms=1200; }
    else if(ty==='run'){ anBanner(st,(e.text||'RUN').toUpperCase(),'mid'); anBurst(fx,160,60,col,12); ms=1300; }
    else { done(); return; }
  } else {
    const home=[160,104], b1=[214,66], b2=[160,30], b3=[106,66];
    if(ty==='hit1'||ty==='hit2'||ty==='hit3'){ const tgt=ty==='hit1'?[206+Math.random()*30,50]:ty==='hit2'?[250,34]:[272,52]; const ball=anBall(fx,home[0],home[1],3,'#fff'); anMove(ball,anArc(home,tgt,ty==='hit1'?10:26,16),800,'ease-out');
      const r=afPlayer(fx,home[0],home[1],col,{name:who||undefined,r:4}); anMove(r,ty==='hit1'?[home,b1]:ty==='hit2'?[home,b1,b2]:[home,b1,b2,b3],900,'linear'); anBanner(st,ty==='hit1'?'SINGLE':ty==='hit2'?'DOUBLE!':'TRIPLE!','mid'); ms=1300; }
    else if(ty==='hr'||ty==='walkoff'){ const ball=anBall(fx,home[0],home[1],3.2,'#fff'); anMove(ball,anArc(home,[away?270:50,-14],64,22),1200,'linear',()=>{ anBurst(fx,away?270:50,0,'#ffd23a',18); }); const r=afPlayer(fx,home[0],home[1],col,{name:who||undefined,r:4}); anMove(r,[home,b1,b2,b3,home],1700,'linear'); anBanner(st,ty==='hr'?'HOME RUN!':'WALK-OFF!','big'); ms=2000; }
    else if(ty==='runscore'){ const r=anDot(fx,b3[0],b3[1],col,4.5); anMove(r,[b3,home],700,'ease-in'); anBurst(fx,home[0],home[1]+2,col,8); anBanner(st,'RUN SCORES!','mid'); ms=1200; }
    else if(ty==='steal'){ const r=anDot(fx,b1[0],b1[1],col,4.5); anMove(r,[b1,b2],650,'ease-in'); setTimeout(()=>{ anBurst(fx,b2[0],b2[1],'#d9b383',8); },600); anBanner(st,'STOLEN BASE — SAFE','good'); ms=1200; }
    else if(ty==='safe'){ const r=anDot(fx,home[0],home[1],col,4.5); anMove(r,[home,b1],600,'ease-in'); setTimeout(()=>{ anBurst(fx,b1[0],b1[1],'#d9b383',9); },560); anBanner(st,'SAFE!','good'); ms=1100; }
    else if(ty==='out'){ const r=anDot(fx,home[0],home[1],col,4.5); anMove(r,[home,[190,80]],400,'ease-out'); const ball=anBall(fx,b2[0],b2[1]+20,2.8,'#fff'); anMove(ball,[[b2[0],b2[1]+20],[b1[0],b1[1]]],450,'ease-in'); anBanner(st,'OUT!','bad'); ms=1100; }
    else if(ty==='strikeout'){ anEl('rect',{x:146,y:70,width:28,height:30,fill:'none',stroke:'#fff','stroke-width':1.5,'stroke-dasharray':'3 2'},fx); const ball=anBall(fx,160,34,3,'#fff'); anMove(ball,[[160,34],[160,86]],380,'ease-in'); anEl('text',{x:160,y:60,'text-anchor':'middle','font-size':22,'font-weight':900,fill:'#fff'},fx).textContent='K'; anBanner(st,'STRIKEOUT','bad'); ms=1100; }
    else if(ty==='walk'){ const r=anDot(fx,home[0],home[1],col,4.5); anMove(r,[home,b1],800,'ease-in-out'); anBanner(st,'BALL FOUR — WALK','sm'); ms=1100; }
    else { done(); return; }
  }
  if(ty==='td'||ty==='hr'||ty==='walkoff'||ty==='three') try{ celebrateB(b,'',side==='home'?'h':'a'); }catch(err){}
  setTimeout(done,anReduced()?900:Math.round(ms*(scale||1)));
}
function anPump(b){
  const Q=AN.q[b.id]; if(!Q||Q.busy) return;
  while(Q.items.length){
    const it=Q.items.shift(); const n=Q.items.length;
    if(n>2&&it.d.pri<2){ AN.drop++; continue; } if(n>4&&it.d.pri<3){ AN.drop++; continue; } if(n>7&&it.d.type!=='final'){ AN.drop++; continue; }   // backlog: small plays go first, then all but the latest
    it.scale=n>3?.55:n>1?.8:1;      // backlog: drop the small plays first
    if(!anEnsureStage(b)) return;
    Q.busy=true; let fin=false; const done=()=>{ if(fin) return; fin=true; Q.busy=false; anPump(b); };
    try{ anPlay(b,it.d,it.e,done,it.scale); }catch(err){ done(); } setTimeout(done,2600); return;
  }
}
function anEnqueue(b,news){
  if(document.hidden) return; const Q=AN.q[b.id]||(AN.q[b.id]={items:[],busy:false});
  let any=false; news.forEach(e=>{ const d=anClassify(b.sport,e); if(d){ Q.items.push({d:d,e:e}); any=true; } });
  if(any){ try{ afCancel(b.id); }catch(e){} }          // a real play cuts in on any filler scene
  news.forEach(e=>{ try{ anSay(b,e); }catch(err){} }); anPump(b);
}
function anBump(b,news){
  if(!news.some(e=>e.kind==='score')||anReduced()) return;
  document.querySelectorAll('#bts-board .score .big').forEach(n=>{ n.animate([{transform:'scale(1)'},{transform:'scale(1.35)',color:'#ffb62e'},{transform:'scale(1)'}],{duration:600,easing:'ease-out'}); });
}
function anLabelOf(e){ return (e&&AN_LABEL[e.kind])||'PLAY'; }
function anIconOf(e){ return (e&&AN_ICON[e.kind])||''; }

AN.classify=anClassify;
