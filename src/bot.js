/* ================= Prop bot (engine/propbot.py): its calibration on every player leg, its notes on each player, its record =================
   The bot runs in every data refresh. Before a game it reads each player's ESPN game log (rest days, teammates who are out, home / road, day of the week),
   the injury report and ESPN news (questionable players, minutes limits, rest days, trades), and moves the player's projection by what it finds. Every
   FanDuel player leg is written down, graded from ESPN's box score after the game, and the misses teach it: how much each pattern should count, how often
   legs at each chance really land (per league, stat and side, big favourites / underdogs, single players). The calibration is put on each player stat of
   the card (st.bot.s = slope, st.bot.c = shift per side), so every builder that uses hpLegs (gold picks, combos, same-game parlays, stacks, safe slips)
   gets the corrected chance. Players the bot flags (pl.bot.avoid) are left out of the builders but stay on the game cards. Practice only. */
function botData(){ try{ return (window.__LSDATA&&window.__LSDATA.bot)||null; }catch(e){ return null; } }
function botP(pl,st,dir,p){
  const b=st&&st.bot; if(!b||b.s==null||!b.c) return null;
  const q0=clamp(p,0.01,0.99); let q=1/(1+Math.exp(-(Math.log(q0/(1-q0))*b.s+(b.c[dir]||0))));
  const v=pl&&pl.bot&&pl.bot.vol; if(v) q=0.5+(q-0.5)*(1-v);              // trade talk: a little more doubt either way
  return clamp(q,0.02,0.97);
}
function botAvoid(pl){ return (pl&&pl.bot&&pl.bot.avoid)||null; }
/* THE NEW-TEAM RULE (engine/propbot.py new_team): a player with fewer than 10 games for the team he is with now (traded, signed, moved in the
   offseason; also any completed trade in ESPN news or the league's transactions) is never an over in the picks. Unders only, until he has 10 games. */
function botUnder(pl){ return (pl&&pl.bot&&pl.bot.under)||null; }
function botOverOK(pl){ return !(pl&&pl.bot&&(pl.bot.avoid||pl.bot.under)); }
const BOT_W0={rest:1,mates:1,home:0.5,dow:0.25};
const BOT_L={rest:'rest days',mates:'teammates out',home:'home/road',dow:'day of week'};
function botW(){ const B=botData(); return (B&&B.learned&&B.learned.w)||BOT_W0; }
/* one short line for a leg: the patterns that moved the projection (at their learned weight) and what the track record did to the chance */
function botTxt(st,p0,p1){
  const b=st&&st.bot; if(!b) return ''; const parts=[], l=b.l||{}, W=botW();
  Object.keys(BOT_L).forEach(k=>{ const x=(l[k]||0)*(W[k]!=null?W[k]:BOT_W0[k]); if(Math.abs(x)>=0.02) parts.push(BOT_L[k]+' '+(x>0?'+':'−')+Math.round(Math.abs(Math.exp(x)-1)*100)+'%'); });
  if(p0!=null&&p1!=null&&Math.abs(p1-p0)>=0.01) parts.push('track record '+(p1>p0?'+':'−')+Math.round(Math.abs(p1-p0)*100)+' pts');
  return parts.length?'Bot: '+parts.join(', '):'';
}
/* notes for the player panel of a game card (template player view) */
function botNotesFor(pl,st){
  const out=[], b=pl&&pl.bot; if(!b) return out;
  if(b.avoid) out.push('<span class="w">Bot: left out of the picks ('+esc(b.avoid)+')</span>');
  else if(b.under) out.push('<span class="w">Bot rule, unders only: '+esc(b.under)+'. Over buttons are off for him.</span>');
  (b.notes||[]).forEach(n=>out.push('Bot: '+esc(n)));
  if(st&&st.bot&&st.bot.f&&Math.abs(st.bot.f-1)>=0.02&&st.bot.p0!=null) out.push('Bot moved the projection '+(st.bot.f>1?'up ':'down ')+Math.round(Math.abs(st.bot.f-1)*100)+'% (from '+st.bot.p0+'). How much each pattern counts is learned from graded results.');
  return out;
}
const BOT_ST={pts:'pts',reb:'reb',ast:'ast',fg3:'threes',pra:'pts+reb+ast',ptsreb:'pts+reb',ptsast:'pts+ast',rebast:'reb+ast',sog:'shots on goal',saves:'saves',gls:'goals',
  passYds:'pass yds',passTD:'pass TD',passAtt:'pass att',comp:'completions',rushYds:'rush yds',carries:'carries',recYds:'rec yds',rec:'receptions',rr:'rush+rec yds',pr:'pass+rush yds',
  hits:'hits',tb:'total bases',runs:'runs',rbi:'RBI',hrr:'hits+runs+RBI',k:'strikeouts',outs:'outs'};
