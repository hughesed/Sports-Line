/* ===== big screen audio: play-by-play voice + synthesized football sound effects ===== */
const SND={on:true,ctx:null,master:null,nb:null,voiceName:'',rate:1.05,q:[],busy:false,lastMs:0,voices:[]};
try{ const sp=JSON.parse(localStorage.getItem('ls_snd')||'{}'); if(sp.on===false) SND.on=false; if(sp.voice) SND.voiceName=sp.voice; if(sp.rate) SND.rate=+sp.rate||1.05; }catch(e){}
function sndSave(){ try{ localStorage.setItem('ls_snd',JSON.stringify({on:SND.on,voice:SND.voiceName,rate:SND.rate})); }catch(e){} }
const HAS_TTS=typeof window!=='undefined'&&'speechSynthesis' in window&&typeof SpeechSynthesisUtterance!=='undefined';
function sndCtx(){
  if(SND.ctx){ if(SND.ctx.state==='suspended'&&SND.ctx.resume) SND.ctx.resume(); return SND.ctx; }
  const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return null;
  try{ SND.ctx=new AC(); SND.master=SND.ctx.createGain(); SND.master.gain.value=.85; SND.master.connect(SND.ctx.destination); }catch(e){ SND.ctx=null; }
  return SND.ctx;
}
function sndNoise(){ const c=SND.ctx; if(SND.nb) return SND.nb; const b=c.createBuffer(1,c.sampleRate*2,c.sampleRate), d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; SND.nb=b; return b; }
function sTone(f1,f2,dur,vol,type,t0,dest,lp){
  const c=SND.ctx; if(!c) return; const t=c.currentTime+(t0||0); const o=c.createOscillator(), g=c.createGain();
  o.type=type||'sine'; o.frequency.setValueAtTime(f1,t); o.frequency.exponentialRampToValueAtTime(Math.max(20,f2),t+dur);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.008); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  if(lp){ const fl=c.createBiquadFilter(); fl.type='lowpass'; fl.frequency.value=lp; o.connect(fl); fl.connect(g); } else o.connect(g);
  g.connect(dest||SND.master); o.start(t); o.stop(t+dur+.05);
}
function sNoise(dur,vol,ftype,f1,f2,q,t0,atk,dest){
  const c=SND.ctx; if(!c) return; const t=c.currentTime+(t0||0); const s=c.createBufferSource(); s.buffer=sndNoise(); s.loop=true;
  const fl=c.createBiquadFilter(); fl.type=ftype; fl.frequency.setValueAtTime(f1,t); if(f2&&f2!==f1) fl.frequency.exponentialRampToValueAtTime(f2,t+dur); fl.Q.value=q||1;
  const g=c.createGain(); const a=atk||0.01; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+a); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  s.connect(fl); fl.connect(g); g.connect(dest||SND.master); s.start(t,Math.random()); s.stop(t+dur+.05);
}
const SFX={
  throw(){ sNoise(.32,.16,'bandpass',900,2600,1.2,0,.12); },
  catch(){ sNoise(.07,.55,'highpass',2200,2200,.8,0); sTone(190,70,.12,.5,'sine',0); sNoise(.12,.2,'bandpass',900,500,1,.01); },
  rush(){ for(let i=0;i<4;i++) sNoise(.09,.14,'bandpass',700+i*60,500,1.3,i*.11,.01); },
  tackle(){ sNoise(.2,.5,'lowpass',500,160,.9,0); sTone(110,45,.22,.55,'sine',0); },
  kick(){ sTone(150,45,.22,.7,'sine',0); sNoise(.1,.35,'lowpass',900,300,1,0); sNoise(.5,.12,'bandpass',1500,500,1,.05,.2); },
  whistle(){ const c=SND.ctx; if(!c) return; const t=c.currentTime; const o=c.createOscillator(), l=c.createOscillator(), lg=c.createGain(), g=c.createGain(); o.type='sine'; o.frequency.value=2950; l.frequency.value=28; lg.gain.value=90; l.connect(lg); lg.connect(o.frequency); g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.22,t+.03); g.gain.setValueAtTime(.22,t+.45); g.gain.exponentialRampToValueAtTime(.0001,t+.6); o.connect(g); g.connect(SND.master); o.start(t); l.start(t); o.stop(t+.65); l.stop(t+.65); },
  sack(){ sNoise(.3,.65,'lowpass',420,120,.9,0); sTone(90,35,.35,.7,'sine',0); sNoise(.12,.3,'highpass',1800,1800,.7,0); },
  big(){ sNoise(.9,.2,'bandpass',500,2400,1.4,0,.5); sTone(440,880,.5,.12,'triangle',.1); },
  crowd(long){ const d=long?3.2:1.8; sNoise(d,long?.5:.28,'bandpass',650,1100,.7,0,.5); sNoise(d,long?.3:.15,'bandpass',1800,2600,.8,.1,.6); if(long){ sTone(523,523,.18,.12,'triangle',.5); sTone(659,659,.18,.12,'triangle',.7); sTone(784,784,.35,.14,'triangle',.9); } },
  whistle2(){ SFX.whistle(); setTimeout(()=>{ if(SND.on&&SND.ctx) SFX.whistle(); },520); },
  boo(){ const c=SND.ctx; if(!c) return; const t=c.currentTime, d=2.4; [104,109,115,98].forEach((f,i)=>{ const o=c.createOscillator(), g=c.createGain(), fl=c.createBiquadFilter(), v=c.createOscillator(), vg=c.createGain(); o.type='sawtooth'; o.frequency.setValueAtTime(f*1.18,t); o.frequency.exponentialRampToValueAtTime(f*.82,t+d); v.frequency.value=5+i; vg.gain.value=3; v.connect(vg); vg.connect(o.frequency); fl.type='lowpass'; fl.frequency.value=420; fl.Q.value=2; g.gain.setValueAtTime(.0001,t+i*.05); g.gain.exponentialRampToValueAtTime(.11,t+.6); g.gain.exponentialRampToValueAtTime(.0001,t+d); o.connect(fl); fl.connect(g); g.connect(SND.master); o.start(t); v.start(t); o.stop(t+d+.1); v.stop(t+d+.1); }); sNoise(d,.18,'bandpass',420,300,.9,0,.5); },
  cheer(){ sNoise(2.2,.38,'bandpass',900,1500,.8,0,.35); sNoise(2.2,.22,'bandpass',2200,3200,.9,.05,.4); for(let i=0;i<7;i++) sNoise(.08,.18,'highpass',1800,1800,.7,.2+i*.22+Math.random()*.1); },
  groan(){ sNoise(1.1,.22,'bandpass',500,260,.8,0,.3); },
  crack(){ sNoise(.06,.7,'highpass',1800,1800,.7,0); sTone(1100,500,.08,.3,'square',0); },
  swish(){ sNoise(.35,.25,'bandpass',2800,1200,1.1,0,.05); }
};
function sfx(name,delay,a){ if(!SND.on||!SND.ctx) return; const f=SFX[name]; if(!f) return; if(delay>0) setTimeout(()=>{ if(SND.on&&SND.ctx) try{ f(a); }catch(e){} },delay); else try{ f(a); }catch(e){} }


