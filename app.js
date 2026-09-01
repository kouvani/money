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
  st.adjust = st.adjust || {};
  st.goals = st.goals || [];
  st.vendors.forEach(v => {
    v.note = v.note ?? ""; v.url = v.url ?? ""; v.cadence = v.cadence ?? null;
    v.dayOfMonth = v.dayOfMonth ?? null; v.defaultAccountId = v.defaultAccountId ?? null;
    v.skipDates = v.skipDates ?? []; v.isProcessor = v.isProcessor ?? false;
  });
  st.items.forEach(x => {
    x.cadFixed = x.cadFixed ?? null; x.accountId = x.accountId ?? null; x.vendorId = x.vendorId ?? null;
    x.note = x.note ?? ""; x.receiptUrl = x.receiptUrl ?? ""; x.recurringSourceId = x.recurringSourceId ?? null;
    x.settle = x.settle ?? null; // null = untracked, "pending" = authorized not settled, ISO date = settled
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
  return st;
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
  return ensure(structuredClone(SEED));
}

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

function save(){ s.lastDate = date; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){ console.error(e); } }

function calc(st, day){
  const sgn = x => x.kind==="in" ? x.usd : -x.usd;
  const adj = st.adjust || {};
  // a start-of-day correction on day D counts from D onward, without being money in or out
  const adjUpTo = Object.keys(adj).filter(d => d <= day).reduce((t, d) => t + adj[d], 0);
  const adjAll = Object.values(adj).reduce((t, v) => t + v, 0);
  // money starts existing on the start date; every day before it is zero
  const carry = (day >= st.startDate ? st.startBudget : 0) + adjUpTo + st.items.filter(x=>x.checked && x.date<day).reduce((t,x)=>t+sgn(x),0);
  const today = st.items.filter(x=>x.date===day);
  const inT = today.filter(x=>x.kind==="in"), outT = today.filter(x=>x.kind==="out");
  const sum = (a,only) => a.filter(x=>!only||x.checked).reduce((t,x)=>t+x.usd,0);
  const inC=sum(inT,true), inA=sum(inT), outC=sum(outT,true), outA=sum(outT);
  const end = carry + inC - outC;
  const allTime = st.startBudget + adjAll + st.items.filter(x=>x.checked).reduce((t,x)=>t+sgn(x),0);
  const ifAll = st.startBudget + adjAll + st.items.reduce((t,x)=>t+sgn(x),0);
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
  const win = st.items.filter(x => x.checked && x.date > from && x.date <= today);
  const net = win.reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
  const cash = st.startBudget + Object.values(st.adjust || {}).reduce((t, v) => t + v, 0)
    + st.items.filter(x => x.checked).reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
  if (net >= 0) return { burning: false, days: null };
  const perDay = -net / 30;
  return { burning: true, days: Math.max(0, Math.floor(cash / perDay)) };
}

