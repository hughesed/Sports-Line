/* ================= Main players: the legs a slip is built around =================
   A winning slip looks like this: QBs, lead backs and the top receivers, each at a number a little below the projection ("Allen 200+ pass yds", "Nacua 80+ rec yds",
   "Cook 80+ rush+rec yds", "Shakir 3+ rec", "Stafford 2+ pass TD"), not a depth player's tiny number. Three things kept the builders away from that:
     1. they ranked legs by raw chance, so a 93% leg on a backup beat a 70% leg on the starter;
     2. the ladder only offered the two rungs nearest the book's line, and rush+rec yards, pass+rush yards and pass TDs had no ladder at all;
     3. any player on the slate could be used, backups and third receivers included.
   This file fixes the inputs for all builders (same-game parlays, stacks, floor legs, safe slips):
     stMain(g,pl)       is the player a main player of his team in this game? Ranked by projected volume among teammates who are playing, so when a starter is out the next man up counts.
                        NFL / college football: QB1, RB1 (RB2 only when he is close to RB1), the top 3 pass catchers (a 4th when he is close to the 3rd).
                        Basketball: the top 6 scorers. Baseball: all pitchers and the top 6 hitters. Anything else (feed-only players, no projection): treated as main.
     stScore(p)         how much a builder wants a leg of chance p: rises with p up to 75%, then falls, so a 93% leg that pays almost nothing does not beat a 72% leg.
     stAltLegs(g,pl,st) per main player and stat, the highest rung that is still about 72%+ ("solid") and the highest that is still about 60%+ ("reach"), from the book's ladder when it has
                        one and from the model when it does not (rush+rec, pass+rush, carries, completions, pass TDs).
   Practice only. */
const ST={cache:new WeakMap(),peak:0.75,drop:0.6,solid:0.72,reach:0.60,pMin:0.55,pMax:0.88,ratioMin:0.45};
/* rung spacing for stats the book ladder does not cover (yards: step; counts: 1) */
const ST_STEP={rr:5,pr:10};
const ST_COUNT={comp:1,carries:1,passTD:1};
const stNum=(pl,k)=>{ const s=(pl.stats||[]).find(x=>x.key===k); if(!s) return null; const m=+(s.proj!=null?s.proj:s.avg); return isFinite(m)?m:null; };
const stOut=pl=>!!(pl.status&&pl.status.kind==='out')||(pl.avail!=null&&pl.avail<0.5);
function stCalc(g){
  const key=keyOf(g), res={}, side={};
  (g.players||[]).forEach(pl=>{ if(pl.feed||stOut(pl)) return; (side[pl.side]=side[pl.side]||[]).push(pl); });
  /* mark the top `keep` of arr (by score) as main, plus up to `extra` more whose score is at least `rel` of the best */
  const mark=(arr,score,keep,extra,rel)=>{
    const xs=arr.map(p=>({p:p,s:score(p)})).filter(x=>x.s!=null&&x.s>0).sort((a,b)=>b.s-a.s);
    xs.forEach((x,i)=>{ res[x.p.id]={main:(i<keep)||(i<keep+(extra||0)&&x.s>=(rel||0.7)*xs[0].s),lead:i===0?1:i===1?0.6:i===2?0.3:0}; });      // lead: QB1 / RB1 / WR1 count most, then the next in line
  };
  Object.keys(side).forEach(sd=>{ const ps=side[sd];
    if(key==='nfl'||key==='cfb'){
      mark(ps.filter(p=>p.pos==='QB'),p=>stNum(p,'passYds'),1,0,0);
      mark(ps.filter(p=>p.fam==='RB'||p.pos==='RB'||p.pos==='FB'),p=>{ const r=stNum(p,'rr'); if(r!=null) return r; const a=stNum(p,'rushYds'),b=stNum(p,'recYds'); return a==null&&b==null?null:(a||0)+(b||0); },1,1,0.6);
      mark(ps.filter(p=>p.pos!=='QB'&&p.fam!=='RB'&&p.pos!=='RB'&&p.pos!=='FB'),p=>stNum(p,'recYds'),3,1,0.8);
    } else if(key==='nba'||key==='wnba'||key==='cbb'){
      mark(ps,p=>stNum(p,'pts'),6,0,0);
    } else if(key==='mlb'){
      ps.filter(p=>p.fam==='P').forEach(p=>{ res[p.id]={main:true,lead:1}; });
      mark(ps.filter(p=>p.fam!=='P'),p=>{ const h=stNum(p,'hrr'); return h!=null?h:stNum(p,'tb'); },6,0,0);
    }
  });
  return res;
}
/* true when the player is a main player of his team in this game (and true for anyone the ranking cannot judge, so nothing disappears by accident) */
function stMain(g,pl){
  if(!g||!pl) return false; let r=ST.cache.get(g); if(!r){ try{ r=stCalc(g); }catch(e){ r={}; } ST.cache.set(g,r); }
  const v=r[pl.id]; return v===undefined?true:v.main;
}
/* 1 for the top player of his group (QB1, RB1, WR1, the top scorer), 0.6 and 0.3 for the next two, 0 for everyone else: builders add a small bonus for it */
function stLead(g,pl){ if(!g||!pl) return 0; stMain(g,pl); const r=ST.cache.get(g)||{}, v=r[pl.id]; return v?v.lead:0; }
/* how much a builder wants a leg of chance p: p itself up to the peak, then it falls (a 93% leg scores below a 75% one) */
const stScore=p=>p<=ST.peak?p:ST.peak-ST.drop*(p-ST.peak);

