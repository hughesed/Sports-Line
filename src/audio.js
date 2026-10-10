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
/* a swell of the voice babble (pitched up for a roar) played on top of the cheer; silent until the babble has been built */
function sCrowdVox(dur,vol,rate,t0){
  const c=SND.ctx, b=sndCrowdBuf(); if(!c||!b) return; const t=c.currentTime+(t0||0); const s=c.createBufferSource(); s.buffer=b; s.playbackRate.value=rate||1;
  const g=c.createGain(); g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(Math.max(.01,vol),t+.35); g.gain.setValueAtTime(Math.max(.01,vol),t+Math.max(.4,dur-1)); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  s.connect(g); g.connect(SND.master); s.start(t,Math.random()*Math.max(.5,b.duration-dur-.1)); s.stop(t+dur+.05);
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
  cheer(){ const vb=sndVerbBus(); sCrowdVox(2.4,.9,1.12); sNoise(2.2,.2,'bandpass',900,1500,.8,0,.35,vb); sNoise(2.2,.22,'bandpass',2200,3200,.9,.05,.4,vb); for(let i=0;i<9;i++) sNoise(.07,.2,'bandpass',1500+Math.random()*1400,1700,.9,.2+i*.2+Math.random()*.12,.003,vb); },
  groan(){ sNoise(1.1,.22,'bandpass',500,260,.8,0,.3); },
  crack(){ sNoise(.06,.7,'highpass',1800,1800,.7,0); sTone(1100,500,.08,.3,'square',0); },
  swish(){ sNoise(.35,.25,'bandpass',2800,1200,1.1,0,.05); },
  /* battle sounds */
  fanfare(){ [[523,0],[659,.13],[784,.26],[1047,.39]].forEach(a=>{ sTone(a[0],a[0]*1.01,.28,.16,'sawtooth',a[1],null,2400); sTone(a[0]/2,a[0]/2,.28,.10,'square',a[1],null,1200); }); sTone(1047,1047,.7,.16,'sawtooth',.52,null,2600); sTone(784,784,.7,.12,'triangle',.52); },
  chime(){ sTone(988,988,.16,.16,'triangle',0); sTone(1319,1319,.34,.16,'triangle',.11); },
  batcrack(){ sNoise(.05,.85,'highpass',2200,2200,.7,0); sTone(1400,420,.09,.4,'square',0); sTone(180,70,.16,.5,'sine',.01); },
  mitt(){ sNoise(.09,.6,'bandpass',900,500,1.1,0,.005); sTone(150,60,.12,.5,'sine',0); },
  slide(){ sNoise(.45,.22,'bandpass',1800,500,.8,0,.05); },
  squeak(){ sTone(1500,2100,.09,.14,'square',0,null,3000); sTone(1900,1300,.08,.12,'square',.1,null,3000); },
  buzzer(){ sTone(220,220,.9,.38,'sawtooth',0,null,1400); sTone(233,233,.9,.3,'sawtooth',0,null,1400); },
  organ(){ [[392,0],[523,.14],[659,.28],[784,.42],[659,.56],[784,.70],[1047,.84]].forEach(a=>{ sTone(a[0],a[0],.2,.12,'square',a[1],null,1800); sTone(a[0]*2,a[0]*2,.2,.05,'triangle',a[1]); }); }
};
function sfx(name,delay,a){
  if(!SND.on) return; const f=SFX[name]; if(!f) return; const c=SND.ctx||sndCtx(); if(!c) return;
  const go=()=>{ if(SND.on&&SND.ctx&&SND.ctx.state==='running'){ try{ f(a); }catch(e){} } };
  const run=()=>{ if(delay>0) setTimeout(go,delay); else go(); };
  if(c.state==='running') run();
  else if(c.resume){ try{ const p=c.resume(); if(p&&p.then) p.then(()=>{ if(c.state==='running') run(); }).catch(()=>{}); }catch(e){} }   // a context made outside a tap starts suspended: start it, then play
}

