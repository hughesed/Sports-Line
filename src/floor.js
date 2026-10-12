/* ================= Floor legs: the "he gets at least this much almost every week" picks =================
   The kind of leg that fills a winning slip: "Makai Lemon 2+ receptions", "Parker Washington 3+ receptions", "Makai Lemon 10+ yards" ... a low rung on a volume stat (receptions,
   receiving / rushing / passing yards, carries, completions, shots, strikeouts ...) where the player's projection sits far above the number and he has cleared it in nearly every recent game.
   The model ladder of a slate player (stat.miles) carries no chance of its own (only FanDuel-only players get one), so every rung is scored here:
     - model   = the lower of a normal and (for counts) a Poisson chance around the player's projection, with at least a Poisson-sized spread
     - record  = (clears + 1) / (games + 2) over the last 15 games, counting for more the more games there are
     - the player's own availability multiplies it, and the app's measured accuracy (adjP, and the learned floor factor in stacks.js) scales it
   A rung counts as a floor leg when: the player is active and nearly certain to play, the number is at most 70% of his projection, he has cleared it in all but at most 15% of his recent games,
   and the chance is 86%+ (90%+ when there is no game log at all). For each player and stat the HIGHEST rung that still passes is used, because it pays the most for the same safety.
   Floor legs are marked floor:true and are used by the same-game parlays (home_picks.js) and the stacks, including a "Floor 6" stack of only these legs (stacks.js). Practice only. */
const FL={min:0.86,minNoLog:0.90,cushion:0.70,weight:8,missRate:0.15,minAvail:0.95,cache:new WeakMap()};
const FL_RARE={passTD:1,td:1,anytd:1,hr:1,int:1,sacks:1};      // rare events never form a floor
/* spread of a yardage stat relative to its projection (same values the engine uses for FanDuel-only players); counts use a Poisson-sized spread, widened 15% because catches and shots clump */
const FL_REL={passYds:0.28,rushYds:0.55,recYds:0.62,rr:0.5,pr:0.3};
/* estimated price of a floor rung: the app's usual estimate (4.5% margin on the chance) but without estPrice's -1000 floor, which would pay a 93% leg more than fair and flatter a parlay of them */
const flPrice=p=>{ const q=clamp(p*1.045,0.03,0.97); return -Math.min(2500,Math.round(100*q/(1-q))); };
const flMu=st=>{ const m=+(st.proj!=null?st.proj:st.avg); return isFinite(m)&&m>0?m:null; };
const flSd=(st,mu)=>Math.max(+st.sd||0,FL_REL[st.key]!=null?FL_REL[st.key]*mu:mu<8?1.15*Math.sqrt(mu):0.4*mu,0.5);
/* chance that the player reaches t or more: {p, pm (model only), h (games at or above t), n (games), mu} */
function flRungP(pl,st,t){
  const mu=flMu(st); if(mu==null) return null;
  const vals=(st.v15||[]).filter(x=>x!=null), n=vals.length, h=vals.filter(x=>x>=t).length;
  const sd=flSd(st,mu);
  const pN=1-phi((t-0.5-mu)/sd), pm=(mu<8&&FL_REL[st.key]==null)?Math.min(pN,poisGE(t,mu)):pN;
  const w=n/(n+FL.weight), p0=n?(w*((h+1)/(n+2))+(1-w)*pm):pm;
  return {p:clamp(p0*(pl.avail==null?1:pl.avail),0.02,0.97),pm:pm,h:h,n:n,mu:mu};
}
/* the highest rung of one stat that still passes every floor test, or null */
function flFloorRung(pl,st){
  if(!st||FL_RARE[st.key]) return null; const mu=flMu(st); if(mu==null) return null;
  if(pl.status&&pl.status.kind==='out') return null; if((pl.avail==null?1:pl.avail)<FL.minAvail) return null;
  let best=null;
  (st.miles||[]).forEach(m=>{
    if(!m||m.t==null) return; const t=+m.t; if(!(t>=1)||t>FL.cushion*mu) return;
    const r=flRungP(pl,st,t); if(!r) return;
    if(r.n>=3&&(r.n-r.h)>Math.floor(FL.missRate*r.n)) return;               // missed it more than ~15% of the time lately
    if(r.p<(r.n>=3?FL.min:FL.minNoLog)) return;
    if(!best||t>best.t) best={t:t,price:m.price,r:r};
  });
  return best;
}
/* floor legs of one game, in the same shape the parlay builders use for threshold legs */
function flLegs(g){
  const cv=(typeof CALV==='number')?CALV:0, hit=FL.cache.get(g); if(hit&&hit.v===cv) return hit.out;
  const out=[];
  (g.players||[]).forEach(pl=>{
    (pl.stats||[]).forEach(st=>{
      const f=flFloorRung(pl,st); if(!f) return;
      const r=f.r, p=(typeof adjP==='function')?adjP(r.p,'prop'):r.p, priced=f.price!=null, tok='o:'+g.id+':alt:'+pl.id+':'+st.key+':'+f.t;
      const lab=String(st.label||st.key).toLowerCase();
      out.push({id:tok,tok:tok,gid:g.id,kind:'alt',floor:true,label:surname(pl.name)+' '+f.t+'+ '+lab,price:priced?f.price:flPrice(p),book:priced?'draftkings':'est',bk:priced?'DK':'est.',link:null,nBooks:0,line:f.t-0.5,
        pFair:null,pModel:r.pm,p:p,ps:p,avail:1,src:priced?'DK':'est.',spec:{k:'prop',pid:pl.id,stat:st.key,T:f.t,dir:'ge'},group:g.id+':'+pl.id+':'+st.key,pid:pl.id,
        proj:r.mu,hh:r.h,hn:r.n,why:'Floor leg: projects '+(Math.round(r.mu*10)/10)+' '+lab+' against a number of '+f.t+(r.n?', and he has reached it in '+r.h+' of his last '+r.n+' games':', no game log, so this is the model alone')+'.'});
    });
  });
  out.sort((a,b)=>b.p-a.p);
  FL.cache.set(g,{v:cv,out:out}); return out;
}
try{ if(window.__LS) window.__LS.fl={FL:FL,rungP:flRungP,floorRung:flFloorRung,legs:flLegs}; }catch(e){}