const botPct=x=>x==null?'–':Math.round(x*100)+'%';
function botLegName(r){ const ln=r.r==='u'?'Under '+(r.t-0.5):r.t+'+'; return ln+' '+(BOT_ST[r.s]||r.s); }
function botHtml(){
  const B=botData(); if(!B) return '';
  const gr=B.graded||{}, n=gr.n||0, BL=B.byLeague||{}, on=Object.keys(BL).filter(k=>BL[k].on);
  const sum=n?(n.toLocaleString()+' legs graded'+(on.length?' · correcting '+on.map(k=>k.toUpperCase()).join(', '):' · still collecting')):'collecting its first graded legs';
  let h='<div class="botw"><div class="small">Runs in every data refresh. Before each game it reads ESPN: each player\'s game log (how his minutes move on back-to-backs, with teammates out, at home or on the road, by day of the week), the injury report and the news (minutes limits, rest days, trades), and moves his projection. After the game it grades every FanDuel player leg from ESPN\'s box score and learns from the misses. Its corrections are already in the chances of the gold picks, combos and parlays above.</div>';
  // record of what was shown
  if(B.record&&B.record.length){
    h+='<div class="bott"><div class="botr bothd"><span>Chance shown</span><span>Legs</span><span>Landed</span></div>'+B.record.map(b=>{ const d=b.got-b.said, cls=Math.abs(d)<0.03?'':d<0?' bad':' ok';
      return '<div class="botr"><span>'+Math.round(b.lo*100)+'–'+Math.round(Math.min(b.hi,0.97)*100)+'% <span class="muted">(avg '+botPct(b.said)+')</span></span><span class="mono">'+b.n.toLocaleString()+'</span><span class="mono'+cls+'">'+botPct(b.got)+'</span></div>'; }).join('')+'</div>'+
      '<div class="small muted">Graded '+(gr.days||0)+' game days'+(gr.since?' since '+esc(gr.since.slice(5)):'')+(gr.backfill?' (including '+gr.backfill.toLocaleString()+' legs rebuilt from earlier slates)':'')+'; '+(gr.void||0)+' void (player did not play). '+(B.open||0)+' legs waiting for a final.</div>';
  } else h+='<div class="small muted">No graded legs yet: '+(B.open||0)+' legs are written down and wait for their games to end.</div>';
  const lgs=Object.keys(BL); if(lgs.length) h+='<div class="botlg">'+lgs.map(k=>{ const x=BL[k]; return '<span class="botchip'+(x.on?' on':'')+'"><b>'+esc(k.toUpperCase())+'</b> '+x.n.toLocaleString()+' legs · said '+botPct(x.said)+' · landed '+botPct(x.got)+(x.on?' · correcting':' · collecting')+'</span>'; }).join('')+'</div>';
  const NT=B.newTeam; if(NT) h+='<div class="small"><b>Rule: new to the team = unders only.</b> A player with fewer than '+NT.games+' games for the team he is with now (traded, signed or moved in the offseason, or traded in today\'s ESPN news) is never an over in the picks, and the Over buttons on his card are off.'+
    (NT.overs&&NT.overs.n?' Their overs, written down anyway: said '+botPct(NT.overs.said)+', landed '+botPct(NT.overs.got)+' ('+NT.overs.n+').':'')+(NT.unders&&NT.unders.n?' Their unders: said '+botPct(NT.unders.said)+', landed '+botPct(NT.unders.got)+' ('+NT.unders.n+').':'')+'</div>';
  const L=B.learned||{};
  if(L.check) h+='<div class="small">'+(L.check.better?'<b class="okc">Working:</b> ':'<b class="badc">Not better yet:</b> ')+'on the last 3 days ('+L.check.n.toLocaleString()+' legs it had not learned from), its corrected chances scored '+L.check.bot.toFixed(3)+' vs '+L.check.raw.toFixed(3)+' for the plain ones (Brier score, lower is closer to what happened).</div>';
  if(L.w){ const wn=L.wn||{}; h+='<div class="small"><b>How much each pattern counts now</b> (1.00 = taken at face value, starting values '+Object.keys(BOT_W0).map(k=>BOT_L[k]+' '+BOT_W0[k].toFixed(2)).join(', ')+'): '+Object.keys(BOT_L).map(k=>BOT_L[k]+' <b>'+(L.w[k]!=null?(+L.w[k]).toFixed(2):'–')+'</b>'+(wn[k]?' <span class="muted">('+Math.round(wn[k])+' graded)</span>':'')).join(' · ')+'</div>'; }
  if(B.lessons&&B.lessons.length) h+='<div class="botsec"><b>What it learned</b><ul>'+B.lessons.slice(0,8).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>';
  if(B.big&&B.big.length) h+='<div class="small"><b>Blowout risk</b>: '+B.big.map(x=>esc(x.lg.toUpperCase()+' '+x.side+' '+(x.r==='o'?'overs':'unders'))+' said '+botPct(x.said)+', landed '+botPct(x.got)+' ('+x.n+')').join(' · ')+'</div>';
  if(B.players&&B.players.length) h+='<div class="small"><b>Players it corrects on their own</b>: '+B.players.slice(0,8).map(x=>esc(x.n)+' '+(x.shift<0?'down':'up')+' <span class="muted">(said '+botPct(x.said)+', landed '+botPct(x.got)+' in '+x.games+' games)</span>').join(' · ')+'</div>';
  // today's research
  const T=B.today||[];
  if(T.length){
    const av=T.filter(x=>x.avoid), un=T.filter(x=>!x.avoid&&x.under), mv=T.filter(x=>!x.avoid&&!x.under).slice(0,14);
    h+='<details class="botsec"'+(un.length||av.length?' open':'')+'><summary><b>Today\'s research</b> <span class="muted small">'+(B.info&&B.info.researched||T.length)+' players read · '+un.length+' new to their team (unders only) · '+av.length+' kept out</span></summary>'+
      (un.length?'<div class="small"><b>New to their team: unders only</b><ul>'+un.map(x=>'<li><b>'+esc(x.n)+'</b> '+esc(x.tm||'')+': '+esc(x.under)+'</li>').join('')+'</ul></div>':'')+
      (av.length?'<div class="small"><b>Kept out of the picks</b><ul>'+av.map(x=>'<li><b>'+esc(x.n)+'</b> '+esc(x.tm||'')+': '+esc(x.avoid)+'</li>').join('')+'</ul></div>':'')+
      (mv.length?'<div class="small"><b>Projections moved</b><ul>'+mv.map(x=>{ const fs=Object.keys(x.f||{}).slice(0,3).map(k=>(BOT_ST[k]||k)+' '+(x.f[k]>1?'+':'−')+Math.round(Math.abs(x.f[k]-1)*100)+'%').join(', ');
        return '<li><b>'+esc(x.n)+'</b> '+esc(x.tm||'')+(fs?' <span class="mono">'+esc(fs)+'</span>':'')+(x.notes&&x.notes.length?'<br><span class="muted">'+esc(x.notes.slice(0,2).join(' · '))+'</span>':'')+'</li>'; }).join('')+'</ul></div>':'')+'</details>';
  }
  const M=B.misses||[];
  if(M.length) h+='<details class="botsec"><summary><b>Recent misses</b> <span class="muted small">legs shown at 75%+ that lost, last 2 days</span></summary><ul class="small">'+M.map(r=>'<li><b>'+esc(r.n)+'</b> '+esc(botLegName(r))+' ('+botPct(r.ps)+'): had '+(r.v!=null?r.v:'?')+(r.u!=null&&r.u0?' in '+Math.round(r.u)+' min (usual '+Math.round(r.u0)+')':'')+' · <span class="muted">'+esc(r.why||'')+'</span></li>').join('')+'</ul>'+
    (B.missWhy&&Object.keys(B.missWhy).length?'<div class="small muted">Misses at 60%+ this week by reason: '+Object.keys(B.missWhy).map(k=>esc(k)+' '+B.missWhy[k]).join(' · ')+'</div>':'')+'</details>';
  h+='<div class="small muted">Updated '+esc((B.at||'').replace('T',' ').replace('Z',' UTC'))+'. Everything it learns is shrunk toward no change until there is enough evidence, and kept within set bounds. A miss on a player who did not play is a void, as at FanDuel.</div></div>';
  return '<section class="game hpsec"><div class="sec">'+hpFold('bot','Prop bot',sum,h,false)+'</div></section>';
}
try{ if(window.__LS) window.__LS.bot={data:botData,p:botP,avoid:botAvoid,under:botUnder,overOK:botOverOK,txt:botTxt,notes:botNotesFor,html:botHtml}; }catch(e){}
