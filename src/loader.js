/* Line Scout data loader. Runs first: fetches data/*.json, starts the app with it, then keeps checking for fresher data.
   - cache-busted: meta.json is read with no-store + a timestamp, the other files with ?v=<generatedAt>
   - "Data updated ..." label, stale warning after 6 h, clear error state if nothing can be loaded
   - last good copy kept in localStorage so the page still opens offline (clearly labelled) */
(function(){
  'use strict';
  var STALE_MS=6*3600e3, RECHECK_MS=4*60e3, CKEY='linescout.data.v1';
  var cur=null, started=false, pending=null, offline=false;
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  // GitHub Pages is a static CDN. A single slow/blocked JSON request must not leave
  // the whole app stuck on "Loading the slate…" forever.  The slate + learning
  // files are required; pastp.json is optional for first paint and can fail/timeout
  // without preventing the rest of the site from opening.
  function getJSON(u, timeoutMs){
    timeoutMs=timeoutMs||15000;
    var ctl=(typeof AbortController==='function')?new AbortController():null;
    var timer=ctl?setTimeout(function(){ try{ctl.abort();}catch(e){} },timeoutMs):null;
    return fetch(u,ctl?{cache:'no-store',signal:ctl.signal}:{cache:'no-store'}).then(function(r){
      if(!r.ok) throw new Error(u.split('?')[0]+' returned HTTP '+r.status);
      return r.json();
    }).finally(function(){ if(timer) clearTimeout(timer); });
  }
  function fetchAll(meta){
    var v=encodeURIComponent(meta.generatedAt||Date.now());
    return Promise.all([
      getJSON('data/slate.json?v='+v,15000),
      getJSON('data/learn.json?v='+v,15000),
      getJSON('data/pastp.json?v='+v,8000).catch(function(){ return {}; })
    ]).then(function(a){
      if(!a[0]||!Array.isArray(a[0].games)||!a[1]||!a[1].leagues) throw new Error('data files are not in the expected format');
      return {meta:meta,slate:a[0],learn:a[1],pastp:a[2]||{}};
    });
  }
  function fetchFresh(){ return getJSON('data/meta.json?t='+Date.now()).then(fetchAll); }
  function ageText(ms){
    var m=Math.max(0,Math.round(ms/60000));
    if(m<1) return 'just now'; if(m<60) return m+' min ago';
    var h=Math.floor(m/60); if(h<48) return h+' h'+(m%60?' '+(m%60)+' min':'')+' ago';
    return Math.floor(h/24)+' days ago';
  }
  function saveCache(d){ try{ localStorage.setItem(CKEY,JSON.stringify(d)); }catch(e){} }
  function readCache(){ try{ var s=localStorage.getItem(CKEY); return s?JSON.parse(s):null; }catch(e){ return null; } }
  function bar(cls,html){ var b=$('lsbar'); if(!b) return; b.className='lsbar'+(cls?' '+cls:''); b.innerHTML=html; }
  function paint(){
    if(!cur) return;
    var meta=cur.meta||{}, t=Date.parse(meta.generatedAt||''), age=isNaN(t)?Infinity:Date.now()-t;
    var when=meta.generatedAtET||meta.generatedAt||'unknown time';
    var html='<span>Data updated <b>'+esc(when)+'</b> · '+(isFinite(age)?ageText(age):'')+'</span>';
    var cls='';
    if(offline){ cls='err'; html='<span><b>Offline.</b> Showing the copy saved on this phone from <b>'+esc(when)+'</b>.</span>'; }
    else if(age>STALE_MS){ cls='stale'; html+='<span><b>Stale:</b> the refresh bot has not updated for '+Math.floor(age/3600e3)+'+ hours. Lines and injuries may be out of date. Check the Actions tab of your GitHub repo.</span>'; }
    else if(meta.lastRunError){ cls='stale'; html+='<span>The last refresh run failed; showing the last good data.</span>'; }
    else if(meta.deadlineHit){ html+='<span>Time limit reached on the last run (some feeds were skipped); it catches up on the next one.</span>'; }
    else if(meta.leagues){
      var bad=Object.keys(meta.leagues).filter(function(k){ var s=meta.leagues[k].status; return s==='error'||s==='stale'||s==='partial'; });
      if(bad.length) html+='<span>Some leagues could not refresh ('+bad.map(function(k){return k.toUpperCase();}).join(', ')+'); their last data is kept.</span>';
    }
    if(pending) html+='<span class="sp"></span><button type="button" id="ls-upd">New data ready · update</button>';
    else html+='<span class="sp"></span><button type="button" id="ls-chk" aria-label="Check for new data now" title="Check for new data now">&#8635;</button>';
    bar(cls,html);
    var u=$('ls-upd'); if(u) u.onclick=function(){ location.reload(); };
    var c=$('ls-chk'); if(c) c.onclick=function(){ recheck(true); };
  }
  function startApp(d){
    window.__LSDATA=d; cur=d; started=true;
    try{ var s=document.createElement('script'); s.text=$('ls-app').textContent; document.body.appendChild(s); }
    catch(e){ fail(e); return; }
    paint();
  }
  function fail(e){
    var msg=(e&&e.message)||String(e);
    var c=readCache();
    if(c&&c.slate&&c.learn&&!started){ offline=true; startApp(c); return; }
    var main=$('app'); if(main) main.innerHTML='<div class="lserr"><h2>Could not load the data</h2><div>The page needs <code>data/slate.json</code>, <code>data/learn.json</code> and <code>data/meta.json</code> next to it. '+
      'If you opened this file straight from your phone or computer, it will not work: open the web address your host gave you instead. If this is your site, run the <b>Refresh data</b> workflow once so the data files exist.</div>'+
      '<div style="margin-top:8px;color:var(--muted)">Technical detail: '+esc(msg)+'</div><button type="button" id="ls-retry">Try again</button></div>';
    bar('err','<span><b>Data not loaded.</b></span><span class="sp"></span>');
    var r=$('ls-retry'); if(r) r.onclick=function(){ boot(); };
  }
  function recheck(manual,returned){
    if(!started) return;
    getJSON('data/meta.json?t='+Date.now()).then(function(meta){
      offline=false;
      if(meta.generatedAt!==cur.meta.generatedAt){
        return fetchAll(meta).then(function(d){
          saveCache(d); pending=d;
          var idle=returned&&!(window.__LS_hooks&&window.__LS_hooks.slipCount());      // coming back to the page with an empty slip: just reload into the fresh data
          if(idle) location.reload(); else paint();
        });
      }
      cur.meta=meta; paint();
    }).catch(function(e){
      if(manual){ var b=$('lsbar'); if(b) b.insertAdjacentHTML('beforeend','<span>Could not check: '+esc(e.message||e)+'</span>'); }
    });
  }
  function boot(){
    var m=$('app'); if(m&&!started) m.innerHTML='<div class="lsload">Loading the slate…</div>';
    fetchFresh().then(function(d){ saveCache(d); offline=false; startApp(d); }).catch(fail);
  }
  document.addEventListener('visibilitychange',function(){ if(!document.hidden){ if(started) recheck(false,true); } });
  setInterval(function(){ if(started&&!document.hidden) recheck(false); },RECHECK_MS);
  setInterval(paint,30e3);
  window.addEventListener('online',function(){ if(offline) location.reload(); });
  boot();
})();
