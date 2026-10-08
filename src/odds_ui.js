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
  const lg=String(g.lg||g.key||'').toUpperCase(), h=g.teams.home, a=g.teams.away;
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
