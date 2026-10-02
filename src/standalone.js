/* ===== standalone live feed: ESPN -> compact docs, in the browser (port of feed.py) ===== */
const ESP={nfl:'football/nfl',wnba:'basketball/wnba',mlb:'baseball/mlb',nba:'basketball/nba',cfb:'football/college-football',cbb:'basketball/mens-college-basketball'};
const ESPFAM={cfb:'nfl',nba:'wnba',cbb:'wnba'};
const ESPQ={cfb:'?groups=80&limit=300',cbb:'?groups=50&limit=400'};
const ESPB='https://site.api.espn.com/apis/site/v2/sports/';
function sToi(x,d){ const n=parseInt(String(x==null?'':x).replace('+',''),10); return isNaN(n)?(d||0):n; }
function sFirst(s){ const m=String(s==null?'':s).match(/^\s*(-?\d+)/); return m?parseInt(m[1],10):0; }
function sGet(url){ return fetch(url,{cache:'no-store'}).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }); }
function sNflX(teamId,yte,awayId){ if(yte==null) return null; return String(teamId)===String(awayId)?100-yte:yte; }

function sNum(x){ const n=parseFloat(String(x==null?'':x).replace(/[+,]/g,'')); return isNaN(n)?0:n; }
function sPair(x){ const m=String(x||'').match(/^\s*(-?\d+(?:\.\d+)?)\s*[-\/]\s*(-?\d+(?:\.\d+)?)/); return m?[parseFloat(m[1]),parseFloat(m[2])]:[0,0]; }
function sTeamStats(lg,s,home,away){
  const out={};
  ((s.boxscore&&s.boxscore.teams)||[]).forEach(t=>{
    const side=String(t.team.id)===String(home.team.id)?'home':'away'; const d={};
    if(lg==='mlb'){
      (t.statistics||[]).forEach(grp=>{ (grp.stats||[]).forEach(x=>{ d[grp.name+'.'+x.name]=x.displayValue; }); });
      const b=k=>sNum(d['batting.'+k]);
      out[side]={h:b('hits'),k:b('strikeouts'),bb:b('walks'),lob:b('runnersLeftOnBase'),ab:b('atBats'),pa:b('plateAppearances'),pit:b('pitches'),e:sNum(d['fielding.errors'])};
      return;
    }
    (t.statistics||[]).forEach(x=>{ if(!(x.name in d)) d[x.name]=x.displayValue; });
    if(lg==='nfl'){
      const pp=sPair(d.totalPenaltiesYards), c3=sPair(d.thirdDownEff), sk=sPair(d.sacksYardsLost); const mm=String(d.possessionTime||'').match(/(\d+):(\d+)/);
      const pl_=sNum(d.totalOffensivePlays)||(sPair(d.completionAttempts)[1]+sNum(d.rushingAttempts)); const ypp_=sNum(d.yardsPerPlay)||(pl_?sNum(d.totalYards)/pl_:0);
      out[side]={pl:pl_,yd:sNum(d.totalYards),ypp:Math.round(ypp_*100)/100,dr:sNum(d.totalDrives),pen:pp[0],peny:pp[1],to:sNum(d.turnovers),c3:c3[0],a3:c3[1],sk:sk[0],fd:sNum(d.firstDowns),rz:sPair(d.redZoneAttempts)[1],ps:mm?(+mm[1])*60+(+mm[2]):0};
    } else {
      const fg=sPair(d['fieldGoalsMade-fieldGoalsAttempted']), f3=sPair(d['threePointFieldGoalsMade-threePointFieldGoalsAttempted']), ft=sPair(d['freeThrowsMade-freeThrowsAttempted']);
      out[side]={fg:fg[0],fga:fg[1],f3:f3[0],f3a:f3[1],ft:ft[0],fta:ft[1],tov:sNum(d.totalTurnovers||d.turnovers),orb:sNum(d.offensiveRebounds),fl:sNum(d.fouls),fb:sNum(d.fastBreakPoints),pip:sNum(d.pointsInPaint)};
    }
  });
  return out;
}