/* ---------- more sounds: ball, court, field, diamond, crowd ---------- */
Object.assign(SFX,{
  dribble(n){ n=n||3; for(let i=0;i<n;i++){ sTone(120,55,.11,.5,'sine',i*.26); sNoise(.05,.18,'lowpass',700,300,1,i*.26,.004); } },
  thud(){ sTone(95,42,.16,.55,'sine',0); sNoise(.1,.3,'lowpass',500,200,1,0,.004); },
  rim(){ sTone(1750,1500,.35,.16,'triangle',0); sTone(2650,2400,.25,.07,'triangle',.01); sNoise(.06,.4,'highpass',2500,2500,.8,0,.003); },
  clang(){ sTone(1200,900,.5,.2,'triangle',0); sTone(1810,1500,.4,.1,'triangle',0); sNoise(.05,.5,'highpass',2000,2000,.8,0,.003); },
  rebound(){ sNoise(.12,.35,'bandpass',900,500,1,0,.004); sTone(140,70,.14,.45,'sine',.02); },
  pass(){ sNoise(.16,.2,'bandpass',1200,2200,1.1,0,.03); sNoise(.06,.4,'bandpass',900,600,1,.2,.004); },
  slam(){ sNoise(.2,.5,'lowpass',900,150,.9,0,.005); sTone(70,32,.45,.8,'sine',0); sTone(1500,700,.18,.2,'square',.02); },
  huddle(){ sNoise(.5,.2,'bandpass',500,380,1,0,.12); },
  hut(){ sNoise(.06,.5,'bandpass',1100,800,1.2,0,.004); sTone(210,150,.12,.28,'sawtooth',0,null,900); },
  pads(){ sNoise(.14,.65,'lowpass',700,180,.9,0,.004); sTone(90,40,.2,.6,'sine',0); sNoise(.05,.3,'highpass',2400,2400,.8,.02,.003); },
  snap(){ sNoise(.05,.5,'highpass',2000,2000,.8,0,.003); sTone(170,80,.1,.4,'sine',0); },
  whoosh(){ sNoise(.4,.22,'bandpass',500,2600,1,0,.2); },
  pitch(){ sNoise(.34,.2,'bandpass',700,2400,1.2,0,.18); },
  foulball(){ sNoise(.05,.5,'highpass',2400,2400,.7,0); sTone(1100,500,.07,.25,'square',0); },
  clap(n){ n=n||6; for(let i=0;i<n;i++) sNoise(.045,.4,'bandpass',1700+Math.random()*900,1700,1.1,i*.11+Math.random()*.03,.002); },
  chant(){ sTone(100,48,.2,.7,'sine',0); sTone(100,48,.2,.7,'sine',.3); sNoise(.1,.5,'highpass',1600,1600,.7,.6,.003); sNoise(.1,.5,'bandpass',1500,1500,1,.62,.003); sTone(100,48,.2,.7,'sine',1.2); sTone(100,48,.2,.7,'sine',1.5); sNoise(.1,.5,'highpass',1600,1600,.7,1.8,.003); },
  horn(){ sTone(330,330,.55,.2,'sawtooth',0,null,1500); sTone(415,415,.55,.16,'sawtooth',0,null,1500); sTone(330,330,.7,.2,'sawtooth',.62,null,1500); sTone(415,415,.7,.16,'sawtooth',.62,null,1500); },
  firework(){ sNoise(.5,.18,'bandpass',600,2500,1,0,.3); sNoise(.5,.5,'lowpass',900,150,.9,.55,.005); sNoise(.9,.14,'highpass',3000,5000,.8,.6,.1); },
  wave(){ sNoise(2.6,.3,'bandpass',500,1500,.7,0,1.1); sNoise(2.6,.18,'bandpass',1800,2600,.8,.2,1.2); },
  cheerBig(){ const vb=sndVerbBus(); sCrowdVox(3.6,1.2,1.2); SFX.cheer(); sCrowdVox(3.2,.8,.95,.35); sNoise(3.2,.3,'bandpass',700,1300,.7,.15,.5,vb); SFX.clap(10); },
  booBig(){ SFX.boo(); sNoise(2.8,.2,'bandpass',380,280,.9,.2,.5); },
  awww(){ sNoise(1.3,.16,'bandpass',480,240,.8,0,.25); },
  /* a heavy wooden door slammed shut: frame crack, body boom, wood slap, panel ring, latch rattle, room tail */
  doorslam(){
    sNoise(.04,.9,'highpass',1800,1800,.7,0,.002);
    sTone(100,36,.55,1,'sine',.004); sTone(170,62,.24,.5,'triangle',.008);
    sNoise(.3,.75,'lowpass',1500,170,1.1,0,.003);
    sNoise(.2,.4,'bandpass',310,250,5,.01,.004);
    sNoise(.55,.2,'bandpass',720,330,2.4,.11,.012);
    sTone(540,420,.12,.11,'square',.1,null,1200); sNoise(.035,.3,'highpass',2600,2600,.7,.16,.002); sNoise(.03,.2,'highpass',2600,2600,.7,.22,.002);
  },
  /* a missed shot: a flat "denied" error buzz, two falling tones, with a dull rim tick underneath */
  denied(){
    sNoise(.05,.35,'bandpass',900,700,1.2,0,.003);
    sTone(330,320,.17,.34,'sawtooth',.02,null,1500); sTone(247,160,.38,.36,'sawtooth',.22,null,1400); sTone(124,80,.38,.2,'square',.22,null,700);
  }
});

