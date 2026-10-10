/* ================= v4: real ESPN live feed (pushed into the page's database) ================= */
const FEED={}, VIS={}; const FS={conn:'wait',last:0,err:''};
const feedStarted=gid=>{ const f=FEED[gid]; return !!f&&f.st.s!=='pre'; };
const isLive=gid=>{ const f=FEED[gid]; return !!f&&f.st.s==='in'; };
const anyLive=()=>DATA.games.some(g=>isLive(g.id));
function liveBadge(gid){ const f=FEED[gid]; if(!f) return ''; if(f.st.s==='in') return '<span class="liveb" title="This game is in progress"><i class="livedot"></i>LIVE</span>'; if(f.st.s==='post') return '<span class="badge">Final</span>'; return ''; }
function normLive(){ Object.keys(P.live||{}).forEach(gid=>{ const L=P.live[gid]; if(L&&L.mode!=='feed'){ delete P.live[gid]; } }); }

/* ---------- feed -> live state ---------- */
function parseClock(c){ c=String(c||''); let m=c.match(/^(\d+):(\d+)/); if(m) return [+m[1],+m[2]]; m=c.match(/^(\d+(?:\.\d+)?)$/); if(m) return [0,Math.floor(+m[1])]; return [0,0]; }
function syncMan(g,doc){
  const L=LS(g.id), m=L.man, st=doc.st;
  m.home=doc.hs; m.away=doc['as'];
  if(g.lg==='mlb'){
    const dm=String(st.det||'').match(/^(Top|Bottom|Bot|Middle|Mid|End)\s+(\d+)/i);
    let inn=Math.max(1,st.per||1), half='top', outs=(doc.sit&&doc.sit.o)||0;
    if(dm){ const w=dm[1].toLowerCase(); inn=+dm[2]; if(w==='bottom'||w==='bot') half='bot'; else if(w==='middle'||w==='mid'){ half='bot'; outs=0; } else if(w==='end'){ inn=inn+1; half='top'; outs=0; } }
    m.inn=Math.min(9,inn); m.half=half; m.outs=Math.min(2,outs);
  } else {
    const c=parseClock(st.clk); const per=st.per||1;
    if((g.key||g.lg)==='cbb'){ // two 20-minute halves: convert to quarter-equivalents
      const e=per>2?2400:Math.min(2400,(per-1)*1200+(1200-(c[0]*60+c[1]))); const q=Math.min(4,Math.floor(Math.min(e,2399)/600)+1); const rem=per>2?0:Math.max(0,600-(e-(q-1)*600));
      m.q=q; m.min=Math.floor(rem/60); m.sec=Math.round(rem%60);
    } else { m.q=Math.min(4,Math.max(1,per)); m.min=per>4?0:c[0]; m.sec=per>4?0:c[1]; }
  }
  const post=st.s==='post';
  g.players.forEach(pl=>{
    const row=doc.p&&doc.p[pl.id];
    m.cur[pl.id]=row?Object.assign({},row):(post?{}:(m.cur[pl.id]||{}));
    if(doc.dnp&&doc.dnp.indexOf(pl.id)>=0) m.act[pl.id]='out';
    else if(row) m.act[pl.id]='in';
    else if(post) m.act[pl.id]=(g.lg==='nfl'?(pl.status.kind==='out'?'out':'unk'):'out');
    else m.act[pl.id]=m.act[pl.id]||'unk';
  });
}
function feedIn(gid,doc){
  const g=G[gid]; if(!g||!doc||!doc.st||!Array.isArray(doc.plays)) return;
  const old=FEED[gid]; if(old&&(old.t||0)>=(doc.t||0)) return;
  FEED[gid]=doc; FS.last=Date.now(); FS.conn='on';
  syncMan(g,doc); ingestPlays(g,doc,!old);
  const V=vis(gid); const st=stateOf(g); const M=teamProbs(g,st,true);
  if(st.started&&!st.final){ V.mh.push([doc.t||Date.now(),Math.round(M.win*1000)/10]); if(V.mh.length>240) V.mh.shift(); }
  if(st.started&&!st.final&&doc.st.s==='in'){ try{ logLiveCalls(g,st,candidates(g,st)); }catch(e){} }
  const changed=!old||old.st.s!==doc.st.s;
  if(doc.st.s==='post'){ const L=LS(gid); if(!L.done&&!L.man.final){ finishGame(gid); renderBank(); renderSlip(); } }
  persist();
  if(changed){ if(['chat','battle','board','profile'].indexOf(S.view)>=0&&typeof isTypingNow==='function'&&isTypingNow()){ const n=document.getElementById('nav'); if(n) n.innerHTML=navHtml(); } else render(); return; }
  if(S.view==='live') refreshLive(gid,true); else syncLegButtons();
  if(S.view==='slips') render();
}
function subLive(db){
  try{
    db.collection('live').onSnapshot(snap=>{ FS.conn='on'; snap.docs.forEach(d=>{ try{ feedIn(d.id,d.data()); }catch(e){ FS.err=String(e&&e.message||e); } }); if(!snap.docs.length&&S.view==='live') RF('lv-status',statusHtml()); },
      e=>{ FS.conn='err'; FS.err=(e&&e.message)||''; if(S.view==='live') RF('lv-status',statusHtml()); });
  }catch(e){ FS.conn='err'; }
}

