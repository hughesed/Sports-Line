/* ===== keep the cards of games with open practice bets =====
   The slate rolls forward as the bot refreshes. A game that has left data/slate.json would leave its open bets unsettleable (and crash the bets list),
   so the card of every game that has a pending bet is remembered on this phone and put back (flagged ghost) until the bet is settled. */
const KC_KEY='linescout.cards.v1';
function kcRead(){ try{ return JSON.parse(localStorage.getItem(KC_KEY)||'{}')||{}; }catch(e){ return {}; } }
function kcWrite(o){ try{ localStorage.setItem(KC_KEY,JSON.stringify(o)); }catch(e){} }
function kcNeed(bets,calls){ const s={}; (bets||[]).forEach(b=>{ if(b&&b.status==='pending') (b.legs||[]).forEach(l=>{ if(l&&!l.res&&l.gid) s[String(l.gid)]=1; }); });
  const cut=new Date(Date.now()-2*864e5).toISOString().slice(0,10);      // parlay stacks span several games: keep the card of each game that still has an ungraded leg (last 2 days)
  (calls||[]).forEach(c=>{ if(c&&c.multi&&c.date>=cut) (c.legs||[]).forEach(l=>{ if(l&&!l.res&&l.gid) s[String(l.gid)]=1; }); }); return s; }
(function kcRestore(){
  let saved=null; try{ saved=JSON.parse(localStorage.getItem('linescout.practice.v1')||'null'); }catch(e){}
  const need=kcNeed(saved&&saved.bets,saved&&saved.calls), cards=kcRead(); let changed=false;
  Object.keys(cards).forEach(id=>{ if(!need[id]){ delete cards[id]; changed=true; } });
  Object.keys(need).forEach(id=>{ if(!G[id]&&cards[id]&&cards[id].teams){ const c=cards[id]; c.ghost=true; G[id]=c; DATA.games.push(c); } });
  if(changed) kcWrite(cards);
})();
function kcSave(){
  try{
    const need=kcNeed(P.bets,P.calls), cards=kcRead(); let changed=false;
    Object.keys(cards).forEach(id=>{ if(!need[id]){ delete cards[id]; changed=true; } });
    Object.keys(need).forEach(id=>{ if(G[id]&&!cards[id]){ cards[id]=G[id]; changed=true; } });
    if(changed) kcWrite(cards);
  }catch(e){}
}
setInterval(kcSave,4000);
window.addEventListener('pagehide',kcSave);
document.addEventListener('visibilitychange',()=>{ if(document.hidden) kcSave(); });