/* ---------- waiting music (timeouts, halftime) ---------- */
const MUS={on:false,t:null,beat:0,gain:null,kind:'',cap:null};
const mHz=m=>440*Math.pow(2,(m-69)/12);
const MCH=[[48,52,55,59],[45,48,52,55],[50,53,57,60],[43,47,50,53]];
function musicStep(){
  const c=SND.ctx; if(!c||!MUS.on||!SND.on) return; const b=MUS.beat++, ch=MCH[Math.floor(b/8)%4], k=b%8, d=MUS.gain;
  const arp=[0,2,1,3,2,3,1,2][k]; sTone(mHz(ch[arp]+12),mHz(ch[arp]+12)*.995,.55,.075,'triangle',0,d,2600);
  if(k===0||k===4) sTone(mHz(ch[0]-12),mHz(ch[0]-12),.5,.16,'sine',0,d);
  if(k===0) { sTone(mHz(ch[1]),mHz(ch[1]),1.2,.04,'sine',0,d); sTone(mHz(ch[2]),mHz(ch[2]),1.2,.04,'sine',0,d); }
  if(k%2===1) sNoise(.05,.05,'highpass',7000,7000,.7,0,.005,d);
  if(k===2||k===6) sNoise(.07,.06,'highpass',5000,5000,.7,0,.005,d);
}
function musicStart(kind){
  if(!SND.on||MUS.on) return; const c=sndCtx(); if(!c) return;
  MUS.on=true; MUS.kind=kind||'to'; MUS.beat=0; MUS.gain=c.createGain(); MUS.gain.gain.setValueAtTime(.0001,c.currentTime); MUS.gain.gain.exponentialRampToValueAtTime(.8,c.currentTime+1.4); MUS.gain.connect(SND.master);
  musicStep(); MUS.t=setInterval(musicStep,300);
  clearTimeout(MUS.cap); MUS.cap=setTimeout(()=>musicStop(),MUS.kind==='half'?1000*60*20:1000*75);
}
function musicStop(){
  if(!MUS.on) return; MUS.on=false; clearInterval(MUS.t); clearTimeout(MUS.cap); const c=SND.ctx, g=MUS.gain; MUS.kind='';
  if(c&&g){ try{ g.gain.cancelScheduledValues(c.currentTime); g.gain.setValueAtTime(Math.max(.0001,g.gain.value),c.currentTime); g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.9); }catch(e){} setTimeout(()=>{ try{ g.disconnect(); }catch(e){} },1200); }
}
function halfCheck(g){ const f=FEED[g.id]; const half=!!f&&/half/i.test(f.st.det||'')&&f.st.s==='in'; if(half&&SND.on) musicStart('half'); else if(MUS.kind==='half') musicStop(); }

