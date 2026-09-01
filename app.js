const KEY = "daydreamz-money-v6";
const LEGACY_KEY = "daydreamz-money-v5";
const SEED = {
  version: 6,
  startDate: "2026-08-31", startBudget: 8403.01, rate: 1.389, lastDate: null,
  adjust: {},
  accounts: [],
  vendors: [],
  items: [
    { id: "o1", kind: "out", date: "2026-08-31", name: "Chapa - rent", usd: 2500 / 1.389, cadFixed: 2500, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null },
    { id: "o2", kind: "out", date: "2026-08-31", name: "Chargeblast (5 bills)", usd: 1545, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null },
  ],
  settings: { theme: "system", currencyDisplay: "both", warnDaysAhead: 3 },
};
const PROCESSOR_NAMES = ["EMS", "PHOENIX ECOMMERCE", "GATEWAY SERVICES", "BANKCARD DEPOSIT"];
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const shift = (iso, n) => { const [y,m,d] = iso.split("-").map(Number); const t = new Date(y, m-1, d+n); return `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`; };
const pretty = iso => { const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d).toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", year:"numeric" }); };
const prettyShort = iso => { const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }); };
const fmt = (n, sym="US$") => { const v = Math.abs(n) < 0.005 ? 0 : n; return (v<0?"−":"") + sym + Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); };
// Primary/secondary display currency. Amounts are stored in USD; this only changes what leads.
const cadFirst = () => (typeof s !== "undefined" && s?.settings?.currencyDisplay) === "cad";
const fmtP = usd => cadFirst() ? fmt(usd * s.rate, "C$") : fmt(usd);
const fmtPbare = usd => cadFirst() ? fmt(usd * s.rate, "") : fmt(usd, "");
const fmtSec = usd => cadFirst() ? fmt(usd) : fmt(usd * s.rate, "C$");
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
  const hadRateMode = st.settings && st.settings.rateMode != null;
  st.settings = Object.assign({ theme: "system", currencyDisplay: "usd", warnDaysAhead: 3, rateMode: "live", rateUpdatedAt: null }, st.settings || {});
  if (st.settings.currencyDisplay !== "cad") st.settings.currencyDisplay = "usd";
  // a rate the user set by hand before live rates existed stays theirs
  if (!hadRateMode && typeof st.rate === "number" && Math.abs(st.rate - 1.389) > 1e-9) st.settings.rateMode = "manual";
  st.adjust = st.adjust || {};
  st.goals = st.goals || [];
  st.vendors.forEach(v => {
    v.note = v.note ?? ""; v.url = v.url ?? ""; v.cadence = v.cadence ?? null;
    v.dayOfMonth = v.dayOfMonth ?? null; v.defaultAccountId = v.defaultAccountId ?? null;
    v.skipDates = v.skipDates ?? []; v.isProcessor = v.isProcessor ?? false; v.dayLag = v.dayLag ?? 0;
  });
  st.items.forEach(x => {
    x.cadFixed = x.cadFixed ?? null; x.accountId = x.accountId ?? null; x.vendorId = x.vendorId ?? null;
    x.note = x.note ?? ""; x.receiptUrl = x.receiptUrl ?? ""; x.recurringSourceId = x.recurringSourceId ?? null;
    x.settle = x.settle ?? null; // null = untracked, "pending" = authorized not settled, ISO date = settled
    x.createdAt = x.createdAt ?? null;
    x.importId = x.importId ?? null;
    x.declined = x.declined ?? false; x.src = x.src ?? null;
  });
  const palette = ["#1C6B5E", "#A8681C", "#6B7280", "#161C26"];
  st.accounts.forEach((a, i) => {
    a.kind = a.kind === "personal" ? "personal" : "business";
    a.color = a.color ?? palette[i % palette.length];
    a.start = typeof a.start === "number" ? a.start : 0;
  });
  // known processing/fee names get flagged as processors, once; manual changes stick after that
  if (!st.settings.procSeeded) {
    for (const name of PROCESSOR_NAMES) {
      let v = st.vendors.find(z => z.name.toLowerCase() === name.toLowerCase());
      if (!v) {
        v = { id: uid("v"), name, note: "", defaultKind: name === "GATEWAY SERVICES" ? "out" : "in", defaultAccountId: null,
              defaultAmountUsd: 0, cadFixed: null, cadence: null, dayOfMonth: null, url: "", skipDates: [], isProcessor: true };
        st.vendors.push(v);
      }
      v.isProcessor = true;
    }
    st.settings.procSeeded = true;
  }
  // entries that predate vendors join their vendor by name
  st.items.forEach(x => {
    if (x.vendorId == null) {
      const v = st.vendors.find(z => z.name.toLowerCase() === x.name.trim().toLowerCase());
      if (v) x.vendorId = v.id;
    }
  });
  // references to deleted vendors/accounts dissolve quietly
  const vids = new Set(st.vendors.map(v => v.id)), aids = new Set(st.accounts.map(a => a.id));
  st.items.forEach(x => {
    if (x.vendorId && !vids.has(x.vendorId)) x.vendorId = null;
    if (x.accountId && !aids.has(x.accountId)) x.accountId = null;
    if (x.recurringSourceId && !vids.has(x.recurringSourceId)) x.recurringSourceId = null;
  });
  st.vendors.forEach(v => { if (v.defaultAccountId && !aids.has(v.defaultAccountId)) v.defaultAccountId = null; });
  return st;
}

// Fold one vendor into another: entries, recurring links, processor flag move over.
function mergeVendor(st, fromId, intoId){
  if (fromId === intoId) return false;
  const from = st.vendors.find(v => v.id === fromId), into = st.vendors.find(v => v.id === intoId);
  if (!from || !into) return false;
  st.items.forEach(x => {
    if (x.vendorId === fromId) x.vendorId = intoId;
    if (x.recurringSourceId === fromId) x.recurringSourceId = intoId;
  });
  if (from.isProcessor) into.isProcessor = true;
  if (!into.cadence && from.cadence) { into.cadence = from.cadence; into.dayOfMonth = from.dayOfMonth; }
  into.skipDates = [...new Set([...(into.skipDates || []), ...(from.skipDates || [])])];
  if (!into.note && from.note) into.note = from.note;
  if (!into.url && from.url) into.url = from.url;
  st.vendors = st.vendors.filter(v => v.id !== fromId);
  return true;
}

// Deleting a vendor keeps every entry; they just lose the link.
function deleteVendor(st, id, today){
  const v = st.vendors.find(z => z.id === id);
  if (!v) return;
  if (v.cadence) stopRecurring(st, v, shift(today, 1));
  st.items.forEach(x => {
    if (x.vendorId === id) x.vendorId = null;
    if (x.recurringSourceId === id) x.recurringSourceId = null;
  });
  st.vendors = st.vendors.filter(z => z.id !== id);
}

function deleteAccount(st, id){
  st.accounts = st.accounts.filter(a => a.id !== id);
  st.items.forEach(x => { if (x.accountId === id) x.accountId = null; });
  st.vendors.forEach(v => { if (v.defaultAccountId === id) v.defaultAccountId = null; });
}

function accountBalance(st, a){
  return a.start + st.items.filter(x => x.checked && x.accountId === a.id)
    .reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
}

function load(){
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrate(JSON.parse(legacy));
  } catch(e){ console.error(e); }
  return freshState();
}

// A brand-new device starts empty: today, nothing owed, one welcome card.
function freshState(){
  const st = ensure(structuredClone(SEED));
  st.items = []; st.startDate = todayISO(); st.startBudget = 0; st.settings.fresh = true;
  return st;
}
const isFresh = () => !!(s.settings.fresh && !s.items.length && !s.startBudget);

let s, date;
let view = "day";
let searchQ = "";
let openVendorId = null;
let deleteAsk = null;
let expandedId = null;
let showDone = { in: false, out: false, proc: false };
let editCarry = false;
let lastRenderedDate = null;
let dragId = null, dragCont = null;

// Reorder within the master list so every view keeps the same order.
function moveItem(st, id, targetId, after){
  const from = st.items.findIndex(i => i.id === id);
  if (from < 0) return;
  const item = st.items.splice(from, 1)[0];
  let to = st.items.findIndex(i => i.id === targetId);
  if (to < 0) { st.items.splice(from, 0, item); return; }
  if (after) to++;
  st.items.splice(to, 0, item);
}
let accountsFilter = "all";
let editAccId = null;
let editStart = false;
let showRate = false;
const drafts = { in:{name:"",amount:"",cur:"USD"}, out:{name:"",amount:"",cur:"USD"} };

function save(){ s.lastDate = date; if (sandbox) return; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){ console.error(e); } }

