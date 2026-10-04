/* ===== big screen (full screen) live view ===== */
const FSV={gid:null};
function fsHeadHtml(g){
  const f=FEED[g.id], st=stateOf(g), a=g.teams.away, h=g.teams.home; const live=f&&f.st.s==='in';
  const poss=g.lg==='nfl'&&f&&f.sit&&f.sit.poss?f.sit.poss:''; const sub=g.lg==='nfl'&&f&&f.sit&&f.sit.dn?f.sit.dn:'';
  return '<div class="fsscore"><div class="fst"><span class="ab">'+esc(a.abbr)+(poss===a.abbr?' <i class="posb">●</i>':'')+'</span><b class="mono">'+st.away+'</b></div>'+
    '<div class="fsc">'+(live?'<span class="liveb"><i class="livedot"></i>LIVE</span>':'')+'<span class="mono">'+esc((g.lg==='nfl'||g.lg==='wnba')&&f&&f.st.s==='in'?((g.key==='cbb'?'H':'Q')+f.st.per+' '+(f.st.clk||'')):pbLabel(g,f))+'</span>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div>'+
    '<div class="fst r"><b class="mono">'+st.home+'</b><span class="ab">'+esc(h.abbr)+(poss===h.abbr?' <i class="posb">●</i>':'')+'</span></div></div>';
}
function fsBetsHtml(g){
  return '<h3>Live bets <span class="hint">tap to add to your slip</span></h3>'+bestHtml(g)+'<div class="fsmk">'+marketsHtml(g)+'</div>';
}
function sndBtnHtml(){ return '<button class="fsb" data-act="snd" aria-pressed="'+SND.on+'">'+(SND.on?'Sound on':'Sound off')+'</button>'; }
function fsVoiceFill(){
  const sel=E('fs-voice'); if(!sel) return;
  const vs=SND.voices.slice().sort((a,b)=>voiceScore(b)-voiceScore(a)); const best=bestVoice();
  sel.innerHTML=vs.length?vs.map(v=>'<option value="'+esc(v.name)+'"'+(best&&best.name===v.name?' selected':'')+'>'+esc(v.name)+' ('+esc(v.lang)+')</option>').join(''):'<option>Default voice</option>';
}
function fsVoiceHtml(){
  if(!HAS_TTS) return '<div class="small muted">This browser has no built-in voice, so the play-by-play will not be read out. Sound effects still play.</div>';
  return '<div class="fsvoice"><label>Voice <select id="fs-voice" aria-label="Commentary voice"></select></label><label>Speed <input type="range" id="fs-rate" min="0.8" max="1.3" step="0.05" value="'+SND.rate+'" aria-label="Voice speed"></label><button class="fsb" data-act="sndtest">Test voice</button></div>'+
    '<div class="small muted">The voice is your device\'s own text-to-speech, so it sounds as natural as the voices installed on it. Pick the best-sounding one above. On iPhone, Settings, Accessibility, Spoken Content, Voices lets you download Enhanced or Premium voices.</div>';
}
function openFS(gid){
  const g=G[gid]; if(!g||FSV.gid) return; const viz=E('viz-'+gid); if(!viz) return;
  FSV.gid=gid; document.body.classList.add('fsopen');
  const ov=document.createElement('div'); ov.className='fsov'; ov.id='fsov'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-modal','true'); ov.setAttribute('aria-label','Full screen live game');
  ov.innerHTML='<div class="fsbar"><button class="fsb x" data-act="fsclose" aria-label="Close full screen">Close</button><div id="fs-head">'+fsHeadHtml(g)+'</div><div id="fs-snd">'+sndBtnHtml()+'</div></div>'+
    '<div class="fsbody"><div class="fsstage" id="fs-stage"></div><div class="fsside"><div id="fs-voicebox">'+fsVoiceHtml()+'</div><div class="sec" id="fs-bets">'+fsBetsHtml(g)+'</div><div class="sec" id="fs-log">'+logHtml(g)+'</div></div></div>';
  document.body.appendChild(ov);
  viz.removeAttribute('data-act'); viz.removeAttribute('role'); viz.removeAttribute('tabindex'); const hint=viz.querySelector('.fshint'); if(hint) hint.remove();
  E('fs-stage').appendChild(viz);
  const ph=E('lv-viz-'+gid); if(ph) ph.innerHTML='<h3>Live field <span class="hint">playing in full screen</span></h3><div class="small muted">Close full screen to bring it back here.</div>';
  fsVoiceFill();
  const sel=E('fs-voice'); if(sel) sel.addEventListener('change',()=>{ SND.voiceName=sel.value; sndSave(); });
  const rt=E('fs-rate'); if(rt) rt.addEventListener('input',()=>{ SND.rate=+rt.value||1.05; sndSave(); });
  sndUnlock(); halfCheck(g);
  if(g.lg==='nfl') camFollow(gid,vis(gid).vs.nfl.x,true);
  if(SND.on) say(g.teams.away.short+' at '+g.teams.home.short+'. Big screen is on.',true);
  document.addEventListener('keydown',fsKey);
}
function fsKey(e){ if(e.key==='Escape') closeFS(); }
function closeFS(){
  const gid=FSV.gid; if(!gid) return; FSV.gid=null; document.removeEventListener('keydown',fsKey);
  sndStop(); const ov=E('fsov'); if(ov) ov.remove(); document.body.classList.remove('fsopen');
  if(CAM[gid]) cancelAnimationFrame(CAM[gid].raf);
  const svg=E('fld-'+gid); if(svg) svg.setAttribute('viewBox','0 0 120 56');
  redrawCard(gid);
}
function fsRefresh(g){
  if(FSV.gid!==g.id) return;
  RF('fs-head',fsHeadHtml(g)); halfCheck(g);
  if(S.pressing){ S.pendingLive[g.id]=2; return; }
  RF('fs-bets',fsBetsHtml(g)); RF('fs-log',logHtml(g));
}
function fsToggleSound(){
  SND.on=!SND.on; sndSave(); if(SND.on){ sndUnlock(); } else sndStop();
  RF('fs-snd',sndBtnHtml());
}
function fsTestVoice(){ if(!SND.on) fsToggleSound(); sndUnlock(); sfx('catch',0); say('First and ten. The quarterback drops back and finds his man down the sideline for twelve yards.',true); }
