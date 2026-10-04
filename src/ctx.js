/* ================= game context: pace, penalties, offense struggles ================= */
// Reads the live team stats (feed doc .ts) and turns them into small, shrunk adjustments to what each team
// is still expected to score, plus plain-language notes that are shown with each live bet.
const CTXC={};
const CTX_NEUTRAL={on:false,home:{mult:1,add:0,notes:[],off:0},away:{mult:1,add:0,notes:[],off:0},pace:{mult:1,note:'',ratio:1},notes:[]};
function ctxOf(g,st){
  const fd=(typeof FEED!=='undefined')?FEED[g.id]:null;
  if(!fd||!fd.ts||!fd.ts.home||!fd.ts.away||st.final||st.f<=0.04||st.f>=0.995) return CTX_NEUTRAL;
  const key=g.id+'|'+(fd.t||0)+'|'+Math.round(st.f*1000)+'|'+st.home+'-'+st.away;
  if(CTXC[key]) return CTXC[key];
  const lg=g.lg, K=g.key||g.lg, f=st.f, r=1-f, cr=g.crossroads, T=fd.ts;
  const FBK={nfl:{plmin:2.1,ypp:5.4,peny:0.85,ppd:1.9,len:60},cfb:{plmin:2.3,ypp:5.8,peny:0.95,ppd:2.1,len:60}}[K]||{plmin:2.1,ypp:5.4,peny:0.85,ppd:1.9,len:60};
  const BBK={wnba:{len:40,pace:3.95,ppp:1.02,fl:0.425},nba:{len:48,pace:4.2,ppp:1.15,fl:0.43},cbb:{len:40,pace:3.4,ppp:1.03,fl:0.43}}[K]||{len:40,pace:3.95,ppp:1.02,fl:0.425};
  const out={on:true,home:{mult:1,add:0,notes:[],off:0},away:{mult:1,add:0,notes:[],off:0},pace:{mult:1,note:'',ratio:1},notes:[]};
  const cl=(x,a,b)=>Math.max(a,Math.min(b,x));
  const sides=['home','away'];
  if(lg==='nfl'){
    const em=f*FBK.len, rm=r*FBK.len;
    const totPl=T.home.pl+T.away.pl;
    if(em>=8&&totPl>0){
      const ratio=(totPl/em)/FBK.plmin; const w=Math.min(1,f/0.45)*0.5; const m=1+cl((ratio-1)*w,-0.1,0.1);
      out.pace={mult:m,ratio:ratio,note:ratio>=1.08?'Fast pace: '+totPl+' plays in '+Math.round(em)+' minutes ('+n1(ratio*FBK.plmin*FBK.len)+' per game pace).':ratio<=0.92?'Slow pace: only '+totPl+' plays in '+Math.round(em)+' minutes ('+n1(ratio*FBK.plmin*FBK.len)+' per game pace), so fewer chances to score.':''};
    }
    sides.forEach(sd=>{
      const o=out[sd], t=T[sd], sc=sd==='home'?st.home:st.away, ab=g.teams[sd].abbr;
      if(t.pl>=10){
        const sh=t.pl/(t.pl+45); const yEff=((t.ypp-FBK.ypp)/FBK.ypp)*sh;
        const ppd=t.dr>0?sc/t.dr:FBK.ppd; const pEff=t.dr>=3?((ppd-FBK.ppd)/FBK.ppd)*(t.dr/(t.dr+8)):0;
        let eff=0.6*yEff+0.4*pEff; eff-=0.03*Math.max(0,t.to)*sh*2; eff-=0.012*Math.max(0,t.sk-2);
        o.off=cl(eff,-0.22,0.22); o.mult=1+0.6*o.off;
        if(t.ypp<=4.6&&t.pl>=20) o.notes.push(ab+' offense is struggling: '+t.ypp.toFixed(1)+' yards per play'+(t.dr>=4?' and '+sc+' points on '+t.dr+' drives':'')+(t.a3>=3?', '+t.c3+' of '+t.a3+' on third down':'')+'.');
        else if(t.ypp>=6.4&&t.pl>=20) o.notes.push(ab+' offense is rolling: '+t.ypp.toFixed(1)+' yards per play'+(t.a3>=3?', '+t.c3+' of '+t.a3+' on third down':'')+'.');
        else if(t.dr>=5&&ppd<=1.0) o.notes.push(ab+' has only '+sc+' points on '+t.dr+' drives.');
        if(t.to>=2) o.notes.push(ab+' has '+t.to+' turnovers.');
        if(t.sk>=4) o.notes.push(ab+' quarterback has taken '+t.sk+' sacks.');
      }
      const rate=(t.peny+FBK.peny*10)/(em+10); const exc=Math.max(0,(rate-FBK.peny)*rm); o.add=-cl(0.05*exc,0,3);
      if(t.pen>=7||t.peny>=60) o.notes.push(ab+' is hurting itself with penalties: '+t.pen+' for '+t.peny+' yards (about 5 for 45 is normal).');
    });
  } else if(lg==='wnba'){
    const em=f*BBK.len, rm=r*BBK.len;
    const poss={}; sides.forEach(sd=>{ const t=T[sd]; poss[sd]=t.fga+0.44*t.fta+t.tov-t.orb; });
    const totP=poss.home+poss.away;
    if(em>=6&&totP>0){
      const ratio=(totP/em)/BBK.pace; const w=Math.min(1,f/0.4)*0.6; const m=1+cl((ratio-1)*w,-0.1,0.1);
      out.pace={mult:m,ratio:ratio,note:ratio>=1.06?'Fast pace: about '+Math.round(totP/2)+' possessions each in '+Math.round(em)+' minutes.':ratio<=0.94?'Slow, grinding pace: about '+Math.round(totP/2)+' possessions each in '+Math.round(em)+' minutes.':''};
    }
    sides.forEach(sd=>{
      const o=out[sd], t=T[sd], sc=sd==='home'?st.home:st.away, ab=g.teams[sd].abbr, ps=poss[sd];
      if(ps>=15){
        const ppp=sc/ps; const sh=ps/(ps+60); const eff=((ppp-BBK.ppp)/BBK.ppp)*sh;
        o.off=cl(eff,-0.2,0.2); o.mult=1+0.7*o.off;
        if(ppp<=BBK.ppp*0.86) o.notes.push(ab+' offense is stuck: '+ppp.toFixed(2)+' points per possession ('+t.fg+'-'+t.fga+' shooting, '+t.tov+' turnovers).');
        else if(ppp>=BBK.ppp*1.13) o.notes.push(ab+' offense is humming: '+ppp.toFixed(2)+' points per possession.');
        if(t.tov>=ps*0.2&&t.tov>=6) o.notes.push(ab+' is turning it over ('+t.tov+').');
      }
      const rate=(t.fl+BBK.fl*6)/(em+6); const exc=Math.max(0,(rate-BBK.fl)*rm); o.add=-cl(0.45*exc,0,3);
      if(t.fl>=em*0.6&&t.fl>=12) o.notes.push(ab+' is in foul trouble: '+t.fl+' team fouls in '+Math.round(em)+' minutes.');
    });
  } else if(lg==='mlb'){
    const inn=f*9;
    const totPa=T.home.pa+T.away.pa;
    if(f>=0.2&&totPa>0){
      const ratio=(totPa/(f*18))/4.3; const m=1+cl((ratio-1)*0.5*Math.min(1,f/0.4),-0.1,0.1);
      out.pace={mult:m,ratio:ratio,note:ratio>=1.1?'Lots of traffic: '+totPa+' plate appearances so far.':ratio<=0.9?'Pitchers are in control: only '+totPa+' plate appearances so far.':''};
    }
    sides.forEach(sd=>{
      const o=out[sd], t=T[sd], ab=g.teams[sd].abbr;
      if(t.pa>=10){
        const sh=inn/(inn+3); const br=(t.h+t.bb)/Math.max(1,inn); const kr=t.pa?t.k/t.pa:0.22;
        let eff=((br-1.26)/1.26)*sh-(kr-0.22)*0.5*sh; o.off=cl(eff,-0.2,0.2); o.mult=1+0.6*o.off;
        if(br<=0.95&&inn>=3) o.notes.push(ab+' bats are quiet: '+t.h+' hits, '+t.bb+' walks and '+t.k+' strikeouts so far.');
        else if(br>=1.6&&inn>=3) o.notes.push(ab+' is getting traffic: '+t.h+' hits and '+t.bb+' walks so far.');
        if(t.lob>=9) o.notes.push(ab+' has stranded '+t.lob+' runners, so runs may be due.');
      }
      if(t.e>=2) o.notes.push(ab+' has '+t.e+' errors.');
    });
  }
  sides.forEach(sd=>{ out.notes=out.notes.concat(out[sd].notes); });
  if(out.pace.note) out.notes.unshift(out.pace.note);
  CTXC[key]=out; return out;
}
// scales a player's remaining production by his team's offense and the game's pace (counting stats only)
function ctxPropMult(g,st,pl,s){
  const C=ctxOf(g,st); if(!C.on) return 1;
  if(g.lg==='mlb'&&pl.fam==='P') return 1;
  const side=pl.side; const tm=C[side]?C[side].mult:1;
  return clamp(1+0.8*(tm-1)+0.8*(C.pace.mult-1),0.85,1.15);
}
function ctxNotesFor(g,st,sides,withPace){
  const C=ctxOf(g,st); if(!C.on) return [];
  let n=[]; sides.forEach(sd=>{ n=n.concat(C[sd].notes); }); if(withPace&&C.pace.note) n.unshift(C.pace.note);
  return n.slice(0,3);
}