/* ---------- voice ---------- */
function loadVoices(){ if(!HAS_TTS) return; try{ SND.voices=(speechSynthesis.getVoices()||[]).filter(v=>/^en/i.test(v.lang)); }catch(e){} }
if(HAS_TTS){ loadVoices(); try{ speechSynthesis.addEventListener('voiceschanged',()=>{ loadVoices(); if(typeof fsVoiceFill==='function') fsVoiceFill(); }); }catch(e){} }
function voiceScore(v){
  const n=v.name||''; let s=0;
  if(/en[-_]US/i.test(v.lang)) s+=3; else if(/en[-_](GB|AU|CA|IE)/i.test(v.lang)) s+=2;
  if(/premium|enhanced|natural|neural|online|studio|wavenet/i.test(n)) s+=8;
  if(/siri/i.test(n)) s+=7;
  if(/\b(ava|zoe|evan|nathan|allison|tom|aaron|noelle)\b/i.test(n)) s+=5;
  if(/(aria|guy|jenny|davis|jason|andrew|brian|emma|ryan|steffan)/i.test(n)) s+=5;
  if(/google (us|uk) english/i.test(n)) s+=5;
  if(/\b(samantha|daniel|alex|karen|moira|serena|oliver)\b/i.test(n)) s+=3;
  if(/fred|zarvox|trinoids|whisper|bahh|bells|boing|bubbles|cellos|deranged|hysterical|organ|princess|ralph|junior|kathy|albert|bad news|good news|jester|superstar|wobble|espeak|compact/i.test(n)) s-=20;
  if(v.localService===false) s+=1;
  return s;
}
function bestVoice(){
  if(!SND.voices.length) loadVoices();
  if(SND.voiceName){ const v=SND.voices.find(x=>x.name===SND.voiceName); if(v) return v; }
  return SND.voices.slice().sort((a,b)=>voiceScore(b)-voiceScore(a))[0]||null;
}
function speechMs(t){ return Math.round(String(t).split(/\s+/).length*300/SND.rate+500); }
function drainSpeech(){
  if(SND.busy||!SND.q.length||!HAS_TTS||!SND.on) return;
  const it=SND.q.shift(); const u=new SpeechSynthesisUtterance(it.t); const v=bestVoice(); try{ if(v){ u.voice=v; u.lang=v.lang; } else u.lang='en-US'; }catch(e){ u.lang='en-US'; }
  u.rate=SND.rate; u.pitch=1; u.volume=1; SND.busy=true;
  let done=false; const fin=()=>{ if(done) return; done=true; SND.busy=false; clearTimeout(SND.wd); setTimeout(drainSpeech,120); };
  u.onend=fin; u.onerror=fin; SND.wd=setTimeout(fin,Math.max(4000,speechMs(it.t)*2.2));
  try{ speechSynthesis.speak(u); }catch(e){ fin(); }
}
function say(text,hi){
  if(!SND.on||!HAS_TTS||!text) return 0;
  if(hi){ SND.q=SND.q.filter(x=>x.hi); } else if(SND.q.length>=2){ SND.q=SND.q.filter(x=>x.hi); }
  SND.q.push({t:text,hi:!!hi}); drainSpeech(); return speechMs(text);
}
function sndStop(){ musicStop(); SND.q=[]; SND.busy=false; try{ if(HAS_TTS) speechSynthesis.cancel(); }catch(e){} }
function sndUnlock(){ sndCtx(); if(HAS_TTS){ try{ const u=new SpeechSynthesisUtterance(' '); u.volume=0; speechSynthesis.speak(u); }catch(e){} } }

