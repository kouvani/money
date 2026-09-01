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
const prettyShort = iso => { const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }); };
const fmt = (n, sym="US$") => (n<0?"−":"") + sym + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const round2 = n => Math.round(n * 100) / 100;
const uid = p => p + Math.random().toString(36).slice(2, 10);

function migrate(raw){
  if (!raw || typeof raw !== "object") return structuredClone(SEED);
  if (raw.version === 6) return ensure(raw);
  // v5 and earlier: no version field
  return ensure({
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
    settings: {},
  });
}

// Older v6 blobs stay loadable as the shape grows: fill anything missing, silently.
function ensure(st){
  st.accounts = st.accounts || [];
  st.vendors = st.vendors || [];
  st.items = st.items || [];
  st.settings = Object.assign({ theme: "system", currencyDisplay: "both", warnDaysAhead: 3 }, st.settings || {});
  st.vendors.forEach(v => {
    v.note = v.note ?? ""; v.url = v.url ?? ""; v.cadence = v.cadence ?? null;
    v.dayOfMonth = v.dayOfMonth ?? null; v.defaultAccountId = v.defaultAccountId ?? null;
  });
  st.items.forEach(x => {
    x.cadFixed = x.cadFixed ?? null; x.accountId = x.accountId ?? null; x.vendorId = x.vendorId ?? null;
    x.note = x.note ?? ""; x.receiptUrl = x.receiptUrl ?? ""; x.recurringSourceId = x.recurringSourceId ?? null;
  });
  return st;
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
let openVendorId = null;
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

// ---- vendors ----

function findVendorByName(st, name){
  const n = String(name).trim().toLowerCase();
  return st.vendors.find(v => v.name.toLowerCase() === n) || null;
}

// Called whenever an entry is logged: reuse the vendor by name or create one,
// remember the entry's amount/currency/direction/account as the new defaults.
function upsertVendorFromEntry(st, item){
  let v = findVendorByName(st, item.name);
  if (!v) {
    v = { id: uid("v"), name: item.name.trim(), note: "", defaultKind: item.kind, defaultAccountId: item.accountId ?? null,
          defaultAmountUsd: item.usd, cadFixed: item.cadFixed, cadence: null, dayOfMonth: null, url: "" };
    st.vendors.push(v);
  } else {
    v.defaultKind = item.kind;
    v.defaultAmountUsd = item.usd;
    v.cadFixed = item.cadFixed;
    if (item.accountId != null) v.defaultAccountId = item.accountId;
  }
  item.vendorId = v.id;
  return v;
}

function vendorDefaults(v){
  return v.cadFixed != null
    ? { amount: round2(v.cadFixed), cur: "CAD" }
    : { amount: round2(v.defaultAmountUsd || 0), cur: "USD" };
}

function vendorItems(st, v){
  return st.items.filter(x => x.vendorId === v.id || (x.vendorId == null && x.name.trim().toLowerCase() === v.name.toLowerCase()))
    .sort((a,b) => b.date.localeCompare(a.date));
}

function vendorStats(st, v, today){
  const list = vendorItems(st, v);
  const year = today.slice(0,4);
  const checked = list.filter(x => x.checked);
  const sum = a => a.reduce((t,x)=>t+x.usd,0);
  const done = checked.filter(x => x.kind === v.defaultKind);
  return {
    count: list.length,
    doneAll: sum(checked.filter(x=>x.kind===v.defaultKind)),
    doneYear: sum(checked.filter(x=>x.kind===v.defaultKind && x.date.slice(0,4)===year)),
    avg: done.length ? sum(done)/done.length : 0,
    last: checked.length ? checked[0].date : null,
    next: list.filter(x=>!x.checked).map(x=>x.date).sort()[0] || null,
  };
}

// ---- rows ----

function rowHTML(x){
  const color = x.kind==="in" ? "var(--in)" : "var(--out)";
  const sign = x.kind==="in" ? "+" : "−";
  const cad = x.cadFixed!=null ? x.cadFixed : x.usd*s.rate;
  return `<label class="row ${x.checked?"done":""}" data-id="${x.id}">
    <input type="checkbox" ${x.checked?"checked":""} style="accent-color:${color}" data-toggle="${x.id}" aria-label="${esc(x.name)} ${x.checked?"done":"expected"}">
    <div class="name"><button class="namebtn" data-vopen-item="${x.id}" title="Open vendor">${esc(x.name)}</button>${x.cadFixed!=null?'<span class="tinytag">CAD</span>':""}</div>
    <div class="amt num"><div class="u" style="color:${x.checked?"var(--muted)":color}">${sign}${fmt(x.usd,"")}</div><div class="c">${fmt(cad,"C$")}</div></div>
    <button class="x" data-remove="${x.id}" title="Remove" aria-label="Remove ${esc(x.name)}">×</button>
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
        <input data-f="name" data-k="${kind}" list="vendorNames" value="${esc(d.name)}" placeholder="${isIn?"Shopify payout":"Meta ads"}" aria-label="Name" autocomplete="off">
        <input data-f="amount" data-k="${kind}" type="number" step="0.01" value="${esc(d.amount)}" placeholder="0.00" style="text-align:right" aria-label="Amount">
        <select data-f="cur" data-k="${kind}" aria-label="Currency" style="padding:9px 6px"><option ${d.cur==="USD"?"selected":""}>USD</option><option ${d.cur==="CAD"?"selected":""}>CAD</option></select>
        <button class="btn" data-add="${kind}">Add</button>
      </div>
      <div class="cadnote" data-cadnote="${kind}"${d.cur==="CAD"&&a>0?"":" hidden"}>${d.cur==="CAD"&&a>0?`${fmt(a,"C$")} = ${fmt(a/s.rate)} today. Stays ${fmt(a,"C$")} even if the rate moves.`:""}</div>
    </div>
  </div>`;
}

function groupedItemsHTML(list){
  const dates = [...new Set(list.map(x=>x.date))].sort().reverse();
  return dates.map(d=>`<div class="grp"><button class="bare" style="font-size:14px;font-weight:600;margin-bottom:2px" data-open="${d}">${pretty(d)}<span class="tinylink">open</span></button>
    ${list.filter(x=>x.date===d).map(rowHTML).join("")}</div>`).join("");
}

// ---- views ----

function render(){
  if (view === "vendor") return renderVendor();
  if (view === "vendors") return renderVendors();
  renderMain();
}

function datalistHTML(){
  return `<datalist id="vendorNames">${s.vendors.map(v=>`<option value="${esc(v.name)}">`).join("")}</datalist>`;
}

function renderMain(){
  const m = calc(s, date);
  const isToday = date===todayISO();
  const isStart = date===s.startDate;
  let startCell;
  if (isStart) {
    startCell = editStart
      ? `<div style="display:flex;gap:6px;align-items:center"><input id="startDraft" type="number" step="0.01" value="${s.startBudget.toFixed(2)}" style="font-size:18px;font-weight:600;padding:4px 8px;width:130px" aria-label="Starting balance"><button class="btn" id="saveStart" style="padding:6px 10px;font-size:12px">Save</button></div>`
      : `<button class="bare num big" id="editStart">${fmt(s.startBudget)}<span class="tinylink">edit</span></button>`;
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
      ${groupedItemsHTML(s.items)}</div>`;
  }

  document.getElementById("app").innerHTML = `
    ${datalistHTML()}
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
      ${showRate?`<input id="rateInput" type="number" step="0.0001" value="${s.rate}" style="width:110px;margin-left:10px;display:inline-block;padding:5px 8px" aria-label="USD to CAD rate">`:""}
      <span style="margin-left:18px">Started ${pretty(s.startDate)} with ${fmt(s.startBudget)}</span>
      <button class="link" id="vendorsLink">vendors</button>
      <button class="link" id="export">export CSV</button>
    </div>`;
  bindMain();
}

function renderVendor(){
  const v = s.vendors.find(x=>x.id===openVendorId);
  if (!v) { view = "day"; return renderMain(); }
  const st = vendorStats(s, v, todayISO());
  const list = vendorItems(s, v);
  const dir = v.defaultKind === "in" ? "Received" : "Paid";
  document.getElementById("app").innerHTML = `
    ${datalistHTML()}
    <div class="datebar"><button class="link" id="back" style="margin-left:0">‹ back</button></div>
    <div class="lt" style="font-size:20px;margin-bottom:4px">${esc(v.name)}</div>
    <div class="summary num" style="margin-top:8px">
      <span>${dir} this year: <b>${fmt(st.doneYear)}</b></span>
      <span>All time: <b>${fmt(st.doneAll)}</b></span>
      <span>${st.count} ${st.count===1?"entry":"entries"}, average <b>${fmt(st.avg)}</b></span>
      <span>Last ${v.defaultKind==="in"?"landed":"paid"}: <b>${st.last?prettyShort(st.last):"—"}</b></span>
      <span>Next expected: <b>${st.next?prettyShort(st.next):"—"}</b></span>
    </div>
    <div class="vfields">
      <input id="vNote" value="${esc(v.note)}" placeholder="Note" aria-label="Vendor note">
      <input id="vUrl" value="${esc(v.url)}" placeholder="Link (billing page, dashboard)" aria-label="Vendor link">
    </div>
    ${v.url?`<div class="sub" style="margin-bottom:10px"><a href="${esc(v.url)}" target="_blank" rel="noopener" class="quietlink">open link</a></div>`:""}
    <div style="margin-top:26px">${list.length?groupedItemsHTML(list):'<div class="empty">Nothing logged yet.</div>'}</div>`;
  bindShared();
  document.getElementById("back").onclick = ()=>{ view="day"; render(); };
  document.getElementById("vNote").oninput = e=>{ v.note = e.target.value; save(); };
  document.getElementById("vUrl").onchange = e=>{ v.url = e.target.value.trim(); save(); render(); };
}

function renderVendors(){
  const t = todayISO();
  const rows = s.vendors
    .map(v => ({ v, st: vendorStats(s, v, t) }))
    .sort((a,b) => (b.st.last||"").localeCompare(a.st.last||""));
  document.getElementById("app").innerHTML = `
    <div class="datebar"><button class="link" id="back" style="margin-left:0">‹ back</button></div>
    <div class="lt" style="font-size:20px;margin-bottom:14px">Vendors</div>
    ${rows.length?rows.map(({v,st})=>`
      <div class="row" style="cursor:default">
        <div class="name"><button class="namebtn" data-vopen="${v.id}">${esc(v.name)}</button></div>
        <div class="sub num" style="margin:0">${st.count} ${st.count===1?"entry":"entries"} · ${fmt(st.doneAll)} · ${st.last?prettyShort(st.last):"—"}</div>
      </div>`).join(""):'<div class="empty">No vendors yet. They appear as you log entries.</div>'}
  `;
  document.getElementById("back").onclick = ()=>{ view="day"; render(); };
  document.querySelectorAll("[data-vopen]").forEach(b=>b.onclick=()=>{ openVendorId=b.dataset.vopen; view="vendor"; render(); });
}

function cadNote(kind){
  const el = document.querySelector(`[data-cadnote="${kind}"]`);
  if (!el) return;
  const d = drafts[kind]; const a = parseFloat(d.amount)||0;
  const show = d.cur==="CAD" && a>0;
  el.hidden = !show;
  el.textContent = show ? `${fmt(a,"C$")} = ${fmt(a/s.rate)} today. Stays ${fmt(a,"C$")} even if the rate moves.` : "";
}

// handlers shared by any view that renders entry rows
function bindShared(){
  const app = document.getElementById("app");
  app.querySelectorAll("[data-toggle]").forEach(c=>c.onchange=()=>{ const x=s.items.find(i=>i.id===c.dataset.toggle); x.checked=!x.checked; save(); render(); });
  app.querySelectorAll("[data-remove]").forEach(b=>b.onclick=e=>{ e.preventDefault(); s.items=s.items.filter(i=>i.id!==b.dataset.remove); save(); render(); });
  app.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{ date=b.dataset.open; view="day"; save(); render(); });
  app.querySelectorAll("[data-vopen-item]").forEach(b=>b.onclick=e=>{
    e.preventDefault();
    const x = s.items.find(i=>i.id===b.dataset.vopenItem);
    if (!x) return;
    let v = (x.vendorId && s.vendors.find(z=>z.id===x.vendorId)) || findVendorByName(s, x.name);
    if (!v) v = upsertVendorFromEntry(s, x);
    x.vendorId = v.id;
    save();
    openVendorId = v.id; view = "vendor"; render();
  });
}

function bindMain(){
  const $ = id => document.getElementById(id);
  const app = $("app");
  bindShared();
  $("prev").onclick = ()=>{ date=shift(date,-1); save(); render(); };
  $("next").onclick = ()=>{ date=shift(date,1); save(); render(); };
  $("datePick").onchange = e=>{ if(e.target.value){ date=e.target.value; save(); render(); } };
  if ($("today")) $("today").onclick = ()=>{ date=todayISO(); save(); render(); };
  app.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{ view=b.dataset.view; render(); });
  app.querySelectorAll("[data-f]").forEach(el=>{
    const k=el.dataset.k, f=el.dataset.f;
    el.oninput = ()=>{
      drafts[k][f]=el.value;
      if(f==="cur"||f==="amount") cadNote(k);
      if(f==="name"){
        const v = findVendorByName(s, el.value);
        if (v && !(parseFloat(drafts[k].amount)>0)) {
          const d0 = vendorDefaults(v);
          if (d0.amount > 0) {
            drafts[k].amount = String(d0.amount); drafts[k].cur = d0.cur;
            const amtEl = app.querySelector(`[data-f="amount"][data-k="${k}"]`);
            const curEl = app.querySelector(`[data-f="cur"][data-k="${k}"]`);
            if (amtEl) amtEl.value = drafts[k].amount;
            if (curEl) curEl.value = drafts[k].cur;
            cadNote(k);
          }
        }
      }
    };
    el.onkeydown = e=>{ if(e.key==="Enter") add(k); };
  });
  app.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>add(b.dataset.add));
  if ($("editStart")) $("editStart").onclick = ()=>{ editStart=true; render(); $("startDraft").focus(); };
  if ($("saveStart")) { const doSave=()=>{ const v=parseFloat($("startDraft").value); editStart=false; if(!isNaN(v)){ s.startBudget=v; s.startDate=date; } save(); render(); };
    $("saveStart").onclick=doSave; $("startDraft").onkeydown=e=>{ if(e.key==="Enter") doSave(); if(e.key==="Escape"){ editStart=false; render(); } }; }
  $("rateToggle").onclick = ()=>{ showRate=!showRate; render(); };
  if ($("rateInput")) $("rateInput").oninput = e=>{ s.rate=parseFloat(e.target.value)||1; save(); const keep=e.target; const v=keep.value; render(); const again=$("rateInput"); if(again){ again.value=v; again.focus(); } };
  $("vendorsLink").onclick = ()=>{ view="vendors"; render(); };
  $("export").onclick = exportCsv;
}

function add(kind){
  const d=drafts[kind]; const a=parseFloat(d.amount)||0;
  if(!d.name.trim()||!a) return;
  const item = { id:uid("x"), kind, date, name:d.name.trim(), usd: d.cur==="CAD"?a/s.rate:a, cadFixed: d.cur==="CAD"?a:null, checked:false, accountId:null, vendorId:null, note:"", receiptUrl:"", recurringSourceId:null };
  const v = upsertVendorFromEntry(s, item);
  item.accountId = v.defaultAccountId;
  s.items.push(item);
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
  module.exports = { SEED, KEY, LEGACY_KEY, migrate, ensure, calc, fmt, upsertVendorFromEntry, findVendorByName, vendorDefaults, vendorStats, vendorItems };
} else {
  s = load();
  date = s.lastDate || todayISO();
  save();
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
}
