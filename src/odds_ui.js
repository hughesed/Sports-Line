/* Sportsbook lines (SportsGameOdds -> data/odds.json, written by the bot when the ODDS_API_KEY secret is set).
   Adds a "Sportsbook lines" box to each game card that matches an event: best price per side plus every book's price, with links to the books.
   Optional: with no key / no file nothing is added. Checked every 60 s (the bot itself pulls at most every ODDS_MIN_GAP_MIN minutes). */
const OD={data:null,idx:null,busy:false};
const OD_BOOKS={draftkings:'DK',fanduel:'FD',betmgm:'MGM',caesars:'CZR',espnbet:'ESPN',fanatics:'FAN',bovada:'BOV',betrivers:'BR',hardrockbet:'HR'};
function odFetch(){
  if(OD.busy) return; OD.busy=true;
  fetch('data/odds.json?t='+Date.now(),{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{ OD.busy=false; if(!d||!Array.isArray(d.events)) return; OD.data=d; OD.idx=null; odPaint(); }).catch(()=>{ OD.busy=false; });
}
function odKey(s){ return String(s||'').toLowerCase().replace(/[^a-z]/g,''); }
function odFind(g){
  if(!OD.data) return null;
  const lg=String(({cfb:'NCAAF',cbb:'NCAAB'})[g.key||g.lg]||g.key||g.lg||'').toUpperCase(), h=g.teams.home, a=g.teams.away;
  return OD.data.events.find(e=>String(e.league||'').toUpperCase()===lg&&((odKey(e.home)===odKey(h.abbr)&&odKey(e.away)===odKey(a.abbr))||(odKey(e.homeName)===odKey(h.name)&&odKey(e.awayName)===odKey(a.name))))||null;
}
function odFmt(o){ return o==null?'–':(o>0?'+'+o:String(o)); }
function odSg(n){ return n==null?'':(n>0?'+'+n:String(n)); }
/* best price for one outcome: highest American odds across the books */
/* best price for one outcome: the most common line among the books, then the highest American odds on that line (never mix different lines) */
function odBest(x){ if(!x||!x.books) return null; const ks=Object.keys(x.books).filter(k=>x.books[k].odds!=null); if(!ks.length) return null;
  const cnt={}; ks.forEach(k=>{ const l=String(x.books[k].line); cnt[l]=(cnt[l]||0)+1; });
  const main=Object.keys(cnt).sort((p,q)=>cnt[q]-cnt[p])[0]; let best=null;
  ks.forEach(k=>{ const v=x.books[k]; if(String(v.line)!==main) return; if(!best||v.odds>best.odds) best={book:k,odds:v.odds,line:v.line,link:v.link,n:cnt[main]}; }); return best; }
function odCell(x,pre){ const b=odBest(x); if(!b) return '<span class="muted">–</span>';
  const all=Object.keys(x.books).map(k=>(OD_BOOKS[k]||k)+' '+(x.books[k].line!=null?(pre||'')+(pre?x.books[k].line:odSg(x.books[k].line))+' ':'')+odFmt(x.books[k].odds)).join(' · ');
  const ln=b.line!=null?(pre?pre+b.line:odSg(b.line))+' ':'';
  const inner='<b class="mono">'+esc(ln)+odFmt(b.odds)+'</b><span class="small muted">'+esc(OD_BOOKS[b.book]||b.book)+' · '+b.n+' book'+(b.n>1?'s':'')+'</span>';
  return '<span class="odc" title="'+esc(all)+'">'+(b.link?'<a href="'+esc(b.link)+'" target="_blank" rel="noopener">'+inner+'</a>':inner)+'</span>'; }
function odBox(g,e){
  const m=e.main||{}, A=g.teams.away, H=g.teams.home, T=m.total||{};
  const row=(side,T1)=>'<div class="odr"><div class="odt">'+esc(T1.abbr)+'</div>'+odCell((m.spread||{})[side])+odCell(side==='away'?T.over:T.under,side==='away'?'O ':'U ')+odCell((m.ml||{})[side])+'</div>';
  const links=e.eventLinks||{}; const lk=['draftkings','fanduel','betmgm','caesars'].filter(k=>links[k]).map(k=>'<a href="'+esc(links[k])+'" target="_blank" rel="noopener">'+esc(OD_BOOKS[k])+'</a>').join(' · ');
  const when=OD.data.generatedAt?new Date(OD.data.generatedAt):null;
  return '<div class="odbox" data-od="'+esc(g.id)+'"><div class="odh"><b>Sportsbook lines</b><span class="small muted">best price shown, tap for the book'+(when?' · pulled '+when.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'')+'</span></div>'+
    '<div class="odr odhd"><div class="odt"></div><span>Spread</span><span>Total</span><span>Money</span></div>'+row('away',A)+row('home',H)+(lk?'<div class="small muted">Open at: '+lk+'</div>':'')+
    '<div class="small muted">Practice only. Prices are what the books showed when pulled; they move.</div></div>';
}
function odPaint(){
  if(!OD.data||typeof G==='undefined') return;
  Object.keys(G).forEach(id=>{ const g=G[id], el=document.getElementById('game-'+id); if(!el||!g||!g.teams) return;
    const old=el.querySelector('.odbox'); const e=odFind(g);
    if(!e||!e.main||!(e.main.ml||e.main.spread||e.main.total)){ if(old) old.remove(); return; }
    const html=odBox(g,e); if(old&&old.outerHTML===html) return; if(old) old.remove();
    const host=el.querySelector('.sec')||el; host.insertAdjacentHTML('afterend',html); });
}
let odT=null; new MutationObserver(()=>{ if(!OD.data) return; clearTimeout(odT); odT=setTimeout(odPaint,120); }).observe(document.body,{childList:true,subtree:true});
setInterval(()=>{ if(!document.hidden) odFetch(); },60e3); odFetch();

/* ---------- bet slip deep links: each leg's own selection link from the odds feed, combined per book, so the slip arrives with the picks already in it ---------- */
function odLegLinks(l){
  const g=G[l.gid]; if(!g) return null; let e=null; try{ e=(typeof bkEvent==='function'&&bkEvent(g))||(typeof odFind==='function'&&odFind(g))||null; }catch(err){} if(!e) return null;
  const sp=l.spec||{}, out={}, M=e.main||{};
  const take=(x,line)=>{ if(!x||!x.books) return; Object.keys(x.books).forEach(k=>{ const b=x.books[k]; if(!b||!b.link) return; if(line!=null&&b.line!=null&&Math.abs(+b.line-line)>0.01) return; out[k]=b.link; }); };
  if(sp.k==='ml') take(M.ml&&M.ml[sp.side]);
  else if(sp.k==='spr') take(M.spread&&M.spread[sp.side],+sp.line);
  else if(sp.k==='tot') take(M.total&&M.total[sp.dir],+sp.line);
  else if(sp.k==='prop'){ const pl=(typeof findPlayer==='function')?findPlayer(g,sp.pid):null; if(pl){ const nm=odKey(pl.name); const side=sp.dir==='lt'?'under':'over'; const line=side==='over'?sp.T-0.5:sp.T-0.5;
      (e.props||[]).forEach(p=>{ if(odKey(p.name)!==nm||p.stat!==sp.stat||p.side!==side) return; take(p,line); }); } }
  if(l.links) Object.keys(l.links).forEach(k=>{ if(l.links[k]) out[k]=l.links[k]; });
  return out;
}
function odCombine(book,ls){
  try{
    const U=ls.map(u=>new URL(u)), q=(u,k)=>u.searchParams.get(k);
    if(book==='fanduel'){ const v=U.map(u=>({m:q(u,'marketId'),s:q(u,'selectionId')})); if(v.every(x=>x.m&&x.s)) return 'https://sportsbook.fanduel.com/addToBetslip?'+v.map((x,i)=>'marketId['+i+']='+encodeURIComponent(x.m)+'&selectionId['+i+']='+encodeURIComponent(x.s)).join('&'); }
    if(book==='draftkings'){ const o=U.map(u=>q(u,'outcomes')); if(o.every(Boolean)&&U.every(u=>u.pathname===U[0].pathname)) return U[0].origin+U[0].pathname+'?outcomes='+o.map(encodeURIComponent).join('%7C'); }
    if(book==='caesars'){ const o=U.map(u=>q(u,'selectionIds')); if(o.every(Boolean)&&U.every(u=>u.pathname===U[0].pathname)) return U[0].origin+U[0].pathname+'?selectionIds='+o.map(encodeURIComponent).join(','); }
    if(book==='espnbet'){ const v=U.map(u=>({s:q(u,'market_selection_id[0]'),n:q(u,'odds_numerator[0]'),d:q(u,'odds_denominator[0]')})); if(v.every(x=>x.s&&x.n&&x.d)) return U[0].origin+'/?'+v.map((x,i)=>'market_selection_id['+i+']='+encodeURIComponent(x.s)+'&odds_numerator['+i+']='+x.n+'&odds_denominator['+i+']='+x.d).join('&'); }
  }catch(err){}
  return null;
}
/* {url, n, total}: n = how many of the slip's legs are inside the link */
function slipDeepLink(book){
  const legs=S.slip||[]; if(!legs.length) return null;
  const links=legs.map(l=>{ const m=odLegLinks(l); return (m&&m[book])||null; }).filter(u=>u&&/^https:\/\//i.test(u)); if(!links.length) return null;
  let url=links[0], n=1; if(links.length>1){ const c=odCombine(book,links); if(c){ url=c; n=links.length; } }
  return {url:url,n:n,total:legs.length};
}