/* ---------- broadcaster-style callouts ---------- */
const ABAL={CLV:'CLE',JAC:'JAX',WAS:'WSH',LVR:'LV',ARZ:'ARI',BLT:'BAL',HST:'HOU',SD:'LAC',STL:'LAR',OAK:'LV'};
function penTeam(g,tx){ const m=String(tx||'').match(/penalty on ([A-Z]{2,4})/i); if(!m) return ''; let ab=m[1].toUpperCase(); ab=ABAL[ab]||ab; return ab===g.teams.away.abbr?'a':ab===g.teams.home.abbr?'h':''; }

const lastName=n=>String(n||'').replace(/^[A-Z]\.\s?/,'').trim();
function cleanTx(tx){ return String(tx||'').replace(/\([^)]*\)/g,' ').replace(/\bto\s+([A-Z]{2,4})\s+(\d+)/g,'to the $1 $2').replace(/\s+/g,' ').trim(); }
function teamName(g,abbr){ abbr=(typeof ABAL!=='undefined'&&ABAL[abbr])||abbr; const a=g.teams.away,h=g.teams.home; return abbr===a.abbr?a.short:abbr===h.abbr?h.short:abbr||''; }
function scoreLine(g,p){ const a=g.teams.away,h=g.teams.home; if(p['as']==null||p.hs==null) return ''; return ' '+a.short+' '+p['as']+', '+h.short+' '+p.hs+'.'; }
function nflCall(g,p){
  const f=nflFlags(p), tx=String(p.tx||''); const y=+p.y; const ay=Math.abs(isNaN(y)?0:y);
  const qb=lastName(nflName(tx,'qb')), rec=lastName(nflName(tx,'to'));
  const fd=/\b1st down\b|first down/i.test(tx); const team=teamName(g,p.tm);
  const yd=n=>n+' yard'+(n===1?'':'s');
  if(/timeout/i.test(p.ty||tx)){ const tb=(tx.match(/by ([A-Z]{2,4})/)||[])[1]; return /official|two-minute|2-minute/i.test((p.ty||'')+tx)?'Official timeout.':'Timeout, '+(tb?teamName(g,tb):team)+'.'; }
  if(f.ko){ if(/touchback/i.test(tx)) return 'Kickoff, touchback.'; const m=tx.match(/(?:returned|return)\s+by\s+([A-Za-z.'\-\s]+?)\s+for\s+(\d+)/i)||tx.match(/\.\s*[A-Z]\.[A-Za-z'\-]+\s+to\s+[A-Z]{2,4}\s+\d+\s+for\s+(\d+)\s+yards?/i)&&[0,tx.match(/\.\s*([A-Z]\.[A-Za-z'\-]+)\s+to\s+[A-Z]{2,4}\s+\d+\s+for/)[1],tx.match(/\.\s*[A-Z]\.[A-Za-z'\-]+\s+to\s+[A-Z]{2,4}\s+\d+\s+for\s+(\d+)/)[1]]; if(p.sc) return 'Kickoff returned all the way back for a touchdown!'+scoreLine(g,p); return m?'Kickoff, returned by '+lastName(m[1])+' for '+yd(+m[2])+'.':'Kickoff.'; }
  if(f.punt){ const m=tx.match(/punts\s+(\d+)/i); return m?team+' punt, '+yd(+m[1])+'.':team+' punt.'; }
  if(f.fg) return (p.sc&&!f.miss)?'The field goal is good!'+scoreLine(g,p):'The kick is no good.';
  if(f.xp) return p.sc?'The extra point is good.'+scoreLine(g,p):'No good on the try.';
  if(f.td){ const who=rec||lastName(nflName(tx,'qb')); const how=f.pass?(qb&&rec?qb+' finds '+rec+' for a '+yd(ay)+' touchdown!':'Touchdown, '+team+'!'):(who?who+' runs it in from '+yd(ay)+'! Touchdown!':'Touchdown, '+team+'!'); return how+scoreLine(g,p); }
  if(f.int) return 'Intercepted! '+team+' turn it over.';
  if(f.fum) return 'Fumble! The ball is loose, and it is a turnover.';
  if(f.sack){ return (qb?qb:'The quarterback')+' is sacked'+(ay?' for a loss of '+yd(ay):'')+'.'; }
  if(f.pass&&f.inc) return rec?qb?qb+' throws incomplete, intended for '+rec+'.':'Incomplete, intended for '+rec+'.':'Pass incomplete.';
  if(f.pass){ const who=rec||'the receiver'; return (qb?qb+' to ':'')+who+', '+yd(ay)+(y<0?' loss':'')+'.'+(ay>=10?' What a catch!':'')+(fd?' First down.':''); }
  if(f.run){ const who=lastName(nflName(tx,'qb')); if(!y) return (who?who+' is stopped for no gain.':'Stopped for no gain.'); return (who?who+' ':'Run ')+(y<0?'loses '+yd(ay)+'.':'carries for '+yd(ay)+'.')+(ay>=10?' Nice burst.':'')+(fd?' First down.':''); }
  if(f.pen){ const pm=tx.match(/penalty on ([A-Z]{2,4})-?([A-Za-z.'\-]*),\s*([^,]+?),\s*(\d+) yards?/i); if(pm){ const pt=penTeam(g,tx); const nm=pt==='a'?g.teams.away.short:pt==='h'?g.teams.home.short:pm[1]; return 'Flag on the play. '+nm+' penalized, '+pm[3].toLowerCase()+', '+pm[4]+' yards.'; } const t=cleanTx(tx); return 'Flag on the play. '+t.slice(0,110); }
  return cleanTx(tx).slice(0,120);
}
function otherCall(g,p){
  const t=cleanTx(p.tx); if(!t) return '';
  if(g.lg==='mlb'){ if(/^(ball|strike|foul|pitch)\b/i.test(t)&&!p.sc) return ''; if(!/struck out|strikes out|grounds|flies|lines|pops|single|double|triple|homer|walk|hit by pitch|out at|scores|steal|stole|double play|reaches|fouled out|sacrifice|lined|fanned/i.test(t)) return ''; }
  if(g.lg==='wnba'){ if(!p.sc&&!/block|steal|turnover|foul/i.test(t)) return ''; }
  return t.slice(0,130);
}
/* called when a play starts in big screen mode: voice, effects, pace */
function announce(g,p,backlog){
  if(!SND.on||FSV.gid!==g.id) return 0; sndCtx();
  const isTO=/timeout|two-minute warning|2-minute warning/i.test((p.ty||'')+' '+(p.tx||''));
  if(isTO){ musicStart('to'); sfx('whistle',0); } else if(MUS.on&&MUS.kind==='to') musicStop();
  let text=''; const f=g.lg==='nfl'?nflFlags(p):null;
  if(g.lg==='nfl'){
    text=nflCall(g,p); const y=+p.y;
    if(f.ko){ sfx('whistle',0); sfx('kick',350); if(p.sc) sfx('crowd',1800,true); }
    else if(f.punt||f.fg||f.xp){ sfx('kick',0); if(p.sc&&!f.miss) sfx('crowd',1100,f.fg); }
    else if(f.sack){ sfx('sack',650); sfx('whistle',1100); }
    else if(f.pass&&f.inc){ sfx('throw',0); sfx('groan',900); }
    else if(f.pass){ sfx('throw',0); const d1=(y>5?900:380); sfx('catch',d1); sfx('tackle',d1+Math.min(1200,300+Math.abs(y)*24)); if(+y>=10&&!p.sc) sfx('big',d1+100); sfx('whistle',d1+Math.min(1400,500+Math.abs(y)*24)); }
    else if(f.run){ sfx('rush',0); sfx('tackle',Math.min(1500,520+Math.abs(y||0)*30)); sfx('whistle',Math.min(1700,720+Math.abs(y||0)*30)); }
    else if(f.pen){ sfx('whistle2',0); const pt=penTeam(g,p.tx); if(pt==='a') sfx('boo',900); else if(pt==='h') sfx('cheer',900); }
    if(f.td) sfx('crowd',900,true);
    if(f.int||/fumble/i.test(p.tx||'')&&p.to){ sfx('groan',300); }
  } else {
    text=otherCall(g,p);
    if(g.lg==='mlb'){ if(/single|double|triple|homer/i.test(p.tx||'')) sfx('crack',0); if(p.sc) sfx('crowd',400,/homer/i.test(p.tx||'')); }
    else if(g.lg==='wnba'){ if(p.sc) { sfx('swish',0); sfx('crowd',250,false); } }
  }
  if(!text||backlog>10) return 0;
  const hi=!!p.sc;
  if(backlog>5&&!hi&&!(g.lg==='nfl'&&+p.y>=10)) return 0;
  return say(text,hi);
}