function espnBuild(key,gid,sbEv){
  const lg=ESPFAM[key]||key;
  return sGet(ESPB+ESP[key]+'/summary?event='+gid).then(s=>{
    if(!s||!s.header) return null;
    const comp=s.header.competitions[0], stt=comp.status, ty=stt.type;
    const teams={}; comp.competitors.forEach(c=>teams[c.team.id]=c);
    const ab={}; Object.keys(teams).forEach(i=>ab[i]=teams[i].team.abbreviation);
    const home=comp.competitors.find(c=>c.homeAway==='home'), away=comp.competitors.find(c=>c.homeAway==='away');
    const doc={gid:gid,lg:key,st:{s:ty.state,per:stt.period||0,clk:stt.displayClock||'',det:ty.detail||'',pre:stt.periodPrefix||''},hs:sToi(home.score),as:sToi(away.score)};
    const sit=(sbEv&&sbEv.competitions&&sbEv.competitions[0]&&sbEv.competitions[0].situation)||{};
    const p={}, nm={}, dnp=[];
    ((s.boxscore&&s.boxscore.players)||[]).forEach(t=>{
      (t.statistics||[]).forEach(grp=>{
        const keys=grp.keys||[];
        (grp.athletes||[]).forEach(a=>{
          const aid=a.athlete.id; nm[aid]=a.athlete.shortName||a.athlete.displayName;
          const v={}; keys.forEach((k,i)=>v[k]=(a.stats||[])[i]); const d=p[aid]||(p[aid]={});
          if(lg==='nfl'){
            const n_=grp.name;
            if(n_==='passing'){ d.comp=sFirst(v['completions/passingAttempts']); d.passYds=sToi(v.passingYards); d.passTD=sToi(v.passingTouchdowns); }
            else if(n_==='rushing'){ d.carries=sToi(v.rushingAttempts); d.rushYds=sToi(v.rushingYards); }
            else if(n_==='receiving'){ d.rec=sToi(v.receptions); d.recYds=sToi(v.receivingYards); }
          } else if(lg==='wnba'){
            d.pts=sToi(v.points); d.reb=sToi(v.rebounds); d.ast=sToi(v.assists); d.fg3=sFirst(v['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
            if(a.didNotPlay) dnp.push(aid);
          } else if(lg==='mlb'){
            if(grp.type==='batting'){ d.hits=sToi(v.hits); d.runs=sToi(v.runs); d.rbi=sToi(v.RBIs); if(d.tb==null) d.tb=0; }
            else if(grp.type==='pitching'){ d.k=sToi(v.strikeouts); const ip=String(v['fullInnings.partInnings']||'0.0').split('.'); d.outs=sToi(ip[0])*3+(ip.length>1?sToi(ip[1]):0); }
          }
        });
      });
    });
    doc.p={}; Object.keys(p).forEach(k=>{ if(Object.keys(p[k]).length) doc.p[k]=p[k]; });
    if(dnp.length) doc.dnp=dnp;
    let plays=[];
    if(lg==='nfl'){
      const dr=s.drives||{}; let allp=[];
      (dr.previous||[]).concat(dr.current?[dr.current]:[]).forEach(d=>{ (d.plays||[]).forEach(pl=>{ pl._dr=d.id; pl._drteam=(d.team||{}).id; allp.push(pl); }); });
      const seen={}; allp.forEach(x=>seen[x.id]=x);
      allp=Object.keys(seen).map(k=>seen[k]).sort((a,b)=>sToi(a.sequenceNumber)-sToi(b.sequenceNumber));
      allp.slice(-50).forEach(pl=>{
        const st_=pl.start||{}, en=pl.end||{};
        const tid=(st_.team||{}).id||pl._drteam;
        let x0=sNflX(tid,st_.yardsToEndzone,away.team.id);
        const etid=(en.team||{}).id||tid;
        let x1=sNflX(etid,en.yardsToEndzone,away.team.id);
        const tx=(pl.text||'').trim();
        if(x1==null){
          const m=[...tx.matchAll(/\b([A-Z]{2,4}) (\d{1,2})\b/g)];
          if(m.length){ const t_=m[m.length-1][1], n_=m[m.length-1][2]; if(t_===away.team.abbreviation) x1=parseInt(n_,10); else if(t_===home.team.abbreviation) x1=100-parseInt(n_,10); }
        }
        if(x0==null) x0=x1; if(x1==null) x1=x0;
        plays.push({i:pl.id,q:(pl.period||{}).number,c:(pl.clock||{}).displayValue||'',tm:ab[String(tid)]||'',tx:tx,ty:(pl.type||{}).text||'',sc:!!pl.scoringPlay,hs:sToi(pl.homeScore),as:sToi(pl.awayScore),x0:x0,x1:x1,y:pl.statYardage,to:!!pl.isTurnover,pen:!!pl.isPenalty,
          dn:st_.shortDownDistanceText||'',dn2:en.shortDownDistanceText||'',fd:en.distance,dr:pl._dr,o:(String(tid)===String(away.team.id)?'a':'h')});
      });
    } else if(lg==='wnba'){
      (s.plays||[]).slice(-60).forEach(pl=>{
        const co=pl.coordinate||{}; const ok=Math.abs(co.x==null?9999:co.x)<200&&Math.abs(co.y==null?9999:co.y)<200&&pl.shootingPlay;
        plays.push({i:pl.id,q:(pl.period||{}).number,c:(pl.clock||{}).displayValue||'',tm:ab[(pl.team||{}).id]||'',tx:(pl.text||'').trim(),ty:(pl.type||{}).text||'',sc:!!pl.scoringPlay,v:pl.scoreValue||0,sh:!!pl.shootingPlay,co:(ok?[co.x,co.y]:null),pa:pl.pointsAttempted||0,hs:sToi(pl.homeScore),as:sToi(pl.awayScore)});
      });
    } else if(lg==='mlb'){
      const tb={};
      (s.plays||[]).forEach(pl=>{
        const tx=pl.text||''; let bid=null;
        (pl.participants||[]).forEach(pa=>{ if(pa.type==='batter') bid=pa.athlete.id; });
        if(bid){ const v=/homered|home run/.test(tx)?4:/\btripled\b/.test(tx)?3:/\bdoubled\b/.test(tx)?2:/\bsingled\b/.test(tx)?1:0; if(v) tb[bid]=(tb[bid]||0)+v; }
      });
      Object.keys(tb).forEach(bid=>{ (doc.p[bid]||(doc.p[bid]={})).tb=tb[bid]; });
      (s.plays||[]).slice(-60).forEach(pl=>{
        const parts={}; (pl.participants||[]).forEach(pa=>{ if(pa.athlete) parts[pa.type]=pa.athlete.id; });
        const per=pl.period||{}, rc=pl.resultCount||{};
        plays.push({i:pl.id,q:per.number,h:per.type,tx:(pl.text||'').trim(),ty:(pl.type||{}).text||'',sc:!!pl.scoringPlay,v:pl.scoreValue||0,
          pt:(pl.pitchCoordinate?[pl.pitchCoordinate.x,pl.pitchCoordinate.y]:null),pv:pl.pitchVelocity,pk:(pl.pitchType||{}).abbreviation,
          hc:(pl.hitCoordinate?[pl.hitCoordinate.x,pl.hitCoordinate.y]:null),ct:[rc.balls,rc.strikes],o:pl.outs,bt:parts.batter,pi:parts.pitcher,ab:pl.atBatId,hs:sToi(pl.homeScore),as:sToi(pl.awayScore)});
      });
    }
    doc.plays=plays;
    doc.ts=sTeamStats(lg,s,home,away);
    doc.nm={};
    if(lg==='mlb'){ Object.keys(nm).forEach(k=>{ if(plays.some(pp=>pp.bt===k||pp.pi===k)) doc.nm[k]=nm[k]; }); }
    doc.ab={home:home.team.abbreviation,away:away.team.abbreviation};
    if(lg==='nfl'){ doc.sit={dn:sit.downDistanceText||'',sdn:sit.shortDownDistanceText||'',poss:ab[String(sit.possession)]||'',rz:!!sit.isRedZone,lp:((sit.lastPlay||{}).text||'').slice(0,160)}; }
    else if(lg==='mlb'){ doc.sit={b:sit.balls||0,s:sit.strikes||0,o:sit.outs||0,on:[!!sit.onFirst,!!sit.onSecond,!!sit.onThird],bat:(((sit.batter||{}).athlete)||{}).shortName||'',pit:(((sit.pitcher||{}).athlete)||{}).shortName||''}; }
    else doc.sit={};
    let wp=(s.winprobability||[]).filter(x=>'homeWinPercentage' in x).map(x=>Math.round(1000*x.homeWinPercentage)/10);
    if(wp.length>90){ const step=wp.length/90; const w2=[]; for(let i=0;i<90;i++) w2.push(wp[Math.floor(i*step)]); w2.push(wp[wp.length-1]); wp=w2; }
    doc.wp=wp;
    return doc;
  });
}

const POLL={sig:{},sb:{},timer:null,fails:0,stop:{}};
function pollGames(){ return Object.keys(G).map(id=>G[id]).filter(g=>ESP[g.key||g.lg]); }
const POLL_LEAD=20*60e3, POLL_OLD=18*3600e3;
function pollOnce(){
  /* only games that are within 20 minutes of kickoff, live, or just finished are polled: a slate of 20+ games costs a handful of requests, not 20 every few seconds */
  const now=Date.now();
  const cand=pollGames().filter(g=>!POLL.stop[g.id]).filter(g=>{ const t=Date.parse(g.iso); return !isFinite(t)||t-now<POLL_LEAD; });
  if(!cand.length){ if(FS.conn!=='err') FS.conn=Object.keys(FEED).length?'on':'idle'; if(S.view==='live') RF('lv-status',statusHtml()); return Promise.resolve(60000); }
  const lgs=[...new Set(cand.map(g=>g.key||g.lg))];
  return Promise.all(lgs.map(lg=>sGet(ESPB+ESP[lg]+'/scoreboard'+(ESPQ[lg]||'')).then(j=>{ POLL.sb[lg]=j; }).catch(()=>{}))).then(()=>
    Promise.all(cand.map(g=>{
      const ev=((POLL.sb[g.key||g.lg]||{}).events||[]).find(e=>e.id===g.id);
      return espnBuild(g.key||g.lg,g.id,ev).then(doc=>{
        if(!doc) return null;
        const h=JSON.stringify(doc);
        if(POLL.sig[g.id]===h){ FS.last=Date.now(); FS.conn='on'; return doc; }
        POLL.sig[g.id]=h; doc.t=Date.now();
        try{ feedIn(g.id,doc); }catch(e){ FS.err=String(e&&e.message||e); }
        return doc;
      });
    }))
  ).then(docs=>{
    POLL.fails=0; FS.conn='on';
    let anyLiveNow=false;
    docs.forEach(d=>{
      if(!d) return;
      if(d.st.s==='in') anyLiveNow=true;
      const g=G[d.gid], t=g?Date.parse(g.iso):NaN;
      if(d.st.s==='post'||(isFinite(t)&&t<now-POLL_OLD&&d.st.s!=='in')) POLL.stop[d.gid]=true;      // finished, or postponed/abandoned long ago: stop asking
    });
    if(S.view==='live') RF('lv-status',statusHtml());
    return anyLiveNow?6000:30000;
  }).catch(e=>{
    POLL.fails++; FS.err=(e&&e.message)||''; if(POLL.fails>=3) FS.conn='err';
    if(S.view==='live') RF('lv-status',statusHtml());
    return Math.min(30000,6000*POLL.fails);
  });
}
function startPoll(){
  if(POLL.timer) return; POLL.timer=1;
  const loop=()=>{ pollOnce().then(ms=>{ if(document.hidden) ms=Math.max(ms,30000); POLL.timer=setTimeout(loop,ms); }); };
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ clearTimeout(POLL.timer); loop(); } });
  loop();
}
