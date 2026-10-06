/* ================= practice state + persistence ================= */
const KEY='linescout.practice.v1';
const MAX_LOAD=10000, MIN_LOAD=0.01;
const P={bank:1000,start:1000,bets:[],saved:[],tpl:'',seq:1,live:{}};
const RT={};            // runtime per game: sim cache, running flag
const store={ref:null,last:0};
const r2=x=>Math.round(x*100)/100;
const money=x=>'$'+r2(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function applySaved(d){
  if(!d||typeof d!=='object') return;
  if(typeof d.bank==='number') P.bank=d.bank;
  if(typeof d.start==='number') P.start=d.start;
  if(Array.isArray(d.bets)) P.bets=d.bets;
  if(Array.isArray(d.saved)) P.saved=d.saved;
  if(typeof d.tpl==='string') P.tpl=d.tpl;
  if(typeof d.seq==='number') P.seq=d.seq;
  if(d.live&&typeof d.live==='object') P.live=d.live;
}
let saveT=null;
function persist(){ clearTimeout(saveT); saveT=setTimeout(doSave,600); }
function doSave(){
  let json=''; try{ json=JSON.stringify(P); }catch(e){ return; }
  try{ localStorage.setItem(KEY,json); }catch(e){}
  if(store.ref){
    const wait=8000-(Date.now()-store.last);
    if(wait>0){ clearTimeout(saveT); saveT=setTimeout(doSave,wait); return; }
    store.last=Date.now();
    try{ store.ref.set({json:json,updated:Date.now()}).catch(()=>{}); }catch(e){}
  }
}
window.addEventListener('pagehide',()=>{ try{ localStorage.setItem(KEY,JSON.stringify(P)); }catch(e){} });
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'){ try{ localStorage.setItem(KEY,JSON.stringify(P)); }catch(e){} if(store.ref){ store.last=0; doSave(); } } });
async function initStore(){
  let loaded=false;
  try{
    const c=window.claude;
    if(c&&c.use){
      const [db,user]=await Promise.all([c.use('db'),c.use('user')]);
      if(db&&user){
        const id=await user.id();
        if(id){
          store.ref=db.collection('data/users/'+id).doc('practice');
          const snap=await store.ref.get();
          if(snap.exists){ const d=snap.data(); if(d&&d.json){ applySaved(JSON.parse(d.json)); loaded=true; } }
        }
      }
    }
  }catch(e){ store.ref=null; }
  if(!loaded){ try{ const raw=localStorage.getItem(KEY); if(raw){ applySaved(JSON.parse(raw)); } }catch(e){} }
  Object.keys(P.live).forEach(gid=>{ if(G[gid]) restoreSim(gid); });
  render();
  if(store.ref) doSave();
}

/* ================= math ================= */
function erf(x){ const s=x<0?-1:1; x=Math.abs(x); const t=1/(1+0.3275911*x); const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x); return s*y; }
const phi=x=>0.5*(1+erf(x/Math.SQRT2));
function poisGE(k,l){ if(k<=0) return 1; if(l<=0) return 0; let term=Math.exp(-l),cdf=term; for(let i=1;i<k;i++){ term*=l/i; cdf+=term; } return clamp(1-cdf,0,1); }
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return((t^t>>>14)>>>0)/4294967296; }; }
function gauss(rng){ let u=0; while(u===0) u=rng(); const v=rng(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
function poisson(rng,l){ if(l<=0) return 0; const L=Math.exp(-l); let k=0,p=1; do{ k++; p*=rng(); }while(p>L&&k<80); return k-1; }

/* ================= game clock ================= */
const SDM={nfl:13.5,wnba:11.5,mlb:4.3,cfb:18,nba:14.5,cbb:13.5};      // sd of a final margin
const SDT={nfl:13.5,wnba:17,mlb:4.4,cfb:16.5,nba:18.8,cbb:17.5};        // sd of a final total
const TEAM_SD={nfl:9.5,wnba:10.5,mlb:2.9,cfb:12,nba:11,cbb:9.5};
const SECS={nfl:3600,wnba:2400,cfb:3600,nba:2880,cbb:2400};
const KAPPA_T=0.6;
function clockLabel(lg,f){
  if(f>=1) return 'Final';
  if(f<=0) return 'Pregame';
  if(lg==='mlb'){ const h=Math.floor(f*18+1e-9); const inn=Math.floor(h/2)+1; const outs=Math.min(2,Math.floor((f*18-h)*3+1e-9)); return (h%2?'Bot ':'Top ')+inn+(inn===1?'st':inn===2?'nd':inn===3?'rd':'th')+', '+outs+' out'+(outs===1?'':'s'); }
  const tot=SECS[lg], len=tot/4, el=f*tot; const q=Math.min(4,Math.floor(el/len)+1); const rem=Math.max(0,Math.round(len-(el-(q-1)*len)));
  return 'Q'+q+' '+Math.floor(rem/60)+':'+String(rem%60).padStart(2,'0');
}
function fFromManual(lg,m){
  if(lg==='mlb'){ const inn=clamp(+m.inn||1,1,9), half=m.half==='bot'?1:0, outs=clamp(+m.outs||0,0,2); return clamp(((inn-1)*2+half+outs/3)/18,0,0.9999); }
  const tot=SECS[lg], len=tot/4; const q=clamp(+m.q||1,1,4); const rem=clamp((+m.min||0)*60+(+m.sec||0),0,len); return clamp(((q-1)*len+(len-rem))/tot,0,0.9999);
}

/* ================= practice game simulator ================= */
const COMP={pr:['passYds','rushYds'],rr:['rushYds','recYds'],pra:['pts','reb','ast'],hrr:['hits','runs','rbi']};
const YDS={passYds:1,rushYds:1,recYds:1};
const statOf=(pl,k)=>pl.stats.find(s=>s.key===k);
const muTruth=s=>0.65*s.proj+0.35*(s.season!=null?s.season:s.proj);
function drawStat(rng,s){ const m=Math.max(0.02,muTruth(s)); if(m<8) return poisson(rng,m); return Math.max(0,Math.round(m+s.sd*gauss(rng))); }
function unitEvents(rng,F,lo,hi){ const a=[]; for(let i=0;i<F;i++) a.push({t:lo+(hi-lo)*rng(),d:1}); return a.sort((x,y)=>x.t-y.t); }
function chunkEvents(rng,F){
  if(F<=0) return [];
  const k=clamp(Math.round(Math.sqrt(F)/1.6)+1,1,18); const w=[]; let sw=0; for(let i=0;i<k;i++){ const x=-Math.log(1-rng()*0.999)+0.15; w.push(x); sw+=x; }
  let used=0; const d=w.map((x,i)=>{ const v=i===k-1?F-used:Math.max(1,Math.round(F*x/sw)); used+=v; return v; });
  const ts=[]; for(let i=0;i<k;i++) ts.push(rng()); ts.sort((a,b)=>a-b);
  return ts.map((t,i)=>({t:0.01+0.98*t,d:d[i]})).filter(e=>e.d>0);
}
function genPlayer(g,pl,rng){
  const lg=g.lg; const rec={pid:pl.id,act:true,goneAt:null,ev:{}};
  if(pl.avail<=0) rec.act=false; else if(rng()>pl.avail) rec.act=false;
  if(!rec.act) return rec;
  const k=pl.status.kind; const pInj=0.03*(k==='ok'?1:k==='probable'?1.3:2.2);
  if(rng()<pInj) rec.goneAt=0.2+0.6*rng();
  const has=key=>statOf(pl,key);
  if(lg==='wnba'){
    const fg3=has('fg3')?drawStat(rng,has('fg3')):0; let pts=has('pts')?drawStat(rng,has('pts')):0;
    if(pts<3*fg3) pts=3*fg3+Math.floor(rng()*5);
    const rest=pts-3*fg3; let ft=Math.min(rest,poisson(rng,rest*0.17)); const twos=Math.floor((rest-ft)/2); ft+=(rest-ft)%2;
    const plays=[]; for(let i=0;i<fg3;i++) plays.push(3); for(let i=0;i<twos;i++) plays.push(2); for(let i=0;i<ft;i++) plays.push(1);
    const evs=plays.map(d=>({t:0.01+0.98*rng(),d:d})).sort((a,b)=>a.t-b.t);
    rec.ev.pts=evs; rec.ev.fg3=evs.filter(e=>e.d===3).map(e=>({t:e.t,d:1}));
    ['reb','ast'].forEach(key=>{ if(has(key)) rec.ev[key]=unitEvents(rng,drawStat(rng,has(key)),0.01,0.99); });
  } else if(lg==='mlb' && pl.fam==='P'){
    let outs=has('outs')?clamp(drawStat(rng,has('outs')),3,27):15; let kk=has('k')?drawStat(rng,has('k')):0; kk=Math.min(kk,outs);
    const span=Math.min(0.95,outs/27+0.1); const ot=[]; for(let i=0;i<outs;i++) ot.push({t:0.02+(i+rng())/outs*span,d:1});
    rec.ev.outs=ot; const idx=ot.map((_,i)=>i); for(let i=idx.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); const x=idx[i]; idx[i]=idx[j]; idx[j]=x; }
    rec.ev.k=idx.slice(0,kk).sort((a,b)=>a-b).map(i=>({t:ot[i].t,d:1}));
  } else if(lg==='mlb'){
    const hits=has('hits')?Math.min(5,drawStat(rng,has('hits'))):0; const he=unitEvents(rng,hits,0.02,0.98); rec.ev.hits=he;
    let extra=0; if(hits>0&&has('tb')&&has('hits')) extra=Math.min(3*hits,poisson(rng,Math.max(0.1,muTruth(has('tb'))-muTruth(has('hits')))));
    const tbE=he.map(e=>({t:e.t,d:1})); for(let i=0;i<extra;i++){ tbE[Math.floor(rng()*tbE.length)].d+=1; } rec.ev.tb=tbE;
    ['runs','rbi'].forEach(key=>{ if(has(key)) rec.ev[key]=unitEvents(rng,Math.min(4,drawStat(rng,has(key))),0.02,0.98); });
  } else {
    pl.stats.forEach(s=>{ if(COMP[s.key]) return; const F=drawStat(rng,s); rec.ev[s.key]=YDS[s.key]?chunkEvents(rng,F):unitEvents(rng,F,0.01,0.99); });
  }
  if(rec.goneAt!=null) Object.keys(rec.ev).forEach(key=>{ rec.ev[key]=rec.ev[key].filter(e=>e.t<=rec.goneAt); });
  return rec;
}
function genSim(g,seed){
  const rng=mulberry32(seed); const lg=g.lg, cr=g.crossroads, ln=g.lines;
  const sim={seed:seed,pl:{},plays:{home:[],away:[]},ot:false,final:null};
  g.players.forEach(pl=>{ sim.pl[pl.id]=genPlayer(g,pl,rng); });
  const bookM=-ln.sprHome, bookT=ln.total; const bH=(bookT+bookM)/2, bA=(bookT-bookM)/2;
  const means={home:0.65*cr.projHome+0.35*bH, away:0.65*cr.projAway+0.35*bA};
  ['home','away'].forEach(side=>{
    const m=Math.max(0.5,means[side]); let T;
    if(lg==='mlb') T=poisson(rng,m*Math.exp(0.25*gauss(rng))); else T=Math.max(0,Math.round(m+TEAM_SD[lg]*gauss(rng)));
    const plays=sim.plays[side];
    if(lg==='nfl'){
      if(T===1) T=rng()<0.5?0:3;
      let rem=T; while(rem>0){ const opts=[[7,0.5],[3,0.3],[6,0.07],[2,0.04],[8,0.05]].filter(o=>o[0]<=rem&&rem-o[0]!==1); if(!opts.length){ plays.push({t:rng(),d:rem}); break; } let r=rng()*opts.reduce((s,o)=>s+o[1],0),c=opts[0][0]; for(const o of opts){ r-=o[1]; if(r<=0){ c=o[0]; break; } } rem-=c; plays.push({t:0.02+0.97*rng(),d:c}); }
    } else if(lg==='wnba'){
      const pls=g.players.filter(p=>p.side===side); let sum=0;
      pls.forEach(p=>{ const e=sim.pl[p.id]; if(e.ev.pts) e.ev.pts.forEach(x=>{ plays.push({t:x.t,d:x.d,pid:p.id}); sum+=x.d; }); });
      let bench=T-sum; if(bench<6) bench=6+Math.floor(rng()*9);
      while(bench>0){ const d=Math.min(bench,rng()<0.2?3:rng()<0.25?1:2); bench-=d; plays.push({t:0.02+0.97*rng(),d:d}); }
    } else {
      for(let i=0;i<T;i++){ const inn=Math.floor(rng()*9); const slot=side==='away'?2*inn:2*inn+1; plays.push({t:(slot+rng())/18,d:1}); }
    }
    plays.sort((a,b)=>a.t-b.t);
  });
  const fin=scoreAtSim(g,sim,1);
  if(fin.home===fin.away){ sim.ot=true; const side=rng()<0.5?'home':'away'; sim.plays[side].push({t:1,d:lg==='nfl'?3:lg==='wnba'?2:1}); }
  sim.final=scoreAtSim(g,sim,1);
  sim.timeline=buildTimeline(g,sim);
  return sim;
}
function cumEv(arr,f){ let s=0; for(let i=0;i<arr.length;i++){ if(arr[i].t<=f) s+=arr[i].d; else break; } return s; }
function baseCum(sim,pid,key,f){ const e=sim.pl[pid]; if(!e||!e.act) return 0; return e.ev[key]?cumEv(e.ev[key],f):0; }
function floorOf(g,sim,side,f){
  const lg=g.lg; let fl=0;
  if(lg==='nfl'){ g.players.forEach(p=>{ if(p.side===side) fl+=6*baseCum(sim,p.id,'passTD',f); }); }
  else if(lg==='mlb'){ let ru=0,rb=0; g.players.forEach(p=>{ if(p.side===side&&p.fam!=='P'){ ru+=baseCum(sim,p.id,'runs',f); rb+=baseCum(sim,p.id,'rbi',f); } }); fl=Math.max(ru,rb); }
  return fl;
}
function scoreAtSim(g,sim,f){
  const out={};
  ['home','away'].forEach(side=>{ out[side]=Math.max(cumEv(sim.plays[side],f),floorOf(g,sim,side,f)); });
  return out;
}
function buildTimeline(g,sim){
  const tl=[]; const lg=g.lg;
  g.players.forEach(pl=>{
    const e=sim.pl[pl.id]; const nm=surname(pl.name);
    if(!e.act){ tl.push({t:0,text:nm+' is inactive tonight ('+pl.status.label+')',kind:'inj'}); return; }
    pl.stats.forEach(st=>{
      if(COMP[st.key]) return; const arr=e.ev[st.key]||[]; let tot=0;
      arr.forEach(x=>{ tot+=x.d; if(lg==='wnba'&&st.key==='fg3') return; tl.push({t:x.t,text:nm+' '+(YDS[st.key]?'+'+x.d+' '+st.label.toLowerCase():st.label.toLowerCase()+(x.d>1?' +'+x.d:''))+' ('+tot+')',kind:'stat'}); });
    });
    if(e.goneAt!=null) tl.push({t:e.goneAt,text:nm+' leaves the game with an injury and will not return',kind:'inj'});
  });
  if(lg==='nfl') ['home','away'].forEach(side=>{ sim.plays[side].forEach(x=>{ tl.push({t:x.t,text:g.teams[side].abbr+' '+(x.d>=6?'touchdown':x.d===3?'field goal':'score')+' (+'+x.d+')',kind:'score'}); }); });
  if(lg==='mlb') ['home','away'].forEach(side=>{ sim.plays[side].forEach(x=>{ tl.push({t:x.t,text:g.teams[side].abbr+' run scores',kind:'score'}); }); });
  if(lg==='wnba') ['home','away'].forEach(side=>{ sim.plays[side].forEach(x=>{ if(!x.pid) tl.push({t:x.t,text:g.teams[side].abbr+' bench '+(x.d===3?'three':x.d===1?'free throw':'basket')+' (+'+x.d+')',kind:'score'}); }); });
  if(sim.ot) tl.push({t:1,text:'Tied after regulation: decided in overtime',kind:'score'});
  return tl.sort((a,b)=>a.t-b.t);
}
function LS(gid){
  if(!P.live[gid]) P.live[gid]={mode:'feed',seed:0,f:0,speed:3,started:false,done:false,man:{q:1,min:15,sec:0,inn:1,half:'top',outs:0,home:0,away:0,cur:{},gone:{},act:{},final:false}};
  return P.live[gid];
}
function restoreSim(gid){
  const g=G[gid], L=LS(gid); if(!RT[gid]) RT[gid]={running:false,sim:null};
  if(L.mode==='sim'&&L.started&&L.seed){ RT[gid].sim=genSim(g,L.seed); }
}
function startSim(gid){
  const g=G[gid], L=LS(gid); if(!RT[gid]) RT[gid]={running:false,sim:null};
  L.seed=(Date.now()%2147483647)+Math.floor(Math.random()*1000); L.f=0; L.started=true; L.done=false; L.mode='sim';
  RT[gid].sim=genSim(g,L.seed); RT[gid].running=true; L.msg='';
}
/* derived live state: score, current stats, who is in/out */
function stateOf(g){
  const L=LS(g.id); const rt=RT[g.id]||{};
  const st={f:L.mode==='sim'?L.f:fFromManual(g.key||g.lg,L.man),home:0,away:0,cur:{},act:{},gone:{},started:L.mode==='sim'?L.started:feedStarted(g.id),final:false,mode:L.mode};
  if(L.mode==='sim'){
    st.final=L.done; const sim=rt.sim;
    if(sim&&L.started){
      const sc=scoreAtSim(g,sim,L.f); st.home=sc.home; st.away=sc.away;
      g.players.forEach(pl=>{
        const e=sim.pl[pl.id]; st.act[pl.id]=e.act?'in':'dnp'; st.gone[pl.id]=e.goneAt!=null&&L.f>=e.goneAt;
        const c={}; pl.stats.forEach(s=>{ c[s.key]=COMP[s.key]?COMP[s.key].reduce((a,k)=>a+baseCum(sim,pl.id,k,L.f),0):baseCum(sim,pl.id,s.key,L.f); }); st.cur[pl.id]=c;
      });
    } else g.players.forEach(pl=>{ st.act[pl.id]='unk'; st.gone[pl.id]=false; st.cur[pl.id]={}; pl.stats.forEach(s=>{ st.cur[pl.id][s.key]=0; }); });
  } else {
    const m=L.man; st.home=+m.home||0; st.away=+m.away||0; st.final=!!m.final;
    g.players.forEach(pl=>{
      st.act[pl.id]=m.act[pl.id]||'unk'; st.gone[pl.id]=!!m.gone[pl.id];
      const c={}; const mc=m.cur[pl.id]||{};
      pl.stats.forEach(s=>{ c[s.key]=COMP[s.key]?COMP[s.key].reduce((a,k)=>a+(+mc[k]||0),0):(+mc[s.key]||0); }); st.cur[pl.id]=c;
    });
  }
  return st;
}
function finalOf(g){
  const L=LS(g.id); const st=stateOf(g);
  const F={home:st.home,away:st.away,stat:{},played:{}};
  if(L.mode==='sim'&&RT[g.id]&&RT[g.id].sim){ const s=scoreAtSim(g,RT[g.id].sim,1); F.home=s.home; F.away=s.away;
    g.players.forEach(pl=>{ const e=RT[g.id].sim.pl[pl.id]; F.played[pl.id]=e.act; const c={}; pl.stats.forEach(s2=>{ c[s2.key]=COMP[s2.key]?COMP[s2.key].reduce((a,k)=>a+baseCum(RT[g.id].sim,pl.id,k,1),0):baseCum(RT[g.id].sim,pl.id,s2.key,1); }); F.stat[pl.id]=c; });
  } else {
    g.players.forEach(pl=>{ F.played[pl.id]=st.act[pl.id]!=='dnp'&&st.act[pl.id]!=='out'; F.stat[pl.id]=st.cur[pl.id]; });
  }
  return F;
}

/* ================= live probability engine ================= */
// useModel=true: my model (injury-adjusted projection, matchup, last-10 form, quick pace response).
// useModel=false: the practice "market" baseline: book totals / season averages with a slow pace response. Prices come from the baseline.
function teamProbs(g,st,useModel){
  const cr=g.crossroads, ln=g.lines, lg=g.key||g.lg;
  const f=st.f, r=Math.max(0,1-f); const m=st.home-st.away, tot=st.home+st.away;
  const muM=useModel?cr.projMargin:-ln.sprHome, muT=useModel?cr.projTotal:ln.total;
  let remM=r*muM; let remT=(muT*KAPPA_T+tot)/(KAPPA_T+f)*r - 0; // pace-adjusted remaining total
  const C=useModel?ctxOf(g,st):CTX_NEUTRAL; let dH=0,dA=0;
  if(C.on){
    const hRem=r*cr.projHome, aRem=r*cr.projAway;
    dH=hRem*(C.home.mult-1)+C.home.add; dA=aRem*(C.away.mult-1)+C.away.add;
    const dP=Math.max(0,remT+dH+dA)*(C.pace.mult-1);
    remM+=dH-dA; remT+=dH+dA+dP; dH+=dP/2; dA+=dP/2;
  }
  const sdM=Math.max(SDM[lg]*Math.sqrt(r),0.0001), sdT=Math.max(SDT[lg]*Math.sqrt(r),0.0001);
  const fm=m+remM, ft=tot+remT;
  const done=st.final||r<=0;
  const win=done?(m>0?1:m<0?0:0.5):phi(fm/sdM);
  const cover=line=>done?((m+line)>0?1:(m+line)<0?0:0.5):phi((fm+line)/sdM);
  const over=line=>done?(tot>line?1:0):1-phi((line-ft)/sdT);
  return {win:win,cover:cover,over:over,projMargin:fm,projTotal:ft,ctx:C,projHome:st.home+r*(useModel?cr.projHome:(ln.total-ln.sprHome)/2)+dH,projAway:st.away+r*(useModel?cr.projAway:(ln.total+ln.sprHome)/2)+dA};
}
function propProb(g,st,pl,s,T,useModel){
  // probability the final stat is at least T. returns null when bets are void (did not play)
  const a=st.act[pl.id]; if(a==='dnp'||a==='out') return null;
  const c=(st.cur[pl.id]||{})[s.key]||0; const need=T-c; if(need<=0) return 1;
  if(st.gone[pl.id]||st.final) return 0;
  const f=st.f, r=Math.max(0,1-f); if(r<=0) return 0;
  const prior=useModel?s.proj:(s.season!=null?s.season:s.proj); const kap=useModel?KAP_MODEL:KAP_BASE;
  const rate=(prior*kap+c)/(kap+f); const mu=rate*r*(useModel?ctxPropMult(g,st,pl,s):1);
  let p;
  if(mu<8) p=poisGE(Math.ceil(need-1e-9),mu);
  else { const sd=Math.sqrt(Math.max(s.sd*s.sd*r,mu*0.9)); p=1-phi((need-0.5-mu)/sd); }
  if(useModel){ const h=histRate(pl,s,T); if(h!=null){ const w=0.3*r; p=(1-w)*p+w*h; } }   // last-10 history of reaching T in a full game
  if(a==='unk') p*=pl.avail;
  return clamp(p,0,1);
}
const KAP_MODEL=2.5, KAP_BASE=5;
const LIVE_P=0.60;
function LIVE_MIN_P(){ return (typeof S!=='undefined'&&S.lvAll)?0.06:LIVE_P; }
function histRate(pl,s,T){
  let n=0,h=0; for(let i=0;i<s.v15.length;i++){ const sl=pl.slots[i]; if(s.v15[i]==null||!sl||sl.model===false) continue; n++; if(s.v15[i]>=T) h++; }
  return n>=3?(h+0.5)/(n+1):null;
}
function propMu(g,st,pl,s,useModel){
  const c=(st.cur[pl.id]||{})[s.key]||0; const f=st.f, r=Math.max(0,1-f);
  const prior=useModel?s.proj:(s.season!=null?s.season:s.proj); const kap=useModel?KAP_MODEL:KAP_BASE;
  return (prior*kap+c)/(kap+f)*r*(useModel?ctxPropMult(g,st,pl,s):1);
}
function ladder(g,st,pl,s){
  // dynamic "T or more" targets near the expected final
  const c=(st.cur[pl.id]||{})[s.key]||0; const mu=c+propMu(g,st,pl,s,true);
  const step=mu>=150?25:mu>=60?10:mu>=22?5:mu>=9?2:1;
  const start=Math.max(step,Math.ceil((c+0.001)/step)*step);
  const lo=LIVE_MIN_P(), arr=[]; for(let k=0;k<9;k++){ const T=start+k*step; if(T<=c) continue; const p=propProb(g,st,pl,s,T,true); if(p==null) return []; if(p>=Math.min(lo,0.06)&&p<=0.97&&p>=lo) arr.push({T:T,p:p}); }
  arr.sort((a,b)=>Math.abs(a.p-0.68)-Math.abs(b.p-0.68)); return arr.slice(0,4).sort((a,b)=>a.T-b.T);
}