/* ---------- constant crowd noise (battle): a looping murmur that swells on big plays ---------- */
const AMB={on:false,out:null,t:null,bits:null,base:.1,lvl:1};
let SND_PINK=null;
function sndPink(){ const c=SND.ctx; if(SND_PINK) return SND_PINK; const n=c.sampleRate*4, b=c.createBuffer(1,n,c.sampleRate), d=b.getChannelData(0); let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
  for(let i=0;i<n;i++){ const w=Math.random()*2-1; b0=.99886*b0+w*.0555179; b1=.99332*b1+w*.0750759; b2=.969*b2+w*.153852; b3=.8665*b3+w*.3104856; b4=.55*b4+w*.5329522; b5=-.7616*b5-w*.016898; d[i]=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11; b6=w*.115926; }
  const f=Math.min(n,Math.floor(c.sampleRate*.05)); for(let i=0;i<f;i++){ d[i]*=i/f; d[n-1-i]*=i/f; }       // short fade so the loop point does not click
  SND_PINK=b; return b; }
/* ---------- the crowd: a murmur built from dozens of overlapping "voices" (a buzzing pitch shaped by vowel formants, started and stopped like syllables) so it reads as people, not wind.
   If a real recording is placed at audio/crowd.mp3 (or .ogg) it is loaded and used instead (see sndLoadCrowdFile). ---------- */
let SND_BAB=null, SND_BABP=false, SND_FILE=null, SND_FILEP=false;
const BAB_VOWELS=[[730,1090],[530,1840],[270,2290],[570,840],[300,870],[660,1720],[440,1020]];
/* a made-up stadium: a 2.4 s stereo impulse response (dense early reflections, then a tail that gets darker as it fades). Used baked into the crowd loop
   and live on the cheers, so a roar sounds like it fills a bowl instead of coming out of a speaker. */
