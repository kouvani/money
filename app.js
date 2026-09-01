const KEY = "daydreamz-money-v6";
const LEGACY_KEY = "daydreamz-money-v5";
const SEED = {
  version: 6,
  startDate: "2026-08-31", startBudget: 8403.01, rate: 1.389, lastDate: null,
  accounts: [],
  vendors: [],
  items: [
    { id: "o1", kind: "out", date: "2026-08-31", name: "Chapa - rent", usd: 2500 / 1.389, cadFixed: 2500, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null },
    { id: "o2", kind: "out", date: "2026-08-31", name: "Chargeblast (5 bills)", usd: 1545, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null },
  ],
  settings: { theme: "system", currencyDisplay: "both", warnDaysAhead: 3 },
};
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const shift = (iso, n) => { const [y,m,d] = iso.split("-").map(Number); const t = new Date(y, m-1, d+n); return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`; };
const pretty = iso => { const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d).toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", year:"numeric" }); };
const fmt = (n, sym="US$") => (n<0?"−":"") + sym + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function migrate(raw){
  if (!raw || typeof raw !== "object") return structuredClone(SEED);
  if (raw.version === 6) return raw;
  // v5 and earlier: no version field
  return {
    version: 6,
    startDate: raw.startDate ?? SEED.startDate,
    startBudget: typeof raw.startBudget === "number" ? raw.startBudget : SEED.startBudget,
    rate: typeof raw.rate === "number" ? raw.rate : SEED.rate,
    lastDate: raw.lastDate ?? null,
    accounts: [],
    vendors: [],
    items: (raw.items || []).map(x => ({
      id: x.id, kind: x.kind, date: x.date, name: x.name,
      usd: x.usd, cadFixed: x.cadFixed ?? null, checked: !!x.checked,
      accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null,
    })),
    settings: { theme: "system", currencyDisplay: "both", warnDaysAhead: 3 },
  };
}

function load(){
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrate(JSON.parse(legacy));
  } catch(e){ console.error(e); }
  return structuredClone(SEED);
}

let s, date;
let view = "day";
let editStart = false;
let showRate = false;
const drafts = { in:{name:"",amount:"",cur:"USD"}, out:{name:"",amount:"",cur:"USD"} };

function save(){ s.lastDate = date; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){ console.error(e); } }

function calc(st, day){
  const sgn = x => x.kind==="in" ? x.usd : -x.usd;
  const carry = st.startBudget + st.items.filter(x=>x.checked && x.date<day).reduce((t,x)=>t+sgn(x),0);
  const today = st.items.filter(x=>x.date===day);
  const inT = today.filter(x=>x.kind==="in"), outT = today.filter(x=>x.kind==="out");
  const sum = (a,only) => a.filter(x=>!only||x.checked).reduce((t,x)=>t+x.usd,0);
  const inC=sum(inT,true), inA=sum(inT), outC=sum(outT,true), outA=sum(outT);
  const end = carry + inC - outC;
  const allTime = st.startBudget + st.items.filter(x=>x.checked).reduce((t,x)=>t+sgn(x),0);
  const ifAll = st.startBudget + st.items.reduce((t,x)=>t+sgn(x),0);
  const pendingEarlier = st.items.filter(x=>!x.checked && x.date<day).length;
  const dates = [...new Set(st.items.map(x=>x.date))].sort().reverse();
  return { carry,inT,outT,inC,inA,outC,outA,end,allTime,ifAll,pendingEarlier,dates };
}

function rowHTML(x){
  const color = x.kind==="in" ? "var(--in)" : "var(--out)";
  const sign = x.kind==="in" ? "+" : "−";
  const cad = x.cadFixed!=null ? x.cadFixed : x.usd*s.rate;
  return `<label class="row ${x.checked?"done":""}" data-id="${x.id}">
    <input type="checkbox" ${x.checked?"checked":""} style="accent-color:${color}" data-toggle="${x.id}">
    <div class="name">${esc(x.name)}${x.cadFixed!=null?'<span style="font-size:11px;color:var(--muted);margin-left:7px;font-weight:400">CAD</span>':""}</div>
    <div class="amt num"><div class="u" style="color:${x.checked?"var(--muted)":color}">${sign}${fmt(x.usd,"")}</div><div class="c">${fmt(cad,"C$")}</div></div>
    <button class="x" data-remove="${x.id}" title="Remove">×</button>
  </label>`;
}

function listHTML(kind, items){
  const isIn = kind==="in";
  const d = drafts[kind];
  const a = parseFloat(d.amount)||0;
  return `<div>
    <div class="lh"><div class="sw" style="background:${isIn?"var(--in)":"var(--out)"}"></div><div class="lt">${isIn?"Coming in":"Going out"}</div></div>
    <div class="hint">${isIn?"Check it when the money lands":"Check it when you pay it"}</div>
    ${items.length?items.map(rowHTML).join(""):'<div class="empty">Nothing on this day.</div>'}
    <div class="addrow">
      <div class="addgrid">
        <input data-f="name" data-k="${kind}" value="${esc(d.name)}" placeholder="${isIn?"Shopify payout":"Meta ads"}" aria-label="Name">
        <input data-f="amount" data-k="${kind}" type="number" step="0.01" value="${esc(d.amount)}" placeholder="0.00" style="text-align:right" aria-label="Amount">
        <select data-f="cur" data-k="${kind}" aria-label="Currency" style="padding:9px 6px"><option ${d.cur==="USD"?"selected":""}>USD</option><option ${d.cur==="CAD"?"selected":""}>CAD</option></select>
        <button class="btn" data-add="${kind}">Add</button>
      </div>
      ${d.cur==="CAD"&&a>0?`<div class="cadnote">${fmt(a,"C$")} = ${fmt(a/s.rate)} today. Stays ${fmt(a,"C$")} even if the rate moves.</div>`:""}
    </div>
  </div>`;
}

function render(){
  const m = calc(s, date);
  const isToday = date===todayISO();
  const isStart = date===s.startDate;
  let startCell;
  if (isStart) {
    startCell = editStart
      ? `<div style="display:flex;gap:6px;align-items:center"><input id="startDraft" type="number" step="0.01" value="${s.startBudget.toFixed(2)}" style="font-size:18px;font-weight:600;padding:4px 8px;width:130px"><button class="btn" id="saveStart" style="padding:6px 10px;font-size:12px">Save</button></div>`
      : `<button class="bare num big" id="editStart">${fmt(s.startBudget)}<span style="font-size:11px;color:var(--muted);margin-left:8px;text-decoration:underline;font-weight:400">edit</span></button>`;
  } else {
    startCell = `<div class="big num">${fmt(m.carry)}</div><div class="sub">carried from before</div>`;
  }
  const endColor = m.end<0 ? "var(--out)" : "var(--in)";
  const endFill = m.end<0 ? "var(--outSoft)" : "var(--inSoft)";

  let body;
  if (view==="day") {
    body = `<div class="cols">${listHTML("in", m.inT)}${listHTML("out", m.outT)}</div>`;
  } else {
    body = `<div style="margin-top:36px">${m.dates.length?"":'<div style="color:var(--muted)">Nothing logged on any day yet.</div>'}
      ${m.dates.map(d=>`<div class="grp"><button class="bare" style="font-size:14px;font-weight:600;margin-bottom:2px" data-open="${d}">${pretty(d)}<span style="font-size:11px;color:var(--muted);margin-left:8px;text-decoration:underline;font-weight:400">open</span></button>
      ${s.items.filter(x=>x.date===d).map(rowHTML).join("")}</div>`).join("")}</div>`;
  }

  document.getElementById("app").innerHTML = `
    <div class="datebar">
      <button class="nav" id="prev" aria-label="Previous day">‹</button>
      <input type="date" id="datePick" value="${date}" aria-label="Pick a date">
      <button class="nav" id="next" aria-label="Next day">›</button>
      ${isToday?"":'<button class="link" id="today">today</button>'}
      <div class="tabs"><button class="tab ${view==="day"?"on":""}" data-view="day">This day</button><button class="tab ${view==="all"?"on":""}" data-view="all">All days</button></div>
    </div>
    <div class="dayhead">${pretty(date)}</div>
    <div class="flow num">
      <div class="cell"><div class="lbl">${isStart?"Starting with":"Start of day"}</div><div>${startCell}</div></div>
      <div class="cell"><div class="lbl" style="color:var(--in)">Came in</div><div><div class="big" style="color:var(--in)">+${fmt(m.inC,"")}</div>${m.inA>m.inC?`<div class="sub">of ${fmt(m.inA,"")} expected</div>`:""}</div></div>
      <div class="cell"><div class="lbl" style="color:var(--out)">Went out</div><div><div class="big" style="color:var(--out)">−${fmt(m.outC,"")}</div>${m.outA>m.outC?`<div class="sub">of ${fmt(m.outA,"")} owed</div>`:""}</div></div>
      <div class="cell" style="background:${endFill}"><div class="lbl">Left</div><div><div class="huge" style="color:${endColor}">${fmt(m.end)}</div><div class="sub">${fmt(m.end*s.rate,"C$")}</div></div></div>
    </div>
    <div class="summary num">
      <span>All days so far: <b>${fmt(m.allTime)}</b></span>
      <span>If everything lands and gets paid: <b style="color:${m.ifAll<0?"var(--out)":"var(--ink)"}">${fmt(m.ifAll)}</b></span>
      ${m.pendingEarlier>0&&view==="day"?`<button class="link" style="margin-left:0;color:var(--out)" data-view="all">${m.pendingEarlier} unchecked from earlier days</button>`:""}
    </div>
    ${body}
    <div class="foot">
      1 USD = ${s.rate.toFixed(4)} CAD<button class="link" id="rateToggle">change</button>
      ${showRate?`<input id="rateInput" type="number" step="0.0001" value="${s.rate}" style="width:110px;margin-left:10px;display:inline-block;padding:5px 8px">`:""}
      <span style="margin-left:18px">Started ${pretty(s.startDate)} with ${fmt(s.startBudget)}</span>
      <button class="link" id="export" style="margin-left:18px">export CSV</button>
    </div>`;
  bind();
}

function bind(){
  const $ = id => document.getElementById(id);
  const app = $("app");
  $("prev").onclick = ()=>{ date=shift(date,-1); save(); render(); };
  $("next").onclick = ()=>{ date=shift(date,1); save(); render(); };
  $("datePick").onchange = e=>{ if(e.target.value){ date=e.target.value; save(); render(); } };
  if ($("today")) $("today").onclick = ()=>{ date=todayISO(); save(); render(); };
  app.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{ view=b.dataset.view; render(); });
  app.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{ date=b.dataset.open; view="day"; save(); render(); });
  app.querySelectorAll("[data-toggle]").forEach(c=>c.onchange=()=>{ const x=s.items.find(i=>i.id===c.dataset.toggle); x.checked=!x.checked; save(); render(); });
  app.querySelectorAll("[data-remove]").forEach(b=>b.onclick=e=>{ e.preventDefault(); s.items=s.items.filter(i=>i.id!==b.dataset.remove); save(); render(); });
  app.querySelectorAll("[data-f]").forEach(el=>{
    const k=el.dataset.k, f=el.dataset.f;
    el.oninput = ()=>{ drafts[k][f]=el.value; if(f==="cur"||f==="amount"){ const focus=document.activeElement; const pos=focus.selectionStart; render(); const again=app.querySelector(`[data-f="${f}"][data-k="${k}"]`); if(again){ again.focus(); if(f==="amount"&&pos!=null) try{again.setSelectionRange(pos,pos);}catch{} } } };
    el.onkeydown = e=>{ if(e.key==="Enter") add(k); };
  });
  app.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>add(b.dataset.add));
  if ($("editStart")) $("editStart").onclick = ()=>{ editStart=true; render(); $("startDraft").focus(); };
  if ($("saveStart")) { const doSave=()=>{ const v=parseFloat($("startDraft").value); editStart=false; if(!isNaN(v)){ s.startBudget=v; s.startDate=date; } save(); render(); };
    $("saveStart").onclick=doSave; $("startDraft").onkeydown=e=>{ if(e.key==="Enter") doSave(); if(e.key==="Escape"){ editStart=false; render(); } }; }
  $("rateToggle").onclick = ()=>{ showRate=!showRate; render(); };
  if ($("rateInput")) $("rateInput").oninput = e=>{ s.rate=parseFloat(e.target.value)||1; save(); const keep=e.target; const v=keep.value; render(); const again=$("rateInput"); if(again){ again.value=v; again.focus(); } };
  $("export").onclick = exportCsv;
}

function add(kind){
  const d=drafts[kind]; const a=parseFloat(d.amount)||0;
  if(!d.name.trim()||!a) return;
  s.items.push({ id:"x"+Date.now(), kind, date, name:d.name.trim(), usd: d.cur==="CAD"?a/s.rate:a, cadFixed: d.cur==="CAD"?a:null, checked:false, accountId:null, vendorId:null, note:"", receiptUrl:"", recurringSourceId:null });
  drafts[kind]={name:"",amount:"",cur:d.cur};
  save(); render();
  const el=document.querySelector(`[data-f="name"][data-k="${kind}"]`); if(el) el.focus();
}

function exportCsv(){
  const rows=[["Date","Type","Name","Amount USD","Amount CAD","CAD locked","Done"],
    ...[...s.items].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>[x.date, x.kind==="in"?"Money in":"Money out", x.name, x.usd.toFixed(6), (x.cadFixed!=null?x.cadFixed:x.usd*s.rate).toFixed(2), x.cadFixed!=null?"yes":"no", x.checked?"yes":"no"])];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a"); a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv); a.download=`money-${todayISO()}.csv`; a.click();
}

if (typeof window === "undefined") {
  module.exports = { SEED, KEY, LEGACY_KEY, migrate, calc, fmt };
} else {
  s = load();
  date = s.lastDate || todayISO();
  save();
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
}