// One pass over every entry: per-date checked and total nets.
function dailyNets(st){
  const m = new Map();
  for (const x of st.items) {
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
  let run = 0;
  for (const [d, e] of nets) if (d < windowStart) run += e.chk;
  for (const d in adj) if (d < windowStart) run += adj[d];
  const past = [];
  for (let i = 29; i >= 0; i--) {
    const d = shift(today, -i);
    run += (adj[d] || 0) + (nets.get(d)?.chk || 0);
    past.push((d >= st.startDate ? st.startBudget : 0) + run);
  }
  const future = [];
  let runF = past[29];
  let overdue = 0;
  for (const [d, e] of nets) if (d <= today) overdue += e.all - e.chk;
  for (let i = 1; i <= 7; i++) {
    const d = shift(today, i);
    if (i === 1) runF += overdue;
    const e = nets.get(d);
    runF += (e ? e.all - e.chk : 0) + (adj[d] || 0);
    future.push(runF);
  }
  return { past, future };
}

function sparkSVG(sd){
  const all = [...sd.past, ...sd.future];
  const w = 170, h = 34, p = 3;
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const n = all.length;
  const X = i => p + i * (w - 2 * p) / (n - 1);
  const Y = v => h - p - (v - min) * (h - 2 * p) / span;
  const solid = sd.past.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const dashed = [sd.past[sd.past.length - 1], ...sd.future].map((v, i) => `${X(sd.past.length - 1 + i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const color = sd.past[sd.past.length - 1] >= sd.past[0] ? "var(--in)" : "var(--out)";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" role="img" aria-label="Balance over the last 30 days and the week ahead">
    <polyline points="${solid}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${dashed}" stroke="var(--muted)" stroke-width="1.3" stroke-dasharray="3 3" stroke-linejoin="round" stroke-linecap="round" opacity=".75"/>
    <circle cx="${X(sd.past.length-1).toFixed(1)}" cy="${Y(sd.past[sd.past.length-1]).toFixed(1)}" r="2.4" fill="${color}"/>
  </svg>`;
}

// ---- goals ----

function goalInfo(st, g, today){
  const cash = calc(st, today).allTime;
  const base = Math.min(g.startUsd, g.targetUsd);
  const denom = g.targetUsd - base || 1;
  const pct = Math.max(0, Math.min(1, (cash - base) / denom));
  const reached = cash >= g.targetUsd;
  const daysLeft = Math.max(0, dayDiff(today, g.targetDate));
  const needPerDay = reached || daysLeft === 0 ? 0 : (g.targetUsd - cash) / daysLeft;
  const from = shift(today, -30);
  const pace = st.items.filter(x => x.checked && x.date > from && x.date <= today)
    .reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0) / 30;
  return { cash, pct, reached, daysLeft, needPerDay, pace, behind: !reached && daysLeft > 0 && needPerDay > Math.max(pace, 0) };
}

// The one most useful thing the numbers can say right now.
function insightsFor(st, today){
  const out = [];
  const week = st.items.filter(x => !x.checked && x.date > today && x.date <= shift(today, 7));
  const owed = week.filter(x => x.kind === "out").reduce((t, x) => t + x.usd, 0);
  const expIn = week.filter(x => x.kind === "in").reduce((t, x) => t + x.usd, 0);
  if (owed > 0 || expIn > 0) {
    const proj = calc(st, today).allTime + expIn - owed;
    out.push({ tone: proj < 0 ? "warn" : "info", text: `Next 7 days: ${fmt(owed)} owed${expIn > 0.004 ? `, ${fmt(expIn)} expected in` : ""} — projected Left ${fmt(proj)}.` });
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
  if (top) out.push({ tone: "info", text: `Biggest cost this month: ${top.name} ${fmt(top.cur)}${top.prev > 0.004 ? ` (last month ${fmt(top.prev)})` : ""}.` });
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
  const t0 = performance.now(), dur = 420;
  const tick = now => {
    if (document.getElementById(id) !== el) return;
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmtFn(from + (val - from) * e);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = fmtFn(val);
  };
  requestAnimationFrame(tick);
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
  if (x.checked || x.settle === "pending") return "";
  if (x.date < today) return '<span class="mark">overdue</span>';
  const d = dayDiff(today, x.date);
  if (d > (s?.settings?.warnDaysAhead ?? 3)) return "";
  return `<span class="mark">${d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`}</span>`;
}

// ---- month ----

function monthData(st, ym, today){
  const [y, m] = ym.split("-").map(Number);
  const days = [];
  let inC = 0, outC = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const todays = st.items.filter(x => x.date === iso);
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

function monthHTML(){
  const ym = date.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const md = monthData(s, ym, todayISO());
  const title = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const t = todayISO();
  return `<div style="margin-top:36px">
    <div class="lh"><div class="lt">${title}</div></div>
    <div class="summary num" style="margin-top:6px;margin-bottom:14px">
      <span>In: <b style="color:var(--in)">+${fmt(md.inC, "")}</b></span>
      <span>Out: <b style="color:var(--out)">−${fmt(md.outC, "")}</b></span>
      <span>Net: <b style="color:${md.net < 0 ? "var(--out)" : "var(--ink)"}">${fmt(md.net)}</b></span>
    </div>
    <div class="mgrid num">
      ${["S","M","T","W","T","F","S"].map(w => `<div class="mwd">${w}</div>`).join("")}
      ${Array.from({ length: md.offset }, () => `<div class="mday off" aria-hidden="true"></div>`).join("")}
      ${md.days.map(d => `
        <button class="mday${d.date === t ? " today" : ""}${d.warn ? " warn" : ""}" data-open="${d.date}" aria-label="${pretty(d.date)}${d.warn ? ", has unchecked entries" : ""}">
          <span class="d">${d.day}</span>
          <span class="mdots">${d.hasIn ? '<span class="mdot" style="background:var(--in)"></span>' : ""}${d.hasOut ? '<span class="mdot" style="background:var(--out)"></span>' : ""}</span>
          <span class="mend">${fmtWhole(d.end)}</span>
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

// ---- search ----

function matchesSearch(st, x, q){
  q = String(q).trim().toLowerCase();
  if (!q) return true;
  const vendor = x.vendorId ? st.vendors.find(v => v.id === x.vendorId) : null;
  const hay = [
    x.name, x.note, vendor ? vendor.name : "",
    round2(x.usd).toFixed(2), String(round2(x.usd)),
    x.cadFixed != null ? round2(x.cadFixed).toFixed(2) : "",
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
  const cad = x.cadFixed!=null ? x.cadFixed : x.usd*s.rate;
  const detail = expandedId === x.id ? `<div class="detail">
    ${s.accounts.length?`<label class="sub" style="margin:0">Account
      <select data-acc="${x.id}" aria-label="Account for ${esc(x.name)}" style="width:auto;margin-left:8px;padding:5px 8px;font-size:12.5px">
        <option value="">none</option>
        ${s.accounts.map(a=>`<option value="${a.id}" ${x.accountId===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}
      </select>
    </label>`:""}
    <input data-note="${x.id}" value="${esc(x.note)}" placeholder="Note" aria-label="Note for ${esc(x.name)}" style="flex:1;min-width:130px;padding:5px 8px;font-size:12.5px">
    <input data-receipt="${x.id}" value="${esc(x.receiptUrl)}" placeholder="Receipt link" aria-label="Receipt link for ${esc(x.name)}" style="flex:1;min-width:130px;padding:5px 8px;font-size:12.5px">
    <label class="sub" style="margin:0">Settlement
      <select data-settle="${x.id}" aria-label="Settlement for ${esc(x.name)}" style="width:auto;margin-left:8px;padding:5px 8px;font-size:12.5px">
        <option value="" ${!x.settle?"selected":""}>—</option>
        <option value="pending" ${x.settle==="pending"?"selected":""}>authorized, not settled</option>
        <option value="settled" ${x.settle&&x.settle!=="pending"?"selected":""}>settled${x.settle&&x.settle!=="pending"?" "+prettyShort(x.settle):""}</option>
      </select>
    </label>
  </div>` : "";
  const authorized = !x.checked && x.settle === "pending";
  return `<label class="row ${x.checked?"done":""}" data-id="${x.id}">
    <span class="drag" draggable="true" data-drag="${x.id}" title="Drag to reorder"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/></svg></span>
    <input type="checkbox" ${x.checked?"checked":""} ${authorized?'data-ind="1"':""} style="accent-color:${color}" data-toggle="${x.id}" aria-label="${esc(x.name)} ${x.checked?"done":authorized?"authorized, waiting to settle — check when it settles":"expected"}">
    <div class="name"><button class="namebtn" data-vopen-item="${x.id}" title="Open vendor">${esc(x.name)}</button>${x.recurringSourceId?RMARK:""}${x.cadFixed!=null?'<span class="tinytag">CAD</span>':""}${x.note?`<span class="notetxt">${esc(x.note)}</span>`:""}${x.receiptUrl?`<a class="notetxt" style="text-decoration:underline" href="${esc(x.receiptUrl)}" target="_blank" rel="noopener">receipt</a>`:""}${x.settle==="pending"?'<span class="tinytag auth">authorized</span>':""}${dueMark(x, todayISO())}</div>
    <div class="amt num" data-expand="${x.id}" title="Details"><div class="u" style="color:${x.checked?"var(--muted)":color}">${sign}${fmt(x.usd,"")}</div><div class="c">${fmt(cad,"C$")}</div></div>
    <button class="x" data-remove="${x.id}" title="Remove" aria-label="Remove ${esc(x.name)}">×</button>
  </label>${detail}`;
}

// Pending entries stay on top; done ones can fold away behind one quiet line.
// Payouts and processor activity never fold — seeing them is the point.
function stackedRows(items, key, fold){
  if (!fold) return items.map(rowHTML).join(""); // exact user order, nothing hidden
  const pending = items.filter(x => !x.checked);
  const done = items.filter(x => x.checked);
  let html = pending.map(rowHTML).join("");
  if (done.length) {
    const net = done.reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
    html += `<button class="donebar num" data-donetoggle="${key}" aria-expanded="${showDone[key] ? "true" : "false"}">${done.length} done · ${fmt(net)}<span class="tinylink">${showDone[key] ? "hide" : "show"}</span></button>`;
    if (showDone[key]) html += done.map(rowHTML).join("");
  }
  return html;
}

function listHTML(kind, items){
  const isIn = kind==="in";
  const d = drafts[kind];
  const a = parseFloat(d.amount)||0;
  return `<div>
    <div class="lh"><div class="sw" style="background:${isIn?"var(--in)":"var(--out)"}"></div><div class="lt">${isIn?"Coming in":"Going out"}</div></div>
    <div class="hint">${isIn?"Check it when the money lands":"Check it when you pay it"}</div>
    ${items.length?`<div data-rows="${kind}">${stackedRows(items, kind, kind==="out")}</div>`:'<div class="empty">Nothing on this day.</div>'}
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

function allListHTML(){
  const list = s.items.filter(x => matchesSearch(s, x, searchQ));
  if (!s.items.length) return '<div style="color:var(--muted)">Nothing logged on any day yet.</div>';
  if (!list.length) return '<div style="color:var(--muted)">Nothing matches.</div>';
  return groupedItemsHTML(list);
}

function groupedItemsHTML(list){
  const dates = [...new Set(list.map(x=>x.date))].sort().reverse();
  return dates.map(d=>`<div class="grp"><button class="bare" style="font-size:14px;font-weight:600;margin-bottom:2px" data-open="${d}">${pretty(d)}<span class="tinylink">open</span></button>
    ${list.filter(x=>x.date===d).map(rowHTML).join("")}</div>`).join("");
}

// ---- views ----

function render(){
  if (generateRecurring(s, todayISO(), shift(date, 32)) > 0) save();
  if (view === "vendor") return renderVendor();
  if (view === "vendors") return renderVendors();
  if (view === "accounts") return renderAccounts();
  if (view === "settings") return renderSettings();
  if (view === "goals") return renderGoals();
  renderMain();
}

function renderGoals(){
  const t = todayISO();
  document.getElementById("app").innerHTML = `
    <div class="datebar"><button class="link" id="back" style="margin-left:0">‹ back</button></div>
    <div class="lt" style="font-size:20px;margin-bottom:4px">Goals</div>
    <div class="hint" style="padding-left:0;margin-bottom:14px">A cash figure to reach by a date. Progress follows your real balance.</div>
    ${s.goals.length?s.goals.map(g=>{
      const gi = goalInfo(s, g, t);
      const status = gi.reached ? "reached"
        : gi.daysLeft === 0 ? "past its date"
        : `${gi.daysLeft} days left · needs +${fmt(gi.needPerDay,"")}/day · pace ${gi.pace>=0?"+":""}${fmt(gi.pace,"")}/day`;
      return `<div class="row" style="cursor:default;flex-wrap:wrap">
        <div class="name">${g.name?esc(g.name):fmt(g.targetUsd)}<span class="tinytag">${prettyShort(g.targetDate)}</span></div>
        <div class="amt num" style="font-weight:600;color:${gi.reached?"var(--in)":"var(--ink)"}">${fmt(gi.cash)} / ${fmt(g.targetUsd)}</div>
        <button class="x" data-goal-remove="${g.id}" title="Remove" aria-label="Remove goal">×</button>
        <div style="flex-basis:100%;display:flex;align-items:center;gap:10px;padding:4px 0 2px 0">
          <span class="gbar" style="flex:1;max-width:none"><span style="width:${(gi.pct*100).toFixed(1)}%"></span></span>
          <span class="sub num" style="margin:0;white-space:nowrap;${gi.behind?"color:var(--out)":""}">${Math.round(gi.pct*100)}% · ${status}</span>
        </div>
      </div>`;
    }).join(""):'<div class="empty">No goals yet. Set one below.</div>'}
    <div class="addrow" style="margin-top:26px">
      <div class="addgrid" style="grid-template-columns:1fr 120px 150px auto">
        <input id="goalName" placeholder="Reserve cushion" aria-label="Goal name (optional)">
        <input id="goalAmt" type="number" step="0.01" placeholder="20000" style="text-align:right" aria-label="Target amount USD">
        <input id="goalDate" type="date" style="width:100%;font-weight:400;font-size:14px" aria-label="Target date">
        <button class="btn" id="goalAdd">Add</button>
      </div>
    </div>`;
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
    s.goals.push({ id: uid("g"), name: document.getElementById("goalName").value.trim(), targetUsd: amt, targetDate: dt,
                   startUsd: calc(s, t).allTime, createdAt: t });
    save(); render();
  };
  document.getElementById("goalAdd").onclick = doAdd;
  ["goalName","goalAmt"].forEach(id=>document.getElementById(id).onkeydown = e=>{ if(e.key==="Enter") doAdd(); });
}

let pendingImport = null;
let importError = false;
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
    <div class="datebar"><button class="link" id="back" style="margin-left:0">‹ back</button></div>
    <div class="lt" style="font-size:20px;margin-bottom:14px">Settings</div>
    ${backupDue(s, t)?`<div class="runway low" style="margin:0 0 14px">It's been over 30 days since the last backup.<button class="link" id="dismissBackup">dismiss</button></div>`:""}
    <div class="grp" style="border-top:1px solid var(--line);padding-top:14px">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <button class="btn" id="exportJson">Download backup</button>
        <span class="sub" style="margin:0">Last backup: ${last?prettyShort(last):"never"}</span>
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label class="sub" style="margin:0" for="importFile">Restore from a backup file</label>
        <input type="file" id="importFile" accept=".json,application/json" aria-label="Backup file" style="width:auto;font-size:12.5px">
      </div>
      ${importError?`<div class="runway low" style="margin-top:10px">That file isn't a Money backup.</div>`:""}
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
      <label class="sub" style="margin:0">Due-soon marks show
        <input id="warnDays" type="number" min="0" max="30" value="${s.settings.warnDaysAhead}" style="width:60px;margin:0 6px;padding:5px 8px;font-size:12.5px" aria-label="Days ahead for due marks">
      days ahead</label>
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
    </div>`;
  document.getElementById("back").onclick = ()=>{ pendingImport=null; view="day"; render(); };
  document.getElementById("exportJson").onclick = exportJson;
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
  const ap = document.getElementById("applyImport");
  if (ap) ap.onclick = ()=>{ s = pendingImport; pendingImport = null; date = s.lastDate || todayISO(); save(); render(); };
  const ci = document.getElementById("cancelImport");
  if (ci) ci.onclick = ()=>{ pendingImport = null; render(); };
  document.getElementById("warnDays").onchange = e=>{
    s.settings.warnDaysAhead = Math.min(30, Math.max(0, parseInt(e.target.value, 10) || 0));
    save(); render();
  };
  document.getElementById("themeSel").onchange = e=>{
    s.settings.theme = e.target.value;
    save(); applyTheme(); render();
  };
}

function renderAccounts(){
  const shown = s.accounts.filter(a => accountsFilter === "all" || a.kind === accountsFilter);
  const total = shown.reduce((t, a) => t + accountBalance(s, a), 0);
  const unassigned = s.items.filter(x => x.checked && !x.accountId)
    .reduce((t, x) => t + (x.kind === "in" ? x.usd : -x.usd), 0);
  document.getElementById("app").innerHTML = `
    <div class="datebar">
      <button class="link" id="back" style="margin-left:0">‹ back</button>
      <div class="tabs">
        <button class="tab ${accountsFilter==="all"?"on":""}" data-afilter="all">All</button>
        <button class="tab ${accountsFilter==="business"?"on":""}" data-afilter="business">Business</button>
        <button class="tab ${accountsFilter==="personal"?"on":""}" data-afilter="personal">Personal</button>
      </div>
    </div>
    <div class="lt" style="font-size:20px;margin-bottom:14px">Accounts</div>
    ${shown.length?shown.map(a=>{
      const bal = accountBalance(s, a);
      const balCell = editAccId===a.id
        ? `<span style="display:flex;gap:6px;align-items:center"><input id="accDraft" type="number" step="0.01" value="${round2(bal).toFixed(2)}" style="width:130px;padding:5px 8px;text-align:right" aria-label="Balance for ${esc(a.name)}"><button class="btn" data-accsave="${a.id}" style="padding:6px 10px;font-size:12px">Save</button></span>`
        : `<button class="bare num" data-accedit="${a.id}" style="font-size:15px;font-weight:600;color:${bal<0?"var(--out)":"var(--ink)"}">${fmt(bal)}<span class="tinylink">edit</span></button>`;
      return `<div class="row" style="cursor:default">
        <div class="sw" style="background:${a.color}"></div>
        <div class="name">${esc(a.name)}<span class="tinytag">${a.kind}</span></div>
        <div class="amt">${balCell}</div>
      </div>`;
    }).join(""):'<div class="empty">No accounts yet.</div>'}
    <div class="summary num" style="margin-top:14px">
      <span>${accountsFilter==="all"?"Across all accounts":accountsFilter==="business"?"Business total":"Personal total"}: <b>${fmt(total)}</b></span>
      ${Math.abs(unassigned)>0.004?`<span>${fmt(unassigned)} of checked entries has no account</span>`:""}
    </div>
    <div class="addrow" style="margin-top:26px">
      <div class="addgrid" style="grid-template-columns:1fr 130px auto">
        <input id="accName" placeholder="Mercury" aria-label="Account name">
        <select id="accKind" aria-label="Account type"><option value="business">business</option><option value="personal">personal</option></select>
        <button class="btn" id="accAdd">Add</button>
      </div>
    </div>`;
  document.getElementById("back").onclick = ()=>{ view="day"; render(); };
  document.querySelectorAll("[data-afilter]").forEach(b=>b.onclick=()=>{ accountsFilter=b.dataset.afilter; render(); });
  document.querySelectorAll("[data-accedit]").forEach(b=>b.onclick=()=>{ editAccId=b.dataset.accedit; render(); document.getElementById("accDraft").focus(); });
  document.querySelectorAll("[data-accsave]").forEach(b=>{
    const doSave = ()=>{
      const a = s.accounts.find(z=>z.id===b.dataset.accsave);
      const v = parseFloat(document.getElementById("accDraft").value);
      // the balance is derived, so editing it adjusts the account's starting figure
      if (!isNaN(v)) a.start = v - (accountBalance(s, a) - a.start);
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
    const a = (s.adjust || {})[date] || 0;
    startCell = editCarry
      ? `<div style="display:flex;gap:6px;align-items:center"><input id="carryDraft" type="number" step="0.01" value="${round2(m.carry).toFixed(2)}" style="font-size:18px;font-weight:600;padding:4px 8px;width:130px" aria-label="Start of day"><button class="btn" id="saveCarry" style="padding:6px 10px;font-size:12px">Save</button></div>`
      : `<button class="bare num big" id="editCarry">${fmt(m.carry)}<span class="tinylink">edit</span></button>
         <div class="sub">${a ? `adjusted ${fmt(a)}<button class="link" id="clearAdj">clear</button>` : date < s.startDate ? "before the start" : "carried from before"}</div>`;
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
        return `<div class="pcard">
          <div class="pcard-h">
            <button class="namebtn pname" data-vopen="${v.id}">${esc(v.name)}</button>
            <span class="pnet num" style="color:${net<0?"var(--out)":"var(--in)"}">${net>=0?"+":""}${fmt(net,"")}${pending?`<span class="tinylink" style="text-decoration:none">${pending} pending</span>`:""}</span>
          </div>
          <div data-rows="p${v.id}">${stackedRows(items, "p"+v.id, false)}</div>
        </div>`;
      }).join("");
      procBlock = `<div class="psec">
        <div class="lh"><div class="sw" style="background:var(--muted)"></div><div class="lt">Processors</div></div>
        <div class="hint">Each processor's payouts, fees, and debits together — check them when they hit</div>
        <div class="pgrid">${cards}</div>
      </div>`;
    }
    body = `${procBlock}<div class="cols">${listHTML("in", inO)}${listHTML("out", outO)}</div>`;
  } else if (view==="month") {
    body = monthHTML();
  } else {
    body = `<div style="margin-top:36px">
      <input id="search" type="search" value="${esc(searchQ)}" placeholder="Search name, vendor, note, amount" aria-label="Search entries" style="max-width:340px">
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
    <div class="dayhead">${pretty(date)}</div>
    <div class="flow num">
      <div class="cell"><div class="lbl">${isStart?"Starting with":"Start of day"}</div><div>${startCell}</div></div>
      <div class="cell"><div class="lbl" style="color:var(--in)">Came in</div><div><div class="big" style="color:var(--in)" id="numIn">+${fmt(m.inC,"")}</div>${m.inA>m.inC?`<div class="sub">of ${fmt(m.inA,"")} expected</div>`:""}</div></div>
      <div class="cell"><div class="lbl" style="color:var(--out)">Went out</div><div><div class="big" style="color:var(--out)" id="numOut">−${fmt(m.outC,"")}</div>${m.outA>m.outC?`<div class="sub">of ${fmt(m.outA,"")} owed</div>`:""}</div></div>
      <div class="cell" style="background:${endFill}"><div class="lbl">Left</div><div><div class="huge" style="color:${endColor}" id="numLeft">${fmt(m.end)}</div><div class="sub">${fmt(m.end*s.rate,"C$")}</div></div></div>
    </div>
    ${view==="day"?(()=>{ const t = todayISO();
      const r = runwayInfo(s, t);
      const rText = r.burning
        ? `Cash lasts ${r.days} ${r.days===1?"day":"days"} at this month's pace.`
        : "At this month's pace, cash is growing.";
      const g = s.goals.filter(x=>!x.dismissed).sort((a,b)=>a.targetDate.localeCompare(b.targetDate))[0];
      let goalLine = "";
      if (g) {
        const gi = goalInfo(s, g, t);
        goalLine = gi.reached
          ? `<span class="ptext">Goal reached: ${fmt(g.targetUsd)}${g.name?` — ${esc(g.name)}`:""}.</span>`
          : `<span class="ptext${gi.behind?" low":""}">${g.name?esc(g.name)+" — ":""}${fmt(g.targetUsd)} by ${prettyShort(g.targetDate)} · ${Math.round(gi.pct*100)}% there${gi.needPerDay>0?` · needs +${fmt(gi.needPerDay,"")}/day`:""}</span>
             <span class="gbar" aria-hidden="true"><span style="width:${(gi.pct*100).toFixed(1)}%"></span></span>`;
      }
      const ins = insightsFor(s, t)[0];
      return `<div class="pulse num">${sparkSVG(sparkData(s, t))}
        <div class="pstack">
          <span class="ptext${r.burning&&r.days<30?" low":""}">${rText}</span>
          ${goalLine}
          ${ins?`<span class="ptext${ins.tone==="warn"?" low":""}">${ins.text}</span>`:""}
        </div>
      </div>`; })():""}
    ${(()=>{ const fl = s.items.filter(x=>!x.checked && x.settle==="pending").reduce((t,x)=>t+(x.kind==="in"?x.usd:-x.usd),0);
      return Math.abs(fl)>0.004 ? `<div class="summary num"><span><b>${fmt(fl)}</b> authorized at the bank, waiting to settle — not counted in Left yet</span></div>` : ""; })()}
    <div class="summary num">
      <span>All days so far: <b>${fmt(m.allTime)}</b></span>
      <span>If everything lands and gets paid: <b style="color:${m.ifAll<0?"var(--out)":"var(--ink)"}">${fmt(m.ifAll)}</b></span>
      ${m.pendingEarlier>0&&view==="day"?`<button class="link" style="margin-left:0;color:var(--out)" data-view="all">${m.pendingEarlier} unchecked from earlier days</button>`:""}
    </div>
    ${body}
    </div>
    <div class="foot">
      1 USD = ${s.rate.toFixed(4)} CAD<button class="link" id="rateToggle">change</button>
      ${showRate?`<input id="rateInput" type="number" step="0.0001" value="${s.rate}" style="width:110px;margin-left:10px;display:inline-block;padding:5px 8px" aria-label="USD to CAD rate">`:""}
      <span style="margin-left:18px">Started ${pretty(s.startDate)} with ${fmt(s.startBudget)}</span>
      <button class="link" id="accountsLink">accounts</button>
      <button class="link" id="vendorsLink">vendors</button>
      <button class="link" id="goalsLink">goals</button>
      <button class="link" id="settingsLink">settings</button>
      <button class="link" id="export">export CSV</button>
    </div>
    ${undoChipHTML()}`;
  bindMain();
  paintNum("numLeft", m.end, v=>fmt(v));
  paintNum("numIn", m.inC, v=>"+"+fmt(v,""));
  paintNum("numOut", m.outC, v=>"−"+fmt(Math.abs(v),""));
  lastAnimDate = date;
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
    <div class="datebar"><button class="link" id="back" style="margin-left:0">‹ back</button></div>
    <div class="lt" style="font-size:20px;margin-bottom:14px">Vendors</div>
    ${rows.length?rows.map(({v,st})=>`
      <div class="row" style="cursor:default">
        <div class="name"><button class="namebtn" data-vopen="${v.id}">${esc(v.name)}</button>${v.isProcessor?'<span class="tinytag">processor</span>':""}</div>
        <div class="sub num" style="margin:0">${st.count} ${st.count===1?"entry":"entries"} · ${fmt(st.doneAll)} · ${st.last?prettyShort(st.last):"—"}</div>
      </div>`).join(""):'<div class="empty">No vendors yet. They appear as you log entries.</div>'}
  `;
  document.getElementById("back").onclick = ()=>{ view="day"; render(); };
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
  bindUndo();
  app.querySelectorAll("[data-vopen]").forEach(b=>b.onclick=()=>{ openVendorId=b.dataset.vopen; view="vendor"; render(); });
  app.querySelectorAll("[data-toggle]").forEach(c=>{
    c.indeterminate = c.hasAttribute("data-ind");
    c.onchange=()=>{ toggleItem(s, c.dataset.toggle, todayISO()); save(); render(); };
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
  app.querySelectorAll("[data-settle]").forEach(sel=>{
    sel.onchange = ()=>{
      const x = s.items.find(i=>i.id===sel.dataset.settle);
      x.settle = sel.value === "settled" ? todayISO() : (sel.value || null);
      if (sel.value === "settled" && !x.checked) x.checked = true; // settled money is real money
      if (sel.value === "pending") x.checked = false;              // authorized money isn't usable yet
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
  const goto = d => { date=d; editCarry=false; showDone={in:false,out:false,proc:false}; save(); render(); };
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
  if ($("editCarry")) $("editCarry").onclick = ()=>{ editCarry=true; render(); $("carryDraft").focus(); };
  if ($("saveCarry")) { const doSave=()=>{
      const v=parseFloat($("carryDraft").value); editCarry=false;
      if(!isNaN(v)){
        s.adjust = s.adjust || {};
        const cur = calc(s, date).carry;
        const next = ((s.adjust[date]||0) + (v - cur));
        if (Math.abs(next) < 0.005) delete s.adjust[date]; else s.adjust[date] = next;
      }
      save(); render(); };
    $("saveCarry").onclick=doSave;
    $("carryDraft").onkeydown=e=>{ if(e.key==="Enter") doSave(); if(e.key==="Escape"){ editCarry=false; render(); } };
  }
  if ($("clearAdj")) $("clearAdj").onclick = ()=>{ delete s.adjust[date]; save(); render(); };
  app.querySelectorAll("[data-donetoggle]").forEach(b=>b.onclick=()=>{ const k=b.dataset.donetoggle; showDone[k]=!showDone[k]; render(); });
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
  if ($("saveStart")) { const doSave=()=>{ const v=parseFloat($("startDraft").value); editStart=false; if(!isNaN(v)){ s.startBudget=v; s.startDate=date; } save(); render(); };
    $("saveStart").onclick=doSave; $("startDraft").onkeydown=e=>{ if(e.key==="Enter") doSave(); if(e.key==="Escape"){ editStart=false; render(); } }; }
  $("rateToggle").onclick = ()=>{ showRate=!showRate; render(); };
  if ($("rateInput")) $("rateInput").oninput = e=>{ s.rate=parseFloat(e.target.value)||1; save(); const keep=e.target; const v=keep.value; render(); const again=$("rateInput"); if(again){ again.value=v; again.focus(); } };
  if ($("search")) $("search").oninput = e=>{
    searchQ = e.target.value;
    $("allList").innerHTML = allListHTML();
    bindShared();
  };
  $("accountsLink").onclick = ()=>{ view="accounts"; render(); };
  $("vendorsLink").onclick = ()=>{ view="vendors"; render(); };
  $("goalsLink").onclick = ()=>{ view="goals"; render(); };
  $("settingsLink").onclick = ()=>{ view="settings"; render(); };
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
  downloadText(`money-${todayISO()}.csv`, "text/csv", csv);
}

if (typeof window === "undefined") {
  module.exports = { SEED, KEY, LEGACY_KEY, migrate, ensure, calc, fmt, upsertVendorFromEntry, findVendorByName, vendorDefaults, vendorStats, vendorItems, generateRecurring, stopRecurring, addMonths, accountBalance, monthData, runwayInfo, matchesSearch, diffStates, backupDue, moveItem, sparkData, toggleItem, dailyNets, goalInfo, insightsFor };
} else {
  s = load();
  date = s.lastDate || todayISO();
  save();
  applyTheme();
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }

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
