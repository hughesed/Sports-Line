function chart(pl,st,pid){
  const W=340,H=176,pL=8,pR=8,pT=18,pB=34;
  const vals=st.v15, slots=pl.slots, n=vals.length;
  const nums=vals.filter(v=>v!=null);
  const top=Math.max.apply(null,nums.concat([st.line,st.safeAdj||0,1]))*1.2;
  const iw=W-pL-pR, ih=H-pT-pB, bw=iw/n;
  const y=v=>pT+ih-(v/top)*ih;
  const selKey=pid+st.key; const sel = (S.bar[selKey]!=null&&S.bar[selKey]<n)?S.bar[selKey]:n-1;
  let s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(pl.name+' '+st.label+', last '+n+' games, oldest to newest: '+vals.map(v=>v==null?'did not play':v).join(', ')+'. Line '+st.line+(st.safeAdj!=null?', safe point '+st.safeAdj:''))+'">';
  [0.5,1].forEach(f=>{ const yy=y(top*f/1.2); s+='<line class="grid" x1="'+pL+'" x2="'+(W-pR)+'" y1="'+yy+'" y2="'+yy+'"/>'; });
  s+='<line class="grid" x1="'+pL+'" x2="'+(W-pR)+'" y1="'+y(0)+'" y2="'+y(0)+'"/>';
  vals.forEach((v,i)=>{
    const g=slots[i]||{}; const x=pL+i*bw+bw*0.14, w=bw*0.72;
    const head='<g data-act="bar" data-pid="'+pid+'" data-stat="'+st.key+'" data-i="'+i+'" style="cursor:pointer">';
    const hit='<rect x="'+(pL+i*bw)+'" y="'+pT+'" width="'+bw+'" height="'+(ih+pB-4)+'" fill="transparent"/>';
    const labs='<text x="'+(x+w/2)+'" y="'+(H-17)+'" font-size="7.5" text-anchor="middle">'+esc(g.opp||'')+'</text><text x="'+(x+w/2)+'" y="'+(H-8)+'" font-size="6.5" text-anchor="middle">'+(g.home?'home':'away')+'</text>';
    if(v==null){
      s+=head+'<rect class="dnp'+(i===sel?' sel':'')+'" x="'+x+'" y="'+(y(0)-18)+'" width="'+w+'" height="18" rx="2"><title>'+esc(fmtDate(g.date)+' '+(g.home?'vs ':'@ ')+g.opp+': did not play')+'</title></rect><text class="dnpt" x="'+(x+w/2)+'" y="'+(y(0)-7)+'" text-anchor="middle">DNP</text>'+hit+labs+'</g>';
      return;
    }
    const h=Math.max(1.5,(v/top)*ih);
    const cls=(v>st.line?'over':'under')+(g.model===false?' old':'');
    s+=head+'<rect class="'+cls+(i===sel?' sel':'')+'" x="'+x+'" y="'+(y(0)-h)+'" width="'+w+'" height="'+h+'" rx="2"><title>'+esc((g.date?fmtDate(g.date)+' '+(g.home?'vs ':'@ ')+g.opp+': ':'')+v)+'</title></rect>'+hit+
      '<text class="val" x="'+(x+w/2)+'" y="'+(y(0)-h-3)+'" font-size="8.5" text-anchor="middle">'+v+'</text>'+labs+'</g>';
  });
  s+='<line class="bk" x1="'+pL+'" x2="'+(W-pR)+'" y1="'+y(st.line)+'" y2="'+y(st.line)+'"/>';
  s+='<text class="bkl" x="'+(W-pR)+'" y="'+(y(st.line)-3)+'" font-size="9" text-anchor="end">'+(st.lineSrc==='DraftKings'?'book ':'model ')+st.line+'</text>';
  if(st.safeAdj!=null){
    s+='<line class="sf" x1="'+pL+'" x2="'+(W-pR)+'" y1="'+y(st.safeAdj)+'" y2="'+y(st.safeAdj)+'"/>';
    const near=Math.abs(y(st.safeAdj)-y(st.line))<12;
    s+='<text class="sfl" x="'+pL+'" y="'+(y(st.safeAdj)+(near?11:-3))+'" font-size="9">safe '+st.safeAdj+'</text>';
  }
  s+='</svg>';
  const g=slots[sel]||{};
  const detail = g.date ? fmtDate(g.date)+' '+(g.home?'vs ':'@ ')+g.opp+(g.res?' ('+g.res+')':'')+(g.post?' · playoffs':'')+': '+(vals[sel]==null?'did not play':vals[sel]+' '+st.label.toLowerCase())+(g.model===false&&!g.dnp?' · older than the model window':'') : '';
  return s+'<div class="small muted mono">'+esc(detail)+'</div>';
}
