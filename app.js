'use strict';
/* ========= 資料 ========= */
const KEY = 'ledger-v1';
const DEFAULT_CATS = [
  { id:'food',   emoji:'🍚', name:'吃飯', period:'week',  amount:115, rollover:false, wallet:true },
  { id:'snack',  emoji:'🍡', name:'點心', period:'week',  amount:20,  rollover:false, wallet:true },
  { id:'game',   emoji:'🎮', name:'娛樂', period:'month', amount:30,  rollover:false },
  { id:'shop',   emoji:'🛍️', name:'購物', period:'month', amount:80,  rollover:true },
  { id:'rhythm', emoji:'🎵', name:'音遊', period:'month', amount:50,  rollover:true },
  { id:'groc',   emoji:'🥩', name:'食材', period:'none',  amount:0 },
  { id:'daily',  emoji:'🧴', name:'生活', period:'none',  amount:0 },
  { id:'med',    emoji:'💊', name:'醫療', period:'none',  amount:0 },
  { id:'trans',  emoji:'🚇', name:'交通', period:'none',  amount:0, transport:true },
  { id:'study',  emoji:'📚', name:'學業', period:'none',  amount:0 },
  { id:'sub',    emoji:'📺', name:'訂閱', period:'none',  amount:0 },
  { id:'house',  emoji:'🏠', name:'住房', period:'none',  amount:0 },
  { id:'trip',   emoji:'✈️', name:'旅遊', period:'none',  amount:0 },
  { id:'other',  emoji:'📦', name:'其他', period:'none',  amount:0 },
];
function defaultState(){
  return {
    version:1,
    settings:{ startDate: ymd(new Date()), travelStart:0, rates:{ JPY:0.0088, TWD:0.042 },
               earlyMorning:true, cutoffHour:4 },
    categories: structuredClone(DEFAULT_CATS),
    expenses: [],      // {id,date,amount(SGD),currency,orig,pending,cat,note,excluded,created}
    adjustments: [],   // {id,date,from,to,amount,note}  from/to: catId | 'travel' | ''
  };
}
let S = load();
function load(){
  try{ const s = JSON.parse(localStorage.getItem(KEY)); if(s && s.version) return s; }catch(e){}
  return defaultState();
}
function save(){ localStorage.setItem(KEY, JSON.stringify(S)); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

/* ========= 日期工具 ========= */
function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parse(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(s,n){ const d=parse(s); d.setDate(d.getDate()+n); return ymd(d); }
function weekStart(s){ const d=parse(s); const wd=(d.getDay()+6)%7; d.setDate(d.getDate()-wd); return ymd(d); } // 週一
function monthKey(s){ return s.slice(0,7); }
function monthStart(mk){ return mk+'-01'; }
function monthEnd(mk){ const [y,m]=mk.split('-').map(Number); return ymd(new Date(y,m,0)); }
function addMonths(mk,n){ const [y,m]=mk.split('-').map(Number); const d=new Date(y,m-1+n,1); return ymd(d).slice(0,7); }
const today = () => ymd(new Date());
const WD = ['日','一','二','三','四','五','六'];
function fmtDay(s){ const d=parse(s); return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`; }
const money = n => (n<0?'-':'') + '$' + Math.abs(n).toFixed(2);
const r2 = n => Math.round(n*100)/100;

/* ========= 計算 ========= */
const cat = id => S.categories.find(c=>c.id===id) || {id, emoji:'❓', name:id, period:'none'};
const counted = e => !e.excluded;
function spent(catId, from, to, includeExcluded=false){
  let t=0; for(const e of S.expenses){ if(e.cat===catId && e.date>=from && e.date<=to && (includeExcluded||counted(e))) t+=e.amount; }
  return r2(t);
}
function adjNet(target, from, to){
  let t=0; for(const a of S.adjustments){ if(a.date<from||a.date>to) continue;
    if(a.to===target) t+=a.amount; if(a.from===target) t-=a.amount; }
  return r2(t);
}
/* 某分類在某日所屬期間的狀態 */
function budgetStatus(c, onDate=today()){
  if(c.period==='week'){
    const ws=weekStart(onDate), we=addDays(ws,6);
    const limit = r2(c.amount + adjNet(c.id, ws, we));
    const sp = spent(c.id, ws, we);
    const daysLeft = Math.round((parse(we)-parse(onDate))/864e5)+1;
    return { limit, spent:sp, remaining:r2(limit-sp), from:ws, to:we, daysLeft };
  }
  if(c.period==='month'){
    const mk=monthKey(onDate), ms=monthStart(mk), me=monthEnd(mk);
    let carry=0;
    if(c.rollover){
      let m = monthKey(S.settings.startDate);
      while(m<mk){ carry += c.amount + adjNet(c.id, monthStart(m), monthEnd(m)) - spent(c.id, monthStart(m), monthEnd(m)); m=addMonths(m,1); }
    }
    carry=r2(carry);
    const limit = r2(c.amount + carry + adjNet(c.id, ms, me));
    const sp = spent(c.id, ms, me);
    return { limit, spent:sp, remaining:r2(limit-sp), carry, from:ms, to:me };
  }
  return null;
}
const walletCats = () => S.categories.filter(c=>c.wallet && c.period==='week');
function walletWeek(ws){
  const we=addDays(ws,6); let limit=0, sp=0;
  for(const c of walletCats()){ limit += c.amount + adjNet(c.id,ws,we); sp += spent(c.id,ws,we); }
  return { limit:r2(limit), spent:r2(sp), remaining:r2(limit-sp) };
}
/* 旅遊基金：已結束的每週「吃飯＋點心」結餘（可為負）＋調整 */
function travelFund(){
  const curWs = weekStart(today());
  let bal = S.settings.travelStart || 0, ws = weekStart(S.settings.travelFrom || S.settings.startDate);
  while(ws < curWs){ bal += walletWeek(ws).remaining; ws = addDays(ws,7); }
  bal += adjNet('travel', '0000-01-01', '9999-12-31');
  return { balance:r2(bal), thisWeek: walletWeek(curWs).remaining };
}

/* ========= 畫面：總覽 ========= */
function budgetLine(c, st, wallet){
  // 吃飯/點心某類超出、但合計仍在額度內 → 顯示合計剩餘
  let main, sub='';
  if(c.wallet && st.remaining<0 && wallet.remaining>=0){
    main = `<b>合計剩 ${money(wallet.remaining)}</b>`; sub = `本類已用 ${money(st.spent)}`;
  } else if(c.period==='week'){
    main = `<b class="${st.remaining<0?'neg':''}">${st.remaining<0?'超出 '+money(-st.remaining):'本週剩 '+money(st.remaining)}</b>`;
    if(c.id==='food' && st.remaining>0) sub = `平均剩 ${money(st.remaining/st.daysLeft)}/天`;
  } else {
    main = `<b class="${st.remaining<0?'neg':''}">${st.remaining<0?'超出 '+money(-st.remaining):'本月剩 '+money(st.remaining)}</b>`;
    const extra = r2(st.limit - c.amount);
    sub = extra ? `${c.rollover?'含滾存/調整':'含調整'} ${money(extra)}` : '';
  }
  const pct = st.limit>0 ? Math.min(100, Math.max(0, st.spent/st.limit*100)) : 100;
  return `<div class="budget-row"><div><div class="name">${c.emoji} ${c.name}</div>
    <div class="muted small">${money(st.spent)} / ${money(st.limit)}</div></div>
    <div class="val">${main}<div class="muted small">${sub}</div></div></div>
    <div class="progress"><i style="width:${pct}%"></i></div>`;
}
function renderHome(){
  const t=today(), wws=weekStart(t), wallet=walletWeek(wws), tf=travelFund();
  const todaySpent = S.expenses.filter(e=>e.date===t && counted(e)).reduce((a,e)=>a+e.amount,0);
  const mk=monthKey(t);
  let weekly='', monthly='', track='';
  for(const c of S.categories){
    const st=budgetStatus(c,t);
    if(c.period==='week') weekly += budgetLine(c,st,wallet);
    else if(c.period==='month') monthly += budgetLine(c,st,wallet);
    else { const s=spent(c.id, monthStart(mk), monthEnd(mk)); if(s) track += `<div class="budget-row"><span>${c.emoji} ${c.name}</span><span class="num">${money(s)}</span></div>`; }
  }
  const walletNote = wallet.remaining<0
    ? `<div class="small neg" style="margin-top:8px">合計超出 ${money(-wallet.remaining)}（週末從旅遊基金扣）</div>`
    : `<div class="small muted" style="margin-top:8px">吃飯＋點心合計剩 ${money(wallet.remaining)}</div>`;
  document.getElementById('view-home').innerHTML = `
    <div class="card"><h3>今天 ${fmtDay(t)}</h3><div class="big">${money(todaySpent)}</div></div>
    <div class="card"><h3>本週（${fmtDay(wws).replace(/（.）/,'')}–${fmtDay(addDays(wws,6)).replace(/（.）/,'')}）</h3>${weekly}${walletNote}</div>
    <div class="card"><h3>本月</h3>${monthly}</div>
    <div class="card"><h3>✈️ 旅遊基金</h3><div class="big">${money(tf.balance)}</div>
      <div class="muted small">本週結算後預計 ${tf.thisWeek>=0?'存入':'扣除'} ${money(Math.abs(tf.thisWeek))}</div></div>
    <div class="card"><h3>只記錄（本月）</h3>${track||'<span class="muted small">本月還沒有</span>'}</div>
    <div class="card"><button class="link" id="openAdj">＋ 預算調整 / 轉移</button></div>`;
  document.getElementById('openAdj').onclick = openAdj;
}

/* ========= 畫面：紀錄 ========= */
let recMonth = monthKey(today());
function renderRecords(){
  const list = S.expenses.filter(e=>monthKey(e.date)===recMonth)
    .sort((a,b)=> b.date.localeCompare(a.date) || b.created-a.created);
  const adjs = S.adjustments.filter(a=>monthKey(a.date)===recMonth);
  const byDay = {}; for(const e of list) (byDay[e.date] ||= []).push(e);
  let html = `<div class="periodnav"><button id="rPrev">‹</button><b>${recMonth.replace('-',' 年 ')} 月</b><button id="rNext">›</button></div>`;
  const pend = S.expenses.filter(e=>e.pending);
  if(pend.length) html += `<div class="card small">⏳ 有 ${pend.length} 筆暫估金額待確認（標「暫估」的項目）</div>`;
  if(!list.length && !adjs.length) html += `<p class="muted">這個月還沒有紀錄。</p>`;
  for(const d of Object.keys(byDay)){
    const tot = byDay[d].filter(counted).reduce((a,e)=>a+e.amount,0);
    html += `<div class="day-head"><span>${fmtDay(d)}</span><span class="num">${money(tot)}</span></div>`;
    for(const e of byDay[d]){
      const c=cat(e.cat);
      const orig = e.currency!=='SGD' ? `<span class="muted small"> ${e.currency==='JPY'?'¥':'NT$'}${e.orig}</span>` : '';
      html += `<div class="rec" data-id="${e.id}"><span class="emo">${c.emoji}</span>
        <div class="mid"><div>${esc(e.note)||c.name}${e.pending?'<span class="tag pending">暫估</span>':''}${e.excluded?'<span class="tag">不計入</span>':''}</div>
        <div class="muted small">${c.name}${orig}</div></div><div class="amt">${money(e.amount)}</div></div>`;
    }
  }
  if(adjs.length){
    html += `<div class="day-head"><span>預算調整</span></div>`;
    for(const a of adjs) html += `<div class="rec" data-adj="${a.id}"><span class="emo">↔️</span><div class="mid"><div>${esc(a.note)||'調整'}</div>
      <div class="muted small">${a.date}｜${lbl(a.from)} → ${lbl(a.to)}</div></div><div class="amt">${money(a.amount)}</div></div>`;
  }
  const v=document.getElementById('view-records'); v.innerHTML=html;
  v.querySelector('#rPrev').onclick=()=>{recMonth=addMonths(recMonth,-1);renderRecords();};
  v.querySelector('#rNext').onclick=()=>{recMonth=addMonths(recMonth,1);renderRecords();};
  v.querySelectorAll('.rec[data-id]').forEach(el=>el.onclick=()=>openEntry(S.expenses.find(e=>e.id===el.dataset.id)));
  v.querySelectorAll('.rec[data-adj]').forEach(el=>el.onclick=()=>{
    if(confirm('刪除這筆預算調整？')){ S.adjustments=S.adjustments.filter(a=>a.id!==el.dataset.adj); save(); renderAll(); }
  });
}
const lbl = v => v==='travel' ? '✈️ 旅遊基金' : v ? cat(v).emoji+' '+cat(v).name : '（無）';
const esc = s => (s||'').replace(/[&<>"]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

/* ========= 畫面：統計 ========= */
let stMode='month', stAnchor=today();
function renderStats(){
  let from,to,title;
  if(stMode==='week'){ from=weekStart(stAnchor); to=addDays(from,6); title=`${from.slice(5).replace('-','/')} – ${to.slice(5).replace('-','/')}`; }
  else { const mk=monthKey(stAnchor); from=monthStart(mk); to=monthEnd(mk); title=mk.replace('-',' 年 ')+' 月'; }
  const inRange = S.expenses.filter(e=>e.date>=from && e.date<=to);
  const own = inRange.filter(counted).reduce((a,e)=>a+e.amount,0);
  const all = inRange.reduce((a,e)=>a+e.amount,0);
  // 分類
  const rows = S.categories.map(c=>({c, own:spent(c.id,from,to), all:spent(c.id,from,to,true)}))
    .filter(r=>r.all!==0).sort((a,b)=>b.own-a.own);
  const max = Math.max(1, ...rows.map(r=>r.own));
  const catHtml = rows.map(r=>`<div class="catbar"><span>${r.c.emoji} ${r.c.name}</span>
      <div class="track"><i style="width:${Math.max(0,r.own)/max*100}%"></i></div>
      <span class="v">${money(r.own)}${r.all!==r.own?`<small>含代購 ${money(r.all)}</small>`:''}</span></div>`).join('')
    || '<span class="muted small">這段期間沒有支出</span>';
  // 每日
  const days=[]; for(let d=from; d<=to; d=addDays(d,1)) days.push(d);
  const daily = days.map(d=>r2(inRange.filter(e=>e.date===d && counted(e)).reduce((a,e)=>a+e.amount,0)));
  const avg = own/days.length;
  const v=document.getElementById('view-stats');
  v.innerHTML = `
    <div class="seg"><button data-m="week" class="${stMode==='week'?'sel':''}">週</button><button data-m="month" class="${stMode==='month'?'sel':''}">月</button></div>
    <div class="periodnav"><button id="sPrev">‹</button><b>${title}</b><button id="sNext">›</button></div>
    <div class="card"><h3>總支出（自用）</h3><div class="big">${money(own)}</div>
      <div class="muted small">平均每天 ${money(avg)}${all!==own?`｜含不計入 ${money(all)}`:''}</div></div>
    <div class="card"><h3>每日花費</h3><div class="chart" id="dailyChart"></div></div>
    <div class="card"><h3>依分類</h3>${catHtml}</div>`;
  v.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{stMode=b.dataset.m;renderStats();});
  const step = n => { stAnchor = stMode==='week' ? addDays(stAnchor,7*n) : monthStart(addMonths(monthKey(stAnchor),n)); renderStats(); };
  v.querySelector('#sPrev').onclick=()=>step(-1); v.querySelector('#sNext').onclick=()=>step(1);
  drawDaily(v.querySelector('#dailyChart'), days, daily);
}
function drawDaily(el, days, vals){
  const W=600, H=200, pl=40, pr=8, pt=10, pb=24, n=days.length;
  const maxV = Math.max(10, ...vals); const nice = niceMax(maxV);
  const bw = (W-pl-pr)/n, gap = Math.min(4, bw*0.25);
  const y = v => pt + (H-pt-pb)*(1-v/nice);
  let g='';
  for(let i=0;i<=4;i++){ const v=nice*i/4, yy=y(v);
    g+=`<line x1="${pl}" x2="${W-pr}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-width="1"/>
        <text x="${pl-6}" y="${yy+4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(v)}</text>`; }
  let bars='', hits='';
  vals.forEach((v,i)=>{
    const x=pl+i*bw+gap/2, w=bw-gap, top=y(Math.max(0,v)), h=y(0)-top;
    if(v>0){ const rr=Math.min(4,w/2,h);
      bars+=`<path d="M${x},${y(0)} V${top+rr} Q${x},${top} ${x+rr},${top} H${x+w-rr} Q${x+w},${top} ${x+w},${top+rr} V${y(0)} Z" fill="var(--bar)"/>`; }
    hits+=`<rect x="${pl+i*bw}" y="${pt}" width="${bw}" height="${H-pt-pb}" fill="transparent" data-i="${i}"/>`;
    const every = n>10 ? 5 : 1; const dd=parse(days[i]);
    if(n<=10 || dd.getDate()===1 || dd.getDate()%every===0)
      bars+=`<text x="${pl+i*bw+bw/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--muted)">${n<=10?WD[dd.getDay()]:dd.getDate()}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日花費長條圖">${g}${bars}${hits}</svg><div class="tip"></div>`;
  const tip=el.querySelector('.tip'), svg=el.querySelector('svg');
  const show = ev => { const r=ev.target.closest('rect[data-i]'); if(!r){tip.style.display='none';return;}
    const i=+r.dataset.i, box=svg.getBoundingClientRect(), sx=box.width/W;
    tip.textContent=`${fmtDay(days[i])} ${money(vals[i])}`; tip.style.display='block';
    tip.style.left=(pl+i*bw+bw/2)*sx+'px'; tip.style.top=y(Math.max(0,vals[i]))*sx+'px'; };
  svg.addEventListener('pointermove',show); svg.addEventListener('pointerdown',show);
  svg.addEventListener('pointerleave',()=>tip.style.display='none');
}
function niceMax(v){ const p=Math.pow(10,Math.floor(Math.log10(v))); for(const m of [1,2,2.5,5,10]) if(m*p>=v) return m*p; return 10*p; }

/* ========= 畫面：設定 ========= */
function renderSettings(){
  const s=S.settings;
  const catRows = S.categories.map((c,i)=>`<div class="set-row" data-i="${i}">
      <input class="emo" value="${c.emoji}" data-k="emoji"><input class="nm" value="${esc(c.name)}" data-k="name">
      <select data-k="period"><option value="week" ${c.period==='week'?'selected':''}>每週</option><option value="month" ${c.period==='month'?'selected':''}>每月</option><option value="none" ${c.period==='none'?'selected':''}>只記錄</option></select>
      <input class="amt" type="number" step="any" value="${c.amount}" data-k="amount" ${c.period==='none'?'disabled':''}>
      <label class="check small"><input type="checkbox" data-k="rollover" ${c.rollover?'checked':''} ${c.period!=='month'?'disabled':''}>滾存</label>
      <label class="check small"><input type="checkbox" data-k="wallet" ${c.wallet?'checked':''} ${c.period!=='week'?'disabled':''}>吃飯錢包</label>
    </div>`).join('');
  document.getElementById('view-settings').innerHTML = `
    <div class="card"><h3>分類與預算</h3>${catRows}
      <div class="small muted" style="margin-top:8px">「吃飯錢包」：勾選的每週分類共用額度，週結餘存入旅遊基金，超出從旅遊基金扣。</div>
      <button class="link" id="addCat">＋ 新增分類</button></div>
    <div class="card"><h3>基本設定</h3>
      <label class="inline"><span>開始日</span><input type="date" id="sStart" value="${s.startDate}"></label>
      <label class="inline"><span>旅遊基金開始日</span><input type="date" id="sTravelFrom" value="${s.travelFrom||s.startDate}"></label>
      <label class="inline"><span>旅遊基金起始</span><input type="number" step="any" id="sTravel" value="${s.travelStart}"></label>
      <label class="inline"><span>¥1 =S$</span><input type="number" step="any" id="sJPY" value="${s.rates.JPY}"></label>
      <label class="inline"><span>NT$1 =S$</span><input type="number" step="any" id="sTWD" value="${s.rates.TWD}"></label>
      <label class="check"><input type="checkbox" id="sEarly" ${s.earlyMorning?'checked':''}> 凌晨 ${s.cutoffHour} 點前記的交通費，日期預設前一天</label>
      <div class="small muted">開始日：滾存與旅遊基金從這天所在的週/月開始累計。購物、音遊的起始滾存可用「預算調整」補。</div>
    </div>
    <div class="card"><h3>備份</h3><div class="btnrow">
      <button class="ghost" id="exJson">匯出備份 (JSON)</button>
      <button class="ghost" id="exCsv">匯出 CSV</button>
      <button class="ghost" id="imJson">匯入備份</button>
      <input type="file" id="imFile" accept=".json,application/json" class="hidden">
    </div><div class="small muted" style="margin-top:8px">資料只存在這支手機的瀏覽器裡，記得定期匯出備份。</div></div>
    <div class="card"><button class="danger" id="reset">清除全部資料</button></div>`;
  const v=document.getElementById('view-settings');
  v.querySelectorAll('.set-row').forEach(row=>{
    const c=S.categories[+row.dataset.i];
    row.querySelectorAll('[data-k]').forEach(inp=>inp.onchange=()=>{
      const k=inp.dataset.k;
      c[k] = inp.type==='checkbox' ? inp.checked : k==='amount' ? Number(inp.value)||0 : inp.value;
      if(k==='period'){ if(c.period!=='month') c.rollover=false; if(c.period!=='week') c.wallet=false; renderSettings(); }
      save(); renderHome();
    });
  });
  v.querySelector('#addCat').onclick=()=>{ S.categories.push({id:uid(),emoji:'🏷️',name:'新分類',period:'none',amount:0}); save(); renderSettings(); };
  const bind=(id,fn)=>v.querySelector(id).onchange=e=>{fn(e.target);save();renderAll();};
  bind('#sStart',t=>s.startDate=t.value||s.startDate);
  bind('#sTravel',t=>s.travelStart=Number(t.value)||0);
  bind('#sTravelFrom',t=>s.travelFrom=t.value||s.startDate);
  bind('#sJPY',t=>s.rates.JPY=Number(t.value)||s.rates.JPY);
  bind('#sTWD',t=>s.rates.TWD=Number(t.value)||s.rates.TWD);
  bind('#sEarly',t=>s.earlyMorning=t.checked);
  v.querySelector('#exJson').onclick=()=>download(`記帳備份-${today()}.json`, JSON.stringify(S,null,1), 'application/json');
  v.querySelector('#exCsv').onclick=()=>{
    const head='日期,金額(SGD),原幣,原幣金額,分類,備註,不計入,暫估';
    const lines=S.expenses.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(e=>
      [e.date,e.amount,e.currency,e.orig,cat(e.cat).name,'"'+(e.note||'').replace(/"/g,'""')+'"',e.excluded?1:0,e.pending?1:0].join(','));
    download(`記帳-${today()}.csv`, '﻿'+[head,...lines].join('\n'), 'text/csv');
  };
  v.querySelector('#imJson').onclick=()=>v.querySelector('#imFile').click();
  v.querySelector('#imFile').onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    try{ const d=JSON.parse(await f.text()); if(!d.version||!Array.isArray(d.expenses)) throw 0;
      if(confirm(`匯入 ${d.expenses.length} 筆紀錄並取代目前資料？`)){ S=d; save(); renderAll(); toast('已匯入'); }
    }catch(_){ alert('檔案格式不對'); }
  };
  v.querySelector('#reset').onclick=()=>{ if(confirm('確定清除全部資料？無法復原（建議先匯出備份）')){ S=defaultState(); save(); renderAll(); } };
}
function download(name, text, type){
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

/* ========= 新增/編輯 ========= */
const dlg=document.getElementById('entryDialog'), F=id=>document.getElementById(id);
let editing=null, selCat=null, dateTouched=false;
function openEntry(e=null){
  editing=e; dateTouched=!!e;
  F('entryTitle').textContent = e?'編輯支出':'新增支出';
  F('fDelete').classList.toggle('hidden',!e);
  F('fCurrency').value = e?.currency || 'SGD';
  F('fAmount').value = e ? (e.currency==='SGD'?e.amount:e.orig) : '';
  F('fSgd').value = e && e.currency!=='SGD' ? e.amount : '';
  F('fPending').checked = !!e?.pending;
  F('fDate').value = e?.date || today();
  F('fNote').value = e?.note || '';
  F('fExcluded').checked = !!e?.excluded;
  selCat = e?.cat || null;
  F('fCats').innerHTML = S.categories.map(c=>`<button type="button" data-c="${c.id}" class="${c.id===selCat?'sel':''}"><span>${c.emoji}</span>${esc(c.name)}</button>`).join('');
  F('fCats').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    selCat=b.dataset.c; F('fCats').querySelectorAll('button').forEach(x=>x.classList.toggle('sel',x===b));
    const c=cat(selCat);
    if(!dateTouched && c.transport && S.settings.earlyMorning && new Date().getHours()<S.settings.cutoffHour) F('fDate').value=addDays(today(),-1);
  });
  updateFx(!e);
  dlg.showModal(); if(!e) F('fAmount').focus();
}
function updateFx(setDefaultPending){
  const cur=F('fCurrency').value, box=F('fxBox');
  box.classList.toggle('hidden', cur==='SGD');
  if(cur==='SGD') return;
  if(setDefaultPending) F('fPending').checked = cur==='JPY';   // 日幣預設暫估，台幣直接概算
  const a=Number(F('fAmount').value)||0, est=r2(a*S.settings.rates[cur]);
  F('fxHint').textContent = `匯率估算 ≈ ${money(est)}`;
}
F('fCurrency').onchange=()=>updateFx(true);
F('fAmount').oninput=()=>updateFx(false);
F('fDate').onchange=()=>dateTouched=true;
F('fCancel').onclick=()=>dlg.close();
F('fDelete').onclick=()=>{ if(editing && confirm('刪除這筆？')){ S.expenses=S.expenses.filter(x=>x.id!==editing.id); save(); dlg.close(); renderAll(); } };
F('entryForm').onsubmit=ev=>{
  ev.preventDefault();
  if(!selCat){ toast('請選分類'); return; }
  const cur=F('fCurrency').value, a=Number(F('fAmount').value);
  if(!a && a!==0){ toast('請輸入金額'); return; }
  const manual=F('fSgd').value!=='' ? Number(F('fSgd').value) : null;
  const sgd = cur==='SGD' ? a : (manual ?? r2(a*S.settings.rates[cur]));
  const rec = { id:editing?.id||uid(), created:editing?.created||Date.now(), date:F('fDate').value, amount:r2(sgd), currency:cur,
    orig: cur==='SGD'?null:a, pending: cur!=='SGD' && F('fPending').checked, cat:selCat, note:F('fNote').value.trim(), excluded:F('fExcluded').checked };
  if(editing) Object.assign(editing, rec); else S.expenses.push(rec);
  save(); dlg.close(); renderAll();
  // 只顯示這筆所屬分類的剩餘
  const c=cat(selCat), st=budgetStatus(c, rec.date);
  let msg=`${c.emoji} ${c.name} 已記 ${money(rec.amount)}`;
  if(rec.excluded) msg+='（不計入）';
  else if(st){
    const w=walletWeek(weekStart(rec.date));
    if(c.wallet && st.remaining<0 && w.remaining>=0) msg+=`｜吃飯＋點心合計剩 ${money(w.remaining)}`;
    else if(st.remaining<0) msg+=`｜超出 ${money(-st.remaining)}`;
    else msg+=`｜${c.period==='week'?'本週':'本月'}剩 ${money(st.remaining)}`;
    if(c.id==='food' && st.remaining>0 && rec.date===today()) msg+=`，平均 ${money(st.remaining/st.daysLeft)}/天`;
  }
  toast(msg);
};

/* ========= 預算調整 ========= */
const adlg=document.getElementById('adjDialog');
function openAdj(){
  const opts = `<option value="">（無）</option><option value="travel">✈️ 旅遊基金</option>` +
    S.categories.filter(c=>c.period!=='none').map(c=>`<option value="${c.id}">${c.emoji} ${esc(c.name)}</option>`).join('');
  F('aFrom').innerHTML=opts; F('aTo').innerHTML=opts;
  F('aAmount').value=''; F('aDate').value=today(); F('aNote').value='';
  adlg.showModal();
}
F('aCancel').onclick=()=>adlg.close();
F('adjForm').onsubmit=ev=>{
  ev.preventDefault();
  const from=F('aFrom').value, to=F('aTo').value, amount=Number(F('aAmount').value);
  if(!amount || (!from && !to) || from===to){ toast('請選擇來源或目標，並輸入金額'); return; }
  S.adjustments.push({id:uid(), date:F('aDate').value, from, to, amount:r2(amount), note:F('aNote').value.trim()});
  save(); adlg.close(); renderAll(); toast('已調整');
};

/* ========= 其他 ========= */
let toastT;
function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),3200); }
const TITLES={home:'總覽',records:'紀錄',stats:'統計',settings:'設定'};
let curView='home';
function show(v){
  curView=v;
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active', s.id==='view-'+v));
  document.querySelectorAll('.tabbar button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  document.getElementById('pageTitle').textContent=TITLES[v];
  document.getElementById('fab').classList.toggle('hidden', v==='settings');
  renderAll();
}
function renderAll(){ renderHome(); if(curView==='records') renderRecords(); if(curView==='stats') renderStats(); if(curView==='settings') renderSettings(); }
document.querySelectorAll('.tabbar button').forEach(b=>b.onclick=()=>show(b.dataset.view));
document.getElementById('fab').onclick=()=>openEntry();
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) renderAll(); });
renderAll();
if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('sw.js');