function sndMakeIR(c,sr,len,decay){
  const n=Math.floor(sr*len), b=c.createBuffer(2,n,sr);
  for(let ch=0;ch<2;ch++){ const d=b.getChannelData(ch); let lp=0;
    for(let i=0;i<n;i++){ const t=i/n; const att=i<sr*.018?i/(sr*.018):1; lp+=((Math.random()*2-1)-lp)*(.42-.34*t); d[i]=lp*att*Math.pow(1-t,decay)*2.4; } }
  return b;
}
let SND_VERB=null;
function sndVerbBus(){            // a mixing point: whatever is sent here is heard dry and through the stadium
  const c=SND.ctx; if(!c) return null; if(SND_VERB&&SND_VERB.ctx===c) return SND_VERB.bus;
  try{ const bus=c.createGain(), conv=c.createConvolver(), wet=c.createGain(), dry=c.createGain(); conv.buffer=sndMakeIR(c,c.sampleRate,2.4,2.6); wet.gain.value=.55; dry.gain.value=.8;
    bus.connect(dry); dry.connect(SND.master); bus.connect(conv); conv.connect(wet); wet.connect(SND.master); SND_VERB={ctx:c,bus:bus}; return bus; }catch(e){ return null; }
}
function sndMakeBabble(){
  if(SND_BAB||SND_BABP) return; const c=SND.ctx; if(!c) return;
  const OC=window.OfflineAudioContext||window.webkitOfflineAudioContext; if(!OC) return; SND_BABP=true;
  try{
    const sr=22050, dur=10, oc=new OC(2,sr*dur,sr), rnd=(a,b)=>a+Math.random()*(b-a);
    /* signal path: voices + roar bed -> mix -> (dry + stadium reverb) -> soft top end -> out */
    const mix=oc.createGain(); mix.gain.value=.1;
    const dry=oc.createGain(); dry.gain.value=.62; const conv=oc.createConvolver(), wet=oc.createGain(); wet.gain.value=.7; conv.buffer=sndMakeIR(oc,sr,2.4,2.6);
    const tone=oc.createBiquadFilter(); tone.type='lowpass'; tone.frequency.value=5200; tone.Q.value=.5;
    mix.connect(dry); mix.connect(conv); conv.connect(wet); dry.connect(tone); wet.connect(tone); tone.connect(oc.destination);
    const nz=oc.createBuffer(1,sr*3,sr), nd=nz.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
    /* the roar bed: the wash of thousands of people too far away to pick out, slowly breathing */
    [[420,.5,.5],[1100,.6,.28],[2600,.8,.1]].forEach((x,k)=>{ const s=oc.createBufferSource(); s.buffer=nz; s.loop=true; const f=oc.createBiquadFilter(); f.type='bandpass'; f.frequency.value=x[0]; f.Q.value=x[1]; const g=oc.createGain(); g.gain.value=x[2];
      const l=oc.createOscillator(), lg=oc.createGain(); l.frequency.value=.11+k*.07; lg.gain.value=x[2]*.45; l.connect(lg); lg.connect(g.gain); l.start(0); s.connect(f); f.connect(g); g.connect(mix); s.start(0,rnd(0,2)); });
    /* the people: each one a buzzing pitch plus breath, shaped by three vowel formants, in short syllables with pitch glides, spread left to right */
    for(let v=0;v<66;v++){
      const o=oc.createOscillator(); o.type='sawtooth'; const kid=Math.random()<.18, base=kid?rnd(240,400):(Math.random()<.4?rnd(165,260):rnd(88,150));
      const f1=oc.createBiquadFilter(), f2=oc.createBiquadFilter(), f3=oc.createBiquadFilter(); f1.type=f2.type=f3.type='bandpass'; f1.Q.value=5; f2.Q.value=7; f3.Q.value=9;
      const g1=oc.createGain(), g2=oc.createGain(), g3=oc.createGain(), env=oc.createGain(), br=oc.createBufferSource(), bg=oc.createGain();
      g1.gain.value=1; g2.gain.value=.55; g3.gain.value=.22; env.gain.setValueAtTime(0,0);
      br.buffer=nz; br.loop=true; bg.gain.value=.45; br.connect(bg); o.connect(f1); o.connect(f2); o.connect(f3); bg.connect(f1); bg.connect(f2);
      f1.connect(g1); f2.connect(g2); f3.connect(g3); g1.connect(env); g2.connect(env); g3.connect(env);
      let out=env; if(oc.createStereoPanner){ const pn=oc.createStereoPanner(); pn.pan.value=rnd(-.85,.85); env.connect(pn); out=pn; } out.connect(mix);
      const vib=oc.createOscillator(), vg=oc.createGain(); vib.frequency.value=rnd(4.5,6.5); vg.gain.value=base*.012; vib.connect(vg); vg.connect(o.frequency); vib.start(0);
      o.frequency.setValueAtTime(base,0); br.start(0,rnd(0,2));
      let t=rnd(0,1.1); const talk=rnd(.45,.9), loud=Math.random()<.25?rnd(.9,1.4):rnd(.25,.8);
      while(t<dur){
        const vw=BAB_VOWELS[Math.floor(Math.random()*BAB_VOWELS.length)], sy=rnd(.09,.3), amp=rnd(.3,1)*loud, w3=rnd(2400,3100), p0=base*rnd(.9,1.12);
        f1.frequency.setValueAtTime(vw[0]*rnd(.9,1.1),t); f2.frequency.setValueAtTime(vw[1]*rnd(.9,1.1),t); f3.frequency.setValueAtTime(w3,t);
        o.frequency.setValueAtTime(p0,t); o.frequency.linearRampToValueAtTime(p0*rnd(.88,1.14),t+sy);
        env.gain.setValueAtTime(0,t); env.gain.linearRampToValueAtTime(amp,t+sy*.3); env.gain.linearRampToValueAtTime(0,t+sy);
        t+=sy+(Math.random()<talk?rnd(.02,.1):rnd(.3,1.2));
      }
      o.start(0); o.stop(dur);
    }
    const done=b=>{ try{ for(let ch=0;ch<b.numberOfChannels;ch++){ const d=b.getChannelData(ch), f=Math.floor(sr*.3); for(let i=0;i<f;i++){ const k=i/f; d[i]*=k; d[d.length-1-i]*=k; } } }catch(e){} SND_BAB=b; SND_BABP=false; };   // fade the ends so the loop does not click
    const pr=oc.startRendering(); if(pr&&pr.then) pr.then(done).catch(()=>{ SND_BABP=false; }); else oc.oncomplete=e=>done(e.renderedBuffer);
  }catch(e){ SND_BABP=false; }
}
function sndLoadCrowdFile(){
  if(SND_FILE||SND_FILEP||SND_FILE===false) return; const c=SND.ctx; if(!c) return; SND_FILEP=true;
  const tries=['audio/crowd.mp3','audio/crowd.ogg','audio/crowd.wav']; let i=0;
  const next=()=>{ if(i>=tries.length){ SND_FILEP=false; SND_FILE=false; return; }
    fetch(tries[i++]).then(r=>{ if(!r.ok) throw 0; return r.arrayBuffer(); }).then(ab=>new Promise((ok,no)=>{ const p=c.decodeAudioData(ab,ok,no); if(p&&p.then) p.then(ok,no); })).then(b=>{ SND_FILE=b; SND_FILEP=false; }).catch(next); };
  next();
}
function sndCrowdBuf(){ return SND_FILE||SND_BAB||null; }
function ambStart(sport){
  if(!SND.on||AMB.on) return; const c=SND.ctx; if(!c||c.state!=='running') return;
  AMB.on=true; AMB.base=sport==='mlb'?.075:sport==='nfl'||sport==='cfb'?.12:.1; AMB.lvl=1;
  const out=c.createGain(); out.gain.setValueAtTime(.0001,c.currentTime); out.gain.exponentialRampToValueAtTime(AMB.base,c.currentTime+1.6); out.connect(SND.master); AMB.out=out;
  const mk=(f,q,g,type)=>{ const s=c.createBufferSource(); s.buffer=sndPink(); s.loop=true; const fl=c.createBiquadFilter(); fl.type=type||'bandpass'; fl.frequency.value=f; fl.Q.value=q; const gg=c.createGain(); gg.gain.value=g; s.connect(fl); fl.connect(gg); gg.connect(out); s.start(0,Math.random()*3); return {s:s,fl:fl,gg:gg}; };
  sndMakeBabble(); sndLoadCrowdFile(); const cb=sndCrowdBuf();
  let L;
  if(cb){   // people talking: the recording or the voice babble, with only a faint low rumble of the stands underneath
    const src=c.createBufferSource(); src.buffer=cb; src.loop=true; const fl=c.createBiquadFilter(); fl.type='peaking'; fl.frequency.value=900; fl.Q.value=.6; fl.gain.value=0; const gg=c.createGain(); gg.gain.value=SND_FILE?1.1:1.6; src.connect(fl); fl.connect(gg); gg.connect(out); src.start(0,Math.random()*Math.max(1,cb.duration-1));
    L=[mk(180,.5,.22,'lowpass'),{s:src,fl:fl,gg:gg}];
  } else L=[mk(420,.5,1),mk(900,.7,.9),mk(1900,.8,.45),mk(3600,.9,.12,'highpass')];
  const lfo=c.createOscillator(), lg=c.createGain(); lfo.frequency.value=.13; lg.gain.value=AMB.base*.28; lfo.connect(lg); lg.connect(out.gain); lfo.start();
  AMB.bits={L:L,lfo:lfo};
  AMB.t=setInterval(()=>{ if(!AMB.on||!SND.on||c.state!=='running') return;
    const k=AMB.lvl*(0.85+Math.random()*.35); try{ out.gain.setTargetAtTime(AMB.base*k,c.currentTime,.9); L[1].fl.frequency.setTargetAtTime(800+Math.random()*500+(AMB.lvl-1)*400,c.currentTime,.8); }catch(e){}
    if(Math.random()<.55) sNoise(.22+Math.random()*.25,.05,'bandpass',650+Math.random()*700,500+Math.random()*500,2.2,0,.06);        // a voice or two out of the crowd
    if(Math.random()<.07) SFX.clap(3+Math.floor(Math.random()*3));
  },1200);
}
function ambStop(){
  if(!AMB.on) return; AMB.on=false; clearInterval(AMB.t); const c=SND.ctx, o=AMB.out, b=AMB.bits; AMB.out=null; AMB.bits=null;
  if(c&&o){ try{ o.gain.cancelScheduledValues(c.currentTime); o.gain.setValueAtTime(Math.max(.0001,o.gain.value),c.currentTime); o.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.8); }catch(e){} setTimeout(()=>{ try{ if(b){ b.lfo.stop(); b.L.forEach(x=>x.s.stop()); } o.disconnect(); }catch(e){} },1000); }
}
/* the crowd gets louder (k > 1) for a few seconds, then settles back */
function ambSwell(k,secs){
  const c=SND.ctx; if(!AMB.on||!AMB.out||!c) return; AMB.lvl=k; const o=AMB.out;
  try{ o.gain.cancelScheduledValues(c.currentTime); o.gain.setValueAtTime(Math.max(.0001,o.gain.value),c.currentTime); o.gain.linearRampToValueAtTime(AMB.base*k,c.currentTime+.25); }catch(e){}
  clearTimeout(AMB._r); AMB._r=setTimeout(()=>{ AMB.lvl=1; try{ if(AMB.on&&AMB.out) AMB.out.gain.setTargetAtTime(AMB.base,SND.ctx.currentTime,1.2); }catch(e){} },(secs||2.5)*1000);
}
/* the home crowd roars for its team and boos the visitors */
function crowdFor(home,big){
  if(!SND.on) return;
  if(home){ sfx(big?'cheerBig':'cheer',0); ambSwell(big?3:2,big?4:2.6); }
  else { sfx(big?'booBig':'boo',0); ambSwell(big?2.1:1.6,big?3.4:2.4); }
}

