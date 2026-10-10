/* ================= Battle filler scenes =================
   The server only sends the plays that change the game, so in a 6- or 8-minute battle the stage used to sit still between plays.
   This director keeps the field / court / diamond alive: whenever no real play is waiting it runs a short scene (free throws, a dunk, a fast break,
   teams lining up on the field, a snap and a pass, a kickoff, a pitch, a double play ...), with the team colors and player names from the
   battle's own rosters, plus the odd crowd moment (the wave, fireworks).  The longer the game, the more scenes run.  Real plays always cut in at once.
   Scenes are pure decoration: they never touch the score or the plays.  Reduced motion: no scenes. */
const AF={d:{},tok:0};
const AF_DECK={
  bk:['lineup','ft','dunk','three','fast','swing','rebound','alley','huddle'],
  fb:['lineup','pass','run','kickoff','fg','huddle','scramble','pass','run'],
  bb:['take','pitch','pitch','pickoff','mound','dp','pitch']
};
function afOther(s){ return s==='home'?'away':'home'; }
function afShuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=a[i]; a[i]=a[j]; a[j]=t; } return a; }
function afR(a,b){ return a+Math.random()*(b-a); }
function afTeamShort(b,side){ try{ const t=teamOf(b.sport,side==='home'?b.home:b.away); return t.short||t.abbr||''; }catch(e){ return ''; } }
function afRoster(b){
  const ro=(b.markets&&b.markets.roster)||null, n=ro?Object.keys(ro).length:0, k='r'+b.id; let r=AF.d[k]; if(r&&r.n===n) return r;
  r={n:n,home:[],away:[]}; if(ro) Object.keys(ro).forEach(pid=>{ const x=ro[pid]; if(x&&r[x[1]]) r[x[1]].push({n:surname(String(x[0]||'')),role:x[2],rk:+x[3]||0}); });
  ['home','away'].forEach(s=>r[s].sort((a,c)=>a.rk-c.rk)); AF.d[k]=r; return r;
}
/* a player's surname from the roster (the better players come up more often); roles is an optional list such as ['QB'] */
function afName(b,side,roles,not){
  const all=afRoster(b)[side]||[]; let pool=roles?all.filter(x=>roles.indexOf(x.role)>=0):all; if(!pool.length) pool=all; if(not&&pool.length>1) pool=pool.filter(x=>x.n!==not);
  if(!pool.length) return afTeamShort(b,side);
  return pool[Math.floor(Math.random()*Math.random()*pool.length*1.4)%pool.length].n;
}
/* the name in front of a play's text ("Jalen Brunson drains a three") */
function anWho(b,e){
  const t=String(e&&e.text||''); const m=t.match(/^((?:[A-Z][A-Za-z.'\-]*\s+){1,2}[A-Z][A-Za-z.'\-]*)/); if(!m) return '';
  const w=m[1].split(/\s+/); if(w.some(q=>/^(guard|wing|forward|big|first|touchdown|field|flag|foul|sack|steal|blocked|strikeout|stolen|ball|close|out|final|end|halftime|kickoff|interception|fumble|punt|safe|scoring)$/i.test(q))||/^[A-Z]{2,4}$/.test(w[0])) return '';
  return surname(m[1]);
}

/* ---- drawing ---- */
function afG(parent,x,y){ const g=anEl('g',{},parent); g.style.transform='translate('+x+'px,'+y+'px)'; return g; }
function afPlayer(fx,x,y,col,o){
  o=o||{}; const r=o.r||4.4, g=afG(fx,x,y);
  anEl('ellipse',{cx:0,cy:r*.95,rx:r*.95,ry:r*.32,fill:'rgba(0,0,0,.28)'},g);
  anEl('rect',{x:-r*.78,y:-r*.7,width:r*1.56,height:r*1.7,rx:r*.5,fill:col,stroke:o.ring||'#fff','stroke-width':.8},g);
  anEl('circle',{cx:0,cy:-r*1.3,r:r*.58,fill:o.skin||'#f1c9a0',stroke:'rgba(40,24,10,.8)','stroke-width':.4},g);
  if(o.name) afTag(g,o.name,o.nameDy!=null?o.nameDy:-r*2.1,o.size,o.tx);
  return g;
}
function afTag(g,txt,dy,size,tx){
  const t=anEl('text',{x:tx||0,y:dy,'text-anchor':'middle','font-size':size||7.4,'font-weight':800,fill:'#fff',stroke:'rgba(8,14,28,.92)','stroke-width':2.3,'paint-order':'stroke','stroke-linejoin':'round'},g); t.textContent=txt; return t;
}
function afBk(fx,x,y){ const g=afG(fx,x,y); anEl('circle',{cx:0,cy:0,r:3.3,fill:'#e8742c',stroke:'#6b2800','stroke-width':.7},g); anEl('path',{d:'M-3.3 0H3.3M0 -3.3V3.3',stroke:'#6b2800','stroke-width':.5,fill:'none'},g); return g; }
function afFb(fx,x,y){ return anBall(fx,x,y,3.4); }
function afBase(fx,x,y){ return anBall(fx,x,y,2.5,'#fff'); }
function afPulse(fx,x,y,col,r){ if(anReduced()) return; const c=anEl('circle',{cx:x,cy:y,r:r||6,fill:'none',stroke:col||'#fff','stroke-width':2},fx); c.animate([{transform:'scale(.4)',transformOrigin:x+'px '+y+'px',opacity:1},{transform:'scale(2.2)',transformOrigin:x+'px '+y+'px',opacity:0}],{duration:520,easing:'ease-out',fill:'forwards'}); }
function afBounce(node,x,y,n,h,ms){ const pts=[]; for(let i=0;i<n;i++){ pts.push([x,y],[x,y-h],[x,y]); } anMove(node,pts,ms,'ease-in-out'); }
function afHop(node,x,y,h,ms){ anMove(node,[[x,y],[x,y-h],[x,y]],ms,'ease-out'); }
function afNote(x,txt,cls,at){ x.T(at||0,()=>anBanner(x.st,txt,(cls||'sm')+' top')); }

/* broadcast camera: ease the stage's viewBox in on the action (same 8:3 shape), and back out before the scene ends */
function afCam(x,vb,ms){
  const svg=x.st.querySelector('svg'); if(!svg||anReduced()) return; const from=(svg.getAttribute('viewBox')||'0 0 320 120').split(/\s+/).map(Number), t0=performance.now(), tok=x.tok;
  const step=now=>{ if(AF.tok!==tok) return; const u=Math.min(1,(now-t0)/(ms||600)), e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2; svg.setAttribute('viewBox',from.map((a,i)=>(a+(vb[i]-a)*e).toFixed(2)).join(' ')); if(u<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function afCamReset(st){ const svg=st&&st.querySelector&&st.querySelector('svg'); if(svg) svg.setAttribute('viewBox','0 0 320 120'); }
function afZoomHoop(x,k){ const w=320/k, h=120/k; afCam(x,[x.away?0:320-w,Math.max(0,60-h/2),w,h],700); }

/* ---- the director ---- */
function afKind(b){ return anFam(b.sport); }
function afStart(b){
  const k='d'+b.id; let d=AF.d[k]; if(d&&d.iv) return;
  d=AF.d[k]=d||{deck:[],side:Math.random()<.5?'home':'away',n:0,last:Date.now(),gap:700,running:false,iv:null,prev:'',first:true,fx:null};
  d.iv=setInterval(()=>afTick(b.id),450);
}
function afBattle(id){ const bt=typeof BT!=='undefined'&&BT.det&&BT.det.battle; return bt&&bt.id===id?bt:null; }
function afTick(id){
  const d=AF.d['d'+id]; if(!d) return; const st=document.getElementById('stg-b'+id), b=afBattle(id);
  if(!st||!b){ clearInterval(d.iv); d.iv=null; d.running=false; return; }
  if(b.status!=='live'||document.hidden||anReduced()) return;
  const Q=AN.q[id]; if(Q&&(Q.busy||Q.items.length)){ d.last=Date.now(); return; }
  if(d.running) return;
  if(Date.now()-d.last<d.gap) return;
  afRun(b,st,d);
}
function afGap(b){ const mins=+b.duration_min||4; return Math.round(afR(500,1100)*(mins>=6?.8:1)); }
function afPick(b,d){
  const f=afKind(b), mins=+b.duration_min||4;
  d.n++; if(d.first){ d.first=false; return f==='bb'?'take':'lineup'; }
  const showEvery=Math.max(4,12-mins);        // longer games get a crowd moment more often
  if(d.n%showEvery===0) return Math.random()<.5?'wave':'fireworks';
  if(!d.deck.length) d.deck=afShuffle(AF_DECK[f]);
  let s=d.deck.shift(); if(s===d.prev&&d.deck.length) s=d.deck.shift();
  if(s==='huddle'&&mins<4&&Math.random()<.6) s=d.deck.length?d.deck.shift():'lineup';
  return s;
}
function afRun(b,st,d){
  const fx=st.querySelector('.fx'); if(!fx) return;
  const name=afPick(b,d), f=afKind(b); const fn=AF_SCENES[(name==='wave'||name==='fireworks')?name:f+'_'+name]; if(!fn){ d.last=Date.now(); return; }
  d.side=afOther(d.side); const A=d.side, D=afOther(A); d.prev=name; d.running=true; const tok=++AF.tok;
  fx.innerHTML='';
  const x={b:b,st:st,fx:fx,A:A,D:D,col:anColor(b,A),colD:anColor(b,D),away:A==='away',tok:tok,
    T:(ms,fn2)=>{ const t=setTimeout(()=>{ if(AF.tok===tok&&d.running){ try{ fn2(); }catch(e){ try{ console.error('Line Scout scene',e); }catch(_){} } } },Math.max(0,ms)); return t; },
    S:(snd,ms)=>x.T(ms||0,()=>sfx(snd,0)),
    crowd:(home,big,ms)=>x.T(ms||0,()=>crowdFor(home,big))};
  let ms=2200; try{ ms=fn(x)||2200; }catch(e){ try{ console.error('Line Scout scene',name,e); }catch(_){} ms=300; }
  d.fx=fx; d.st=st; try{ AN.log.push('fill:'+name); }catch(e){}
  x.T(Math.max(300,ms-550),()=>afCam(x,[0,0,320,120],500));
  setTimeout(()=>{ if(AF.tok===tok){ d.running=false; d.last=Date.now(); d.gap=afGap(b); afCamReset(st); if(fx.childNodes.length) fx.innerHTML=''; } },ms+80);
}
/* a real play is about to be shown: stop whatever filler is running */
function afCancel(id){ const d=AF.d['d'+id]; if(!d||!d.running) return; AF.tok++; d.running=false; d.last=Date.now(); try{ afCamReset(d.st); if(d.fx) d.fx.innerHTML=''; }catch(e){} }

/* ---- basketball (the away team shoots at the left hoop, the home team at the right) ---- */
function afBkSet(x){ x.hx=x.away?22:298; x.sgn=x.away?-1:1; x.ft=x.away?54:266; x.m=v=>x.away?v:320-v; return x; }
function afBkLineup(x){
  const b=x.b, fx=x.fx, ca=anColor(b,'away'), ch=anColor(b,'home'); const na=afName(b,'away'), nh=afName(b,'home');
  const sa=[[132,34],[132,86],[112,48],[112,72]], sh=[[188,34],[188,86],[208,48],[208,72]];
  sa.forEach((p,i)=>{ const g=afPlayer(fx,12,p[1],ca); anMove(g,[[12,p[1]],[p[0],p[1]]],850+i*90,'ease-out'); });
  sh.forEach((p,i)=>{ const g=afPlayer(fx,308,p[1],ch); anMove(g,[[308,p[1]],[p[0],p[1]]],850+i*90,'ease-out'); });
  const ja=afPlayer(fx,12,60,ca,{name:na,tx:-12}), jh=afPlayer(fx,308,60,ch,{name:nh,tx:12}); afCam(x,[40,7,240,90],900); anMove(ja,[[12,60],[148,60]],1000,'ease-out'); anMove(jh,[[308,60],[172,60]],1000,'ease-out');
  afNote(x,'TIP-OFF','mid',900); x.S('whistle',900);
  x.T(1300,()=>{ const bl=afBk(fx,160,66); anMove(bl,[[160,66],[160,24],[160,50]],900,'ease-in-out'); afHop(ja,148,60,8,420); afHop(jh,172,60,8,420); });
  x.T(2100,()=>{ const w=Math.random()<.5?'away':'home'; const bl=afBk(fx,160,50); anMove(bl,[[160,50],[w==='home'?186:134,58]],380,'ease-out'); x.S('pass',0); x.crowd(w==='home',false,200); });
  x.S('chime',1250);
  return 3000;
}
function afBkFt(x){
  afBkSet(x); const b=x.b, fx=x.fx, hx=x.hx, sg=x.sgn; const nm=afName(b,x.A), sx=x.ft-sg*5;
  [[hx-sg*10,44,x.col],[hx-sg*10,76,x.colD],[hx-sg*26,44,x.colD],[hx-sg*26,76,x.col]].forEach(p=>afPlayer(fx,p[0],p[1],p[2],{r:3.8}));
  const sh=afPlayer(fx,sx,60,x.col,{name:nm}); const cnt=anEl('text',{x:sx,y:75,'text-anchor':'middle','font-size':6.4,'font-weight':800,fill:'#ffd23a',stroke:'rgba(8,14,28,.9)','stroke-width':2.1,'paint-order':'stroke'},fx);
  let made=0; const res=[Math.random()<.78,Math.random()<.74]; afNote(x,'FREE THROWS','sm',0); afZoomHoop(x,2);
  if(x.A==='away') x.S('boo',150);
  res.forEach((ok,i)=>{ const t0=300+i*1700; if(ok) made++; let bl=null;
    x.T(t0,()=>{ cnt.textContent='FT '+(i+1)+' of 2'; bl=afBk(fx,sx-sg*4,58); afBounce(bl,sx-sg*4,58,2,8,640); sfx('dribble',0); });
    x.T(t0+700,()=>{ if(!bl) return; anMove(bl,anArc([sx-sg*4,58],[hx,60],20,18),760,'linear',()=>{ if(ok){ anBurst(fx,hx,60,'#fff',8); } else { anMove(bl,[[hx,60],[hx-sg*16,76]],360,'ease-out'); } }); });
    x.T(t0+1460,()=>{ if(ok){ sfx('swish',0); if(x.A==='home') sfx('crowd',0,false); else sfx('awww',0); } else { sfx('denied',0); if(x.A==='home') sfx('awww',250); else sfx('cheer',250); } });
    x.T(t0+1650,()=>{ if(bl&&bl.parentNode) bl.remove(); });
  });
  x.T(3500,()=>{ cnt.textContent=''; anBanner(x.st,made+' OF 2',made===2?'good':made?'mid':'bad'); if(x.A==='home'&&made===2) x.crowd(true,false); });
  return 4300;
}
function afBkDunk(x){
  afBkSet(x); const b=x.b, fx=x.fx, hx=x.hx, sg=x.sgn; const nm=afName(b,x.A); const y0=afR(40,80), x0=x.away?172:148;
  const d=afPlayer(fx,x0+sg*-14,y0+4,x.colD,{r:4}); anMove(d,[[x0-sg*14,y0+4],[hx-sg*34,60],[hx-sg*24,56]],1250,'ease-in-out');
  const p=afPlayer(fx,x0,y0,x.col,{name:nm}); const bl=afBk(p,5,-3);
  anMove(p,[[x0,y0],[hx-sg*46,58],[hx-sg*22,50],[hx-sg*9,38],[hx-sg*14,60]],1350,'ease-in');
  x.S('squeak',100); x.S('squeak',520); afZoomHoop(x,1.5);
  x.T(1000,()=>{ anBanner(x.st,'SLAM DUNK!','big top'); anBurst(fx,hx,56,'#ffd23a',14); afPulse(fx,hx,56,'#ffd23a',7); sfx('doorslam',0); x.crowd(x.A==='home',true,120); });
  void bl; return 2300;
}
function afBkThree(x){
  afBkSet(x); const b=x.b, fx=x.fx, hx=x.hx, sg=x.sgn; const dy=afR(-32,32); const arcx=x.away?34+Math.sqrt(2500-dy*dy):286-Math.sqrt(2500-dy*dy); const sx=arcx-sg*5, sy=60+dy;
  const nm=afName(b,x.A), pn=afName(b,x.A,null,nm); const px=x.m(150), py=60+(dy>0?-26:26);
  const pas=afPlayer(fx,px,py,x.col,{name:pn}); void pas; const dfn=afPlayer(fx,sx+sg*22,sy,x.colD,{r:4}); anMove(dfn,[[sx+sg*22,sy],[sx+sg*4,sy+1]],900,'ease-out');
  const sh=afPlayer(fx,sx,sy,x.col,{name:nm}); const ok=Math.random()<.42;
  afZoomHoop(x,1.5); const bl=afBk(fx,px,py-2); anMove(bl,[[px,py-2],[sx,sy-4]],420,'ease-in'); x.S('pass',0);
  x.T(480,()=>{ afHop(sh,sx,sy,5,520); anMove(bl,anArc([sx,sy-4],[hx,60],38,20),900,'linear',()=>{ if(ok) anBurst(fx,hx,60,'#fff',8); else anMove(bl,[[hx,60],[hx-sg*18,80]],420,'ease-out'); }); });
  x.T(1520,()=>{ if(ok){ sfx('swish',0); anBanner(x.st,'THREE!','big top'); x.crowd(x.A==='home',false); } else { sfx('denied',0); if(x.A==='home') sfx('awww',200); else sfx('cheer',200); } });
  return 2700;
}
function afBkFast(x){
  afBkSet(x); const b=x.b, fx=x.fx, hx=x.hx, sg=x.sgn; const x0=x.away?272:48; const n1=afName(b,x.A), n2=afName(b,x.A,null,n1);
  [34,86].forEach((y,i)=>{ const g=afPlayer(fx,x0-sg*16,y,x.colD,{r:3.8}); anMove(g,[[x0-sg*16,y],[160-sg*14,y],[hx-sg*36,60+(i?12:-12)]],1900,'ease-in-out'); });
  const h=afPlayer(fx,x0,60,x.col,{name:n1}); anMove(h,[[x0,60],[160,56],[hx-sg*40,58],[hx-sg*22,50]],1500,'ease-in-out');
  const w=afPlayer(fx,x0,34,x.col,{name:n2}); anMove(w,[[x0,34],[160,36],[hx-sg*28,38],[hx-sg*12,38]],1550,'ease-in-out');
  const bl=afBk(fx,x0,58); anMove(bl,[[x0,58],[160,54],[hx-sg*40,56]],1100,'ease-in-out');
  afNote(x,'FAST BREAK!','mid',300); x.S('dribble',100); x.S('squeak',700); x.S('dribble',900);
  x.T(1100,()=>{ anMove(bl,anArc([hx-sg*40,56],[hx-sg*14,40],10,12),420,'ease-out'); sfx('pass',0); });
  x.T(1560,()=>{ anMove(bl,anArc([hx-sg*14,40],[hx,60],12,12),420,'linear',()=>anBurst(fx,hx,60,'#fff',8)); });
  x.T(1980,()=>{ sfx('swish',0); x.crowd(x.A==='home',false); });
  return 2800;
}
function afBkSwing(x){
  afBkSet(x); const b=x.b, fx=x.fx, hx=x.hx, sg=x.sgn; const m=x.m;
  const sp=[[m(92),60],[m(82),30],[m(82),90],[m(60),44],[m(60),76]]; const names=sp.map((_,i)=>afName(b,x.A));
  sp.forEach((p,i)=>afPlayer(fx,p[0],p[1],x.col,{name:(i===0||i===3)?names[i]:undefined,r:4}));
  sp.forEach((p,i)=>{ const g=afPlayer(fx,p[0]+sg*10,p[1]+(i?(p[1]>60?-3:3):0),x.colD,{r:3.8}); anMove(g,[[p[0]+sg*10,p[1]],[p[0]+sg*10+(i%2?3:-3),p[1]+(i%2?-3:3)],[p[0]+sg*10,p[1]]],2600,'ease-in-out'); });
  const seq=[0,1,3,2,4,3]; const bl=afBk(fx,sp[0][0],sp[0][1]-3); let t=350;
  for(let i=1;i<seq.length;i++){ const a=sp[seq[i-1]], c=sp[seq[i]]; x.T(t,()=>{ anMove(bl,[[a[0],a[1]-3],[c[0],c[1]-3]],360,'ease-out'); sfx('pass',0); }); t+=430; }
  afNote(x,'BALL MOVEMENT','sm',0); afZoomHoop(x,1.4);
  const last=sp[seq[seq.length-1]], ok=Math.random()<.62;
  x.T(t+120,()=>{ anMove(bl,anArc([last[0],last[1]-3],[hx,60],26,18),760,'linear',()=>{ if(ok) anBurst(fx,hx,60,'#fff',8); else anMove(bl,[[hx,60],[hx-sg*18,70]],360,'ease-out'); }); });
  x.T(t+880,()=>{ if(ok){ sfx('swish',0); x.crowd(x.A==='home',false); } else { sfx('denied',0); if(x.A==='home') sfx('awww',200); } });
  return t+1700;
}
function afBkRebound(x){
  afBkSet(x); const b=x.b, fx=x.fx, hx=x.hx, sg=x.sgn; const m=x.m;
  const shooter=afPlayer(fx,m(86),60,x.col,{name:afName(b,x.A)}); void shooter; const bl=afBk(fx,m(86),56);
  const spots=[[hx-sg*20,46,x.col],[hx-sg*28,74,x.colD],[hx-sg*14,70,x.colD],[hx-sg*30,52,x.col]];
  const dots=spots.map(p=>afPlayer(fx,p[0],p[1],p[2],{r:4}));
  afZoomHoop(x,1.8); anMove(bl,anArc([m(86),56],[hx,60],26,18),760,'linear'); x.S('denied',780);
  const w=Math.random()<.5?'A':'D', wi=w==='A'?[0,3][Math.floor(Math.random()*2)]:[1,2][Math.floor(Math.random()*2)];
  x.T(800,()=>{ dots.forEach((g,i)=>afHop(g,spots[i][0],spots[i][1],i===wi?11:8,520)); anMove(bl,[[hx,60],[hx-sg*10,40],[spots[wi][0],spots[wi][1]-9]],520,'ease-out'); });
  x.T(1350,()=>{ sfx('rebound',0); anMove(bl,[[spots[wi][0],spots[wi][1]-9],[x.m(120),64]],520,'ease-out'); anBanner(x.st,'REBOUND','sm top'); if((w==='A')===(x.A==='home')) sfx('crowd',0,false); else sfx('awww',0); });
  return 2300;
}
function afBkAlley(x){
  afBkSet(x); const b=x.b, fx=x.fx, hx=x.hx, sg=x.sgn; const m=x.m; const n1=afName(b,x.A), n2=afName(b,x.A,null,n1);
  const pas=afPlayer(fx,m(104),76,x.col,{name:n1}); void pas; const cut=afPlayer(fx,m(98),26,x.col,{name:n2});
  const d=afPlayer(fx,m(70),48,x.colD,{r:4}); anMove(d,[[m(70),48],[hx-sg*16,52]],1200,'ease-in-out');
  const bl=afBk(fx,m(104),70); x.S('whoosh',100);
  anMove(bl,[[m(104),70],[m(88),22],[hx-sg*9,36]],900,'ease-in-out'); anMove(cut,[[m(98),26],[m(70),30],[hx-sg*22,40],[hx-sg*9,34],[hx-sg*15,62]],1350,'ease-in');
  afZoomHoop(x,1.6); afNote(x,'ALLEY-OOP!','big',900); x.T(1000,()=>{ anBurst(fx,hx,56,'#ffd23a',14); afPulse(fx,hx,56,'#ffd23a',7); sfx('doorslam',0); x.crowd(x.A==='home',true,100); });
  return 2400;
}
function afBkHuddle(x){
  afBkSet(x); const fx=x.fx; const cx=160, cy=96; const coach=afPlayer(fx,cx,cy,'#e7ebf2',{r:4.6}); void coach;
  for(let i=0;i<5;i++){ const a=i/5*Math.PI*2-Math.PI/2; const g=afPlayer(fx,cx+Math.cos(a)*15,cy+Math.sin(a)*8,x.col,{r:3.8}); afHop(g,cx+Math.cos(a)*15,cy+Math.sin(a)*8,3,500); }
  afCam(x,[80,42,160,60],700); afNote(x,'TIMEOUT','mid',0); x.S('whistle',0); x.S('huddle',500); x.S('chant',900); x.S('clap',2300);
  return 3000;
}

/* ---- football (the away team attacks the right-hand end zone) ---- */
function afFbSet(x){ x.sgn=x.away?1:-1; x.los=afR(110,210); x.ox=d=>x.los-x.sgn*d; x.dx=d=>x.los+x.sgn*d; return x; }
function afFbForm(x,from,lab){
  const fx=x.fx, b=x.b, o={}, ox=x.ox, dx=x.dx; lab=lab||[];
  const NM={qb:afName(b,x.A,['QB']),wr1:afName(b,x.A,['WR']),rb:afName(b,x.A,['RB'])};
  const mk=(key,xx,yy,col,r)=>{ const sx=from?(col===x.col?ox(from):dx(from)):xx; const g=afPlayer(fx,sx,yy,col,{r:r||3.1,name:lab.indexOf(key)>=0?NM[key]:undefined,nameDy:key==='wr1'?12:undefined}); if(from) anMove(g,[[sx,yy],[xx,yy]],800+Math.random()*250,'ease-out'); o[key]=g; o[key+'_p']=[xx,yy]; return g; };
  [47,53.5,60,66.5,73].forEach((y,i)=>mk('ol'+i,ox(3),y,x.col));
  mk('te',ox(3),80,x.col); mk('wr1',ox(3),30,x.col); mk('wr2',ox(3),92,x.col); mk('slot',ox(9),86,x.col);
  mk('qb',ox(12),60,x.col); mk('rb',ox(20),64,x.col);
  [49,56.5,63.5,71].forEach((y,i)=>mk('dl'+i,dx(3),y,x.colD)); [45,60,75].forEach((y,i)=>mk('lb'+i,dx(11),y,x.colD));
  mk('cb1',dx(8),30,x.colD); mk('cb2',dx(8),92,x.colD); mk('s1',dx(24),42,x.colD); mk('s2',dx(24),78,x.colD);
  return o;
}
function afFbCam(x,k){ k=k||1.5; const w=320/k, h=120/k; const cx=Math.max(w/2,Math.min(320-w/2,x.los)); afCam(x,[cx-w/2,Math.max(0,60-h/2),w,h],800); }
function afFbLos(x){ const l=anEl('rect',{x:x.los-.7,y:12,width:1.4,height:96,fill:'#3d8bff','fill-opacity':.8},x.fx); void l; const f=anEl('rect',{x:x.los+x.sgn*24-.7,y:12,width:1.4,height:96,fill:'#ffd23a','fill-opacity':.8},x.fx); void f; }
function afDown(){ return ['1ST & 10','2ND & 7','3RD & 4','2ND & 10','1ST & 10','3RD & 8','4TH & 1'][Math.floor(Math.random()*7)]; }
function afFbLineup(x){
  afFbSet(x); afFbLos(x); afFbCam(x,1.5); const o=afFbForm(x,38,['qb']); const fx=x.fx;
  afNote(x,afDown(),'sm',700); x.S('huddle',100);
  x.T(1300,()=>{ const p=o.slot_p; anMove(o.slot,[[p[0],p[1]],[p[0],p[1]-18],[p[0]+x.sgn*-2,p[1]-18]],700,'ease-in-out'); });
  x.T(1700,()=>{ anBanner(x.st,'HUT HUT!','mid'); x.S('hut',0); });
  x.T(2350,()=>{ const bl=afFb(fx,x.los,60); anMove(bl,[[x.los,60],[x.ox(12),60]],240,'ease-out'); sfx('snap',0); ['dl0','dl1','dl2','dl3'].forEach(k=>{ anMove(o[k],[[o[k+'_p'][0],o[k+'_p'][1]],[o[k+'_p'][0]-x.sgn*3,o[k+'_p'][1]]],300,'ease-out'); }); });
  return 3100;
}
function afFbPass(x){
  afFbSet(x); afFbLos(x); afFbCam(x,1.5); const o=afFbForm(x,0,['qb','wr1']), fx=x.fx, sg=x.sgn, los=x.los;
  const ok=Math.random()<.78; const gain=ok?Math.round(afR(5,28)):0; const tx=los+sg*(30+gain*1.1); const ty=afR(38,54);
  afNote(x,afDown(),'sm',0); const bl=afFb(fx,los,60);
  x.T(350,()=>{ sfx('hut',0); sfx('snap',250); anMove(bl,[[los,60],[x.ox(12),60]],260,'ease-out'); });
  x.T(650,()=>{ anMove(o.qb,[[x.ox(12),60],[x.ox(26),60]],700,'ease-out'); ['dl0','dl1','dl2','dl3'].forEach((k,i)=>anMove(o[k],[[o[k+'_p'][0],o[k+'_p'][1]],[o[k+'_p'][0]-sg*7,o[k+'_p'][1]+(i<2?-2:2)]],900,'ease-out')); ['ol0','ol1','ol2','ol3','ol4'].forEach(k=>anMove(o[k],[[o[k+'_p'][0],o[k+'_p'][1]],[o[k+'_p'][0]-sg*4,o[k+'_p'][1]]],900,'ease-out')); sfx('pads',200); anMove(bl,[[x.ox(12),60],[x.ox(26),60]],700,'ease-out'); });
  anMove(o.wr1,[[o.wr1_p[0],30],[los+sg*26,31],[los+sg*34,36],[tx,ty]],1500,'ease-in-out'); anMove(o.cb1,[[o.cb1_p[0],30],[los+sg*30,32],[los+sg*40,38],[tx+sg*6,ty+3]],1600,'ease-in-out');
  x.T(1450,()=>{ sfx('throw',0); anMove(bl,anArc([x.ox(26),60],[tx,ty-3],26,18),620,'linear'); });
  if(ok){ x.T(2070,()=>{ sfx('catch',0); anBurst(fx,tx,ty-3,'#fff',7); anBanner(x.st,(gain>=15?'BIG GAIN +':'+')+gain+' YDS',gain>=15?'good':'sm'); anMove(o.wr1,[[tx,ty],[tx+sg*8,ty+10]],520,'ease-out'); anMove(bl,[[tx,ty-3],[tx+sg*8,ty+7]],520,'ease-out'); anMove(o.cb1,[[tx+sg*6,ty+3],[tx+sg*10,ty+11]],520,'ease-out'); anMove(o.s1,[[o.s1_p[0],42],[tx+sg*14,ty+14]],700,'ease-in'); });
    x.T(2650,()=>{ sfx('tackle',0); anBurst(fx,tx+sg*9,ty+10,'#ffd23a',10); sfx('whistle',250); if(gain>=15) x.crowd(x.A==='home',false); else sfx('crowd',0,false); });
    return 3500; }
  x.T(2070,()=>{ anMove(bl,[[tx,ty-3],[tx+sg*6,ty+20]],340,'ease-in'); anBanner(x.st,'INCOMPLETE','bad'); sfx('groan',200); if(x.A==='home') sfx('awww',300); else sfx('cheer',300); });
  return 3000;
}
function afFbRun(x){
  afFbSet(x); afFbLos(x); afFbCam(x,1.5); const o=afFbForm(x,0,['rb']), fx=x.fx, sg=x.sgn, los=x.los;
  const len=Math.round(afR(6,36)), ey=60+afR(-14,14), ex=los+sg*(4+len*1.4); const gain=Math.round((ex-los)*sg/2.4); const bl=afFb(fx,los,60);
  afNote(x,afDown(),'sm',0);
  x.T(350,()=>{ sfx('snap',0); anMove(bl,[[los,60],[x.ox(12),60]],240,'ease-out'); });
  x.T(650,()=>{ anMove(bl,[[x.ox(12),60],[x.ox(20),62]],300,'ease-out'); sfx('pads',150); });
  x.T(950,()=>{ const path=[[x.ox(20),62],[x.ox(8),60],[los+sg*6,ey],[ex,ey+(ey>60?4:-4)]]; anMove(o.rb,path,1500,'ease-in'); anMove(bl,path,1500,'ease-in'); sfx('pads',400);
    ['dl0','dl1','dl2','dl3'].forEach(k=>anMove(o[k],[[o[k+'_p'][0],o[k+'_p'][1]],[o[k+'_p'][0]-sg*3,o[k+'_p'][1]]],400,'ease-out'));
    ['lb0','lb1','lb2'].forEach((k,i)=>anMove(o[k],[[o[k+'_p'][0],o[k+'_p'][1]],[los+sg*(10+i*4),ey+(i-1)*8],[ex+sg*3,ey+(i-1)*3]],1400,'ease-in')); anMove(o.s1,[[o.s1_p[0],42],[ex+sg*8,ey-8]],1500,'ease-in'); anMove(o.s2,[[o.s2_p[0],78],[ex+sg*8,ey+8]],1500,'ease-in'); });
  x.T(2450,()=>{ sfx('tackle',0); anBurst(fx,ex+sg*2,ey,'#ffd23a',12); sfx('whistle',250); anBanner(x.st,(gain>=18?'BREAKAWAY +':'+')+gain+' YDS',gain>=18?'good':'sm'); if(gain>=18) x.crowd(x.A==='home',false); else sfx('crowd',0,false); });
  return 3300;
}
function afFbKickoff(x){
  afFbSet(x); const fx=x.fx, sg=x.sgn, b=x.b; const kx=x.away?72:248, rx=kx+sg*112; const nm=afTeamShort(b,x.A)+' K';
  afNote(x,'KICKOFF','sm',0); x.S('whistle',0);
  const line=[]; for(let i=0;i<9;i++){ const y=18+i*10.5; const g=afPlayer(fx,kx-sg*8,y,x.col,{r:3.3}); line.push([g,y]); }
  const kick=afPlayer(fx,kx-sg*22,60,x.col,{r:3.6,name:nm}); anMove(kick,[[kx-sg*22,60],[kx-sg*6,60]],600,'ease-in');
  const wedge=[[rx+sg*6,36],[rx+sg*6,60],[rx+sg*6,84],[rx-sg*4,48],[rx-sg*4,72]].map(p=>{ const g=afPlayer(fx,p[0],p[1],x.colD,{r:3.4}); return [g,p]; });
  const ret=afPlayer(fx,rx+sg*30,60,x.colD,{r:3.8}); const bl=afFb(fx,kx,60);
  x.T(650,()=>{ sfx('kick',0); anMove(bl,anArc([kx,60],[rx+sg*28,60],46,22),1150,'linear'); line.forEach((p,i)=>anMove(p[0],[[kx-sg*8,p[1]],[kx+sg*86,p[1]+(60-p[1])*.35]],1700,'ease-in')); });
  x.T(1800,()=>{ sfx('catch',0); anMove(ret,[[rx+sg*30,60],[rx-sg*22,56]],1000,'ease-in-out'); anMove(bl,[[rx+sg*28,60],[rx-sg*22,56]],1000,'ease-in-out'); wedge.forEach(w=>anMove(w[0],[[w[1][0],w[1][1]],[w[1][0]-sg*18,w[1][1]]],900,'ease-out')); });
  x.T(2850,()=>{ sfx('tackle',0); anBurst(fx,rx-sg*22,56,'#ffd23a',12); sfx('whistle',250); sfx('crowd',0,false); });
  return 3500;
}
function afFbFg(x){
  afFbSet(x); const fx=x.fx, sg=x.sgn, b=x.b; const los=x.away?236:84; const x1=x.away?300:20; const nm=afTeamShort(b,x.A)+' K';
  anEl('path',{d:'M'+x1+' 40 V58 M'+(x1-7)+' 42 V58 M'+(x1+7)+' 42 V58 M'+(x1-7)+' 58 H'+(x1+7),stroke:'#ffd23a','stroke-width':1.6,fill:'none'},fx);
  for(let i=0;i<7;i++){ const y=44+i*5; afPlayer(fx,los-sg*3,y,x.col,{r:3}); }
  for(let i=0;i<7;i++){ const y=42+i*6; const g=afPlayer(fx,los+sg*4,y,x.colD,{r:3}); anMove(g,[[los+sg*4,y],[los+sg*2,y]],900,'ease-out'); }
  const hold=afPlayer(fx,los-sg*14,60,x.col,{r:3.3}); void hold; const kick=afPlayer(fx,los-sg*22,66,x.col,{r:3.5,name:nm}); const bl=afFb(fx,los-sg*3,60);
  const ok=Math.random()<.78; afNote(x,'FIELD GOAL TRY','sm',0); x.S('whistle',0); afCam(x,[x.away?120:0,22,200,75],800);
  x.T(500,()=>{ sfx('snap',0); anMove(bl,[[los-sg*3,60],[los-sg*14,60]],220,'ease-out'); anMove(kick,[[los-sg*22,66],[los-sg*10,62]],420,'ease-in'); });
  x.T(900,()=>{ sfx('kick',0); anMove(bl,anArc([los-sg*14,60],[x1,ok?48:(Math.random()<.5?30:84)],34,20),1000,'linear'); });
  x.T(1950,()=>{ if(ok){ anBanner(x.st,'FIELD GOAL!','mid'); anBurst(fx,x1,48,'#ffd23a',12); x.crowd(x.A==='home',false); } else { anBanner(x.st,'NO GOOD','bad'); sfx('groan',0); if(x.A==='home') sfx('awww',250); else sfx('cheer',250); } });
  return 3100;
}
function afFbHuddle(x){
  afFbSet(x); const fx=x.fx, sg=x.sgn; const cx=x.ox(46), cy=60; const ps=[];
  const qb=afPlayer(fx,cx,cy,x.col,{r:3.5,name:afName(x.b,x.A,['QB'])}); void qb;
  for(let i=0;i<10;i++){ const a=i/10*Math.PI*2; ps.push(afPlayer(fx,cx+Math.cos(a)*13,cy+Math.sin(a)*13*.8,x.col,{r:3.3})); }
  afNote(x,'HUDDLE','sm',0); x.S('huddle',100); x.S('clap',1500);
  x.T(1700,()=>{ ps.forEach((g,i)=>{ const a=i/10*Math.PI*2; anMove(g,[[cx+Math.cos(a)*13,cy+Math.sin(a)*13*.8],[x.ox(3+(i%4)*2),30+i*6]],900,'ease-out'); }); for(let i=0;i<8;i++){ const g=afPlayer(fx,x.dx(60),20+i*11,x.colD,{r:3.3}); anMove(g,[[x.dx(60),20+i*11],[x.dx(4+(i%3)*5),20+i*11]],900,'ease-out'); } sfx('crowd',0,false); });
  return 2900;
}
function afFbScramble(x){
  afFbSet(x); afFbLos(x); afFbCam(x,1.5); const o=afFbForm(x,0,['qb']), fx=x.fx, sg=x.sgn, los=x.los; const bl=afFb(fx,los,60); const ex=los+sg*afR(14,40), ey=afR(88,100);
  afNote(x,afDown(),'sm',0);
  x.T(350,()=>{ sfx('snap',0); anMove(bl,[[los,60],[x.ox(12),60]],240,'ease-out'); });
  x.T(650,()=>{ anMove(o.qb,[[x.ox(12),60],[x.ox(24),60],[x.ox(18),72],[los+sg*4,88],[ex,ey]],1900,'ease-in-out'); anMove(bl,[[x.ox(12),60],[x.ox(24),60],[x.ox(18),72],[los+sg*4,88],[ex,ey]],1900,'ease-in-out');
    ['dl0','dl1','dl2','dl3'].forEach((k,i)=>anMove(o[k],[[o[k+'_p'][0],o[k+'_p'][1]],[x.ox(14),60+(i-1.5)*5]],700,'ease-in')); sfx('pads',300); });
  x.T(900,()=>{ anBanner(x.st,'SCRAMBLE!','mid'); sfx('big',0); ['lb0','lb1','lb2','cb2','s2'].forEach((k,i)=>anMove(o[k],[[o[k+'_p'][0],o[k+'_p'][1]],[ex+sg*(6+i*2),ey-6+i*2]],1700,'ease-in')); });
  x.T(2600,()=>{ sfx('tackle',0); anBurst(fx,ex,ey,'#ffd23a',10); sfx('whistle',250); sfx('crowd',0,false); });
  return 3400;
}

/* ---- baseball ---- */
const AF_FLD={p:[160,66],c:[160,112],b1:[204,68],b2:[186,46],ss:[134,46],b3:[116,68],lf:[86,30],cf:[160,16],rf:[234,30]};
function afBbField(x,from){
  const fx=x.fx, b=x.b, o={}; const nm={}; ['p','c','b1','b2','ss','b3','lf','cf','rf'].forEach(k=>{ const p=AF_FLD[k]; nm[k]=(k==='p'||k==='ss'||k==='b3'||k==='b1')?afName(b,x.D,k==='p'?['SP']:['H']):''; const sx=from?20:p[0], sy=from?112:p[1]; const g=afPlayer(fx,sx,sy,x.colD,{r:3.6,name:(k==='p')?nm[k]:undefined}); if(from) anMove(g,[[sx,sy],[p[0],p[1]]],900+Math.random()*500,'ease-out'); o[k]=g; });
  return {o:o,nm:nm};
}
function afBbTake(x){
  const fx=x.fx, b=x.b; const F=afBbField(x,true); const bn=afName(b,x.A,['H']); const bx=x.A==='home'?172:148;
  const bat=afPlayer(fx,106,110,x.col,{name:bn}); anMove(bat,[[106,110],[bx,100]],1500,'ease-in-out');
  afNote(x,'PLAY BALL!','big',300); x.S('whistle',200); x.S('organ',500);
  x.T(1700,()=>{ const bl=afBase(fx,160,66); anMove(bl,[[160,66],[160,108]],520,'ease-in'); sfx('mitt',500); });
  x.T(2300,()=>{ anBanner(x.st,'BATTER UP','sm'); x.crowd(true,false); });
  void F; return 3000;
}
function afBbPitch(x){
  afCam(x,[60,36,200,75],800); const fx=x.fx, b=x.b; const F=afBbField(x,false); const left=Math.random()<.5, bx=left?148:172; const bn=afName(b,x.A,['H']);
  const bat=afPlayer(fx,bx,100,x.col,{name:bn}); void bat; const bg=afG(fx,bx+(left?-1:1)*2,96); const bt=anEl('rect',{x:0,y:-1.1,width:11,height:2.2,rx:1,fill:'#e8c27a',stroke:'#7a5a1f','stroke-width':.4},bg);
  void bt; const roll=Math.random(); const res=roll<.30?'k':roll<.50?'ground':roll<.66?'fly':roll<.80?'single':'walk';
  const seqn=res==='walk'?['b','s','b','b','b']:res==='k'?['b','s','f','sw']:['b','s','x'];
  let t=500, balls=0, strikes=0; const tag=anEl('text',{x:160,y:44,'text-anchor':'middle','font-size':6.6,'font-weight':800,fill:'#fff',stroke:'rgba(8,14,28,.92)','stroke-width':2.2,'paint-order':'stroke'},fx);
  afNote(x,'AT BAT','sm',0);
  seqn.forEach((p,i)=>{ const last=i===seqn.length-1;
    x.T(t,()=>{ const bl=afBase(fx,160,64); const tgt=p==='b'?[left?136:184,100]:[160,102]; anMove(bl,[[160,64],tgt],400,'ease-in'); sfx('pitch',0);
      if(p==='sw'||p==='f'||p==='x'){ if(!anReduced()) bg.animate([{transform:'translate('+(bx+(left?-1:1)*2)+'px,96px) rotate('+(left?-80:260)+'deg)'},{transform:'translate('+(bx+(left?-1:1)*2)+'px,96px) rotate('+(left?100:80)+'deg)'}],{duration:240,delay:150,fill:'forwards',easing:'ease-in'}); }
    });
    x.T(t+420,()=>{
      if(p==='b'){ balls++; sfx('mitt',0); tag.textContent='BALL '+balls; }
      else if(p==='s'){ strikes++; sfx('mitt',0); tag.textContent='STRIKE '+strikes; }
      else if(p==='sw'){ strikes=3; sfx('mitt',0); tag.textContent=''; anBanner(x.st,'STRIKE THREE!','bad'); if(x.A==='home') sfx('awww',200); else sfx('cheer',200); }
      else if(p==='f'){ strikes=Math.min(2,strikes+1); sfx('foulball',0); tag.textContent='FOUL'; const bl2=afBase(fx,160,102); anMove(bl2,anArc([160,102],[x.A==='home'?292:28,70],40,16),700,'linear'); }
      else if(last){ afBbResult(x,res,tag,F,bn); }
      if(p==='b'&&balls===4){ tag.textContent=''; anBanner(x.st,'BALL FOUR — WALK','good'); const r=afPlayer(fx,bx,100,x.col,{r:3.8}); anMove(r,[[bx,100],[214,66]],900,'ease-in-out'); sfx('chime',0); sfx('crowd',200,false); }
    });
    t+=900; });
  return t+1500;
}
function afBbResult(x,res,tag,F,bn){
  const fx=x.fx; tag.textContent=''; const home=[160,104];
  if(res==='single'){ sfx('batcrack',0); const bl=afBase(fx,160,100); anMove(bl,anArc([160,100],[196,40],26,16),800,'ease-out'); const r=afPlayer(fx,160,102,x.col,{r:3.8}); anMove(r,[[160,102],[214,66]],900,'linear'); anBanner(x.st,'BASE HIT!','good'); x.crowd(x.A==='home',false,300); }
  else if(res==='ground'){ sfx('batcrack',0); const bl=afBase(fx,160,100); anMove(bl,[[160,100],[134,50]],520,'ease-out'); const r=afPlayer(fx,160,102,x.col,{r:3.8}); anMove(r,[[160,102],[210,72]],1000,'linear'); x.T(700,()=>{ anMove(bl,[[134,50],[204,66]],420,'ease-in'); sfx('mitt',380); anBanner(x.st,'GROUNDOUT','bad'); if(x.A==='home') sfx('awww',200); else sfx('cheer',200); }); }
  else { sfx('batcrack',0); const tx=afR(110,210); const bl=afBase(fx,160,100); anMove(bl,anArc([160,100],[tx,24],70,20),1300,'linear'); const f=F.o[tx<135?'lf':tx>185?'rf':'cf']; const p=tx<135?AF_FLD.lf:tx>185?AF_FLD.rf:AF_FLD.cf; anMove(f,[[p[0],p[1]],[tx,26]],1200,'ease-out'); x.T(1350,()=>{ sfx('mitt',0); anBanner(x.st,'FLY OUT','bad'); if(x.A==='home') sfx('awww',200); else sfx('cheer',200); }); }
  void bn;
}
function afBbPickoff(x){
  const fx=x.fx, b=x.b; const F=afBbField(x,false); const run=afPlayer(fx,214,66,x.col,{r:3.8,name:afName(b,x.A,['H'])}); afPlayer(fx,148,100,x.col,{r:3.6});
  afNote(x,'PICKOFF THROW','sm',0); afCam(x,[110,24,180,67.5],700);
  x.T(500,()=>{ anMove(run,[[214,66],[226,60]],400,'ease-out'); });
  x.T(900,()=>{ const bl=afBase(fx,160,66); anMove(bl,[[160,66],[204,68]],360,'ease-in'); sfx('whoosh',0); sfx('mitt',340); anMove(run,[[226,60],[214,66]],360,'ease-in'); });
  x.T(1400,()=>{ anBanner(x.st,'SAFE!','good'); sfx('slide',0); anBurst(fx,214,66,'#d9b383',9); });
  x.T(2000,()=>{ const bl=afBase(fx,204,68); anMove(bl,[[204,68],[160,66]],360,'ease-out'); sfx('mitt',340); });
  void F; return 2800;
}
function afBbMound(x){
  const fx=x.fx, b=x.b; const nm=afName(b,x.D,['SP']); const cx=160, cy=66; afPlayer(fx,cx,cy,x.colD,{r:3.8,name:nm});
  [AF_FLD.c,AF_FLD.b1,AF_FLD.b2,AF_FLD.ss,AF_FLD.b3].forEach((p,i)=>{ const g=afPlayer(fx,p[0],p[1],x.colD,{r:3.5}); const a=i/5*Math.PI*2; anMove(g,[[p[0],p[1]],[cx+Math.cos(a)*14,cy+Math.sin(a)*9]],900+i*80,'ease-out'); });
  afNote(x,'MOUND VISIT','sm',0); afCam(x,[85,30,150,56],700); x.S('organ',200); x.S('clap',1600);
  return 2800;
}
function afBbDp(x){
  const fx=x.fx, b=x.b; const F=afBbField(x,false); void F; const r1=afPlayer(fx,214,66,x.col,{r:3.8}); const bat=afPlayer(fx,150,100,x.col,{r:3.8});
  const sn=afName(b,x.D,['H']), tn=afName(b,x.D,['H'],sn); afNote(x,'DOUBLE PLAY!','mid',1200);
  const bl=afBase(fx,160,100); x.T(500,()=>{ sfx('batcrack',0); anMove(bl,[[160,100],[134,48]],480,'ease-out'); anMove(r1,[[214,66],[162,34]],900,'linear'); anMove(bat,[[150,100],[208,70]],1500,'linear'); });
  x.T(1000,()=>{ anMove(bl,[[134,48],[170,36]],300,'ease-in'); sfx('mitt',280); const g=afG(fx,134,38); afTag(g,sn,-4); });
  x.T(1500,()=>{ anMove(bl,[[170,36],[204,66]],360,'ease-in'); sfx('mitt',340); sfx('slide',0); anBurst(fx,162,34,'#d9b383',9); const g=afG(fx,184,38); afTag(g,tn,-4); });
  x.T(1900,()=>{ sfx('organ',0); x.crowd(x.D==='home',false); });
  return 3000;
}

/* ---- crowd moments, any sport ---- */
function afWave(x){
  const fx=x.fx; const n=26; const cols=[anColor(x.b,'away'),anColor(x.b,'home')];
  for(let r=0;r<2;r++) for(let i=0;i<n;i++){ const px=10+i*(300/(n-1)), py=r?113:7; const g=afG(fx,px,py); anEl('circle',{cx:0,cy:0,r:3,fill:cols[i%2],stroke:'#fff','stroke-width':.6},g); anEl('circle',{cx:0,cy:-3.8,r:2,fill:'#f1c9a0'},g);
    if(!anReduced()) g.animate([{transform:'translate('+px+'px,'+py+'px)'},{transform:'translate('+px+'px,'+(py+(r?-9:9))+'px)',offset:.4},{transform:'translate('+px+'px,'+py+'px)'}],{duration:620,delay:300+i*70,easing:'ease-in-out',fill:'forwards'}); }
  afNote(x,'THE WAVE','sm',300); x.S('wave',250); x.T(300,()=>ambSwell(1.8,3));
  return 3200;
}
function afFireworks(x){
  const fx=x.fx; const cols=[anColor(x.b,'away'),anColor(x.b,'home'),'#ffd23a','#fff'];
  [[70,34,0],[160,26,520],[250,36,1000],[115,50,1450]].forEach((p,i)=>x.T(p[2],()=>{ anBurst(fx,p[0],p[1],cols[i%4],20); anBurst(fx,p[0],p[1],cols[(i+1)%4],12); sfx('firework',0); }));
  afNote(x,'FIREWORKS','sm',100); x.T(200,()=>ambSwell(1.6,3));
  return 2800;
}

const AF_SCENES={
  bk_lineup:afBkLineup,bk_ft:afBkFt,bk_dunk:afBkDunk,bk_three:afBkThree,bk_fast:afBkFast,bk_swing:afBkSwing,bk_rebound:afBkRebound,bk_alley:afBkAlley,bk_huddle:afBkHuddle,
  fb_lineup:afFbLineup,fb_pass:afFbPass,fb_run:afFbRun,fb_kickoff:afFbKickoff,fb_fg:afFbFg,fb_huddle:afFbHuddle,fb_scramble:afFbScramble,
  bb_take:afBbTake,bb_pitch:afBbPitch,bb_pickoff:afBbPickoff,bb_mound:afBbMound,bb_dp:afBbDp,
  wave:afWave,fireworks:afFireworks
};
try{ window.__AF=AF; window.__AF_SCENES=AF_SCENES; }catch(e){}