/* every rung of one stat with a chance: the book's ladder where it has one, otherwise rungs from the model's projection */
function stRungSet(pl,st){
  const mu=(typeof flMu==='function')?flMu(st):null; if(mu==null||typeof flRungP!=='function') return [];
  const have={}, raw=[];
  (st.miles||[]).forEach(m=>{ if(m&&m.t!=null&&+m.t>=1){ have[+m.t]=1; raw.push({t:+m.t,price:m.price,p:m.p}); } });
  if(raw.length<3){
    const step=ST_STEP[st.key], cnt=ST_COUNT[st.key];
    if(step){ for(let t=Math.ceil(0.4*mu/step)*step;t<=1.15*mu;t+=step) if(t>=1&&!have[t]) raw.push({t:t,price:null,p:null}); }
    else if(cnt){ for(let t=Math.max(1,Math.round(0.4*mu));t<=Math.ceil(1.25*mu);t++) if(!have[t]) raw.push({t:t,price:null,p:null}); }
  }
  return raw.map(m=>{ if(m.p!=null) return m; const r=flRungP(pl,st,+m.t); return r?{t:m.t,price:m.price,p:r.p,pm:r.pm}:null; }).filter(Boolean).sort((a,b)=>a.t-b.t);
}
/* the "solid" and "reach" rungs of one main player's stat, as parlay legs (same shape as the other threshold legs) */
function stAltLegs(g,pl,st,key){
  if(!st||!stMain(g,pl)||pl.status&&pl.status.kind==='out') return [];
  const mu=flMu(st); if(mu==null) return [];
  const lineT=st.line!=null?Math.floor(+st.line)+1:null;
  const cand=stRungSet(pl,st).filter(m=>m.t!==lineT&&m.t>=ST.ratioMin*mu&&m.p>=ST.pMin&&m.p<=ST.pMax).sort((a,b)=>b.t-a.t);        // highest number first
  const picks=[]; [cand.find(m=>m.p>=ST.solid),cand.find(m=>m.p>=ST.reach)].forEach(m=>{ if(m&&picks.indexOf(m)<0) picks.push(m); });
  const av=pl.avail==null?1:pl.avail, lab=String(st.label||st.key).toLowerCase(), out=[];
  picks.forEach(m=>{ const p=adjP(clamp(m.p*av,0.02,0.97),'prop'), priced=m.price!=null, tok='o:'+g.id+':alt:'+pl.id+':'+st.key+':'+m.t;
    out.push({id:tok,tok:tok,gid:g.id,kind:'alt',main:true,label:surname(pl.name)+' '+m.t+'+ '+lab,price:priced?m.price:estPrice(m.p),book:priced?'draftkings':'est',bk:priced?'DK':'est.',link:null,nBooks:0,line:m.t-0.5,
      pFair:null,pModel:m.p,p:p,ps:p,avail:1,src:priced?'DK':'est.',spec:{k:'prop',pid:pl.id,stat:st.key,T:m.t,dir:'ge'},group:g.id+':'+pl.id+':'+st.key,pid:pl.id,lead:stLead(g,pl),
      why:'Starter leg: projects '+(Math.round(mu*10)/10)+' '+lab+', and this number is '+Math.round(100*m.t/mu)+'% of that.'}); });
  return out;
}
try{ if(window.__LS) window.__LS.st={ST:ST,main:stMain,lead:stLead,score:stScore,rungs:stRungSet,alt:stAltLegs}; }catch(e){}