/* ---------- visuals ---------- */
const vis=gid=>VIS[gid]||(VIS[gid]={seen:new Set(),queue:[],shown:[],next:0,mh:[],vs:{nfl:{x:50,y:28,los:null,fd:null,pts:[],dr:null,o:'a'},mlb:{ab:null,dots:[],on:[false,false,false]},wnba:{shots:[]}}});
const restart=(el,cls)=>{ if(!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const hashN=s=>{ let h=0; String(s).split('').forEach(c=>{ h=(h*31+c.charCodeAt(0))|0; }); return Math.abs(h); };
const E=id=>document.getElementById(id);
const FX=x=>10+Math.max(-9,Math.min(109,x));
function celebrate(gid,label,scorer){
  const el=E('cel-'+gid); if(!el) return; const g=G[gid]; const tc=(g&&scorer&&g.teams[scorer==='a'?'away':'home'].color)||'#4d98ff';
  const cols=['#ffb62e',tc,'#2fcb7e','#fff','#f06d66']; let c=''; for(let i=0;i<30;i++){ const a=Math.random()*360, d=40+Math.random()*110, dl=Math.random()*.3; c+='<i style="--a:'+a.toFixed(0)+'deg;--d:'+d.toFixed(0)+'px;--dl:'+dl.toFixed(2)+'s;--c:'+cols[i%5]+'"></i>'; }
  el.innerHTML='<div class="celt">'+esc(label)+'</div>'+c; restart(el,'go'); clearTimeout(el._t); el._t=setTimeout(()=>{ el.classList.remove('go'); el.innerHTML=''; },2800);
}
function chip(gid,label,txt,kind){ const el=E('chip-'+gid); if(!el) return; el.className='playchip '+(kind||''); el.innerHTML='<b>'+esc(label)+'</b><span>'+esc(txt)+'</span>'; restart(el,'pop'); const pl=E('pill-'+gid); if(pl){ pl.textContent=String(label||'').slice(0,22); restart(pl,'pop'); } }

/* --- football --- */
/* --- football (v5: arcs, gain/loss colours, kickoff, TD, sack, big plays, camera) --- */
const GREEN='#2fcb7e', RED='#ff5a52', GOLD='#ffc83a';
function nflFlags(p){
  const ty=p.ty||'', tx=p.tx||'', t=ty+' '+tx, f={};
  f.ko=/kickoff/i.test(ty)||/\bkicks off\b|\bkickoff\b/i.test(tx);
  f.punt=/\bpunt/i.test(ty)||/\bpunts\b/i.test(tx);
  f.xp=/extra point|two-point|2-pt/i.test(t);
  f.fg=!f.xp&&/field goal/i.test(t);
  f.td=/touchdown/i.test(t)&&!f.xp;
  f.sack=/\bsack/i.test(t);
  f.inc=/incomplet/i.test(t);
  f.int=/intercept/i.test(t);
  f.fum=/fumble/i.test(t)&&!!p.to;
  f.pass=!f.ko&&!f.punt&&!f.fg&&!f.xp&&(/pass/i.test(ty)||/\bpass(es)?\b/i.test(tx)||f.sack);
  f.run=!f.pass&&!f.ko&&!f.punt&&!f.fg&&!f.xp&&(/rush|run/i.test(ty)||/\b(up the middle|left end|right end|left tackle|right tackle|left guard|right guard)\b/i.test(tx));
  f.miss=/no good|missed|blocked|wide (left|right)/i.test(tx);
  f.pen=!!p.pen||/^penalty/i.test(ty);
  return f;
}
function nflKind(p){ const f=nflFlags(p); if(p.sc) return 'score'; if(f.ko) return 'ko'; if(p.to||f.int) return 'turn'; if(f.pen) return 'pen'; if(f.sack) return 'sack'; if(f.pass) return 'pass'; if(f.run) return 'run'; if(f.punt||f.fg) return 'kick'; return 'other'; }
function nflName(tx,which){
  tx=String(tx||'');
  if(which==='to'){ const m=tx.match(/\bto\s+(?:[A-Z]{2,4}\s+)?((?:[A-Z]\.\s?)?[A-Z][A-Za-z'\-]+)/); return m?m[1]:''; }
  const m=tx.match(/^\s*(?:\([^)]*\)\s*)?((?:[A-Z]\.\s?)?[A-Z][A-Za-z'\-]+)/); return m?m[1]:'';
}
function nflLabel(p){
  const k=nflKind(p), f=nflFlags(p); const y=p.y; const ys=(y==null||isNaN(+y))?'':(+y>0?' +'+y:' '+y);
  if(k==='score'){ if(f.td) return 'TOUCHDOWN'; if(f.fg) return 'FIELD GOAL'; if(/safety/i.test(p.tx)) return 'SAFETY'; if(f.xp) return /two-point|2-pt/i.test(p.tx)?'2-POINT GOOD':'EXTRA POINT'; return 'SCORE'; }
  if(k==='ko') return 'KICKOFF';
  if(k==='turn') return f.int?'INTERCEPTION':'TURNOVER';
  if(k==='pen') return 'FLAG'+ys;
  if(k==='sack') return 'SACK'+ys;
  if(k==='pass') return f.inc?'INCOMPLETE':(+y>=10?'BIG PASS':'PASS')+ys;
  if(k==='run') return 'RUN'+ys;
  if(f.punt) return 'PUNT'; if(f.fg) return f.miss?'FIELD GOAL NO GOOD':'FIELD GOAL';
  return (p.ty||'PLAY').toUpperCase();
}
function nflViz(g){
  const a=g.teams.away,h=g.teams.home; let s='<svg id="fld-'+g.id+'" class="fld" viewBox="0 0 120 56" role="img" aria-label="Football field showing the ball position and the current drive">';
  s+='<defs><linearGradient id="tg-'+g.id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>';
  s+='<rect x="0" y="0" width="120" height="56" fill="#143321"/>';
  s+='<rect x="0" y="3" width="10" height="50" fill="'+esc(a.color)+'"/><rect x="110" y="3" width="10" height="50" fill="'+esc(h.color)+'"/>';
  for(let i=0;i<10;i++) s+='<rect x="'+(10+i*10)+'" y="3" width="10" height="50" class="'+(i%2?'gB':'gA')+'"/>';
  s+='<rect x="0" y="3" width="120" height="50" fill="url(#tg-'+g.id+')"/>';
  for(let k=1;k<20;k++) s+='<line x1="'+(10+5*k)+'" y1="3" x2="'+(10+5*k)+'" y2="53" class="yl'+(k%2===0?' m':'')+'"/>';
  for(let k=10;k<=110;k+=1){ if((k-10)%5===0) continue; s+='<line x1="'+k+'" y1="20.2" x2="'+k+'" y2="21.2" class="hm"/><line x1="'+k+'" y1="34.8" x2="'+k+'" y2="35.8" class="hm"/>'; }
  for(let k=1;k<10;k++){ const v=k<=5?k*10:100-k*10; s+='<text x="'+(10+10*k)+'" y="12" class="yn" text-anchor="middle">'+v+'</text><text x="'+(10+10*k)+'" y="49" class="yn" text-anchor="middle" transform="rotate(180 '+(10+10*k)+' 47.8)">'+v+'</text>'; }
  s+='<text x="5" y="28" class="ez" text-anchor="middle" transform="rotate(-90 5 28)">'+esc(a.abbr)+'</text><text x="115" y="28" class="ez" text-anchor="middle" transform="rotate(90 115 28)">'+esc(h.abbr)+'</text>';
  s+='<polyline id="drv-'+g.id+'" class="drv" points=""/><line id="los-'+g.id+'" class="los" x1="0" y1="3" x2="0" y2="53" style="opacity:0"/><line id="fd-'+g.id+'" class="fdl" x1="0" y1="3" x2="0" y2="53" style="opacity:0"/>';
  s+='<g id="fx-'+g.id+'"></g>';
  s+='<ellipse id="shd-'+g.id+'" class="shd" rx="1.8" ry=".7" style="transform:translate(60px,28px);opacity:0"/>';
  s+='<g id="ball-'+g.id+'" class="ball" style="transform:translate(60px,28px)"><ellipse rx="2.3" ry="1.4" fill="#8b4a1c" stroke="#fff" stroke-width=".35"/><line x1="-.9" y1="0" x2=".9" y2="0" stroke="#fff" stroke-width=".35"/><line x1="-.4" y1="-.5" x2="-.4" y2=".5" stroke="#fff" stroke-width=".25"/><line x1=".4" y1="-.5" x2=".4" y2=".5" stroke="#fff" stroke-width=".25"/></g>';
  s+='<g id="fxl-'+g.id+'"></g></svg>';
  return s;
}
function nflApply(g,instant){
  const V=vis(g.id).vs.nfl; const ball=E('ball-'+g.id); if(!ball) return;
  if(instant){ ball.style.transition='none'; }
  ball.style.transform='translate('+FX(V.x)+'px,'+V.y+'px)';
  if(instant){ void ball.getBoundingClientRect(); ball.style.transition=''; }
  const los=E('los-'+g.id), fd=E('fd-'+g.id), dv=E('drv-'+g.id);
  if(los){ if(V.los==null) los.style.opacity=0; else { los.setAttribute('x1',FX(V.los)); los.setAttribute('x2',FX(V.los)); los.style.opacity=1; } }
  if(fd){ if(V.fd==null) fd.style.opacity=0; else { fd.setAttribute('x1',FX(V.fd)); fd.setAttribute('x2',FX(V.fd)); fd.style.opacity=1; } }
  if(dv) dv.setAttribute('points',V.pts.map(p=>FX(p[0])+','+p[1]).join(' '));
  camFollow(g.id,V.x,true);
}
/* camera: only the full-screen view zooms and follows the ball */
const CAM={};
function camFollow(gid,x,instant){
  const svg=E('fld-'+gid); if(!svg||FSV.gid!==gid) { if(svg&&svg.getAttribute('viewBox')!=='0 0 120 56') svg.setAttribute('viewBox','0 0 120 56'); return; }
  const W=84, tx=Math.max(0,Math.min(120-W,FX(x)-W/2)); const C=CAM[gid]||(CAM[gid]={x:tx});
  if(instant){ C.x=tx; svg.setAttribute('viewBox',tx.toFixed(2)+' 0 '+W+' 56'); return; }
  const from=C.x, t0=performance.now(), dur=900; cancelAnimationFrame(C.raf);
  const step=now=>{ const k=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-k,3); C.x=from+(tx-from)*e; svg.setAttribute('viewBox',C.x.toFixed(2)+' 0 '+W+' 56'); if(k<1) C.raf=requestAnimationFrame(step); };
  C.raf=requestAnimationFrame(step);
}
/* ball flight along one or more segments: {a:[X,Y], b:[X,Y], arc, dur, wob} */
function flyBall(g,segs){
  const ball=E('ball-'+g.id), shd=E('shd-'+g.id); if(!ball||!ball.animate) return 0;
  const sum=segs.reduce((s,q)=>s+q.dur,0); let acc=0; const bk=[], sk=[];
  segs.forEach(q=>{
    const n=Math.max(8,Math.round(q.dur/35)); const ang=Math.atan2(q.b[1]-q.a[1],q.b[0]-q.a[0])*180/Math.PI;
    for(let i=(bk.length?1:0);i<=n;i++){
      const t=i/n; let x=q.a[0]+(q.b[0]-q.a[0])*t, y=q.a[1]+(q.b[1]-q.a[1])*t; if(q.wob) y+=Math.sin(t*Math.PI*q.wob)*1.7;
      const h=(q.arc||0)*4*t*(1-t); const off=Math.min(1,(acc+q.dur*t)/sum);
      bk.push({transform:'translate('+x.toFixed(2)+'px,'+(y-h).toFixed(2)+'px) rotate('+(q.arc?ang+(t*360*(q.spin||0)):0)+'deg) scale('+(1+Math.min(h,16)*0.05).toFixed(3)+')',offset:off});
      sk.push({transform:'translate('+x.toFixed(2)+'px,'+(y+0.4).toFixed(2)+'px) scale('+(1+h*0.03).toFixed(3)+')',opacity:q.arc?Math.max(.18,.5-h*0.016):0,offset:off});
    }
    acc+=q.dur;
  });
  bk[bk.length-1].offset=1; sk[sk.length-1].offset=1; bk[0].offset=0; sk[0].offset=0;
  ball.style.transition='none';
  const an=ball.animate(bk,{duration:sum,easing:'linear'}); if(shd){ shd.animate(sk,{duration:sum,easing:'linear'}); }
  an.onfinish=an.oncancel=()=>{ ball.style.transition=''; nflApply(g,true); };
  return sum;
}
function fxAdd(gid,svgStr,ms){ const el=E('fx-'+gid); if(!el) return null; const tmp=document.createElementNS('http://www.w3.org/2000/svg','g'); tmp.innerHTML=svgStr; const kids=[...tmp.childNodes]; kids.forEach(k=>el.appendChild(k)); if(ms) setTimeout(()=>kids.forEach(k=>k.remove()),ms); return kids; }
function fxLabel(gid,svgStr,ms){ const el=E('fxl-'+gid); if(!el) return null; const tmp=document.createElementNS('http://www.w3.org/2000/svg','g'); tmp.innerHTML=svgStr; const kids=[...tmp.childNodes]; kids.forEach(k=>el.appendChild(k)); setTimeout(()=>kids.forEach(k=>k.remove()),ms||2800); return kids; }
function trailAnim(gid,a,b,arc,col,delay,dur,dash){
  const cy=(a[1]+b[1])/2-arc*2; const d='M'+a[0]+' '+a[1]+' Q'+((a[0]+b[0])/2)+' '+cy+' '+b[0]+' '+b[1];
  const k=fxAdd(gid,'<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.5" stroke-linecap="round"'+(dash?' stroke-dasharray="2 2"':'')+' opacity="0"/>',4200); if(!k||!k[0]||!k[0].animate) return;
  const p=k[0], len=p.getTotalLength?p.getTotalLength():60;
  if(dash){ p.animate([{opacity:0},{opacity:.9,offset:.2},{opacity:.9,offset:.7},{opacity:0}],{duration:dur+900,delay:delay,fill:'both'}); return; }
  p.style.strokeDasharray=len; p.style.strokeDashoffset=len;
  p.animate([{strokeDashoffset:len,opacity:1},{strokeDashoffset:0,opacity:1,offset:.6},{strokeDashoffset:0,opacity:0}],{duration:dur+1500,delay:delay,easing:'ease-out',fill:'both'});
}
function ripple(gid,X,Y,col,delay,r){
  const k=fxAdd(gid,'<circle cx="'+X+'" cy="'+Y+'" r="1" fill="none" stroke="'+col+'" stroke-width="1.2" opacity="0"/>',2600); if(!k||!k[0]||!k[0].animate) return;
  k[0].animate([{r:1,opacity:.95,strokeWidth:2},{r:r||9,opacity:0,strokeWidth:.3}],{duration:900,delay:delay||0,easing:'ease-out',fill:'both'});
}
function popText(gid,X,Y,txt,col,delay,size){
  const k=fxLabel(gid,'<text x="'+X+'" y="'+Y+'" text-anchor="middle" class="fxt" fill="'+col+'" style="font-size:'+(size||5.4)+'px" opacity="0">'+esc(txt)+'</text>',2800); if(!k||!k[0]||!k[0].animate) return;
  k[0].animate([{opacity:0,transform:'translateY(3px) scale(.6)'},{opacity:1,transform:'translateY(-1px) scale(1.15)',offset:.18},{opacity:1,transform:'translateY(-4px) scale(1)',offset:.7},{opacity:0,transform:'translateY(-9px) scale(1)'}],{duration:2200,delay:delay||0,easing:'ease-out',fill:'both'});
}
function gainBand(gid,X0,X1,Y,col,delay,dur){
  const x=Math.min(X0,X1), w=Math.abs(X1-X0); if(w<1) return;
  const k=fxAdd(gid,'<rect x="'+x+'" y="'+(Y-5.5)+'" width="'+w+'" height="11" rx="2" fill="'+col+'" opacity="0"/>',4200); if(!k||!k[0]||!k[0].animate) return;
  k[0].style.transformOrigin=X0+'px '+Y+'px'; k[0].style.transformBox='view-box'; if(X1<X0) k[0].style.transformOrigin=X0+'px '+Y+'px';
  k[0].animate([{opacity:0,transform:'scaleX(0)'},{opacity:.34,transform:'scaleX(1)',offset:.45},{opacity:.34,offset:.8},{opacity:0,transform:'scaleX(1)'}],{duration:dur+1400,delay:delay,easing:'ease-out',fill:'both'});
}
function shakeFld(gid){ const s=E('fld-'+gid); if(!s) return; s.classList.remove('shake'); void s.getBoundingClientRect(); s.classList.add('shake'); setTimeout(()=>s.classList.remove('shake'),700); }
function flashZone(gid,toRight,col){
  const x=toRight?110:0; const k=fxAdd(gid,'<rect x="'+x+'" y="3" width="10" height="50" fill="'+col+'" opacity="0"/>',3600); if(!k||!k[0]||!k[0].animate) return;
  k[0].animate([{opacity:0},{opacity:.75},{opacity:.15},{opacity:.7},{opacity:.12},{opacity:.6},{opacity:0}],{duration:2400,fill:'both'});
}

function nflPlay(g,p,instant){
  const V=vis(g.id).vs.nfl; const k=nflKind(p), f=nflFlags(p);
  if(p.dr!==V.dr){ V.pts=[]; V.dr=p.dr; }
  const o=p.o||V.o||'a'; const dirn=o==='a'?1:-1;
  let x0=p.x0, x1=p.x1;
  if(f.ko&&x0==null) x0=(o==='a')?35:65;
  if(x0==null) x0=V.x; if(x1==null) x1=x0;
  let scorer=null; if(p.sc){ scorer=(p['as']>(V.sa||0))?'a':(p.hs>(V.sh||0))?'h':o; }
  V.sa=p['as']; V.sh=p.hs;
  if(f.td&&scorer) x1=scorer==='a'?104:-4;
  if(f.fg&&p.sc) x1=o==='a'?104:-4;
  const yBase=28+((hashN(p.i)%7)-3);
  V.o=p.o||V.o; V.x=x1; V.y=yBase;
  const spot=(f.ko||f.punt||f.fg||f.xp||p.sc)?null:x1;
  V.los=spot; const noFd=!!f.ko||f.punt||f.fg||f.xp||!p.dn2||p.dn2.indexOf('&')<0;
  V.fd=noFd||p.fd==null||spot==null?null:Math.max(0,Math.min(100,x1+dirn*p.fd));
  V.pts.push([Math.max(0,Math.min(100,x1)),28]); if(V.pts.length>40) V.pts.shift();
  if(instant){ nflApply(g,true); return; }
  const gain=dirn*(x1-x0), X0=FX(x0), X1=FX(x1);
  const col=gain>0.4?GREEN:gain<-0.4?RED:'#e8eef9';
  const yq=28, yt=Math.max(9,Math.min(47,yBase+((hashN(p.i+'t')%21)-10)));
  let moveMs=0;
  const rec=nflName(p.tx,'to'), qb=nflName(p.tx,'qb');
  /* ---- by play type ---- */
  if(f.ko){
    const land=FX(o==='a'?96:4), ret=Math.abs(x1-(o==='a'?96:4))>3&&!f.td?X1:null; const kd=1500;
    moveMs=flyBall(g,[{a:[X0,yq],b:[land,yq+((hashN(p.i)%9)-4)],arc:24,dur:kd,spin:2}].concat(ret?[{a:[land,yq+((hashN(p.i)%9)-4)],b:[ret,yBase],arc:0,dur:Math.min(1500,500+Math.abs(ret-land)*22),wob:3}]:(f.td?[{a:[land,yq],b:[X1,yBase],arc:0,dur:1700,wob:3}]:[])));
    trailAnim(g.id,[X0,yq],[land,yq],24,'#e8eef9',0,kd,true);
    if(ret||f.td){ const rg=Math.abs(x1-(o==='a'?96:4)); trailAnim(g.id,[land,yq],[X1,yBase],0,GREEN,kd,700,false); }
    ripple(g.id,land,yq,'#e8eef9',kd,8);
    popText(g.id,X0+(land-X0)/2,16,'KICKOFF','#ffffff',0,5);
  } else if(f.punt){
    const kd=1500; moveMs=flyBall(g,[{a:[X0,yq],b:[X1,yBase],arc:20,dur:kd,spin:2}]); trailAnim(g.id,[X0,yq],[X1,yBase],20,'#e8eef9',0,kd,true); ripple(g.id,X1,yBase,'#e8eef9',kd,7); popText(g.id,(X0+X1)/2,14,'PUNT','#ffffff',0,5);
  } else if(f.fg||f.xp){
    const good=!!p.sc&&!f.miss, kd=1300, tx_=o==='a'?FX(104):FX(-4);
    moveMs=flyBall(g,[{a:[X0,yq],b:[good?tx_:(tx_+(o==='a'?-6:6)),good?yq:yq+(hashN(p.i)%2?9:-9)],arc:12,dur:kd,spin:1}]);
    trailAnim(g.id,[X0,yq],[good?tx_:(tx_+(o==='a'?-6:6)),yq],12,good?GOLD:RED,0,kd,false);
    popText(g.id,(X0+tx_)/2,16,good?(f.xp?'EXTRA POINT':'FIELD GOAL GOOD'):'NO GOOD',good?GOLD:RED,kd-200,5);
    if(good) ripple(g.id,tx_,yq,GOLD,kd,9);
  } else if(f.sack){
    const d=700; moveMs=flyBall(g,[{a:[X0,yq],b:[X1,yq],arc:0,dur:d,wob:2}]);
    gainBand(g.id,X0,X1,yq,RED,0,d); trailAnim(g.id,[X0,yq],[X1,yq],0,RED,0,d,false);
    ripple(g.id,X1,yq,RED,d-100,10); ripple(g.id,X1,yq,RED,d+200,6);
    popText(g.id,X1,yq-9,'SACK',RED,d-100,8); popText(g.id,X1,yq+11,(Math.round(gain)||'')+' YDS',RED,d+200,4.6);
    setTimeout(()=>shakeFld(g.id),d-100);
  } else if(f.pass&&f.inc){
    const air=7+(hashN(p.i)%9), tx_=X0+dirn*air, d=950;
    moveMs=flyBall(g,[{a:[X0,yq],b:[tx_,yt],arc:Math.min(13,4+air*.6),dur:d,spin:1},{a:[tx_,yt],b:[tx_+dirn*2,yt+3],arc:2.5,dur:260}]);
    trailAnim(g.id,[X0,yq],[tx_,yt],Math.min(13,4+air*.6),'#e8eef9',0,d,true);
    ripple(g.id,tx_,yt,'#e8eef9',d,5); popText(g.id,tx_,yt-8,'INCOMPLETE','#e8eef9',d,4.8);
  } else if(f.pass){
    const air=gain>5, xc=air?X0+(X1-X0)*0.78:X1, d1=air?Math.min(1500,720+Math.abs(xc-X0)*19):420;
    const segs=[{a:[X0,yq],b:[xc,yt],arc:air?Math.min(15,4+Math.abs(xc-X0)*.42):1.5,dur:d1,spin:air?1.5:0}];
    if(air&&Math.abs(X1-xc)>1.2) segs.push({a:[xc,yt],b:[X1,yBase],arc:0,dur:Math.min(1200,350+Math.abs(X1-xc)*28),wob:2});
    moveMs=flyBall(g,segs);
    gainBand(g.id,X0,X1,yq,col,0,moveMs);
    trailAnim(g.id,[X0,yq],[xc,yt],segs[0].arc,col,0,d1,false);
    if(segs.length>1) trailAnim(g.id,[xc,yt],[X1,yBase],0,col,d1,moveMs-d1,false);
    ripple(g.id,xc,yt,'#ffffff',d1,5);
    if(!f.td){
      popText(g.id,X1,yBase-9,(gain>=0?'+':'')+Math.round(gain)+' YDS',gain>=0?GREEN:RED,moveMs,5);
      if(rec) popText(g.id,X1,yBase+11,rec,'#ffffff',moveMs+120,3.8);
      if(+p.y>=10&&!f.int){ ripple(g.id,xc,yt,GOLD,d1,14); ripple(g.id,X1,yBase,GOLD,moveMs,16); popText(g.id,(X0+X1)/2,13,'BIG PLAY',GOLD,d1,6.4); }
    }
  } else if(f.run||(!f.ko&&Math.abs(x1-x0)>0.5&&!f.pen)){
    const d=Math.min(1700,520+Math.abs(X1-X0)*30); moveMs=flyBall(g,[{a:[X0,yq],b:[X1,yBase],arc:0,dur:d,wob:3.5}]);
    gainBand(g.id,X0,X1,yq,col,0,d); trailAnim(g.id,[X0,yq],[X1,yBase],0,col,0,d,false);
    if(!f.td) popText(g.id,X1,yBase-9,(gain>=0?'+':'')+Math.round(gain)+' YDS',gain>=0?GREEN:RED,d,5);
    if(gain>=10&&!f.td) { ripple(g.id,X1,yBase,GOLD,d,14); popText(g.id,(X0+X1)/2,13,'BIG RUN',GOLD,d*.6,6); }
  } else {
    flyBall(g,[{a:[FX(V.x===x1?x0:x0),V.y],b:[X1,yBase],arc:0,dur:500}]);
  }
  /* ---- results ---- */
  if(f.int||(p.to&&!f.ko&&!f.punt)){ setTimeout(()=>{ ripple(g.id,X1,yBase,RED,0,12); shakeFld(g.id); },moveMs); popText(g.id,X1,yBase-11,f.int?'INTERCEPTED':'TURNOVER',RED,moveMs,6.4); }
  if(f.td&&scorer){ setTimeout(()=>{ flashZone(g.id,scorer==='a',GOLD); ripple(g.id,X1,yBase,GOLD,0,16); },Math.max(0,moveMs-100)); shakeFld(g.id); }
  chip(g.id,nflLabel(p),(p.dn?p.dn+' · ':'')+(p.tx||'').replace(/\s+/g,' ').slice(0,110),(+p.y>=10&&f.pass&&!f.inc&&!p.sc)?'big':k);
  if(k==='score'){ setTimeout(()=>celebrate(g.id,nflLabel(p),scorer),Math.max(0,moveMs-200)); }
  camFollow(g.id,Math.max(0,Math.min(100,x1)),false);
}

/* --- baseball --- */
const HOME=[125,205], BASES=[[167,163],[125,121],[83,163]];
function mlbViz(g){
  let s='<div class="mlbviz"><svg id="dia-'+g.id+'" class="dia" viewBox="0 0 250 250" role="img" aria-label="Baseball diamond with runners and the last batted ball">';
  s+='<path d="M125 205 L10 90 A165 165 0 0 1 240 90 Z" class="grs"/><path d="M125 205 L50 130 A105 105 0 0 1 200 130 Z" class="drt"/><path d="M125 205 L167 163 L125 121 L83 163 Z" class="grs2"/>';
  s+='<line x1="125" y1="205" x2="10" y2="90" class="fl"/><line x1="125" y1="205" x2="240" y2="90" class="fl"/>';
  BASES.forEach((b,i)=>{ s+='<rect id="bs'+i+'-'+g.id+'" class="bs" x="'+(b[0]-7)+'" y="'+(b[1]-7)+'" width="14" height="14" transform="rotate(45 '+b[0]+' '+b[1]+')"/>'; });
  s+='<polygon points="125,199 131,205 128,211 122,211 119,205" class="hp"/><circle id="hit-'+g.id+'" class="hit" r="4.5" cx="0" cy="0" style="opacity:0"/><g id="hsp-'+g.id+'"></g></svg>';
  s+='<div class="zwrap"><svg id="zn-'+g.id+'" class="zn" viewBox="40 110 160 140" role="img" aria-label="Pitch locations in the strike zone (approximate)"><rect x="92" y="150" width="48" height="46" class="zone"/><line x1="108" y1="150" x2="108" y2="196" class="zl"/><line x1="124" y1="150" x2="124" y2="196" class="zl"/><line x1="92" y1="165" x2="140" y2="165" class="zl"/><line x1="92" y1="181" x2="140" y2="181" class="zl"/><g id="pts-'+g.id+'"></g></svg>';
  s+='<div class="cnt" id="cnt-'+g.id+'"></div></div></div>';
  return s;
}
function pitchClass(tx,ty){ const t=(tx||'')+' '+(ty||''); if(/In Play/i.test(t)) return 'inplay'; if(/Foul/i.test(t)) return 'foul'; if(/Swinging/i.test(t)) return 'swing'; if(/Looking|Called/i.test(t)) return 'strike'; if(/Ball/i.test(t)) return 'ball'; return 'ball'; }
function mlbCnt(g){
  const f=FEED[g.id]; const el=E('cnt-'+g.id); if(!el||!f||!f.sit) return; const s=f.sit;
  const row=(lab,n,max,c)=>'<div class="cr"><span>'+lab+'</span>'+Array.from({length:max},(_,i)=>'<i class="'+c+(i<n?' on':'')+'"></i>').join('')+'</div>';
  el.innerHTML=row('B',s.b||0,4,'cb')+row('S',s.s||0,3,'cs')+row('O',s.o||0,3,'co')+(s.bat?'<div class="who"><b>'+esc(s.bat)+'</b> batting</div>':'')+(s.pit?'<div class="who">vs '+esc(s.pit)+'</div>':'');
}
function mlbApply(g,instant){
  const V=vis(g.id).vs.mlb; const f=FEED[g.id]; const on=(f&&f.sit&&f.sit.on)||V.on;
  [0,1,2].forEach(i=>{ const b=E('bs'+i+'-'+g.id); if(b){ const was=b.classList.contains('on'); b.classList.toggle('on',!!on[i]); if(!instant&&on[i]&&!was) restart(b,'bump'); } });
  mlbCnt(g);
  if(instant){ const pts=E('pts-'+g.id); if(pts) pts.innerHTML=V.dots.map(d=>'<circle cx="'+d.x+'" cy="'+d.y+'" r="4.6" class="pd '+d.c+'"/>').join(''); const hs=E('hsp-'+g.id); if(hs&&V.hit) hs.innerHTML='<circle cx="'+V.hit[0]+'" cy="'+V.hit[1]+'" r="3.5" class="hs"/>'; }
}
function mlbPlay(g,p,instant){
  const V=vis(g.id).vs.mlb;
  if(p.ab!==V.ab){ V.ab=p.ab; V.dots=[]; const pts=E('pts-'+g.id); if(pts) pts.innerHTML=''; }
  const cls=pitchClass(p.tx,p.ty);
  if(p.pt){ V.dots.push({x:p.pt[0],y:p.pt[1],c:cls}); if(V.dots.length>12) V.dots.shift(); }
  if(p.hc) V.hit=p.hc;
  if(instant){ mlbApply(g,true); return; }
  const pts=E('pts-'+g.id);
  if(pts&&p.pt){ const ns='http://www.w3.org/2000/svg'; const c=document.createElementNS(ns,'circle'); c.setAttribute('cx',p.pt[0]); c.setAttribute('cy',p.pt[1]); c.setAttribute('r',4.6); c.setAttribute('class','pd '+cls+' pop'); pts.appendChild(c); const lab=document.createElementNS(ns,'text'); lab.textContent=(p.pv?Math.round(p.pv):''); lab.setAttribute('x',p.pt[0]); lab.setAttribute('y',p.pt[1]-7); lab.setAttribute('class','pv'); if(p.pv) pts.appendChild(lab); }
  const hit=E('hit-'+g.id);
  if(hit&&p.hc){ hit.style.opacity=1; hit.animate([{transform:'translate('+HOME[0]+'px,'+HOME[1]+'px) scale(.6)',opacity:1},{transform:'translate('+((HOME[0]+p.hc[0])/2)+'px,'+(Math.min(HOME[1],p.hc[1])-26)+'px) scale(1.3)',opacity:1,offset:.5},{transform:'translate('+p.hc[0]+'px,'+p.hc[1]+'px) scale(.9)',opacity:1}],{duration:1100,easing:'ease-out',fill:'forwards'}).onfinish=()=>{ const hs=E('hsp-'+g.id); if(hs) hs.innerHTML='<circle cx="'+p.hc[0]+'" cy="'+p.hc[1]+'" r="3.5" class="hs"/>'; hit.style.opacity=0; };
  }
  mlbApply(g,false);
  const nm=(FEED[g.id]&&FEED[g.id].nm)||{}; const isPitch=/^Pitch \d/.test(p.tx||'');
  const lab=isPitch?('PITCH '+(p.pk||'')+(p.pv?' '+Math.round(p.pv)+' mph':'')):(p.sc?'RUN SCORES':(p.ty||'PLAY').toUpperCase());
  chip(g.id,lab,(p.tx||'').slice(0,110)+(p.bt&&nm[p.bt]&&isPitch?' · '+nm[p.bt]:''),p.sc?'score':(p.hc?'run':(cls==='strike'||cls==='swing'?'sack':'pass')));
  if(p.sc&&!isPitch) celebrate(g.id,/home run|homered/i.test(p.tx)?'HOME RUN':'RUN SCORES');
}

/* --- basketball (shots are in ESPN's half-court frame: basket at x=25, y=0, feet) --- */
function wnbaViz(g){
  let s='<svg id="crt-'+g.id+'" class="crt" viewBox="0 0 50 42" role="img" aria-label="Half court with shot locations">';
  s+='<rect x="0" y="0" width="50" height="42" class="cfl"/><rect x="17" y="0" width="16" height="19" class="paint"/><circle cx="25" cy="19" r="6" class="cl" fill="none"/>';
  s+='<path d="M3 0 L3 14.2 A23.75 23.75 0 0 0 47 14.2 L47 0" class="cl" fill="none"/><line x1="22" y1="4" x2="28" y2="4" class="cl"/><circle cx="25" cy="5.25" r=".95" class="rim"/><path d="M19 0 A6 6 0 0 0 31 0" class="cl" fill="none"/>';
  s+='<g id="shots-'+g.id+'"></g><circle id="ballb-'+g.id+'" class="bb" r="1.3" cx="0" cy="0" style="opacity:0"/></svg>';
  return s;
}
function shotEl(sh,fresh){ const x=sh.x, y=sh.y+5.25; return sh.m?'<circle cx="'+x+'" cy="'+y+'" r="1.35" class="sm'+(fresh?' pop':'')+'"/>':'<g class="sx'+(fresh?' pop':'')+'"><line x1="'+(x-1.1)+'" y1="'+(y-1.1)+'" x2="'+(x+1.1)+'" y2="'+(y+1.1)+'"/><line x1="'+(x-1.1)+'" y1="'+(y+1.1)+'" x2="'+(x+1.1)+'" y2="'+(y-1.1)+'"/></g>'; }
function wnbaApply(g){ const V=vis(g.id).vs.wnba; const el=E('shots-'+g.id); if(el) el.innerHTML=V.shots.map(s=>shotEl(s,false)).join(''); }
function wnbaPlay(g,p,instant){
  const V=vis(g.id).vs.wnba; const made=!!p.sc;
  if(p.sh&&p.co){ V.shots.push({x:p.co[0],y:p.co[1],m:made}); if(V.shots.length>16) V.shots.shift(); }
  if(instant){ wnbaApply(g); return; }
  const els=E('shots-'+g.id);
  if(els&&p.sh&&p.co){
    const sx=p.co[0], sy=p.co[1]+5.25; const ball=E('ballb-'+g.id);
    if(ball){ ball.style.opacity=1; ball.animate([{transform:'translate('+sx+'px,'+sy+'px)'},{transform:'translate('+((sx+25)/2)+'px,'+(Math.min(sy,5.25)-6+(sy-5.25)*.3)+'px)',offset:.55},{transform:'translate(25px,5.25px)'}],{duration:850,easing:'ease-in-out',fill:'forwards'}).onfinish=()=>{ ball.style.opacity=0; els.insertAdjacentHTML('beforeend',shotEl({x:p.co[0],y:p.co[1],m:made},true)); if(els.children.length>16) els.removeChild(els.firstChild); }; }
  }
  chip(g.id,p.sh?(made?'+'+(p.v||p.pa||'')+' '+(p.pa===3?'THREE':'BUCKET'):'MISS'):(p.ty||'PLAY').toUpperCase(),(p.tm?p.tm+' · ':'')+(p.tx||'').slice(0,110),made?'score':(p.sh?'sack':'other'));
  if(made&&p.pa===3) celebrate(g.id,'THREE!');
}

function vizHtml(g){
  const kind=g.lg==='nfl'?nflViz(g):g.lg==='mlb'?mlbViz(g):wnbaViz(g);
  const a=g.teams.away,h=g.teams.home, k=g.lg==='nfl'?'nfl':g.lg==='mlb'?'mlb':'bkb';
  const plate=(t,side)=>'<div class="vz-plate '+side+'" style="--c:'+esc(t.color||'#4d98ff')+'"><i>SCORE</i><span><em>'+esc(t.abbr)+'</em><b id="vs'+side[0]+'-'+g.id+'">0</b></span></div>';
  const first=k==='nfl'?'KICKOFF':k==='mlb'?'AT BAT':'TIP-OFF';
  return '<div class="viz vz-'+k+'" id="viz-'+g.id+'" data-act="fs" data-g="'+g.id+'" role="button" tabindex="0" aria-label="Open full screen"><div class="vz-field">'+kind+'<div class="vz-vig"></div></div>'+
    '<div class="vz-top">'+plate(a,'away')+'<div class="vz-pill" id="pill-'+g.id+'">'+first+'</div>'+plate(h,'home')+'</div>'+
    '<div class="vz-ball" id="vball-'+g.id+'"><span>'+(k==='nfl'?'🏈':k==='mlb'?'⚾':'🏀')+'</span><em id="vclk-'+g.id+'"></em></div>'+
    '<span class="fshint">Full screen</span><div class="playchip" id="chip-'+g.id+'"><b>Waiting for a play</b><span></span></div><div class="cel" id="cel-'+g.id+'"></div></div>';
}
function vzScores(){
  Object.keys(G).forEach(id=>{ const a=E('vsa-'+id); if(!a) return; const h=E('vsh-'+id); let st=null; try{ st=stateOf(G[id]); }catch(e){} if(st){ if(a.textContent!==String(st.away)){ a.textContent=st.away; restart(a,'pop'); } if(h&&h.textContent!==String(st.home)){ h.textContent=st.home; restart(h,'pop'); } }
    const c=E('vclk-'+id); if(c){ let t=''; try{ t=pbLabel(G[id],FEED[id]); }catch(e){} if(t==='Not started') t=''; c.textContent=t; } });
}
setInterval(vzScores,1000);
function vizRestore(g){
  if(g.lg==='nfl') nflApply(g,true); else if(g.lg==='mlb') mlbApply(g,true); else wnbaApply(g);
  const V=vis(g.id); const last=V.shown[0]; if(last){ chip(g.id,g.lg==='nfl'?nflLabel(last):(last.ty||'Play').toUpperCase(),(last.tx||'').slice(0,110),g.lg==='nfl'?nflKind(last):'other'); }
}
function ingestPlays(g,doc,first){
  const V=vis(g.id); const fresh=doc.plays.filter(p=>!V.seen.has(p.i));
  if(first){
    doc.plays.forEach(p=>V.seen.add(p.i));
    doc.plays.slice(-30).forEach(p=>{ if(g.lg==='nfl') nflPlay(g,p,true); else if(g.lg==='mlb') mlbPlay(g,p,true); else wnbaPlay(g,p,true); });
    V.shown=doc.plays.slice(-18).reverse();
    if(g.lg==='mlb') mlbApply(g,true);
    return;
  }
  fresh.forEach(p=>{ V.seen.add(p.i); V.queue.push(p); });
  if(V.queue.length>80) V.queue=V.queue.slice(-80);
  if(g.lg==='mlb') mlbApply(g,false);
}
const DUR={nfl:2300,wnba:1500,mlb:1300};
function playDur(g,p){ if(g.lg==='mlb') return p.hc?2000:(p.pt?1000:700); if(g.lg==='wnba') return p.sh?1700:800; const f=nflFlags(p); if(p.sc) return 3800; if(f.ko) return 3300; if(f.sack) return 2600; if(f.pass&&!f.inc) return (+p.y>5?3000:2300); if(f.inc) return 2400; if(f.fg||f.punt) return 2900; return 2500; }
function vizTick(){
  const now=Date.now();
  Object.keys(VIS).forEach(gid=>{
    const V=VIS[gid]; if(!V.queue.length||now<V.next) return; const g=G[gid]; const p=V.queue.shift();
    const show=S.view==='live'&&E('viz-'+gid)&&document.visibilityState==='visible';
    const turbo=V.queue.length>40;
    if(g.lg==='nfl') nflPlay(g,p,!show||turbo); else if(g.lg==='mlb') mlbPlay(g,p,!show||turbo); else wnbaPlay(g,p,!show||turbo);
    V.shown.unshift(p); if(V.shown.length>30) V.shown.length=30; V.fresh=p.i;
    let d=playDur(g,p); if(V.queue.length>12) d*=0.4; let sp=0; if(show&&!turbo&&FSV.gid===gid) sp=announce(g,p,V.queue.length)||0; if(sp&&V.queue.length<=8) d=Math.max(d,sp); if(show&&FSV.gid===gid&&SND.on&&V.queue.length<=3&&/timeout|two-minute warning/i.test((p.ty||'')+' '+(p.tx||''))) d=Math.max(d,12000); if(!show||turbo) d=0; V.next=now+d;
    if(show){ RF('lv-log-'+gid,logHtml(G[gid])); if(FSV.gid===gid) RF('fs-log',logHtml(G[gid])); }
  });
  document.querySelectorAll('[data-age]').forEach(el=>{ const f=FEED[el.getAttribute('data-age')]; if(!f) return; const a=Math.max(0,Math.round((Date.now()-(f.t||0))/1000)); const live=f.st.s==='in'; el.textContent=a<90?('Updated '+a+'s ago'):('Updated '+Math.round(a/60)+' min ago'); el.classList.toggle('stale',live&&a>150); });
}
setInterval(vizTick,250);

/* ---------- live cards ---------- */
function pbLabel(g,f){
  if(!f) return 'Not started';
  const s=f.st; if(s.s==='pre') return 'Not started';
  if(s.s==='post') return 'Final';
  return s.det||s.clk||'Live';
}
function statusHtml(){
  if(FS.conn==='nodb') return '<div class="livenote">The live feed comes through the page\'s shared database, which is not available in this view. Open the page signed in to claude.ai to see live games.</div>';
  if(FS.conn==='err') return '<div class="livenote">The live feed could not connect'+(FS.err?' ('+esc(FS.err)+')':'')+'.</div>';
  const n=Object.keys(FEED).length;
  if(!n&&FS.conn==='idle') return '<div class="livenote"><i class="livedot dim"></i> <b>No games live right now.</b> The live feed starts by itself about 20 minutes before the next kickoff on the slate.</div>';
  if(!n) return '<div class="livenote"><i class="livedot dim"></i> Connecting to the ESPN feed…</div>';
  const live=DATA.games.filter(g=>isLive(g.id)).length;
  const age=Math.round((Date.now()-FS.last)/1000);
  return '<div class="livenote"><i class="livedot'+(live?'':' dim')+'"></i> <b>'+(live?live+' game'+(live>1?'s':'')+' live now':'No games live right now')+'.</b> Scores, plays and stats come from ESPN and reach this page about every 30–60 seconds. Win chances and prices below recalculate on every update. Plays replay in order, so the picture can run a little behind the scoreboard.</div>';
}
function boardHtml(g){
  const f=FEED[g.id], a=g.teams.away,h=g.teams.home; const st=stateOf(g); const live=f&&f.st.s==='in';
  const M=teamProbs(g,st,true), B=teamProbs(g,st,false); const wp=Math.round(M.win*100), wb=Math.round(B.win*100);
  const espn=f&&f.wp&&f.wp.length?Math.round(f.wp[f.wp.length-1]):null;
  if(!f||f.st.s==='pre'){
    return '<h3>Scoreboard <span class="hint"><span class="badge">Not started</span></span></h3><div class="small muted">'+(f?esc(f.st.det||''):'Waiting for the feed.')+'. Live prices open at kickoff. Pregame lines are in the Games tab.</div>';
  }
  const poss=g.lg==='nfl'&&f.sit&&f.sit.poss?f.sit.poss:'';
  const sub=g.lg==='nfl'&&f.sit&&f.sit.dn?esc(f.sit.dn):(g.lg==='mlb'&&f.sit?'':'');
  return '<h3>Scoreboard <span class="hint">'+(live?'<span class="liveb"><i class="livedot"></i>LIVE</span>':'<span class="badge">Final</span>')+'</span></h3>'+
    '<div class="score"><div class="sc"><div class="cr-lab">'+esc(a.abbr)+(poss===a.abbr?' <span class="posb">●</span>':'')+'</div><div class="big mono">'+st.away+'</div></div><div class="clk"><div class="mono">'+esc(pbLabel(g,f))+'</div><div class="cr-lab">'+(sub||(g.lg==='mlb'?'innings':'time'))+'</div></div><div class="sc"><div class="cr-lab">'+esc(h.abbr)+(poss===h.abbr?' <span class="posb">●</span>':'')+'</div><div class="big mono">'+st.home+'</div></div></div>'+
    '<div class="wp" role="img" aria-label="'+esc(h.abbr+' win chance '+wp+' percent')+'"><div class="wpa" style="width:'+(100-wp)+'%">'+esc(a.abbr)+' '+(100-wp)+'%</div><div class="wph" style="width:'+wp+'%">'+esc(h.abbr)+' '+wp+'%</div></div>'+
    '<div class="proj"><div class="kv"><div class="k">Model projected final</div><div class="v">'+n1(M.projAway)+' – '+n1(M.projHome)+'</div><div class="s">'+esc(a.abbr)+' – '+esc(h.abbr)+'</div></div>'+
    '<div class="kv"><div class="k">Projected total</div><div class="v">'+n1(M.projTotal)+'</div><div class="s">book '+g.lines.total+' · baseline '+n1(B.projTotal)+'</div></div>'+
    '<div class="kv"><div class="k">'+esc(h.abbr)+' win chance</div><div class="v">'+wp+'%</div><div class="s">baseline '+wb+'%'+(espn!=null?' · ESPN '+espn+'%':'')+'</div></div></div>'+
    '<div class="small muted age" data-age="'+g.id+'"></div>'+availHtml(g,st);
}
function wpChartHtml(g){
  const f=FEED[g.id]; if(!f||f.st.s==='pre') return '';
  const V=vis(g.id); const W=300,H=96,pad=6;
  const pts=(f.wp||[]); const n=pts.length;
  const X=i=>pad+(W-2*pad)*(n<2?0:i/(n-1)), Y=v=>H-pad-(H-2*pad)*(v/100);
  const path=n>1?pts.map((v,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)).join(''):'';
  const st=stateOf(g), M=teamProbs(g,st,true);
  const my=V.mh.length>1?V.mh.map((p,i)=>(i?'L':'M')+(pad+(W-2*pad)*(i/(V.mh.length-1))).toFixed(1)+' '+Y(p[1]).toFixed(1)).join(''):'';
  return '<h3>Win chance, '+esc(g.teams.home.abbr)+' <span class="hint">through the game</span></h3>'+
    '<svg class="wpc" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Win probability through the game"><line x1="'+pad+'" y1="'+Y(50)+'" x2="'+(W-pad)+'" y2="'+Y(50)+'" class="mid"/>'+(path?'<path d="'+path+'" class="espn"/>':'')+(my?'<path d="'+my+'" class="mine"/>':'')+
    (n>1?'<circle cx="'+X(n-1)+'" cy="'+Y(pts[n-1])+'" r="3" class="dotE"/>':'')+'</svg>'+
    '<div class="legend small"><span><i class="lg1"></i>ESPN win probability</span><span><i class="lg2"></i>This model, since you opened the page ('+Math.round(M.win*100)+'% now)</span></div>';
}
function logHtml(g){
  const V=vis(g.id); const f=FEED[g.id];
  if(!f||f.st.s==='pre') return '<h3>Play-by-play</h3><div class="small muted">Plays appear here once the game starts.</div>';
  const rows=V.shown.slice(0,25).map((p,i)=>{
    const when=g.lg==='mlb'?((p.h||'')+' '+(p.q||'')):((g.key==='cbb'?'H':'Q')+(p.q||'')+' '+(p.c||'')); const tm=p.tm||'';
    const cls='pf'+(p.sc?' sc':'')+((V.fresh===p.i)?' fresh':'');
    return '<div class="'+cls+'"><span class="mono muted w">'+esc(when.trim())+'</span><span class="t">'+(tm?'<b>'+esc(tm)+'</b> ':'')+esc((p.tx||'').replace(/\s+/g,' '))+(g.lg!=='mlb'&&(p.hs||p['as'])?'':'')+'</span>'+(p.sc?'<span class="mono sco">'+esc(g.teams.away.abbr)+' '+p['as']+' · '+esc(g.teams.home.abbr)+' '+p.hs+'</span>':'')+'</div>';
  }).join('');
  return '<h3>Play-by-play <span class="hint">'+(V.queue.length?V.queue.length+' more to replay':'live')+'</span></h3><div class="feed2">'+(rows||'<div class="small muted">No plays yet.</div>')+'</div>';
}
function liveCard(g){
  const a=g.teams.away,h=g.teams.home; const f=FEED[g.id]; const started=f&&f.st.s!=='pre';
  const hs='<div class="ghead"><div class="meta"><span class="lg">'+esc(g.league)+'</span>'+liveBadge(g.id)+'<span>'+esc(g.startDate)+' · '+esc(g.start)+'</span><span>'+esc(g.venue)+'</span></div>'+
    '<div class="matchup"><div class="team">'+chipOf(a)+'<div class="tn"><div class="n">'+esc(a.short)+'</div><div class="r">'+esc(a.record)+'</div></div></div><span class="at">at</span><div class="team" style="flex-direction:row-reverse;text-align:right">'+chipOf(h)+'<div class="tn"><div class="n">'+esc(h.short)+'</div><div class="r">'+esc(h.record)+'</div></div></div></div></div>';
  return '<article class="game'+(isLive(g.id)?' islive':'')+'" id="live-'+g.id+'">'+hs+'<div class="sec" id="lv-board-'+g.id+'">'+boardHtml(g)+'</div>'+
    (started?'<div class="sec" id="lv-viz-'+g.id+'"><h3>Live field <span class="hint">replays each new play</span></h3>'+(FSV.gid===g.id?'<div class="small muted">Playing in full screen.</div>':vizHtml(g))+'</div><div class="sec" id="lv-wp-'+g.id+'">'+wpChartHtml(g)+'</div><div class="sec" id="lv-log-'+g.id+'">'+logHtml(g)+'</div>':'')+
    '<div class="sec" id="lv-best-'+g.id+'">'+bestHtml(g)+'</div><div class="sec" id="lv-mk-'+g.id+'">'+marketsHtml(g)+'</div></article>';
}
function liveView(){
  const order={in:0,pre:1,post:2};
  const gs=DATA.games.filter(g=>S.league==='all'||(g.key||g.lg)===S.league).slice().sort((x,y)=>(order[(FEED[x.id]||{st:{s:'pre'}}).st.s]||0)-(order[(FEED[y.id]||{st:{s:'pre'}}).st.s]||0));
  return '<div id="lv-status">'+statusHtml()+'</div>'+gs.map(liveCard).join('');
}
const RF=(id,html)=>{ const el=document.getElementById(id); if(el) el.innerHTML=html; };
function refreshLive(gid,full){
  if(S.view!=='live') return; if(S.pressing){ S.pendingLive[gid]=2; return; }
  const g=G[gid]; if(!E('live-'+gid)) return;
  RF('lv-board-'+gid,boardHtml(g)); RF('lv-wp-'+gid,wpChartHtml(g)); RF('lv-status',statusHtml());
  RF('lv-best-'+gid,bestHtml(g)); RF('lv-mk-'+gid,marketsHtml(g));
  const art=E('live-'+gid); if(art) art.classList.toggle('islive',isLive(gid));
  if(FEED[gid]&&FEED[gid].st.s!=='pre'&&!E('viz-'+gid)){ redrawCard(gid); }
  if(g.lg==='mlb'){ mlbApply(g,false); }
  fsRefresh(g);
}
function redrawCard(gid){ const el=E('live-'+gid); if(!el) return; const tmp=document.createElement('div'); tmp.innerHTML=liveCard(G[gid]); el.replaceWith(tmp.firstElementChild); if(E('viz-'+gid)) vizRestore(G[gid]); }
function afterLiveRender(){ DATA.games.forEach(g=>{ if(E('viz-'+g.id)) vizRestore(g); }); }