/* ---------- unlocking audio on phones: a tap starts the context, and a silent <audio> keeps iOS from muting Web Audio with the ring switch ---------- */
let SND_SIL=null;
function sndSilentWav(){ const n=1600,sr=8000,b=new Uint8Array(44+n*2),dv=new DataView(b.buffer),w=(o,t)=>{ for(let i=0;i<t.length;i++) b[o+i]=t.charCodeAt(i); };
  w(0,'RIFF'); dv.setUint32(4,36+n*2,true); w(8,'WAVE'); w(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,sr,true); dv.setUint32(28,sr*2,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true); w(36,'data'); dv.setUint32(40,n*2,true);
  return URL.createObjectURL(new Blob([b],{type:'audio/wav'})); }
function sndSilentKeep(){ try{ if(!SND_SIL){ const a=document.createElement('audio'); a.setAttribute('playsinline',''); a.loop=true; a.volume=.02; a.src=sndSilentWav(); SND_SIL=a; } if(SND_SIL.paused){ const p=SND_SIL.play(); if(p&&p.catch) p.catch(()=>{}); } }catch(e){} }


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
function sndStop(){ try{ ambStop(); }catch(e){} musicStop(); SND.q=[]; SND.busy=false; try{ if(HAS_TTS) speechSynthesis.cancel(); }catch(e){} }
function sndUnlock(){ const c=sndCtx(); if(c){ try{ const b=c.createBuffer(1,1,22050), z=c.createBufferSource(); z.buffer=b; z.connect(c.destination); z.start(0); }catch(e){} } sndSilentKeep(); if(HAS_TTS){ try{ const u=new SpeechSynthesisUtterance(' '); u.volume=0; speechSynthesis.speak(u); }catch(e){} } }

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
  if(g.lg==='nhl'){ if(!p.sc&&!/save|penalty|hit|block/i.test(t)) return ''; }
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
    else if(g.lg==='nhl'){ if(p.sc){ sfx('horn',0); sfx('crowd',300,true); } else if(p.sh) sfx('crack',0); }
  }
  if(!text||backlog>10) return 0;
  const hi=!!p.sc;
  if(backlog>5&&!hi&&!(g.lg==='nfl'&&+p.y>=10)) return 0;
  return say(text,hi);
}