function calc(st, day){
  const sgn = x => x.kind==="in" ? x.usd : -x.usd;
  const adj = st.adjust || {};
  // a start-of-day correction on day D counts from D onward, without being money in or out
  const adjUpTo = Object.keys(adj).filter(d => d <= day).reduce((t, d) => t + adj[d], 0);
  const adjAll = Object.values(adj).reduce((t, v) => t + v, 0);
  // the starting balance is a snapshot: entries dated before the start date are
  // history (visible, searchable, in vendor totals) but never move balances
  const started = x => x.date >= st.startDate;
  const carry = (day >= st.startDate ? st.startBudget : 0) + adjUpTo + st.items.filter(x=>x.checked && started(x) && x.date<day).reduce((t,x)=>t+sgn(x),0);
  const today = st.items.filter(x=>x.date===day && !x.declined);
  const inT = today.filter(x=>x.kind==="in"), outT = today.filter(x=>x.kind==="out");
  const sum = (a,only) => a.filter(x=>!only||x.checked).reduce((t,x)=>t+x.usd,0);
  const inC=sum(inT,true), inA=sum(inT), outC=sum(outT,true), outA=sum(outT);
  const end = carry + inC - outC;
  const allTime = st.startBudget + adjAll + st.items.filter(x=>x.checked && started(x)).reduce((t,x)=>t+sgn(x),0);
  const ifAll = st.startBudget + adjAll + st.items.filter(x=>started(x) && !x.declined).reduce((t,x)=>t+sgn(x),0);
  const pendingEarlier = st.items.filter(x=>!x.checked && !x.declined && started(x) && x.date<day).length;
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
    // banks truncate long names ("PHOENIX ECOMMERC") — match a clear truncation, never short names
    const n = item.name.trim().toLowerCase();
    if (n.length >= 10) v = st.vendors.find(z => {
      const zn = z.name.toLowerCase();
      return zn.length >= 10 && (zn.startsWith(n) || n.startsWith(zn));
    }) || null;
  }
  if (!v) {
    v = { id: uid("v"), name: item.name.trim(), note: "", defaultKind: item.kind, defaultAccountId: item.accountId ?? null,
          defaultAmountUsd: item.usd, cadFixed: item.cadFixed, cadence: null, dayOfMonth: null, url: "", skipDates: [] };
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

// ---- recurring ----

const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based
function addMonths(iso, n, day){
  const [y, m, d] = iso.split("-").map(Number);
  const total = (m - 1) + n;
  const y2 = y + Math.floor(total / 12), m2 = (total % 12 + 12) % 12 + 1;
  const d2 = Math.min(day ?? d, daysInMonth(y2, m2));
  return `${y2}-${pad(m2)}-${pad(d2)}`;
}

// A vendor with a cadence generates expected entries: from its latest entry
// forward, through the viewed date, at most 12 months ahead of today.
function generateRecurring(st, today, through){
  let horizon = addMonths(today, 3);
  if (through && through > horizon) horizon = through;
  const cap = addMonths(today, 12);
  if (horizon > cap) horizon = cap;
  let changed = 0;
  for (const v of st.vendors) {
    if (!v.cadence) continue;
    v.skipDates = v.skipDates || [];
    const amountUsd = v.cadFixed != null ? v.cadFixed / st.rate : v.defaultAmountUsd;
    if (!(amountUsd > 0)) continue;
    const mine = st.items.filter(x => x.vendorId === v.id).map(x => x.date).sort();
    const anchor = mine.length ? mine[mine.length - 1] : today;
    const dom = v.dayOfMonth ?? Number(anchor.slice(8, 10));
    const next = d => {
      if (v.cadence === "weekly") return shift(d, 7);
      if (v.cadence === "yearly") return addMonths(d, 12, Number(anchor.slice(8, 10)));
      return addMonths(d, 1, dom);
    };
    const taken = new Set(st.items.filter(x => x.vendorId === v.id).map(x => x.date));
    // first occurrence: the cadence day in the anchor's own month still counts if it's ahead
    let d = next(anchor), guard = 0;
    if (v.cadence === "monthly") {
      const sameMonth = addMonths(anchor, 0, dom);
      if (sameMonth > anchor) d = sameMonth;
    }
    while (d <= horizon && guard++ < 400) {
      if (!taken.has(d) && !v.skipDates.includes(d)) {
        st.items.push({ id: uid("r"), kind: v.defaultKind, date: d, name: v.name,
          usd: v.cadFixed != null ? v.cadFixed / st.rate : v.defaultAmountUsd,
          cadFixed: v.cadFixed, checked: false, accountId: v.defaultAccountId,
          vendorId: v.id, note: "", receiptUrl: "", recurringSourceId: v.id });
        taken.add(d);
        changed++;
      }
      d = next(d);
    }
  }
  return changed;
}

// Stop a vendor's cadence and drop its still-unchecked generated entries from a date on.
function stopRecurring(st, v, fromDate){
  v.cadence = null;
  const before = st.items.length;
  st.items = st.items.filter(x => !(x.recurringSourceId === v.id && !x.checked && x.date >= fromDate));
  return before - st.items.length;
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

// ---- runway ----

const dayDiff = (a, b) => Math.round((new Date(b + "T00:00") - new Date(a + "T00:00")) / 86400000);

// Trailing 30-day net of checked entries; days of cash left at that pace.
function runwayInfo(st, today){
  const from = shift(today, -30);
  const win = st.items.filter(x => x.checked && x.date >= st.startDate && x.date > from && x.date <= today);
  const net = win.reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
  const cash = st.startBudget + Object.values(st.adjust || {}).reduce((t, v) => t + v, 0)
    + st.items.filter(x => x.checked && x.date >= st.startDate).reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
  if (net >= 0) return { burning: false, days: null };
  const perDay = -net / 30;
  return { burning: true, days: Math.max(0, Math.floor(cash / perDay)) };
}

// One pass over every entry: per-date checked and total nets.
function dailyNets(st){
  const m = new Map();
  for (const x of st.items) {
    if (x.declined) continue;
    const e = m.get(x.date) || { chk: 0, all: 0 };
    const v = x.kind === "in" ? x.usd : -x.usd;
    e.all += v; if (x.checked) e.chk += v;
    m.set(x.date, e);
  }
  return m;
}

// Trailing 30 days of real balances, plus a 7-day projection from
// everything scheduled but unchecked (overdue included on day one).
function sparkData(st, today){
  const nets = dailyNets(st);
  const adj = st.adjust || {};
  const windowStart = shift(today, -29);
  let chkRun = 0, adjRun = 0;
  for (const [d, e] of nets) if (d >= st.startDate && d < windowStart) chkRun += e.chk;
  for (const d in adj) if (d < windowStart) adjRun += adj[d];
  const past = [];
  for (let i = 29; i >= 0; i--) {
    const d = shift(today, -i);
    adjRun += adj[d] || 0;
    if (d >= st.startDate) chkRun += nets.get(d)?.chk || 0;
    // before the start, a day just shows its own movement; from the start on, the chain
    past.push(d >= st.startDate ? st.startBudget + adjRun + chkRun : (nets.get(d)?.chk || 0) + adjRun);
  }
  const future = [];
  let runF = past[29];
  let overdue = 0;
  for (const [d, e] of nets) if (d >= st.startDate && d <= today) overdue += e.all - e.chk;
  for (let i = 1; i <= 7; i++) {
    const d = shift(today, i);
    if (i === 1) runF += overdue;
    const e = nets.get(d);
    runF += (e ? e.all - e.chk : 0) + (adj[d] || 0);
    future.push(runF);
  }
  return { past, future };
}

function sparkSVG(sd, today, wide){
  const all = [...sd.past, ...sd.future];
  const w = wide ? 320 : 170, h = wide ? 56 : 34, p = 3;
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const n = all.length;
  const X = i => p + i * (w - 2 * p) / (n - 1);
  const Y = v => h - p - (v - min) * (h - 2 * p) / span;
  const solid = sd.past.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const dashed = [sd.past[sd.past.length - 1], ...sd.future].map((v, i) => `${X(sd.past.length - 1 + i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const color = sd.past[sd.past.length - 1] >= sd.past[0] ? "var(--in)" : "var(--out)";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img" aria-label="Balance over the last 30 days and the week ahead">
    <polyline class="spark-line" pathLength="1" points="${solid}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline class="spark-future" points="${dashed}" stroke="var(--muted)" stroke-width="1.3" stroke-dasharray="3 3" stroke-linejoin="round" stroke-linecap="round" opacity=".75"/>
    <circle cx="${X(sd.past.length-1).toFixed(1)}" cy="${Y(sd.past[sd.past.length-1]).toFixed(1)}" r="2.4" fill="${color}"/>
    ${today ? all.map((v, i) => { const d = i < sd.past.length ? shift(today, -(sd.past.length - 1 - i)) : shift(today, i - sd.past.length + 1);
      return `<circle class="spot" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5" fill="transparent"><title>${prettyShort(d)} · ${fmtP(v)}${i >= sd.past.length ? " (projected)" : ""}</title></circle>`; }).join("") : ""}
  </svg>`;
}

// ---- goals ----

function goalInfo(st, g, today){
  const cash = calc(st, today).allTime;
  const pct = Math.max(0, Math.min(1, cash / (g.targetUsd || 1)));
  const reached = cash >= g.targetUsd;
  const daysLeft = Math.max(0, dayDiff(today, g.targetDate));
  const needPerDay = reached || daysLeft === 0 ? 0 : (g.targetUsd - cash) / daysLeft;
  const from = shift(today, -30);
  const pace = st.items.filter(x => x.checked && x.date > from && x.date <= today)
    .reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0) / 30;
  return { cash, pct, reached, daysLeft, needPerDay, pace, behind: !reached && daysLeft > 0 && needPerDay > Math.max(pace, 0) };
}

// Walk the next N days through everything scheduled and unchecked; where does cash bottom out?
function forecastLow(st, today, days = 30){
  const nets = dailyNets(st);
  let bal = calc(st, today).allTime;
  let overdue = 0;
  for (const [d, e] of nets) if (d >= st.startDate && d <= today) overdue += e.all - e.chk;
  let min = bal, minDate = today;
  for (let i = 1; i <= days; i++) {
    const d = shift(today, i);
    if (i === 1) bal += overdue;
    const e = nets.get(d);
    bal += (e ? e.all - e.chk : 0) + ((st.adjust || {})[d] || 0);
    if (bal < min) { min = bal; minDate = d; }
  }
  return { min, date: minDate, endBalance: bal };
}

// The one most useful thing the numbers can say right now.
function insightsFor(st, today){
  const out = [];
  const week = st.items.filter(x => !x.checked && !x.declined && x.date > today && x.date <= shift(today, 7));
  const owed = week.filter(x => x.kind === "out").reduce((t, x) => t + x.usd, 0);
  const expIn = week.filter(x => x.kind === "in").reduce((t, x) => t + x.usd, 0);
  if (owed > 0 || expIn > 0) {
    const proj = calc(st, today).allTime + expIn - owed;
    out.push({ tone: proj < 0 ? "warn" : "info", text: `Next 7 days: ${fmtP(owed)} owed${expIn > 0.004 ? `, ${fmtP(expIn)} expected in` : ""} — projected Left ${fmtP(proj)}.` });
  }
  const ym = today.slice(0, 7), prevYm = addMonths(today, -1).slice(0, 7);
  const byVendor = new Map();
  for (const x of st.items) {
    if (x.kind !== "out" || !x.checked) continue;
    const k = x.name.trim().toLowerCase();
    const e = byVendor.get(k) || { name: x.name.trim(), cur: 0, prev: 0 };
    if (x.date.slice(0, 7) === ym) e.cur += x.usd;
    if (x.date.slice(0, 7) === prevYm) e.prev += x.usd;
    byVendor.set(k, e);
  }
  const top = [...byVendor.values()].filter(e => e.cur > 0).sort((a, b) => b.cur - a.cur)[0];
  if (top) out.push({ tone: "info", text: `Biggest cost this month: ${top.name} ${fmtP(top.cur)}${top.prev > 0.004 ? ` (last month ${fmtP(top.prev)})` : ""}.` });
  const isProcId = new Set(st.vendors.filter(v => v.isProcessor).map(v => v.id));
  const pin = st.items.filter(x => x.checked && x.kind === "in" && isProcId.has(x.vendorId) && x.date.slice(0, 7) === ym).reduce((t, x) => t + x.usd, 0);
  const pout = st.items.filter(x => x.checked && x.kind === "out" && isProcId.has(x.vendorId) && x.date.slice(0, 7) === ym).reduce((t, x) => t + x.usd, 0);
  if (pin > 0 && pout > 0) out.push({ tone: "info", text: `Processor fees and debits are ${(pout / pin * 100).toFixed(1)}% of payouts this month.` });
  return out;
}

// The strip's numbers glide to their new value instead of snapping.
const prevNums = {};
let lastAnimDate = null;
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
function paintNum(id, val, fmtFn){
  const el = document.getElementById(id);
  if (!el) { prevNums[id] = val; return; }
  const from = prevNums[id];
  prevNums[id] = val;
  el.textContent = fmtFn(val);
  if (from == null || from === val || reduced() || lastAnimDate !== date) return;
  if (id === "numLeft") { const cell = el.closest(".cell"); if (cell) { cell.classList.add(val > from ? "pulse-up" : "pulse-down"); } }
  const t0 = performance.now(), dur = 640;
  const tick = now => {
    if (document.getElementById(id) !== el) return;
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 5);
    el.textContent = fmtFn(from + (val - from) * e);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = fmtFn(val);
  };
  requestAnimationFrame(tick);
}

// Move an entry to the day the money actually moved (e.g. a card purchase
// back to its authorization day). A moved generated bill doesn't come back.
function redateItem(st, id, newDate, today){
  const x = st.items.find(i => i.id === id);
  if (!x || !newDate) return null;
  if (x.recurringSourceId) {
    const v = st.vendors.find(z => z.id === x.recurringSourceId);
    if (v && !(v.skipDates || []).includes(x.date)) (v.skipDates = v.skipDates || []).push(x.date);
  }
  // learn the vendor's usual authorization lag — but only from correcting a
  // freshly-logged entry, never from fixing an old typo
  const back = dayDiff(newDate, x.date);
  const freshCorrection = x.createdAt && x.createdAt === x.date && (!today || dayDiff(x.createdAt, today) <= 7);
  if (!x.recurringSourceId && x.vendorId && freshCorrection && back >= 1 && back <= 3) {
    const v = st.vendors.find(z => z.id === x.vendorId);
    if (v) v.dayLag = back;
  }
  x.date = newDate;
  return x;
}

// A fresh entry whose vendor usually authorizes earlier gets a one-tap suggestion.
function lagSuggestion(st, x){
  if (x.recurringSourceId || !x.vendorId || x.createdAt !== x.date) return null;
  const v = st.vendors.find(z => z.id === x.vendorId);
  if (!v || !(v.dayLag >= 1)) return null;
  return shift(x.date, -v.dayLag);
}

// Money authorized on day X normally settles the next business morning.
function nextBusinessDay(iso){
  let d = shift(iso, 1);
  while ([0, 6].includes(new Date(d + "T00:00").getDay())) d = shift(d, 1);
  return d;
}

// One tap from the tray: count it and stamp the most sensible settled date.
function settlePending(st, id, today){
  const x = st.items.find(i => i.id === id);
  if (!x || x.settle !== "pending") return null;
  const exp = nextBusinessDay(x.date);
  x.settle = exp <= today ? exp : today;
  x.checked = true;
  return x;
}

// Checking an entry that was authorized-but-unsettled stamps the settled date.
function toggleItem(st, id, today){
  const x = st.items.find(i => i.id === id);
  if (!x) return null;
  x.checked = !x.checked;
  if (x.checked && x.settle === "pending") x.settle = today;
  return x;
}

function dueMark(x, today){
  if (x.checked || x.settle === "pending" || x.declined) return "";
  if (x.date < today) return '<span class="mark">overdue</span>';
  const d = dayDiff(today, x.date);
  if (d > (s?.settings?.warnDaysAhead ?? 3)) return "";
  return `<span class="mark">${d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`}</span>`;
}

// ---- day in brief ----

// The day's numbers plus what a typical day looks like (trailing 30 days from the start date).
function daySummary(st, day){
  const items = st.items.filter(x => x.date === day && !x.declined);
  const chk = items.filter(x => x.checked);
  const sum = (a, k) => a.filter(x => x.kind === k).reduce((t, x) => t + x.usd, 0);
  const inC = sum(chk, "in"), outC = sum(chk, "out");
  const pend = items.filter(x => !x.checked);
  const pendNet = pend.reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
  const biggest = [...items].sort((a, b) => b.usd - a.usd)[0] || null;
  const from = shift(day, -30);
  const lo = from > st.startDate ? from : st.startDate;
  const windowDays = Math.max(1, Math.min(30, dayDiff(lo, day)));
  let n = 0, tin = 0, tout = 0;
  for (const x of st.items) {
    if (!x.declined && x.date >= lo && x.date < day) { n++; if (x.checked) { if (x.kind === "in") tin += x.usd; else tout += x.usd; } }
  }
  const nets = dailyNets(st);
  const bars = [];
  for (let i = 6; i >= 0; i--) { const d = shift(day, -i); bars.push({ date: d, net: d >= st.startDate ? (nets.get(d)?.chk || 0) : 0 }); }
  return { count: items.length, inC, outC, net: inC - outC, pending: pend, pendNet, biggest,
           typicalCount: n / windowDays, typicalIn: tin / windowDays, typicalOut: tout / windowDays, windowDays, bars };
}

function dayBriefText(sm, day, today){
  const names = a => a.slice(0, 2).map(x => x.name).join(", ") + (a.length > 2 ? ` and ${a.length - 2} more` : "");
  if (!sm.count) return day > today ? "Nothing planned yet." : day === today ? "Nothing logged yet today." : "Nothing moved that day.";
  const parts = [];
  const tc = sm.typicalCount;
  const tone = tc >= 1 && sm.count >= tc * 1.6 && sm.count >= 4 ? "Busier than usual"
             : tc >= 1 && sm.count <= tc * 0.5 ? "Quieter than usual"
             : tc < 1 ? "Early days" : "A normal day";
  parts.push(`${tone} — ${sm.count} ${sm.count === 1 ? "entry" : "entries"}${tc >= 1 ? ` against a typical ${Math.round(tc)}` : ""}.`);
  const chkCount = sm.count - sm.pending.length;
  if (chkCount) {
    const vs = sm.typicalOut > 0 && sm.outC > 0 ? (sm.outC > sm.typicalOut * 1.5 ? ", well above your usual" : sm.outC < sm.typicalOut * 0.5 ? ", well under your usual" : ", about your usual") : "";
    parts.push(`In ${fmtP(sm.inC)}, out ${fmtP(sm.outC)}${vs} — ${sm.net >= 0 ? "ahead" : "down"} ${fmtP(Math.abs(sm.net))} so far.`);
  }
  if (sm.biggest) parts.push(`Biggest: ${sm.biggest.name} ${sm.biggest.kind === "in" ? "+" : "−"}${fmtPbare(sm.biggest.usd)}.`);
  if (sm.pending.length) parts.push(`Still open: ${names(sm.pending)} (${fmtP(sm.pendNet)}).`);
  return parts.join(" ");
}

function weekBarsSVG(sm){
  const w = 168, h = 46, pad = 2, gap = 6, bw = (w - gap * 6) / 7, mid = 30;
  const maxAbs = Math.max(1, ...sm.bars.map(b => Math.abs(b.net)));
  const bars = sm.bars.map((b, i) => {
    const x = i * (bw + gap), hh = Math.max(1.5, Math.abs(b.net) / maxAbs * (mid - pad - 2));
    const y = b.net >= 0 ? mid - hh : mid;
    const col = b.net >= 0 ? "var(--in)" : "var(--out)";
    const wd = new Date(b.date + "T00:00").toLocaleDateString("en-US", { weekday: "narrow" });
    return `<rect class="wbar${b.net < 0 ? " wbar-neg" : ""}" style="--i:${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="2" fill="${col}" opacity="${b.date === date ? 1 : .45}"><title>${prettyShort(b.date)} · ${fmtP(b.net)}</title></rect>
      <text x="${(x + bw / 2).toFixed(1)}" y="${h - 2}" text-anchor="middle" font-size="9" fill="var(--muted)">${wd}</text>`;
  }).join("");
  return `<svg class="week-bars" viewBox="0 0 ${w} ${h}" role="img" aria-label="Net per day, last 7 days"><line x1="0" x2="${w}" y1="${mid}" y2="${mid}" stroke="var(--line)" stroke-width="1"/>${bars}</svg>`;
}

// One row of quiet, tappable status chips under the strip.
function sandboxBarHTML(){
  return sandbox
    ? `<div class="sandbar num"><span><b>Sandbox</b> — play with anything; nothing is saved until you keep it.</span><span><button class="btn" id="sbKeep" style="padding:7px 12px;font-size:12px">Keep changes</button><button class="link" id="sbDiscard">discard</button></span></div>`
    : "";
}

function statusChipsHTML(m){
  const t = todayISO();
  const chips = [];
  if (!sandbox && view === "day") chips.push(`<button class="chip" id="sbOn" title="Try what-ifs without saving"><span class="dot"></span>What if</button>`);
  const r = runwayInfo(s, t);
  chips.push(r.burning
    ? `<span class="chip${r.days < 30 ? " warn" : ""}"><span class="dot"></span>Cash lasts <b>${r.days} ${r.days===1?"day":"days"}</b></span>`
    : `<span class="chip good"><span class="dot"></span>Cash <b>growing</b></span>`);
  const pend = s.items.filter(x => x.settle === "pending");
  if (pend.length) chips.push(`<button class="chip${showPendTray?" on":""}" id="pendTray"><span class="dot"></span><b>${pend.length}</b> waiting to settle</button>`);
  if (m.pendingEarlier > 0 && view === "day") chips.push(`<button class="chip warn" data-view="all"><span class="dot"></span><b>${m.pendingEarlier}</b> unchecked from earlier days</button>`);
  const fl = forecastLow(s, t); const cushion = s.settings.cushionUsd || 0;
  if (view === "day" && fl.date !== t && fl.min < cushion) chips.push(`<button class="chip warn" data-open="${fl.date}"><span class="dot"></span>Dips to <b>${fmtP(fl.min)}</b> ${prettyShort(fl.date)}</button>`);
  const bb = s.settings.slashSync?.balance;
  if (bb) { const diff = bb.available - calc(s, t).end; if (Math.abs(diff) > 1) chips.push(`<button class="chip warn" data-nav="settings"><span class="dot"></span>Off from Slash by <b>${fmtP(diff)}</b></button>`); else chips.push(`<span class="chip good"><span class="dot"></span>Matches <b>Slash</b></span>`); }
  const g = s.goals.sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0];
  if (g) { const gi = goalInfo(s, g, t); chips.push(`<button class="chip${gi.reached?" good":gi.behind?" warn":""}" data-nav="goals"><span class="dot"></span>${g.name?esc(g.name):"Goal"} <b>${gi.reached?"reached":Math.round(gi.pct*100)+"%"}</b></button>`); }
  return `<div class="chips num">${chips.join("")}</div>`;
}

function pendTrayHTML(){
  if (!showPendTray) return "";
  const t = todayISO();
  const pend = s.items.filter(x => x.settle === "pending").sort((a, b) => a.date.localeCompare(b.date));
  if (!pend.length) return "";
  const notCounted = pend.filter(x => !x.checked).reduce((tt, x) => tt + (x.kind === "in" ? x.usd : -x.usd), 0);
  return `<div class="pendlist num">
    ${Math.abs(notCounted) > 0.004 ? `<div class="sub" style="padding:10px 0 4px">${fmtP(notCounted)} of this isn't counted in Left yet.</div>` : ""}
    ${pend.map(x => {
      const exp = nextBusinessDay(x.date), late = exp < t;
      return `<div class="row" style="cursor:default">
        <div class="name">${esc(x.name)}<span class="tinytag">${prettyShort(x.date)}</span><span class="${late?"mark":"notetxt"}">${late?"expected "+prettyShort(exp):"settles ~"+prettyShort(exp)}</span></div>
        <div class="amt num"><div class="u" style="color:${x.kind==="in"?"var(--in)":"var(--out)"}">${x.kind==="in"?"+":"−"}${fmtPbare(x.usd)}</div></div>
        <button class="btn" data-psettle="${x.id}" style="padding:6px 12px;font-size:12px">Settled</button>
      </div>`; }).join("")}
  </div>`;
}

// The reflective card at the bottom of the day: trend, week, the day in words.
function dayBriefHTML(m){
  const t = todayISO();
  const sm = daySummary(s, date);
  const ins = insightsFor(s, t)[0];
  return `<section class="pulsecard num">
    <div class="pulse-grid">
      <div><div class="lbl">Balance · last 30 days, next 7 dotted</div>${sparkSVG(sparkData(s, t), t, true)}</div>
      <div><div class="lbl">Net per day · this week</div>${weekBarsSVG(sm)}</div>
    </div>
    <p class="brief-text">${esc(dayBriefText(sm, date, t))}</p>
    <div class="pulse-foot">
      ${ins ? `<span${ins.tone==="warn"?' style="color:var(--out)"':""}>${ins.text}</span>` : ""}
      <span>If everything lands and gets paid: <b style="color:${m.ifAll<0?"var(--out)":"var(--ink)"}">${fmtP(m.ifAll)}</b></span>
      ${(()=>{ const f = forecastLow(s, t); const cushion = s.settings.cushionUsd || 0; const low = f.min < cushion;
        return f.date === t ? "" : `<span${low?' style="color:var(--out)"':""}>Next 30 days bottom out at <b>${fmtP(f.min)}</b> on <button class="link" data-open="${f.date}" style="margin-left:0">${prettyShort(f.date)}</button>${low&&cushion?` — under your ${fmtP(cushion)} cushion`:""}</span>`; })()}
    </div>
  </section>`;
}

// ---- month ----

function monthData(st, ym, today){
  const [y, m] = ym.split("-").map(Number);
  const days = [];
  let inC = 0, outC = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const todays = st.items.filter(x => x.date === iso && !x.declined);
    inC += todays.filter(x => x.kind === "in" && x.checked).reduce((t, x) => t + x.usd, 0);
    outC += todays.filter(x => x.kind === "out" && x.checked).reduce((t, x) => t + x.usd, 0);
    days.push({
      date: iso, day: d,
      hasIn: todays.some(x => x.kind === "in"),
      hasOut: todays.some(x => x.kind === "out"),
      end: calc(st, iso).end,
      warn: iso < today && todays.some(x => !x.checked),
    });
  }
  return { days, inC, outC, net: inC - outC, offset: new Date(y, m - 1, 1).getDay() };
}

const fmtWhole = n => (n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString("en-US");
const fmtWholeP = usd => fmtWhole(cadFirst() ? usd * s.rate : usd);

function monthHTML(){
  const ym = date.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const md = monthData(s, ym, todayISO());
  const title = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const t = todayISO();
  return `<div style="margin-top:36px">
    <div class="lh"><div class="lt">${title}</div></div>
    <div class="summary num" style="margin-top:6px;margin-bottom:14px">
      <span>In: <b style="color:var(--in)">+${fmtPbare(md.inC)}</b></span>
      <span>Out: <b style="color:var(--out)">−${fmtPbare(md.outC)}</b></span>
      <span>Net: <b style="color:${md.net < 0 ? "var(--out)" : "var(--ink)"}">${fmtP(md.net)}</b></span>
    </div>
    <div class="mgrid num">
      ${["S","M","T","W","T","F","S"].map(w => `<div class="mwd">${w}</div>`).join("")}
      ${Array.from({ length: md.offset }, () => `<div class="mday off" aria-hidden="true"></div>`).join("")}
      ${md.days.map(d => `
        <button class="mday${d.date === t ? " today" : ""}${d.warn ? " warn" : ""}" data-open="${d.date}" aria-label="${pretty(d.date)}${d.warn ? ", has unchecked entries" : ""}">
          <span class="d">${d.day}</span>
          <span class="mdots">${d.hasIn ? '<span class="mdot" style="background:var(--in)"></span>' : ""}${d.hasOut ? '<span class="mdot" style="background:var(--out)"></span>' : ""}</span>
          <span class="mend">${fmtWholeP(d.end)}</span>
        </button>`).join("")}
    </div>
  </div>`;
}

// ---- backup ----

function diffStates(cur, inc){
  const one = (a, b) => {
    const am = new Map(a.map(x => [x.id, x])), bm = new Map(b.map(x => [x.id, x]));
    let add = 0, change = 0, remove = 0;
    for (const [id, x] of bm) { if (!am.has(id)) add++; else if (JSON.stringify(am.get(id)) !== JSON.stringify(x)) change++; }
    for (const id of am.keys()) if (!bm.has(id)) remove++;
    return { add, change, remove };
  };
  return {
    items: one(cur.items, inc.items),
    vendors: one(cur.vendors, inc.vendors),
    accounts: one(cur.accounts, inc.accounts),
    startChanged: cur.startBudget !== inc.startBudget || cur.startDate !== inc.startDate,
    rateChanged: cur.rate !== inc.rate,
  };
}

function backupDue(st, today){
  if (!st.items.length) return false;
  const last = st.settings.lastBackupAt;
  const dismissed = st.settings.backupDismissedAt;
  const stale = !last || dayDiff(last, today) > 30;
  const snoozed = dismissed && dayDiff(dismissed, today) <= 30;
  return stale && !snoozed;
}

// Live USD->CAD rate. Sanity-checked; manual override always wins.
function applyLiveRate(st, v, today){
  if (typeof v !== "number" || !(v > 0.5 && v < 3)) return false;
  const changed = Math.abs(st.rate - v) > 0.00005;
  st.rate = v;
  st.settings.rateUpdatedAt = today;
  return changed;
}

async function refreshRate(){
  if (!navigator.onLine || s.settings.rateMode === "manual") return;
  const sources = [
    ["https://open.er-api.com/v6/latest/USD", j => j?.rates?.CAD],
    ["https://api.frankfurter.app/latest?from=USD&to=CAD", j => j?.rates?.CAD],
  ];
  for (const [url, pick] of sources) {
    try {
      const j = await fetch(url).then(x => x.json());
      if (s.settings.rateMode === "manual") return; // the user took over while we were fetching
      const v = pick(j);
      if (typeof v === "number" && v > 0.5 && v < 3) {
        const changed = applyLiveRate(s, v, todayISO());
        save();
        // never yank the page out from under an edit in progress
        const tag = document.activeElement?.tagName || "";
        const busy = /INPUT|SELECT|TEXTAREA/.test(tag) || editStart || editCarry || editAccId !== null || showRate || deleteAsk !== null || pendingImport !== null || pendingCsv !== null;
        if (changed && !busy) render();
        return;
      }
    } catch {}
  }
}

function downloadText(filename, mime, text){
  const a = document.createElement("a");
  a.href = `data:${mime};charset=utf-8,` + encodeURIComponent(text);
  a.download = filename;
  a.click();
}

function exportJson(){
  s.settings.lastBackupAt = todayISO();
  save();
  downloadText(`money-backup-${todayISO()}.json`, "application/json", JSON.stringify(s, null, 2));
  render();
}

// ---- bank import (Slash CSV) ----

function parseCsv(text){
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ""; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    }
    else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

// "2026-08-30 02:07:42AM" (UTC) -> the date it was in this machine's timezone
function utcToLocalISO(sUtc){
  const m = String(sUtc || "").trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2})(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[4]) % 12; if (/pm/i.test(m[7])) h += 12;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], h, +m[5], +m[6]));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "ACH debit from EMS" -> "EMS", "SHOPIFY* 58195" -> "SHOPIFY", "SUSHI SHOP - 2250" -> "SUSHI SHOP"
function cleanBankName(desc){
  const n = String(desc).trim()
    .replace(/^incoming ach (credit|debit) from /i, "")
    .replace(/^ach (credit|debit) from /i, "")
    .replace(/\*\s*\S*$/, "")
    .replace(/\s+#\d+$/, "")
    .replace(/\s+-\s+\d+$/, "")
    .trim();
  return n || String(desc).trim();
}

// Turn a Slash transactions export into a plan: adds, pending-completions, skips.
function mapSlashCsv(st, text){
  const rows = parseCsv(text);
  if (!rows.length) return null;
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = n => head.indexOf(n);
  const ci = { id: col("id"), date: col("date (utc)"), desc: col("description"), amt: col("amount"),
    famt: col("foreign amount"), fcur: col("foreign currency"), type: col("type"), last4: col("last 4"),
    auth: col("authorization date (utc)"), status: col("status"), decline: col("decline reason") };
  if (ci.id < 0 || ci.date < 0 || ci.amt < 0 || ci.desc < 0) return null;
  let recs = rows.slice(1).map(r => ({
    id: r[ci.id], desc: r[ci.desc], amt: parseFloat(r[ci.amt]),
    famt: ci.famt >= 0 ? parseFloat(r[ci.famt]) : NaN, fcur: ci.fcur >= 0 ? (r[ci.fcur] || "").toUpperCase() : "",
    type: ci.type >= 0 ? (r[ci.type] || "").toLowerCase() : "", last4: ci.last4 >= 0 ? (r[ci.last4] || "") : "",
    dateLocal: utcToLocalISO(r[ci.date]), authLocal: ci.auth >= 0 ? utcToLocalISO(r[ci.auth]) : null,
    status: ci.status >= 0 ? (r[ci.status] || "").toLowerCase() : "settled", decline: ci.decline >= 0 ? (r[ci.decline] || "") : "",
  })).filter(x => x.id && x.dateLocal && !isNaN(x.amt) && x.amt !== 0);
  return planFromRecords(st, recs);
}

// Shared planner for CSV rows and live API items (same record shape).
function planFromRecords(st, recs){
  const isDeclined = r => r.declined || !!r.decline || r.status === "declined";
  const declinedRecs = recs.filter(isDeclined);
  recs = recs.filter(r => !isDeclined(r));
  let pairs = 0;
  // opposite rows of the same amount from the same counterparty cancel out
  const dropped = new Set();
  for (const a of recs) {
    if (dropped.has(a.id)) continue;
    const mate = recs.find(b => !dropped.has(b.id) && b.id !== a.id
      && cleanBankName(b.desc).toLowerCase() === cleanBankName(a.desc).toLowerCase()
      && Math.abs(b.amt + a.amt) < 0.005 && Math.sign(b.amt) !== Math.sign(a.amt)
      && Math.abs(dayDiff(a.dateLocal, b.dateLocal)) <= 3);
    if (mate) { dropped.add(a.id); dropped.add(mate.id); pairs++; }
  }
  recs = recs.filter(x => !dropped.has(x.id));
  // a card hold superseded by its settlement in the same file
  let authSkips = 0;
  recs = recs.filter(x => {
    if (x.type !== "card_authorization") return true;
    const hit = recs.some(b => b.type === "card_settlement" && b.last4 === x.last4 && Math.abs(b.amt - x.amt) < 0.005);
    if (hit) authSkips++;
    return !hit;
  });
  const adds = [], updates = []; let dupes = 0;
  for (const x of [...recs].reverse()) { // the export is newest-first; add oldest-first
    if (st.items.some(i => i.importId === x.id) || updates.some(u => u.importId === x.id)) { dupes++; continue; }
    const name = cleanBankName(x.desc);
    const kind = x.amt > 0 ? "in" : "out";
    const usd = Math.abs(x.amt);
    const isCard = x.type.startsWith("card");
    const entryDate = isCard ? (x.authLocal || x.dateLocal) : x.dateLocal;
    const settled = x.status === "settled";
    if (settled) {
      const pend = st.items.find(i => i.settle === "pending" && i.importId !== x.id
        && i.name.toLowerCase() === name.toLowerCase() && Math.abs(i.usd - usd) < 0.01
        && Math.abs(dayDiff(i.date, entryDate)) <= 4
        && !updates.some(u => u.id === i.id));
      if (pend) { updates.push({ id: pend.id, settle: x.dateLocal, importId: x.id }); continue; }
    }
    if (st.items.some(i => !i.importId && i.date === entryDate && Math.abs(i.usd - usd) < 0.01 && i.name.toLowerCase() === name.toLowerCase())) { dupes++; continue; }
    adds.push({
      id: uid("m"), kind, date: entryDate, name, usd,
      cadFixed: x.fcur === "CAD" && x.famt > 0 ? x.famt : null,
      // settled = real; a pending debit is already held from the balance; a pending credit isn't yours yet
      checked: settled ? true : kind === "out",
      accountId: null, vendorId: null, note: "", receiptUrl: "",
      recurringSourceId: null, settle: settled ? x.dateLocal : "pending",
      createdAt: entryDate, importId: x.id, src: x.type || null, declined: false,
    });
  }
  // declined and failed attempts are kept for the record, never counted
  for (const x of [...declinedRecs].reverse()) {
    if (st.items.some(i => i.importId === x.id)) { dupes++; continue; }
    adds.push({ id: uid("m"), kind: x.amt > 0 ? "in" : "out", date: x.authLocal || x.dateLocal, name: cleanBankName(x.desc), usd: Math.abs(x.amt),
      cadFixed: x.fcur === "CAD" && x.famt > 0 ? x.famt : null, checked: false, accountId: null, vendorId: null,
      note: x.decline ? String(x.decline) : "", receiptUrl: "", recurringSourceId: null, settle: null,
      createdAt: x.authLocal || x.dateLocal, importId: x.id, src: x.type || null, declined: true });
  }
  return { adds, updates, dupes, pairs, authSkips, declined: declinedRecs.length };
}

// Wipe one month of entries (and its start-of-day adjustments), e.g. to re-import it clean.
function deleteMonth(st, ym){
  const before = st.items.length;
  st.items = st.items.filter(x => !x.date.startsWith(ym));
  for (const d of Object.keys(st.adjust || {})) if (d.startsWith(ym)) delete st.adjust[d];
  return before - st.items.length;
}

// "2026-08-30T02:07:42.000Z" -> the date it was in this machine's timezone
function isoToLocalISO(iso){
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Live Slash API transactions -> the importer's record shape
function recsFromSlashApi(items){
  return (items || []).map(t => {
    const cat = t.category || (t.cardId ? "card" : (t.achInfo ? "ach" : (t.feeInfo ? "fee" : "")));
    const ds = String(t.detailedStatus || "").toLowerCase();
    const status = ds === "settled" || ds === "refund" || ds === "reversed" || ds === "returned" ? "settled"
                 : (t.status === "pending" || ds === "pending" || ds === "pending_approval" || ds === "in_review") ? "pending" : "declined";
    const isCard = cat === "card" || !!t.cardId;
    return {
      id: t.id, desc: t.merchantData?.description || t.description || "", amt: (t.amountCents || 0) / 100,
      famt: t.originalCurrency ? Math.abs((t.originalCurrency.amountCents || 0) / 100) : NaN,
      fcur: (t.originalCurrency?.code || "").toUpperCase(),
      type: isCard ? (status === "pending" ? "card_authorization" : "card_settlement") : cat === "ach" ? "inbound_ach_transfer" : cat,
      last4: t.cardId || "",
      dateLocal: isoToLocalISO(t.date), authLocal: isoToLocalISO(t.authorizedAt),
      status, decline: t.declineReason || "",
    };
  }).filter(x => x.id && x.dateLocal && !isNaN(x.amt) && x.amt !== 0);
}

// Slash reports one balance per type; what you can spend is all of them together
// (a secured charge card keeps your money as "credit", a debit account as "debit").
function pickAvailable(b){
  const accts = (b && b.accounts) || [];
  if (accts.length) return { available: accts.reduce((t, a) => t + (a.available || 0), 0), posted: accts.reduce((t, a) => t + (a.posted || 0), 0) };
  return typeof b?.available === "number" ? { available: b.available, posted: b.posted || 0 } : null;
}

// Pull new transactions through the relay and apply them quietly.
let syncing = false;
async function syncSlash(manual, full){
  const c = s.settings.slashSync || {};
  if (!c.url || !c.token || syncing || !navigator.onLine || sandbox) return;
  syncing = true;
  try {
    const since = full ? 0 : (c.lastSyncMs ? c.lastSyncMs - 4 * 86400000 : Date.now() - 45 * 86400000);
    const r = await fetch(`${c.url.replace(/\/+$/, "")}/transactions?since=${since}`, { headers: { Authorization: `Bearer ${c.token}` } });
    if (!r.ok) throw new Error("relay " + r.status);
    const j = await r.json();
    const plan = planFromRecords(s, recsFromSlashApi(j.items));
    const n = plan.adds.length + plan.updates.length;
    if (n) { armUndo(structuredClone(s)); applySlashImport(s, plan); }
    let balance = c.balance || null;
    try {
      const rb = await fetch(`${c.url.replace(/\/+$/, "")}/balance`, { headers: { Authorization: `Bearer ${c.token}` } });
      if (rb.ok) { const b = await rb.json(); const p = pickAvailable(b); if (p) balance = { ...p, accounts: b.accounts || [], at: Date.now() }; }
    } catch {}
    s.settings.slashSync = { ...c, balance, lastSyncMs: Date.now(), lastResult: n ? `${plan.adds.length} new, ${plan.updates.length} settled` : "nothing new", lastError: "" };
    save();
    if (n || manual) render();
    if (n) toast(`Slash: ${plan.adds.length} new${plan.updates.length ? `, ${plan.updates.length} settled` : ""}`);
  } catch (e) {
    s.settings.slashSync = { ...c, lastError: String(e.message || e) };
    save(); if (manual) render();
  } finally { syncing = false; }
}

// Replace every entry with Slash's full history and line today up with Slash's balance.
function rebuildFromRecords(st, recs, available, today){
  st.items = []; st.adjust = {};
  const plan = planFromRecords(st, recs);
  applySlashImport(st, plan);
  const dates = st.items.filter(x => !x.declined).map(x => x.date).sort();
  if (dates.length) { st.startDate = dates[0]; st.startBudget = 0; }
  let matched = 0;
  if (typeof available === "number" && dates.length) {
    const diff = available - calc(st, today).end;
    if (Math.abs(diff) > 0.004) { st.adjust[st.startDate] = diff; matched = diff; }
  }
  return { count: st.items.length, declined: plan.declined || 0, startDate: st.startDate, matched };
}

let rebuildAsk = false;
async function rebuildFromSlash(){
  const c = s.settings.slashSync || {};
  if (!c.url || !c.token || syncing) return;
  syncing = true;
  try {
    const base = c.url.replace(/\/+$/, "");
    const r = await fetch(`${base}/transactions?since=0`, { headers: { Authorization: `Bearer ${c.token}` } });
    if (!r.ok) throw new Error("relay " + r.status);
    const j = await r.json();
    let bal = null;
    try { const rb = await fetch(`${base}/balance`, { headers: { Authorization: `Bearer ${c.token}` } }); if (rb.ok) bal = pickAvailable(await rb.json()); } catch {}
    armUndo(structuredClone(s));
    const out = rebuildFromRecords(s, recsFromSlashApi(j.items), bal ? bal.available : null, todayISO());
    s.settings.slashSync = { ...c, balance: bal ? { ...bal, accounts: [], at: Date.now() } : c.balance, lastSyncMs: Date.now(), lastResult: `rebuilt: ${out.count} entries`, lastError: "" };
    rebuildAsk = false; date = todayISO(); view = "day";
    save(); render();
    toast(`Rebuilt from Slash — ${out.count} entries since ${prettyShort(out.startDate)}`);
  } catch (e) {
    s.settings.slashSync = { ...c, lastError: String(e.message || e) }; rebuildAsk = false; save(); render();
  } finally { syncing = false; }
}

let toastTimer = null;
function toast(text){
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast num"; document.body.appendChild(el); }
  el.textContent = text; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function applySlashImport(st, plan){
  for (const u of plan.updates) {
    const i = st.items.find(z => z.id === u.id);
    if (i) { i.settle = u.settle; i.importId = u.importId; i.checked = true; }
  }
  for (const a of plan.adds) {
    const v = upsertVendorFromEntry(st, a);
    a.accountId = v.defaultAccountId ?? null;
    st.items.push(a);
  }
  return st;
}

// ---- search ----

function matchesSearch(st, x, q){
  q = String(q).trim().toLowerCase();
  if (!q) return true;
  const vendor = x.vendorId ? st.vendors.find(v => v.id === x.vendorId) : null;
  const cad = x.cadFixed != null ? x.cadFixed : x.usd * (st.rate || 1);
  const hay = [
    x.name, x.note, vendor ? vendor.name : "",
    round2(x.usd).toFixed(2), String(round2(x.usd)),
    round2(cad).toFixed(2), String(round2(cad)),
  ].join("\n").toLowerCase();
  return hay.includes(q);
}

// ---- rows ----

const RMARK = `<svg class="rmark" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Repeats"><path d="M10.2 6A4.2 4.2 0 1 1 8.9 2.9"/><path d="M9.2 0.9l0.4 2.2-2.2 0.4"/></svg>`;

function rowHTML(x){
  if (deleteAsk === x.id) {
    return `<div class="row askrow" data-id="${x.id}">
      <div class="name" style="white-space:normal">Delete ${esc(x.name)}?
        <button class="link" data-del-one="${x.id}" style="margin-left:10px">just this one</button>
        <button class="link" data-del-stop="${x.id}">stop repeating</button>
        <button class="link" data-del-cancel="${x.id}">keep it</button>
      </div>
    </div>`;
  }
  const color = x.kind==="in" ? "var(--in)" : "var(--out)";
  const sign = x.kind==="in" ? "+" : "−";
  const cadVal = x.cadFixed!=null ? x.cadFixed : x.usd*s.rate;
  const mainAmt = cadFirst() ? fmt(cadVal,"") : fmt(x.usd,"");
  const subAmt = cadFirst() ? fmt(x.usd) : fmt(cadVal,"C$");
  const lag = lagSuggestion(s, x);
  const detail = expandedId === x.id ? `<div class="detail">
    ${s.accounts.length?`<label class="sub" style="margin:0">Account
      <select data-acc="${x.id}" aria-label="Account for ${esc(x.name)}" style="width:auto;margin-left:8px;padding:5px 8px;font-size:12.5px">
        <option value="">none</option>
        ${s.accounts.map(a=>`<option value="${a.id}" ${x.accountId===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}
      </select>
    </label>`:""}
    <input data-note="${x.id}" value="${esc(x.note)}" placeholder="Note" aria-label="Note for ${esc(x.name)}" style="flex:1;min-width:130px;padding:5px 8px;font-size:12.5px">
    <input data-receipt="${x.id}" value="${esc(x.receiptUrl)}" placeholder="Receipt link" aria-label="Receipt link for ${esc(x.name)}" style="flex:1;min-width:130px;padding:5px 8px;font-size:12.5px">
    <label class="sub" style="margin:0">Day
      <input type="date" data-redate="${x.id}" value="${x.date}" aria-label="Day for ${esc(x.name)}" style="width:auto;margin-left:8px;padding:5px 8px;font-size:12.5px;font-weight:400">
      <button class="link" data-yesterday="${x.id}" style="margin-left:6px">yesterday</button>
      <button class="link" data-again="${x.id}" style="margin-left:6px">log again today</button>
    </label>
    <label class="sub" style="margin:0">Settlement
      <select data-settle="${x.id}" aria-label="Settlement for ${esc(x.name)}" style="width:auto;margin-left:8px;padding:5px 8px;font-size:12.5px">
        <option value="" ${!x.settle?"selected":""}>—</option>
        <option value="pending" ${x.settle==="pending"?"selected":""}>authorized, not settled</option>
        <option value="settled" ${x.settle&&x.settle!=="pending"?"selected":""}>settled</option>
      </select>
      ${x.settle&&x.settle!=="pending"?`<input type="date" data-setdate="${x.id}" value="${x.settle}" aria-label="Settled on" style="width:auto;margin-left:6px;padding:5px 8px;font-size:12.5px;font-weight:400">`:""}
    </label>
  </div>` : "";
  const authorized = !x.checked && x.settle === "pending";
  return `<label class="row ${x.checked?"done":""}${x.id===lastAddedId?" fresh":""}${x.declined?" declinedrow":""}" data-id="${x.id}">
    <span class="drag" draggable="true" data-drag="${x.id}" title="Drag to reorder"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/></svg></span>
    <input type="checkbox" ${x.checked?"checked":""} ${authorized?'data-ind="1"':""} ${x.declined?"disabled":""} style="accent-color:${color}" data-toggle="${x.id}" aria-label="${esc(x.name)} ${x.checked?"done":authorized?"authorized, waiting to settle — check when it settles":"expected"}">
    <div class="name"><button class="namebtn" data-vopen-item="${x.id}" title="Open vendor">${esc(x.name)}</button>${x.recurringSourceId?RMARK:""}${x.cadFixed!=null?'<span class="tinytag">CAD</span>':""}${x.note?`<span class="notetxt">${esc(x.note)}</span>`:""}${x.receiptUrl?`<a class="notetxt" style="text-decoration:underline" href="${esc(x.receiptUrl)}" target="_blank" rel="noopener">receipt</a>`:""}${x.settle==="pending"?'<span class="tinytag auth">authorized</span>':""}${x.declined?'<span class="tinytag">declined</span>':""}${dueMark(x, todayISO())}${lag?`<button class="lagchip" data-lag="${x.id}" title="This vendor usually authorizes earlier — move it there">${dayDiff(lag, x.date)===1?"yesterday?":prettyShort(lag)+"?"}</button>`:""}</div>
    <div class="amt num" data-expand="${x.id}" title="Details"><div class="u" style="color:${x.checked?"var(--muted)":color}">${sign}${mainAmt}</div><div class="c">${subAmt}</div></div>
    <button class="x" data-remove="${x.id}" title="Remove" aria-label="Remove ${esc(x.name)}">×</button>
  </label>${detail}`;
}

// Two or more entries from the same merchant in one list collapse into a single
// row with the count and total; a group with something unchecked opens itself.
function groupItems(items){
  const groups = new Map();
  for (const x of items) { const k = x.vendorId || x.name.trim().toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  return [...groups.entries()].map(([k, list]) => ({ key: k, list }));
}
function groupRows(items, listKey){
  return groupItems(items).map(({ key, list }) => {
    if (list.length < 2) return rowHTML(list[0]);
    const gk = "g:" + listKey + ":" + key;
    const pend = list.filter(x => !x.checked && !x.declined).length;
    const open = showDone[gk] !== undefined ? showDone[gk] : pend > 0;
    const total = list.reduce((t, x) => t + x.usd, 0);
    const kind = list[0].kind, color = kind === "in" ? "var(--in)" : "var(--out)";
    return `<div class="row grouprow" role="button" tabindex="0" data-donetoggle="${gk}" data-cur="${open?1:0}" aria-expanded="${open?"true":"false"}">
      <span class="gbadge">${list.length}</span>
      <div class="name">${esc(list[0].name)}<span class="notetxt">${list.length} × same merchant${pend?` · ${pend} unchecked`:""}</span></div>
      <div class="amt num"><div class="u" style="color:${color}">${kind==="in"?"+":"−"}${fmtPbare(total)}</div><div class="c">${fmtSec(total)}</div></div>
      <svg class="pchev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.2 2.5L8 6l-3.8 3.5"/></svg>
    </div>${open ? `<div class="gsub">${list.map(rowHTML).join("")}</div>` : ""}`;
  }).join("");
}

// Pending entries stay on top; done ones can fold away behind one quiet line.
// Payouts and processor activity never fold — seeing them is the point.
function stackedRows(items, key, fold){
  if (!fold) return groupRows(items, key); // nothing hidden, repeats grouped
  const pending = items.filter(x => !x.checked);
  const done = items.filter(x => x.checked);
  let html = groupRows(pending, key + "p");
  if (done.length) {
    const net = done.reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
    html += `<button class="donebar num" data-donetoggle="${key}" aria-expanded="${showDone[key] ? "true" : "false"}">${done.length} done · ${fmtP(net)}<span class="tinylink">${showDone[key] ? "hide" : "show"}</span></button>`;
    if (showDone[key]) html += groupRows(done, key + "d");
  }
  return html;
}

// The last few merchants you logged by hand in this direction.
function recentVendors(st, kind){
  const seen = [];
  const manual = st.items.filter(x => x.kind === kind && !x.importId && !x.recurringSourceId && !x.declined).sort((a, b) => b.date.localeCompare(a.date));
  for (const x of manual) { const n = x.name.trim(); if (!seen.some(z => z.toLowerCase() === n.toLowerCase())) seen.push(n); if (seen.length >= 5) break; }
  return seen;
}

function listHTML(kind, items){
  const isIn = kind==="in";
  const d = drafts[kind];
  const a = parseFloat(d.amount)||0;
  return `<div>
    <div class="lh"><div class="sw" style="background:${isIn?"var(--in)":"var(--out)"}"></div><div class="lt">${isIn?"Coming in":"Going out"}</div></div>
    <div class="hint">${isIn?"Check it when the money lands":"Check it when you pay it"}</div>
    ${items.length?`<div data-rows="${kind}">${stackedRows(items, kind, kind==="out")}</div>`:`<div class="empty">${date===todayISO()?"Quiet so far today.":date<todayISO()?"Nothing moved.":"Nothing planned yet."}</div>`}
    <div class="addrow">
      <div class="addgrid">
        <input data-f="name" data-k="${kind}" value="${esc(d.name)}" placeholder="${isIn?"Shopify payout":"Meta ads"}" aria-label="Name" autocomplete="off">
        <input data-f="amount" data-k="${kind}" type="number" step="0.01" value="${esc(d.amount)}" placeholder="0.00" style="text-align:right" aria-label="Amount">
        <select data-f="cur" data-k="${kind}" aria-label="Currency" style="padding:9px 6px"><option ${d.cur==="USD"?"selected":""}>USD</option><option ${d.cur==="CAD"?"selected":""}>CAD</option></select>
        <button class="btn" data-add="${kind}">Add</button>
      </div>
      <div class="cadnote" data-cadnote="${kind}"${d.cur==="CAD"&&a>0?"":" hidden"}>${d.cur==="CAD"&&a>0?`${fmt(a,"C$")} = ${fmt(a/s.rate)} today. Stays ${fmt(a,"C$")} even if the rate moves.`:""}</div>
      ${(()=>{ const r = recentVendors(s, kind); return r.length ? `<div class="recent">${r.map(n=>`<button class="chip mini" data-quick="${kind}" data-name="${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""; })()}
    </div>
  </div>`;
}

// Every entry since the start date, newest first, with the balance after each checked one.
function ledgerRows(st){
  const items = st.items.filter(x => x.date >= st.startDate).sort((a, b) => a.date.localeCompare(b.date));
  const adj = st.adjust || {};
  const adjDates = Object.keys(adj).sort();
  let bal = st.startBudget, ai = 0;
  const rows = [];
  for (const x of items) {
    while (ai < adjDates.length && adjDates[ai] <= x.date) { bal += adj[adjDates[ai]]; ai++; }
    if (x.checked) bal += x.kind === "in" ? x.usd : -x.usd;
    rows.push({ x, bal: x.checked ? bal : null });
  }
  return rows.reverse();
}

let allMode = "days";
let ledgerFilter = "all";
let ledgerGroup = true;
// consecutive rows from the same merchant with the same state become one line
function ledgerCompress(rows){
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const same = last && last.x.name.toLowerCase() === r.x.name.toLowerCase() && last.x.kind === r.x.kind && !!last.x.declined === !!r.x.declined && last.x.checked === r.x.checked;
    if (same) { last.n++; last.total += r.x.usd; }
    else out.push({ x: r.x, bal: r.bal, n: 1, total: r.x.usd });
  }
  return out;
}
function ledgerPass(st, x, f){
  const isProc = () => { const v = x.vendorId && st.vendors.find(z => z.id === x.vendorId); return !!(v && v.isProcessor); };
  switch (f) {
    case "proc": return isProc();
    case "cards": return String(x.src || "").startsWith("card");
    case "fees": return x.src === "fee" || /\bfee\b/i.test(x.name);
    case "pending": return !x.declined && (!x.checked || x.settle === "pending");
    case "declined": return !!x.declined;
    default: return true;
  }
}
function ledgerHTML(){
  const all = ledgerRows(s);
  const rows = all.filter(r => ledgerPass(s, r.x, ledgerFilter) && matchesSearch(s, r.x, searchQ));
  const count = f => all.filter(r => ledgerPass(s, r.x, f)).length;
  const chips = [["all","All"],["proc","Processors"],["cards","Cards"],["fees","Fees"],["pending","Pending"],["declined","Declined"]]
    .map(([k,l]) => `<button class="chip${ledgerFilter===k?" on":""}" data-lfilter="${k}"><span class="dot${k==="declined"?" warn":k==="proc"?" good":""}"></span>${l} <b>${count(k)}</b></button>`).join("")
    + `<button class="chip${ledgerGroup?" on":""}" id="lgroup" title="Collapse runs of the same merchant"><span class="dot"></span>Group repeats</button>`;
  const head = `<div class="chips" style="margin:0 0 12px">${chips}</div>`;
  if (!rows.length) return head + '<div style="color:var(--muted)">Nothing matches.</div>';
  const compact = ledgerGroup ? ledgerCompress(rows) : rows.map(r => ({ ...r, n: 1, total: r.x.usd }));
  const shown = compact.slice(0, 400);
  const status = x => x.declined ? "declined" : x.checked ? (x.settle === "pending" ? "held" : x.settle ? "settled" : "done") : (x.settle === "pending" ? "authorized" : "expected");
  return head + `<div class="ledgerwrap"><table class="ledger num">
    <thead><tr><th>Date</th><th>What</th><th>Status</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th></tr></thead>
    <tbody>${shown.map(({ x, bal, n, total }) => `<tr class="${x.declined ? "decl" : x.checked ? "" : "pend"}">
      <td>${prettyShort(x.date)}</td>
      <td><button class="namebtn" data-vopen-item="${x.id}">${esc(x.name)}</button>${n > 1 ? `<span class="gbadge" style="margin-left:7px">×${n}</span>` : ""}${x.cadFixed != null && n === 1 ? '<span class="tinytag">CAD</span>' : ""}${x.recurringSourceId ? RMARK : ""}</td>
      <td class="sub" style="margin:0">${status(x)}</td>
      <td style="text-align:right;color:${x.kind === "in" ? "var(--in)" : "var(--out)"};font-weight:600">${x.kind === "in" ? "+" : "−"}${fmtPbare(total)}</td>
      <td style="text-align:right;color:${bal == null ? "var(--muted)" : bal < 0 ? "var(--out)" : "var(--ink)"}">${bal == null ? "—" : fmtPbare(bal)}</td>
    </tr>`).join("")}</tbody></table></div>
    ${compact.length > shown.length ? `<div class="sub" style="margin-top:8px">Showing the latest ${shown.length} of ${compact.length} — search to narrow.</div>` : ""}`;
}

function allListHTML(){
  if (allMode === "table") return ledgerHTML();
  const list = s.items.filter(x => matchesSearch(s, x, searchQ));
  if (!s.items.length) return '<div style="color:var(--muted)">Nothing logged on any day yet.</div>';
  if (!list.length) return '<div style="color:var(--muted)">Nothing matches.</div>';
  return groupedItemsHTML(list);
}

function groupedItemsHTML(list){
  const dates = [...new Set(list.map(x=>x.date))].sort().reverse();
  return dates.map(d=>`<div class="grp"><button class="bare" style="font-size:14px;font-weight:600;margin-bottom:2px" data-open="${d}">${pretty(d)}<span class="tinylink">open</span></button>
    ${groupRows(list.filter(x=>x.date===d), "d" + d)}</div>`).join("");
}

// ---- views ----

let lastRenderedView = null;
const tabPos = {};
// After each render, slide the highlight pill to the active tab instead of swapping it.
function placeTabPills(){
  document.querySelectorAll(".tabs").forEach((box, i) => {
    const on = box.querySelector(".tab.on");
    if (!on) return;
    let pill = box.querySelector(".tabind");
    if (!pill) { pill = document.createElement("span"); pill.className = "tabind"; pill.setAttribute("aria-hidden", "true"); box.prepend(pill); }
    const key = [...box.querySelectorAll(".tab")].map(t => t.textContent.trim()).join("|");
    const to = { left: on.offsetLeft, width: on.offsetWidth };
    const from = tabPos[key];
    pill.style.left = to.left + "px"; pill.style.width = to.width + "px";
    if (from && !reduced() && (from.left !== to.left || from.width !== to.width) && pill.animate) {
      pill.animate([{ left: from.left + "px", width: from.width + "px" }, { left: to.left + "px", width: to.width + "px" }],
        { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
    tabPos[key] = to;
  });
}
let showPendTray = false;
let sandbox = null; // snapshot of the real state while you play with what-ifs
let lastAddedId = null;
function gotoDate(d){ date=d; editCarry=false; showDone={in:false,out:false,proc:false}; showPendTray=false; save(); render(); }

function render(){
  if (generateRecurring(s, todayISO(), shift(date, 32)) > 0) save();
  const freshView = view !== lastRenderedView;
  lastRenderedView = view;
  if (view === "vendor") renderVendor();
  else if (view === "vendors") renderVendors();
  else if (view === "accounts") renderAccounts();
  else if (view === "settings") renderSettings();
  else if (view === "goals") renderGoals();
  else renderMain();
  placeTabPills();
  // opening a screen fades it in gently; staying on it doesn't replay the entrance
  const el = document.getElementById("app");
  if (freshView && !reduced()) {
    el.classList.remove("viewfade");
    void el.offsetWidth;
    el.classList.add("viewfade");
  } else if (!freshView) el.classList.remove("viewfade");
}

function renderGoals(){
  const t = todayISO();
  document.getElementById("app").innerHTML = `
    <div class="datebar"><button class="backbtn" id="back" aria-label="Back">${CHEV}</button><div class="lt" style="font-size:19px">Goals</div></div>
    <div class="hint" style="padding-left:0;margin-bottom:18px">A cash figure to reach by a date. Progress follows your real balance.</div>
    ${s.goals.length?`<div class="ggrid">${s.goals.map(g=>{
      const gi = goalInfo(s, g, t);
      const state = gi.reached
        ? '<span class="gstate" style="color:var(--in)">reached</span>'
        : gi.daysLeft === 0
          ? '<span class="gstate" style="color:var(--out)">past its date</span>'
          : gi.behind
            ? '<span class="gstate" style="color:var(--out)">behind pace</span>'
            : '<span class="gstate" style="color:var(--in)">on pace</span>';
      const meta = gi.reached
        ? `Reached with ${fmtP(gi.cash)} on hand.`
        : gi.daysLeft === 0
          ? `${fmtP(g.targetUsd - gi.cash)} short of the date.`
          : `${prettyShort(g.targetDate)} · ${gi.daysLeft} ${gi.daysLeft===1?"day":"days"} left · needs +${fmtPbare(gi.needPerDay)}/day · pace ${gi.pace>=0?"+":"−"}${fmtPbare(Math.abs(gi.pace))}/day`;
      return `<div class="gcard">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding-right:24px">
          <div class="name" style="font-weight:600;font-size:15px">${g.name?esc(g.name):"Cash target"}</div>
          ${state}
        </div>
        <div class="gbig num">${fmtP(gi.cash)} <span class="gof">of ${fmtP(g.targetUsd)}</span></div>
        <div class="gtrack" role="progressbar" aria-valuenow="${Math.round(gi.pct*100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${(gi.pct*100).toFixed(1)}%;${gi.behind&&!gi.reached?"background:var(--out)":""}"></span></div>
        <div class="gmeta num">${meta}</div>
        <button class="x" data-goal-remove="${g.id}" title="Remove" aria-label="Remove goal">×</button>
      </div>`;
    }).join("")}</div>`:'<div class="empty" style="border:none;padding-left:0">Nothing to aim at yet. Set the first one below.</div>'}
    <div class="addrow" style="margin-top:28px;border:none;padding:0">
      <div class="addgrid" style="grid-template-columns:1fr 130px 160px auto">
        <input id="goalName" placeholder="Reserve cushion" aria-label="Goal name (optional)">
        <input id="goalAmt" type="number" step="0.01" placeholder="${cadFirst()?"C$ 20000":"US$ 20000"}" style="text-align:right" aria-label="Target amount in ${cadFirst()?"Canadian":"US"} dollars">
        <input id="goalDate" type="date" style="width:100%;font-weight:400;font-size:14px" aria-label="Target date">
        <button class="btn" id="goalAdd">Set goal</button>
      </div>
    </div>
    ${undoChipHTML()}`;
  bindUndo();
  document.getElementById("back").onclick = ()=>{ view="day"; render(); };
  document.querySelectorAll("[data-goal-remove]").forEach(b=>b.onclick=()=>{
    armUndo(structuredClone(s));
    s.goals = s.goals.filter(g=>g.id!==b.dataset.goalRemove);
    save(); render();
  });
  const doAdd = ()=>{
    const amt = parseFloat(document.getElementById("goalAmt").value);
    const dt = document.getElementById("goalDate").value;
    if (!(amt > 0) || !dt) return;
    s.goals.push({ id: uid("g"), name: document.getElementById("goalName").value.trim(), targetUsd: cadFirst() ? amt/s.rate : amt, targetDate: dt,
                   startUsd: calc(s, t).allTime, createdAt: t });
    save(); render();
  };
  document.getElementById("goalAdd").onclick = doAdd;
  ["goalName","goalAmt"].forEach(id=>document.getElementById(id).onkeydown = e=>{ if(e.key==="Enter") doAdd(); });
}

let pendingImport = null;
let importError = false;
let pendingCsv = null;
let csvError = false;
let wipeMsg = "";
let undoBuf = null;

function applyTheme(){
  const t = s.settings.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// Any delete can be taken back for 6 seconds.
function armUndo(snapshot){
  if (undoBuf) clearTimeout(undoBuf.timer);
  undoBuf = { snapshot, timer: setTimeout(()=>{ undoBuf = null; render(); }, 6000) };
}

function undoChipHTML(){
  return undoBuf ? `<div class="undo num" role="status">Deleted.<button id="undoBtn" class="link" style="color:var(--paper)">Undo</button></div>` : "";
}

function bindUndo(){
  const b = document.getElementById("undoBtn");
  if (b) b.onclick = ()=>{
    clearTimeout(undoBuf.timer);
    s = undoBuf.snapshot; undoBuf = null;
    save(); render();
  };
}

function renderSettings(){
  const t = todayISO();
  const last = s.settings.lastBackupAt;
  const diff = pendingImport ? diffStates(s, pendingImport) : null;
  document.getElementById("app").innerHTML = `
    <div class="datebar"><button class="backbtn" id="back" aria-label="Back">${CHEV}</button><div class="lt" style="font-size:19px">Settings</div></div>
    ${backupDue(s, t)?`<div class="runway low" style="margin:0 0 14px">It's been over 30 days since the last backup.<button class="link" id="dismissBackup">dismiss</button></div>`:""}
    <div class="grp" style="border-top:1px solid var(--line);padding-top:14px">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <button class="btn" id="exportJson">Download backup</button>
        <button class="btn btn2" id="exportCsvBtn">Export CSV</button>
        <span class="sub" style="margin:0">Last backup: ${last?prettyShort(last):"never"}</span>
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="sub" style="margin:0" for="importFile">Restore from a backup file</label>
        <input type="file" id="importFile" accept=".json,application/json" aria-label="Backup file" style="width:auto;font-size:12.5px">
      </div>
      ${importError?`<div class="runway low" style="margin-top:10px">That file isn't a Money backup.</div>`:""}
      <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="sub" style="margin:0" for="slashFile">Import a Slash CSV export</label>
        <input type="file" id="slashFile" accept=".csv,text/csv" aria-label="Slash CSV export" style="width:auto;font-size:12.5px">
      </div>
      ${csvError?`<div class="runway low" style="margin-top:10px">That doesn't look like a Slash transactions export.</div>`:""}
      ${pendingCsv?(()=>{ const inSum = pendingCsv.adds.filter(a=>a.kind==="in").reduce((t,a)=>t+a.usd,0);
        const outSum = pendingCsv.adds.filter(a=>a.kind==="out").reduce((t,a)=>t+a.usd,0);
        return `<div class="summary num" style="margin-top:14px">
          <span>Adds <b>${pendingCsv.adds.length}</b> ${pendingCsv.adds.length===1?"entry":"entries"} (+${fmtPbare(inSum)} in, −${fmtPbare(outSum)} out)</span>
          ${pendingCsv.updates.length?`<span>marks <b>${pendingCsv.updates.length}</b> pending ${pendingCsv.updates.length===1?"entry":"entries"} settled</span>`:""}
          ${pendingCsv.dupes?`<span>skips ${pendingCsv.dupes} already logged</span>`:""}
          ${pendingCsv.pairs?`<span>ignores ${pendingCsv.pairs} cancelling ${pendingCsv.pairs===1?"pair":"pairs"}</span>`:""}
          ${pendingCsv.authSkips?`<span>ignores ${pendingCsv.authSkips} superseded ${pendingCsv.authSkips===1?"hold":"holds"}</span>`:""}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn" id="applyCsv">Apply</button>
          <button class="link" id="cancelCsv" style="margin-left:0">cancel</button>
        </div>`; })():""}
      ${diff?`<div class="summary num" style="margin-top:14px">
          <span>This will add <b>${diff.items.add}</b>, change <b>${diff.items.change}</b>, remove <b>${diff.items.remove}</b> ${diff.items.remove===1?"entry":"entries"}</span>
          <span>Vendors: +${diff.vendors.add} ~${diff.vendors.change} −${diff.vendors.remove}</span>
          <span>Accounts: +${diff.accounts.add} ~${diff.accounts.change} −${diff.accounts.remove}</span>
          ${diff.startChanged?"<span>The starting balance changes</span>":""}
          ${diff.rateChanged?"<span>The rate changes</span>":""}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn" id="applyImport">Apply</button>
          <button class="link" id="cancelImport" style="margin-left:0">cancel</button>
        </div>`:""}
    </div>
    <div class="grp" style="border-top:1px solid var(--line);padding-top:14px">
      <div class="lbl" style="font-size:12px;color:var(--muted)">Auto-sync with Slash</div>
      <div class="sub" style="margin:4px 0 10px">New transactions land here on their own, through your own relay (see relay/README.md). Your Slash API key never touches this app.</div>
      <div class="addgrid" style="grid-template-columns:1fr 1fr auto;gap:8px">
        <input id="ssUrl" value="${esc(s.settings.slashSync?.url||"")}" placeholder="https://money-relay.you.workers.dev" aria-label="Relay URL">
        <input id="ssTok" type="password" value="${esc(s.settings.slashSync?.token||"")}" placeholder="App token" aria-label="Relay app token" autocomplete="off">
        <button class="btn btn2" id="ssSync">Sync now</button>
      </div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button class="link" id="ssFull" style="margin-left:0">Pull my full Slash history</button>
        <span class="sub" style="margin:0">Everything, once. Days before your start date become history that never moves your balance.</span>
      </div>
      <div style="margin-top:12px">
        ${rebuildAsk
          ? `<div class="runway low" style="margin:0 0 8px">This replaces every entry with Slash's complete history — settled, pending, and declined — sets your start to the first transaction, and lines today up with Slash's balance. Vendors, accounts, and goals stay. Undo has you for 6 seconds.</div>
             <div style="display:flex;gap:8px;align-items:center"><button class="btn" id="rebuildGo">Rebuild from Slash</button><button class="link" id="rebuildNo" style="margin-left:0">cancel</button></div>`
          : `<button class="btn btn2" id="rebuildAskBtn">Rebuild everything from Slash</button><span class="sub" style="margin-left:10px">The clean slate: no duplicates, no leftover gaps.</span>`}
      </div>
      ${s.settings.slashSync?.lastSyncMs?`<div class="sub" style="margin-top:8px">Last sync ${new Date(s.settings.slashSync.lastSyncMs).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} · ${esc(s.settings.slashSync.lastResult||"")}</div>`:""}
      ${s.settings.slashSync?.lastError?`<div class="runway low" style="margin-top:6px">Couldn't sync: ${esc(s.settings.slashSync.lastError)}</div>`:""}
      ${(()=>{ const b = s.settings.slashSync?.balance; if (!b) return "";
        const leftToday = calc(s, todayISO()).end; const diff = b.available - leftToday;
        return `<div class="recon num">
          <span>Slash available: <b>${fmtP(b.available)}</b></span>
          <span>Tracker today: <b>${fmtP(leftToday)}</b></span>
          <span style="color:${Math.abs(diff)>0.005?"var(--out)":"var(--in)"}">Difference: <b>${fmtP(diff)}</b></span>
          ${Math.abs(diff)>0.005?`<button class="btn btn2" id="reconBtn" style="padding:7px 12px;font-size:12px">Match Slash today</button>`:"<span>In sync.</span>"}
          <span class="sub" style="margin:0">Slash figure as of ${new Date(b.at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}. Matching adds a start-of-day adjustment for today — never an entry.</span>
        </div>`; })()}
    </div>
    <div class="grp" style="border-top:1px solid var(--line);padding-top:14px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="sub" style="margin:0" for="wipeMonth">Delete a whole month of entries</label>
        <input type="month" id="wipeMonth" style="width:auto;font-size:12.5px;font-weight:400" aria-label="Month to delete">
        <button class="btn btn2" id="wipeBtn">Delete that month</button>
        ${wipeMsg?`<span class="sub" style="margin:0">${wipeMsg}</span>`:""}
      </div>
      <div class="sub" style="margin-top:8px">For re-importing a month clean. Undo has your back for 6 seconds.</div>
    </div>
    <div class="grp" style="border-top:1px solid var(--line);padding-top:14px">
      <label class="sub" style="margin:0;display:block;margin-bottom:10px">Warn when the 30-day low dips under
        <input id="cushion" type="number" step="1" min="0" value="${s.settings.cushionUsd||0}" style="width:110px;margin:0 6px;padding:5px 8px;font-size:12.5px" aria-label="Cushion in US dollars"> US$
      </label>
      <label class="sub" style="margin:0">Due-soon marks show
        <input id="warnDays" type="number" min="0" max="30" value="${s.settings.warnDaysAhead}" style="width:60px;margin:0 6px;padding:5px 8px;font-size:12.5px" aria-label="Days ahead for due marks">
      days ahead</label>
    </div>
    <div class="grp" style="border-top:1px solid var(--line);padding-top:14px">
      <label class="sub" style="margin:0">Currency shown first
        <select id="curSel" aria-label="Primary currency" style="width:auto;margin-left:8px;padding:5px 8px;font-size:12.5px">
          <option value="usd" ${s.settings.currencyDisplay!=="cad"?"selected":""}>US dollars</option>
          <option value="cad" ${s.settings.currencyDisplay==="cad"?"selected":""}>Canadian dollars</option>
        </select>
      </label>
      <div class="sub" style="margin-top:8px">The other currency stays visible underneath. Amounts are kept in USD; CAD-locked entries never move.</div>
    </div>
    <div class="grp" style="border-top:1px solid var(--line);padding-top:14px">
      <label class="sub" style="margin:0">Appearance
        <select id="themeSel" aria-label="Theme" style="width:auto;margin-left:8px;padding:5px 8px;font-size:12.5px">
          <option value="system" ${s.settings.theme==="system"?"selected":""}>follow the system</option>
          <option value="light" ${s.settings.theme==="light"?"selected":""}>light</option>
          <option value="dark" ${s.settings.theme==="dark"?"selected":""}>dark</option>
        </select>
      </label>
    </div>
    <div class="grp" style="border-top:1px solid var(--line);padding-top:14px">
      <div class="sub" style="margin:0">Keyboard: n new entry · ← → change day · t today · / search · Esc cancel</div>
    </div>
    ${undoChipHTML()}`;
  bindUndo();
  document.getElementById("back").onclick = ()=>{ pendingImport=null; pendingCsv=null; csvError=false; wipeMsg=""; view="day"; render(); };
  const ssSave = ()=>{ s.settings.slashSync = { ...(s.settings.slashSync||{}), url: document.getElementById("ssUrl").value.trim(), token: document.getElementById("ssTok").value.trim() }; save(); };
  document.getElementById("ssUrl").onchange = ssSave;
  document.getElementById("ssTok").onchange = ssSave;
  document.getElementById("ssSync").onclick = ()=>{ ssSave(); syncSlash(true); };
  document.getElementById("ssFull").onclick = ()=>{ ssSave(); syncSlash(true, true); };
  const ra = document.getElementById("rebuildAskBtn"); if (ra) ra.onclick = ()=>{ ssSave(); rebuildAsk = true; render(); };
  const rn = document.getElementById("rebuildNo"); if (rn) rn.onclick = ()=>{ rebuildAsk = false; render(); };
  const rg = document.getElementById("rebuildGo"); if (rg) rg.onclick = ()=>{ ssSave(); rebuildFromSlash(); };
  const rb = document.getElementById("reconBtn");
  if (rb) rb.onclick = ()=>{
    const b = s.settings.slashSync?.balance; if (!b) return;
    const t = todayISO(); const diff = b.available - calc(s, t).end;
    s.adjust = s.adjust || {}; s.adjust[t] = (s.adjust[t] || 0) + diff;
    save(); render(); toast("Matched Slash — today's start adjusted");
  };
  document.getElementById("wipeBtn").onclick = ()=>{
    const ym = document.getElementById("wipeMonth").value;
    if (!ym) { wipeMsg = "Pick a month first."; render(); return; }
    armUndo(structuredClone(s));
    const n = deleteMonth(s, ym);
    wipeMsg = n ? `Removed ${n} ${n===1?"entry":"entries"}.` : "Nothing in that month.";
    save(); render();
  };
  document.getElementById("exportJson").onclick = exportJson;
  document.getElementById("exportCsvBtn").onclick = exportCsv;
  const dis = document.getElementById("dismissBackup");
  if (dis) dis.onclick = ()=>{ s.settings.backupDismissedAt = t; save(); render(); };
  document.getElementById("importFile").onchange = e=>{
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      try {
        const inc = JSON.parse(rd.result);
        if (!inc || typeof inc !== "object" || !Array.isArray(inc.items)) throw new Error("bad shape");
        pendingImport = migrate(inc); importError = false;
      }
      catch { pendingImport = null; importError = true; }
      render();
    };
    rd.readAsText(f);
  };
  document.getElementById("slashFile").onchange = e=>{
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      try { pendingCsv = mapSlashCsv(s, rd.result); csvError = !pendingCsv; }
      catch { pendingCsv = null; csvError = true; }
      render();
    };
    rd.readAsText(f);
  };
  const ac = document.getElementById("applyCsv");
  if (ac) ac.onclick = ()=>{
    armUndo(structuredClone(s));
    applySlashImport(s, pendingCsv);
    pendingCsv = null;
    save(); view = "day"; render();
  };
  const cc = document.getElementById("cancelCsv");
  if (cc) cc.onclick = ()=>{ pendingCsv = null; render(); };
  const ap = document.getElementById("applyImport");
  if (ap) ap.onclick = ()=>{ s = pendingImport; pendingImport = null; date = s.lastDate || todayISO(); save(); render(); };
  const ci = document.getElementById("cancelImport");
  if (ci) ci.onclick = ()=>{ pendingImport = null; render(); };
  document.getElementById("cushion").onchange = e=>{ s.settings.cushionUsd = Math.max(0, parseFloat(e.target.value) || 0); save(); render(); };
  document.getElementById("warnDays").onchange = e=>{
    s.settings.warnDaysAhead = Math.min(30, Math.max(0, parseInt(e.target.value, 10) || 0));
    save(); render();
  };
  document.getElementById("themeSel").onchange = e=>{
    s.settings.theme = e.target.value;
    save(); applyTheme(); render();
  };
  document.getElementById("curSel").onchange = e=>{
    s.settings.currencyDisplay = e.target.value === "cad" ? "cad" : "usd";
    save(); render();
  };
}

function renderAccounts(){
  const shown = s.accounts.filter(a => accountsFilter === "all" || a.kind === accountsFilter);
  const total = shown.reduce((t, a) => t + accountBalance(s, a), 0);
  const unassigned = s.items.filter(x => x.checked && !x.accountId)
    .reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
  document.getElementById("app").innerHTML = `
    <div class="datebar">
      <button class="backbtn" id="back" aria-label="Back">${CHEV}</button>
      <div class="lt" style="font-size:19px">Accounts</div>
      <div class="tabs">
        <button class="tab ${accountsFilter==="all"?"on":""}" data-afilter="all">All</button>
        <button class="tab ${accountsFilter==="business"?"on":""}" data-afilter="business">Business</button>
        <button class="tab ${accountsFilter==="personal"?"on":""}" data-afilter="personal">Personal</button>
      </div>
    </div>
    <div class="hero num">
      <div class="lbl">${accountsFilter==="all"?"Across all accounts":accountsFilter==="business"?"Business total":"Personal total"}</div>
      <div class="heron" style="color:${total<0?"var(--out)":"var(--in)"}">${fmtP(total)}</div>
      <div class="sub">${fmtSec(total)}</div>
    </div>
    ${shown.length?shown.map(a=>{
      const bal = accountBalance(s, a);
      const balCell = editAccId===a.id
        ? `<span style="display:flex;gap:6px;align-items:center"><span class="sub num" style="margin:0">${cadFirst()?"C$":"US$"}</span><input id="accDraft" type="number" step="0.01" value="${round2(cadFirst()?bal*s.rate:bal).toFixed(2)}" style="width:130px;padding:5px 8px;text-align:right" aria-label="Balance for ${esc(a.name)} in ${cadFirst()?"Canadian":"US"} dollars"><button class="btn" data-accsave="${a.id}" style="padding:6px 10px;font-size:12px">Save</button></span>`
        : `<button class="bare num" data-accedit="${a.id}" style="font-size:15px;font-weight:600;color:${bal<0?"var(--out)":"var(--ink)"}">${fmtP(bal)}<span class="tinylink">edit</span></button>`;
      return `<div class="row" style="cursor:default">
        <div class="sw" style="background:${a.color}"></div>
        <input class="bare-input" data-acc-name="${a.id}" value="${esc(a.name)}" aria-label="Name of ${esc(a.name)}">
        <select class="kindsel" data-acc-kind="${a.id}" aria-label="Type of ${esc(a.name)}">
          <option value="business" ${a.kind==="business"?"selected":""}>business</option>
          <option value="personal" ${a.kind==="personal"?"selected":""}>personal</option>
        </select>
        <div class="amt">${balCell}</div>
        <button class="x" data-acc-remove="${a.id}" title="Remove" aria-label="Remove ${esc(a.name)}">×</button>
      </div>`;
    }).join(""):'<div class="empty">No accounts yet.</div>'}
    ${Math.abs(unassigned)>0.004?`<div class="summary num" style="margin-top:14px"><span>${fmtP(unassigned)} of checked entries has no account</span></div>`:""}
    <div class="addrow" style="margin-top:26px">
      <div class="addgrid" style="grid-template-columns:1fr 130px auto">
        <input id="accName" placeholder="Mercury" aria-label="Account name">
        <select id="accKind" aria-label="Account type"><option value="business">business</option><option value="personal">personal</option></select>
        <button class="btn" id="accAdd">Add</button>
      </div>
    </div>
    ${undoChipHTML()}`;
  bindUndo();
  document.getElementById("back").onclick = ()=>{ view="day"; render(); };
  document.querySelectorAll("[data-afilter]").forEach(b=>b.onclick=()=>{ accountsFilter=b.dataset.afilter; render(); });
  document.querySelectorAll("[data-acc-name]").forEach(el=>{
    el.onchange = ()=>{ const a=s.accounts.find(z=>z.id===el.dataset.accName); const v=el.value.trim(); if(v){ a.name=v; save(); } render(); };
    el.onkeydown = e=>{ if(e.key==="Enter") el.blur(); };
  });
  document.querySelectorAll("[data-acc-kind]").forEach(el=>{
    el.onchange = ()=>{ const a=s.accounts.find(z=>z.id===el.dataset.accKind); a.kind=el.value; save(); render(); };
  });
  document.querySelectorAll("[data-acc-remove]").forEach(b=>b.onclick=()=>{
    armUndo(structuredClone(s));
    deleteAccount(s, b.dataset.accRemove);
    save(); render();
  });
  document.querySelectorAll("[data-accedit]").forEach(b=>b.onclick=()=>{ editAccId=b.dataset.accedit; render(); document.getElementById("accDraft").focus(); });
  document.querySelectorAll("[data-accsave]").forEach(b=>{
    const doSave = ()=>{
      const a = s.accounts.find(z=>z.id===b.dataset.accsave);
      const v = parseFloat(document.getElementById("accDraft").value);
      // the balance is derived, so editing it adjusts the account's starting figure
      if (!isNaN(v)) { const usdV = cadFirst() ? v/s.rate : v; a.start = usdV - (accountBalance(s, a) - a.start); }
      editAccId = null; save(); render();
    };
    b.onclick = doSave;
    document.getElementById("accDraft").onkeydown = e=>{ if(e.key==="Enter") doSave(); if(e.key==="Escape"){ editAccId=null; render(); } };
  });
  const accAdd = document.getElementById("accAdd");
  const doAdd = ()=>{
    const name = document.getElementById("accName").value.trim();
    if (!name) return;
    const palette = ["#1C6B5E", "#A8681C", "#6B7280", "#161C26"];
    s.accounts.push({ id: uid("a"), name, kind: document.getElementById("accKind").value, color: palette[s.accounts.length % palette.length], start: 0 });
    save(); render();
  };
  accAdd.onclick = doAdd;
  document.getElementById("accName").onkeydown = e=>{ if(e.key==="Enter") doAdd(); };
}

// The datalist starts empty: no dropdown on click, suggestions only once you type.
function datalistHTML(){
  return `<datalist id="vendorNames"></datalist>`;
}

const CHEV = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.8 3.5L5.3 8l4.5 4.5"/></svg>';

const NAV_ICONS = {
  accounts: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6L8 2.8 13.5 6M3.5 6v6M6.5 6v6M9.5 6v6M12.5 6v6M2.5 13.2h11"/></svg>',
  vendors: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 5.8h9.6l-1-3H4.2l-1 3zM3.8 5.8v7.4h8.4V5.8M6.6 13.2V9.4h2.8v3.8"/></svg>',
  goals: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.2 13.8V2.6M4.2 3.2h7.6l-1.7 2.6 1.7 2.6H4.2"/></svg>',
  settings: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 5h11M2.5 11h11"/><circle cx="6" cy="5" r="1.7"/><circle cx="10" cy="11" r="1.7"/></svg>',
};

function sectionNavHTML(){
  return `<nav class="navbar" aria-label="Sections">
    ${[["accounts","Accounts"],["vendors","Vendors"],["goals","Goals"],["settings","Settings"]]
      .map(([k,label])=>`<button class="navbtn" data-nav="${k}">${NAV_ICONS[k]}<span>${label}</span></button>`).join("")}
  </nav>`;
}

function renderMain(){
  const m = calc(s, date);
  const isToday = date===todayISO();
  const isStart = date===s.startDate;
  const curSym = cadFirst() ? "C$" : "US$";
  const inPrimary = usd => round2(cadFirst() ? usd * s.rate : usd).toFixed(2);
  let startCell;
  if (isStart) {
    startCell = editStart
      ? `<div style="display:flex;gap:6px;align-items:center"><span class="sub num" style="margin:0">${curSym}</span><input id="startDraft" type="number" step="0.01" value="${inPrimary(s.startBudget)}" style="font-size:18px;font-weight:600;padding:4px 8px;width:130px" aria-label="Starting balance in ${cadFirst()?"Canadian":"US"} dollars"><button class="btn" id="saveStart" style="padding:6px 10px;font-size:12px">Save</button></div>`
      : `<button class="bare num big" id="editStart">${fmtP(s.startBudget)}<span class="tinylink">edit</span></button>`;
  } else {
    const a = (s.adjust || {})[date] || 0;
    startCell = editCarry
      ? `<div style="display:flex;gap:6px;align-items:center"><span class="sub num" style="margin:0">${curSym}</span><input id="carryDraft" type="number" step="0.01" value="${inPrimary(m.carry)}" style="font-size:18px;font-weight:600;padding:4px 8px;width:130px" aria-label="Start of day in ${cadFirst()?"Canadian":"US"} dollars"><button class="btn" id="saveCarry" style="padding:6px 10px;font-size:12px">Save</button></div>`
      : `<button class="bare num big" id="editCarry">${fmtP(m.carry)}<span class="tinylink">edit</span></button>
         <div class="sub">${a ? `adjusted ${fmtP(a)}<button class="link" id="clearAdj">clear</button>` : date < s.startDate ? "before the start" : "carried from before"}</div>`;
  }
  const endColor = m.end<0 ? "var(--out)" : "var(--in)";
  const endFill = m.end<0 ? "var(--outSoft)" : "var(--inSoft)";

  let body;
  if (view==="day") {
    const procOf = x => { const v = x.vendorId && s.vendors.find(z=>z.id===x.vendorId); return (v && v.isProcessor) ? v : null; };
    const procT = [...m.inT, ...m.outT].filter(x=>procOf(x));
    const inO = m.inT.filter(x=>!procOf(x)), outO = m.outT.filter(x=>!procOf(x));
    // one card per processor: its payout with its fees and debits, together
    let procBlock = "";
    if (procT.length) {
      const byVendor = new Map();
      for (const x of procT) { const v = procOf(x); if (!byVendor.has(v.id)) byVendor.set(v.id, { v, items: [] }); byVendor.get(v.id).items.push(x); }
      const cards = [...byVendor.values()].map(({ v, items }) => {
        const net = items.filter(x=>x.checked).reduce((t,x)=>t+(x.kind==="in"?x.usd:-x.usd),0);
        const pending = items.filter(x=>!x.checked).length;
        // one line per direction: total incoming, total outgoing — tap to see the entries.
        // A direction with something pending opens itself so the checkbox is reachable.
        const key = "p" + v.id;
        let rowsHtml = [["in", "Incoming"], ["out", "Outgoing"]].map(([kind, label]) => {
          const list = items.filter(x => x.kind === kind);
          if (!list.length) return "";
          const k2 = key + kind;
          const total = list.reduce((t, x) => t + x.usd, 0);
          const pend = list.filter(x => !x.checked).length;
          const open = showDone[k2] !== undefined ? showDone[k2] : pend > 0;
          return `<button class="prow num" data-donetoggle="${k2}" data-cur="${open?1:0}" aria-expanded="${open?"true":"false"}">
            <span class="plabel">${label} · ${list.length}${pend?` · ${pend} pending`:""}</span>
            <span class="pamt" style="color:${kind==="in"?"var(--in)":"var(--out)"}">${kind==="in"?"+":"−"}${fmtPbare(total)}</span>
            <svg class="pchev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.2 2.5L8 6l-3.8 3.5"/></svg>
          </button>${open ? groupRows(list, k2) : ""}`;
        }).join("");
        if (!rowsHtml) rowsHtml = '<div class="empty">Nothing today.</div>';
        return `<div class="pcard">
          <div class="pcard-h">
            <button class="namebtn pname" data-vopen="${v.id}">${esc(v.name)}</button>
            <span class="pnet num" style="color:${net<0?"var(--out)":"var(--in)"}">${net>=0?"+":""}${fmtPbare(net)}${pending?`<span class="tinylink" style="text-decoration:none">${pending} pending</span>`:""}</span>
          </div>
          <div data-rows="p${v.id}">${rowsHtml}</div>
        </div>`;
      }).join("");
      procBlock = `<div class="psec">
        <div class="lh"><div class="sw" style="background:var(--muted)"></div><div class="lt">Processors</div></div>
        <div class="hint">Each processor's payouts, fees, and debits together — check them when they hit</div>
        <div class="pgrid">${cards}</div>
      </div>`;
    }
    const declinedT = s.items.filter(x => x.date === date && x.declined);
    const declBlock = declinedT.length ? `<div class="declbox"><button class="donebar num" data-donetoggle="decl" aria-expanded="${showDone.decl?"true":"false"}">${declinedT.length} declined ${declinedT.length===1?"attempt":"attempts"} · ${fmtP(-declinedT.reduce((t,x)=>t+x.usd,0))} never left<span class="tinylink">${showDone.decl?"hide":"show"}</span></button>${showDone.decl?declinedT.map(rowHTML).join(""):""}</div>` : "";
    body = `${procBlock}<div class="cols">${listHTML("in", inO)}${listHTML("out", outO)}</div>${declBlock}`;
  } else if (view==="month") {
    body = monthHTML();
  } else {
    body = `<div style="margin-top:36px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input id="search" type="search" value="${esc(searchQ)}" placeholder="Search name, vendor, note, amount" aria-label="Search entries" style="max-width:340px">
        <div class="tabs" style="margin-left:0"><button class="tab ${allMode==="days"?"on":""}" data-allmode="days">By day</button><button class="tab ${allMode==="table"?"on":""}" data-allmode="table">Ledger</button></div>
      </div>
      <div id="allList" style="margin-top:18px">${allListHTML()}</div>
    </div>`;
  }

  let slideCls = "";
  if (lastRenderedDate && date !== lastRenderedDate) slideCls = date > lastRenderedDate ? "slide-l" : "slide-r";
  lastRenderedDate = date;
  document.getElementById("app").innerHTML = `
    ${datalistHTML()}
    <div class="datebar">
      <button class="nav" id="prev" aria-label="${view==="month"?"Previous month":"Previous day"}">‹</button>
      <input type="date" id="datePick" value="${date}" aria-label="Pick a date">
      <button class="nav" id="next" aria-label="${view==="month"?"Next month":"Next day"}">›</button>
      ${isToday?"":'<button class="link" id="today">today</button>'}
      <div class="tabs"><button class="tab ${view==="day"?"on":""}" data-view="day">This day</button><button class="tab ${view==="month"?"on":""}" data-view="month">Month</button><button class="tab ${view==="all"?"on":""}" data-view="all">All days</button></div>
    </div>
    <div id="page" class="${slideCls}">
    ${sandboxBarHTML()}
    ${isFresh() ? `<div class="welcome">
      <div class="lt" style="font-size:17px">Start with what you have</div>
      <div class="sub" style="margin:4px 0 12px">Type today's balance and the strip takes it from here. Or restore a backup, or connect Slash in Settings — either fills this in for you.</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="sub num" style="margin:0">US$</span><input id="welcomeAmt" type="number" step="0.01" placeholder="0.00" style="width:160px" aria-label="Today's balance in US dollars"><button class="btn" id="welcomeGo">Save</button></div>
    </div>` : ""}
    <div class="dayhead">${(()=>{ const d = dayDiff(todayISO(), date);
      const tag = d===0?"Today":d===-1?"Yesterday":d===1?"Tomorrow":d<0?`${-d} days ago`:`In ${d} days`;
      return `<span class="daytag${d===0?" now":""}">${tag}</span>`; })()}${pretty(date)}</div>
    <div class="flow num">
      <div class="cell"><div class="lbl">${isStart?"Starting with":"Start of day"}</div><div>${startCell}</div></div>
      <div class="cell"><div class="lbl" style="color:var(--in)">Came in</div><div><div class="big" style="color:var(--in)" id="numIn">+${fmtPbare(m.inC)}</div>${m.inA>m.inC?`<div class="sub">of ${fmtPbare(m.inA)} expected</div>`:""}</div></div>
      <div class="cell"><div class="lbl" style="color:var(--out)">Went out</div><div><div class="big" style="color:var(--out)" id="numOut">−${fmtPbare(m.outC)}</div>${m.outA>m.outC?`<div class="sub">of ${fmtPbare(m.outA)} owed</div>`:""}</div></div>
      <div class="cell" style="background:${endFill}"><div class="lbl">Left</div><div><div class="huge" style="color:${endColor}" id="numLeft">${fmtP(m.end)}</div><button class="bare sub" id="flipCur" title="Show ${cadFirst()?"US dollars":"Canadian dollars"} first" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">${fmtSec(m.end)}</button></div></div>
    </div>
    ${statusChipsHTML(m)}
    ${pendTrayHTML()}
    ${body}
    ${view==="day"?dayBriefHTML(m):""}
    ${sectionNavHTML()}
    ${view==="day"?'<button class="fab" id="fab" aria-label="New entry"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg></button>':""}
    </div>
    <div class="foot">
      1 USD = ${s.rate.toFixed(4)} CAD
      <span style="margin-left:6px">${s.settings.rateMode==="manual"?"· set by hand":`· live${s.settings.rateUpdatedAt?`, updated ${prettyShort(s.settings.rateUpdatedAt)}`:""}`}</span>
      <button class="link" id="rateToggle">change</button>
      ${showRate?`<input id="rateInput" type="number" step="0.0001" value="${s.rate}" style="width:110px;margin-left:10px;display:inline-block;padding:5px 8px" aria-label="USD to CAD rate">
        ${s.settings.rateMode==="manual"?'<button class="link" id="liveRate">use the live rate</button>':""}`:""}
      <span style="margin-left:18px">Started ${pretty(s.startDate)} with ${fmt(s.startBudget)}</span>
    </div>
    ${undoChipHTML()}`;
  bindMain();
  paintNum("numLeft", m.end, v=>fmtP(v));
  paintNum("numIn", m.inC, v=>"+"+fmtPbare(v));
  paintNum("numOut", m.outC, v=>"−"+fmtPbare(Math.abs(v)));
  lastAnimDate = date;
  const flip = document.getElementById("flipCur");
  if (flip) flip.onclick = ()=>{ s.settings.currencyDisplay = cadFirst() ? "usd" : "cad"; save(); render(); };
  const fab = document.getElementById("fab");
  if (fab) fab.onclick = ()=>{ const el = document.querySelector('[data-f="name"][data-k="out"]'); if (el) { el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" }); el.focus({ preventScroll: true }); } };
  lastAddedId = null;
  const wg = document.getElementById("welcomeGo");
  if (wg) { const go = ()=>{ const v = parseFloat(document.getElementById("welcomeAmt").value); if (isNaN(v)) return; s.startBudget = v; s.startDate = date; s.settings.fresh = false; save(); render(); toast("Set — check things off as they happen"); };
    wg.onclick = go; document.getElementById("welcomeAmt").onkeydown = e=>{ if (e.key==="Enter") go(); }; }
  const sbOn = document.getElementById("sbOn");
  if (sbOn) sbOn.onclick = ()=>{ sandbox = structuredClone(s); render(); toast("Sandbox on — nothing is saved until you keep it"); };
  const sbKeep = document.getElementById("sbKeep");
  if (sbKeep) sbKeep.onclick = ()=>{ sandbox = null; save(); render(); toast("Kept"); };
  const sbDiscard = document.getElementById("sbDiscard");
  if (sbDiscard) sbDiscard.onclick = ()=>{ s = sandbox; sandbox = null; render(); toast("Discarded — back to your real numbers"); };
  const pt = document.getElementById("pendTray");
  if (pt) pt.onclick = ()=>{ showPendTray = !showPendTray; render(); };
  document.querySelectorAll("[data-psettle]").forEach(b=>b.onclick=()=>{
    settlePending(s, b.dataset.psettle, todayISO());
    save(); render();
  });
}

function renderVendor(){
  const v = s.vendors.find(x=>x.id===openVendorId);
  if (!v) { view = "day"; return renderMain(); }
  const st = vendorStats(s, v, todayISO());
  const list = vendorItems(s, v);
  const dir = v.defaultKind === "in" ? "Received" : "Paid";
  document.getElementById("app").innerHTML = `
    ${datalistHTML()}
    <div class="datebar"><button class="backbtn" id="back" aria-label="Back">${CHEV}</button><div class="lt" style="font-size:19px">${esc(v.name)}</div></div>
    <div class="summary num" style="margin-top:8px">
      <span>${dir} this year: <b>${fmtP(st.doneYear)}</b></span>
      <span>All time: <b>${fmtP(st.doneAll)}</b></span>
      <span>${st.count} ${st.count===1?"entry":"entries"}, average <b>${fmtP(st.avg)}</b></span>
      <span>Last ${v.defaultKind==="in"?"landed":"paid"}: <b>${st.last?prettyShort(st.last):"—"}</b></span>
      <span>Next expected: <b>${st.next?prettyShort(st.next):"—"}</b></span>
    </div>
    <div class="vfields">
      <input id="vNote" value="${esc(v.note)}" placeholder="Note" aria-label="Vendor note">
      <input id="vUrl" value="${esc(v.url)}" placeholder="Link (billing page, dashboard)" aria-label="Vendor link">
    </div>
    <div class="cadrow num">
      <span>Repeats</span>
      <select id="vCadence" aria-label="Repeats">
        <option value="" ${!v.cadence?"selected":""}>never</option>
        <option value="weekly" ${v.cadence==="weekly"?"selected":""}>weekly</option>
        <option value="monthly" ${v.cadence==="monthly"?"selected":""}>monthly</option>
        <option value="yearly" ${v.cadence==="yearly"?"selected":""}>yearly</option>
      </select>
      ${v.cadence==="monthly"?`<span>on day</span><input id="vDay" type="number" min="1" max="31" value="${v.dayOfMonth??""}" aria-label="Day of month" style="width:64px">`:""}
      ${v.cadence?`<span class="sub" style="margin:0">Bills appear unchecked on their day. Delete one to skip it.</span>`:""}
    </div>
    <div class="cadrow">
      <label class="sub" style="margin:0;display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="vProc" ${v.isProcessor?"checked":""} style="width:15px;height:15px">
        Payment processor — its entries get their own section on the day
      </label>
    </div>
    ${s.vendors.length > 1 ? `<div class="cadrow">
      <span>Merge into</span>
      <select id="vMerge" aria-label="Merge this vendor into another">
        <option value="">choose a vendor…</option>
        ${s.vendors.filter(z => z.id !== v.id).sort((a, b) => a.name.localeCompare(b.name)).map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join("")}
      </select>
      <button class="btn btn2" id="vMergeGo" style="padding:6px 10px;font-size:12px">Merge</button>
      <span class="sub" style="margin:0">Moves every entry over and removes this name. Undo has you.</span>
    </div>` : ""}
    ${s.accounts.length?`<div class="cadrow num">
      <span>Account</span>
      <select id="vAccount" aria-label="Default account">
        <option value="">none</option>
        ${s.accounts.map(a=>`<option value="${a.id}" ${v.defaultAccountId===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}
      </select>
    </div>`:""}
    ${v.url?`<div class="sub" style="margin-bottom:10px"><a href="${esc(v.url)}" target="_blank" rel="noopener" class="quietlink">open link</a></div>`:""}
    <div style="margin-top:26px">${list.length?groupedItemsHTML(list):'<div class="empty">Nothing logged yet.</div>'}</div>
    ${undoChipHTML()}`;
  bindShared();
  document.getElementById("back").onclick = ()=>{ view="day"; render(); };
  document.getElementById("vNote").oninput = e=>{ v.note = e.target.value; save(); };
  document.getElementById("vUrl").onchange = e=>{ v.url = e.target.value.trim(); save(); render(); };
  document.getElementById("vCadence").onchange = e=>{
    const c = e.target.value || null;
    if (!c) { stopRecurring(s, v, shift(todayISO(), 1)); }
    else {
      v.cadence = c;
      if (c === "monthly" && v.dayOfMonth == null) {
        const mine = vendorItems(s, v);
        v.dayOfMonth = Number((mine[0]?.date || todayISO()).slice(8, 10));
      }
    }
    save(); render();
  };
  document.getElementById("vProc").onchange = e=>{ v.isProcessor = e.target.checked; save(); render(); };
  const mg = document.getElementById("vMergeGo");
  if (mg) mg.onclick = ()=>{
    const into = document.getElementById("vMerge").value; if (!into) return;
    armUndo(structuredClone(s));
    if (mergeVendor(s, v.id, into)) { openVendorId = into; save(); render(); toast("Merged"); }
  };
  const vAcc = document.getElementById("vAccount");
  if (vAcc) vAcc.onchange = e=>{
    v.defaultAccountId = e.target.value || null;
    // future expectations follow the vendor's account
    s.items.forEach(x=>{ if (x.recurringSourceId === v.id && !x.checked && x.date >= todayISO()) x.accountId = v.defaultAccountId; });
    save(); render();
  };
  const vDay = document.getElementById("vDay");
  if (vDay) vDay.onchange = e=>{
    const n = Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1));
    v.dayOfMonth = n;
    // regenerate on the new day: drop untouched future generated entries first
    const c = v.cadence; stopRecurring(s, v, shift(todayISO(), 1)); v.cadence = c;
    save(); render();
  };
}

function renderVendors(){
  const t = todayISO();
  const rows = s.vendors
    .map(v => ({ v, st: vendorStats(s, v, t) }))
    .sort((a,b) => (b.st.last||"").localeCompare(a.st.last||""));
  document.getElementById("app").innerHTML = `
    <div class="datebar"><button class="backbtn" id="back" aria-label="Back">${CHEV}</button><div class="lt" style="font-size:19px">Vendors</div></div>
    ${rows.length?rows.map(({v,st})=>`
      <div class="row" style="cursor:default">
        <div class="name"><button class="namebtn" data-vopen="${v.id}">${esc(v.name)}</button>${v.isProcessor?'<span class="tinytag">processor</span>':""}</div>
        <div class="sub num" style="margin:0">${st.count} ${st.count===1?"entry":"entries"} · ${fmtP(st.doneAll)} · ${st.last?prettyShort(st.last):"—"}</div>
        <button class="x" data-ven-remove="${v.id}" title="Remove" aria-label="Remove ${esc(v.name)}">×</button>
      </div>`).join(""):'<div class="empty">No vendors yet. They appear as you log entries, or add one below.</div>'}
    <div class="addrow" style="margin-top:26px">
      <div class="addgrid" style="grid-template-columns:1fr auto">
        <input id="venName" placeholder="Adyen" aria-label="Vendor name">
        <button class="btn" id="venAdd">Add</button>
      </div>
    </div>
    ${undoChipHTML()}`;
  bindUndo();
  document.getElementById("back").onclick = ()=>{ view="day"; render(); };
  document.querySelectorAll("[data-vopen]").forEach(b=>b.onclick=()=>{ openVendorId=b.dataset.vopen; view="vendor"; render(); });
  document.querySelectorAll("[data-ven-remove]").forEach(b=>b.onclick=()=>{
    armUndo(structuredClone(s));
    deleteVendor(s, b.dataset.venRemove, todayISO());
    save(); render();
  });
  const venAdd = ()=>{
    const name = document.getElementById("venName").value.trim();
    if (!name) return;
    if (!findVendorByName(s, name)) s.vendors.push({ id: uid("v"), name, note: "", defaultKind: "out", defaultAccountId: null,
      defaultAmountUsd: 0, cadFixed: null, cadence: null, dayOfMonth: null, url: "", skipDates: [], isProcessor: false });
    save(); render();
  };
  document.getElementById("venAdd").onclick = venAdd;
  document.getElementById("venName").onkeydown = e=>{ if(e.key==="Enter") venAdd(); };
}

function cadNote(kind){
  const el = document.querySelector(`[data-cadnote="${kind}"]`);
  if (!el) return;
  const d = drafts[kind]; const a = parseFloat(d.amount)||0;
  if (d.cur==="CAD" && a>0) { el.hidden = false; el.textContent = `${fmt(a,"C$")} = ${fmt(a/s.rate)} today. Stays ${fmt(a,"C$")} even if the rate moves.`; return; }
  const q = !a ? parseQuickAdd(d.name) : null;
  if (q) { el.hidden = false; el.textContent = `Adds ${q.name} · ${q.cur==="CAD"?fmt(q.amount,"C$"):fmt(q.amount)}${q.kind?(q.kind==="in"?" · money in":" · money out"):""}${q.pending?" · authorized, not settled":""}`; return; }
  el.hidden = true; el.textContent = "";
}

// handlers shared by any view that renders entry rows
function bindShared(){
  const app = document.getElementById("app");
  bindUndo();
  app.querySelectorAll("[data-vopen]").forEach(b=>b.onclick=()=>{ openVendorId=b.dataset.vopen; view="vendor"; render(); });
  app.querySelectorAll("[data-toggle]").forEach(c=>{
    c.indeterminate = c.hasAttribute("data-ind");
    c.onchange=()=>{
      const row = c.closest(".row");
      const go = ()=>{ toggleItem(s, c.dataset.toggle, todayISO()); save(); render(); };
      if (row && !reduced()) { row.classList.add("checking"); setTimeout(go, 200); } else go();
    };
  });
  app.querySelectorAll("[data-remove]").forEach(b=>b.onclick=e=>{
    e.preventDefault();
    const x = s.items.find(i=>i.id===b.dataset.remove);
    const v = x && x.recurringSourceId ? s.vendors.find(z=>z.id===x.recurringSourceId) : null;
    if (v && v.cadence) { deleteAsk = x.id; render(); return; }
    armUndo(structuredClone(s));
    s.items=s.items.filter(i=>i.id!==b.dataset.remove); save(); render();
  });
  app.querySelectorAll("[data-del-one]").forEach(b=>b.onclick=()=>{
    const x = s.items.find(i=>i.id===b.dataset.delOne);
    const v = s.vendors.find(z=>z.id===x.recurringSourceId);
    armUndo(structuredClone(s));
    if (v && !v.skipDates.includes(x.date)) v.skipDates.push(x.date);
    s.items = s.items.filter(i=>i.id!==x.id);
    deleteAsk = null; save(); render();
  });
  app.querySelectorAll("[data-del-stop]").forEach(b=>b.onclick=()=>{
    const x = s.items.find(i=>i.id===b.dataset.delStop);
    const v = s.vendors.find(z=>z.id===x.recurringSourceId);
    armUndo(structuredClone(s));
    if (v) stopRecurring(s, v, x.date);
    s.items = s.items.filter(i=>i.id!==x.id);
    deleteAsk = null; save(); render();
  });
  app.querySelectorAll("[data-del-cancel]").forEach(b=>b.onclick=()=>{ deleteAsk = null; render(); });
  app.querySelectorAll("[data-expand]").forEach(el=>el.onclick=e=>{
    e.preventDefault();
    expandedId = expandedId === el.dataset.expand ? null : el.dataset.expand;
    render();
  });
  app.querySelectorAll("[data-acc]").forEach(sel=>{
    sel.onchange = ()=>{
      const x = s.items.find(i=>i.id===sel.dataset.acc);
      x.accountId = sel.value || null;
      save(); render();
    };
  });
  app.querySelectorAll("[data-lag]").forEach(b=>b.onclick=e=>{
    e.preventDefault();
    const x = s.items.find(i=>i.id===b.dataset.lag);
    const target = lagSuggestion(s, x);
    if (target) { redateItem(s, x.id, target, todayISO()); save(); render(); }
  });
  app.querySelectorAll("[data-again]").forEach(b=>b.onclick=e=>{
    e.preventDefault();
    const x = s.items.find(i=>i.id===b.dataset.again);
    const copy = { ...x, id: uid("x"), date: todayISO(), checked: false, settle: null, createdAt: todayISO(), importId: null, recurringSourceId: null, note: "", receiptUrl: "" };
    s.items.push(copy); lastAddedId = copy.id;
    expandedId = null; date = todayISO(); view = "day"; save(); render();
  });
  app.querySelectorAll("[data-yesterday]").forEach(b=>b.onclick=e=>{
    e.preventDefault();
    const x = s.items.find(i=>i.id===b.dataset.yesterday);
    redateItem(s, x.id, shift(x.date, -1), todayISO());
    expandedId = null; save(); render();
  });
  app.querySelectorAll("[data-redate]").forEach(el=>{
    el.onchange = ()=>{
      if (!el.value) return;
      redateItem(s, el.dataset.redate, el.value, todayISO());
      expandedId = null; save(); render();
    };
  });
  app.querySelectorAll("[data-setdate]").forEach(el=>{
    el.onchange = ()=>{
      const x = s.items.find(i=>i.id===el.dataset.setdate);
      if (el.value) { x.settle = el.value; save(); render(); }
    };
  });
  app.querySelectorAll("[data-settle]").forEach(sel=>{
    sel.onchange = ()=>{
      const x = s.items.find(i=>i.id===sel.dataset.settle);
      x.settle = sel.value === "settled" ? todayISO() : (sel.value || null);
      if (sel.value === "settled" && !x.checked) x.checked = true; // settled money is real money
      if (sel.value === "pending") x.checked = x.kind === "out";   // a pending debit is already gone; pending money in is not yours yet
      save(); render();
    };
  });
  app.querySelectorAll("[data-note]").forEach(el=>{
    el.oninput = ()=>{ const x=s.items.find(i=>i.id===el.dataset.note); x.note = el.value; save(); };
    el.onkeydown = e=>{ if(e.key==="Escape"||e.key==="Enter"){ expandedId=null; render(); } };
  });
  app.querySelectorAll("[data-receipt]").forEach(el=>{
    el.onchange = ()=>{ const x=s.items.find(i=>i.id===el.dataset.receipt); x.receiptUrl = el.value.trim(); save(); };
    el.onkeydown = e=>{ if(e.key==="Escape"||e.key==="Enter"){ const x=s.items.find(i=>i.id===el.dataset.receipt); x.receiptUrl = el.value.trim(); expandedId=null; save(); render(); } };
  });
  app.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{ date=b.dataset.open; view="day"; editCarry=false; showDone={in:false,out:false,proc:false}; save(); render(); });
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
  const goto = gotoDate;
  const step = view==="month" ? n=>addMonths(date, n) : n=>shift(date, n);
  $("prev").onclick = ()=>goto(step(-1));
  $("next").onclick = ()=>goto(step(1));
  $("datePick").onchange = e=>{ if(e.target.value) goto(e.target.value); };
  if ($("today")) $("today").onclick = ()=>goto(todayISO());
  app.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{ view=b.dataset.view; render(); });
  app.querySelectorAll("[data-f]").forEach(el=>{
    const k=el.dataset.k, f=el.dataset.f;
    el.oninput = ()=>{
      drafts[k][f]=el.value;
      if(f==="cur"||f==="amount") cadNote(k);
      if(f==="name"){
        cadNote(k);
        // suggest only after typing, and only what matches
        const q = el.value.trim().toLowerCase();
        const dl = document.getElementById("vendorNames");
        if (q.length >= 1) {
          if (dl) dl.innerHTML = s.vendors.filter(z=>z.name.toLowerCase().includes(q)).slice(0,8).map(z=>`<option value="${esc(z.name)}">`).join("");
          el.setAttribute("list", "vendorNames");
        } else {
          el.removeAttribute("list");
          if (dl) dl.innerHTML = "";
        }
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
  app.querySelectorAll("[data-quick]").forEach(b=>b.onclick=()=>{
    const k = b.dataset.quick, n = b.dataset.name;
    drafts[k].name = n;
    const v = findVendorByName(s, n);
    if (v) { const d0 = vendorDefaults(v); if (d0.amount > 0) { drafts[k].amount = String(d0.amount); drafts[k].cur = d0.cur; } }
    render();
    const amt = app.querySelector(`[data-f="amount"][data-k="${k}"]`); if (amt) { amt.focus(); amt.select && amt.select(); }
  });
  if ($("editStart")) $("editStart").onclick = ()=>{ editStart=true; render(); $("startDraft").focus(); };
  if ($("editCarry")) $("editCarry").onclick = ()=>{ editCarry=true; render(); $("carryDraft").focus(); };
  if ($("saveCarry")) { const doSave=()=>{
      const v=parseFloat($("carryDraft").value); editCarry=false;
      if(!isNaN(v)){
        const usdV = cadFirst() ? v/s.rate : v;
        s.adjust = s.adjust || {};
        const cur = calc(s, date).carry;
        const next = ((s.adjust[date]||0) + (usdV - cur));
        if (Math.abs(next) < 0.005) delete s.adjust[date]; else s.adjust[date] = next;
      }
      save(); render(); };
    $("saveCarry").onclick=doSave;
    $("carryDraft").onkeydown=e=>{ if(e.key==="Enter") doSave(); if(e.key==="Escape"){ editCarry=false; render(); } };
  }
  if ($("clearAdj")) $("clearAdj").onclick = ()=>{ delete s.adjust[date]; save(); render(); };
  app.querySelectorAll(".grouprow").forEach(g=>g.onkeydown=e=>{ if (e.key==="Enter"||e.key===" ") { e.preventDefault(); g.click(); } });
  app.querySelectorAll("[data-donetoggle]").forEach(b=>b.onclick=()=>{
    const k=b.dataset.donetoggle;
    showDone[k] = b.dataset.cur != null ? b.dataset.cur !== "1" : !showDone[k];
    render();
  });
  // drag to reorder from anywhere on the row, within the same list on the same day
  app.querySelectorAll("[data-drag]").forEach(h=>{ h.onclick = e=>e.preventDefault(); });
  app.querySelectorAll("[data-rows] .row").forEach(row=>{
    row.setAttribute("draggable", "true");
    row.ondragstart = e=>{
      const cont = row.closest("[data-rows]");
      if (!cont || !row.dataset.id) { e.preventDefault(); return; }
      dragId = row.dataset.id; dragCont = cont.dataset.rows;
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragId); } catch {}
      requestAnimationFrame(()=>row.classList.add("dragging"));
    };
    row.ondragend = ()=>{ dragId = null; dragCont = null; app.querySelectorAll(".dragging,.drop-above,.drop-below").forEach(el=>el.classList.remove("dragging","drop-above","drop-below")); };
    row.ondragover = e=>{
      if (!dragId || row.closest("[data-rows]")?.dataset.rows !== dragCont) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      const r = row.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      row.classList.toggle("drop-below", after);
      row.classList.toggle("drop-above", !after);
    };
    row.ondragleave = ()=>row.classList.remove("drop-above","drop-below");
    row.ondrop = e=>{
      e.preventDefault();
      const targetId = row.dataset.id;
      const after = row.classList.contains("drop-below");
      row.classList.remove("drop-above","drop-below");
      if (!dragId || targetId === dragId) { dragId = null; return; }
      moveItem(s, dragId, targetId, after);
      dragId = null; dragCont = null;
      save(); render();
    };
  });
  if ($("saveStart")) { const doSave=()=>{ const v=parseFloat($("startDraft").value); editStart=false; if(!isNaN(v)){ s.startBudget = cadFirst() ? v/s.rate : v; s.startDate=date; } save(); render(); };
    $("saveStart").onclick=doSave; $("startDraft").onkeydown=e=>{ if(e.key==="Enter") doSave(); if(e.key==="Escape"){ editStart=false; render(); } }; }
  $("rateToggle").onclick = ()=>{ showRate=!showRate; render(); };
  if ($("rateInput")) $("rateInput").oninput = e=>{ s.rate=parseFloat(e.target.value)||1; s.settings.rateMode="manual"; save(); const keep=e.target; const v=keep.value; render(); const again=$("rateInput"); if(again){ again.value=v; again.focus(); } };
  if ($("liveRate")) $("liveRate").onclick = ()=>{ s.settings.rateMode="live"; showRate=false; save(); render(); refreshRate(); };
  if ($("search")) $("search").oninput = e=>{
    searchQ = e.target.value;
    $("allList").innerHTML = allListHTML();
    bindShared();
  };
  app.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>{ view=b.dataset.nav; render(); });
  app.querySelectorAll("[data-allmode]").forEach(b=>b.onclick=()=>{ allMode=b.dataset.allmode; render(); });
  app.querySelectorAll("[data-lfilter]").forEach(b=>b.onclick=()=>{ ledgerFilter=b.dataset.lfilter; render(); });
  const lg = document.getElementById("lgroup"); if (lg) lg.onclick = ()=>{ ledgerGroup = !ledgerGroup; render(); };
}

// "uber 42", "chapa 2500 cad", "kurv +2000 pending" -> name, amount, currency, direction, state
function parseQuickAdd(text){
  const m = String(text || "").trim().match(/^(.*?)\s+([+\-−])?\s*(?:us\$|c\$|\$)?(\d[\d,]*(?:\.\d+)?)\s*(usd|cad|us\$|c\$)?\s*(pending|authorized|auth|held)?\s*$/i);
  if (!m || !m[1].trim()) return null;
  const amount = parseFloat(m[3].replace(/,/g, ""));
  if (!(amount > 0)) return null;
  const curRaw = (m[4] || "").toLowerCase();
  return { name: m[1].trim(), amount, cur: curRaw.startsWith("c") ? "CAD" : curRaw ? "USD" : null,
           kind: m[2] === "+" ? "in" : (m[2] ? "out" : null), pending: !!m[5] };
}

function add(kind){
  const d=drafts[kind]; let a=parseFloat(d.amount)||0; let name=d.name.trim(); let cur=d.cur; let k=kind; let pending=false;
  if (!a) { const q = parseQuickAdd(name); if (q) { name=q.name; a=q.amount; if (q.cur) cur=q.cur; if (q.kind) k=q.kind; pending=q.pending; } }
  if(!name||!a) return;
  const item = { id:uid("x"), kind:k, date, name, usd: cur==="CAD"?a/s.rate:a, cadFixed: cur==="CAD"?a:null, checked: pending ? k==="out" : false, accountId:null, vendorId:null, note:"", receiptUrl:"", recurringSourceId:null, settle: pending ? "pending" : null, createdAt: date };
  const v = upsertVendorFromEntry(s, item);
  item.accountId = v.defaultAccountId;
  s.items.push(item);
  lastAddedId = item.id;
  drafts[kind]={name:"",amount:"",cur:d.cur};
  save(); render();
  const el=document.querySelector(`[data-f="name"][data-k="${k}"]`); if(el) el.focus();
}

function exportCsv(){
  const rows=[["Date","Type","Name","Amount USD","Amount CAD","CAD locked","Done"],
    ...[...s.items].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>[x.date, x.kind==="in"?"Money in":"Money out", x.name, x.usd.toFixed(6), (x.cadFixed!=null?x.cadFixed:x.usd*s.rate).toFixed(2), x.cadFixed!=null?"yes":"no", x.checked?"yes":"no"])];
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  downloadText(`money-${todayISO()}.csv`, "text/csv", csv);
}

if (typeof window === "undefined") {
  module.exports = { SEED, KEY, LEGACY_KEY, migrate, ensure, calc, fmt, upsertVendorFromEntry, findVendorByName, vendorDefaults, vendorStats, vendorItems, generateRecurring, stopRecurring, addMonths, accountBalance, monthData, runwayInfo, matchesSearch, diffStates, backupDue, moveItem, sparkData, toggleItem, dailyNets, goalInfo, insightsFor, redateItem, deleteVendor, deleteAccount, applyLiveRate, lagSuggestion, nextBusinessDay, settlePending, daySummary, dayBriefText, parseCsv, utcToLocalISO, cleanBankName, mapSlashCsv, applySlashImport, deleteMonth, planFromRecords, recsFromSlashApi, isoToLocalISO, ledgerRows, pickAvailable, rebuildFromRecords, ledgerPass, groupItems, ledgerCompress, parseQuickAdd, forecastLow, mergeVendor, recentVendors, freshState };
} else {
  s = load();
  date = s.lastDate || todayISO();
  save();
  applyTheme();
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
  refreshRate();
  setInterval(refreshRate, 6 * 60 * 60 * 1000);
  syncSlash(false);
  setInterval(() => syncSlash(false), 3 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncSlash(false); });

  // swipe left/right to move through days (or months on the month tab)
  let sx = 0, sy = 0, st0 = 0;
  document.addEventListener("touchstart", e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st0 = Date.now(); }, { passive: true });
  document.addEventListener("touchend", e => {
    const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
    if (typing || Date.now() - st0 > 600 || Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
    if (!(view === "day" || view === "month" || view === "all")) return;
    const n = dx < 0 ? 1 : -1;
    gotoDate(view === "month" ? addMonths(date, n) : shift(date, n));
  }, { passive: true });

  document.addEventListener("keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
    if (e.key === "Escape") {
      if (deleteAsk || expandedId || editStart || editCarry || editAccId || pendingImport) {
        deleteAsk = null; expandedId = null; editStart = false; editCarry = false; editAccId = null; pendingImport = null;
        if (typing) document.activeElement.blur();
        render();
      } else if (typing) document.activeElement.blur();
      return;
    }
    if (typing) return;
    const mainView = view === "day" || view === "month" || view === "all";
    if (e.key === "n") {
      e.preventDefault();
      if (view !== "day") { view = "day"; render(); }
      document.querySelector('[data-f="name"][data-k="out"]')?.focus();
    } else if (e.key === "/") {
      e.preventDefault();
      if (view !== "all") { view = "all"; render(); }
      document.getElementById("search")?.focus();
    } else if (e.key === "t" && mainView) {
      date = todayISO(); save(); render();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && mainView) {
      const n = e.key === "ArrowLeft" ? -1 : 1;
      date = view === "month" ? addMonths(date, n) : shift(date, n);
      save(); render();
    }
  });
}
