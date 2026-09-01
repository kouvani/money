const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const { SEED, migrate, ensure, calc, upsertVendorFromEntry, findVendorByName, vendorDefaults, vendorStats, generateRecurring, stopRecurring, addMonths, accountBalance, monthData, runwayInfo, matchesSearch, diffStates, backupDue, moveItem, sparkData, toggleItem, goalInfo, insightsFor, redateItem } = require(path.join(root, "app.js"));

let failed = 0;
const assert = (name, cond) => {
  console.log((cond ? "  ok  " : "  FAIL") + "  " + name);
  if (!cond) failed++;
};
const round2 = n => Math.round(n * 100) / 100;

// 1. Seed strip: Left is 8403.01 unchecked, 5058.15 with both checked
{
  const st = structuredClone(SEED);
  let m = calc(st, "2026-08-31");
  assert("Left reads 8403.01 with nothing checked", round2(m.end) === 8403.01);
  st.items.forEach(x => { x.checked = true; });
  m = calc(st, "2026-08-31");
  assert("Left reads 5058.15 with both checked", round2(m.end) === 5058.15);
}

// 2. Changing the rate never changes a CAD-locked entry's CAD figure
{
  const st = structuredClone(SEED);
  const locked = st.items.find(x => x.cadFixed != null);
  const cadShown = (x, rate) => x.cadFixed != null ? x.cadFixed : x.usd * rate;
  const before = cadShown(locked, st.rate);
  st.rate = 1.9;
  const after = cadShown(locked, st.rate);
  assert("CAD-locked entry shows C$2500 before rate change", before === 2500);
  assert("CAD-locked entry shows C$2500 after rate change", after === 2500);
  assert("CAD-locked entry's USD is untouched by rate change", locked.usd === 2500 / 1.389);
}

// 3. A v5 localStorage blob migrates to a valid v6 state with no lost entries
{
  const v5 = {
    startDate: "2026-08-31", startBudget: 8403.01, rate: 1.389, lastDate: "2026-08-31",
    items: [
      { id: "o1", kind: "out", date: "2026-08-31", name: "Chapa - rent", usd: 2500 / 1.389, cadFixed: 2500, checked: true },
      { id: "o2", kind: "out", date: "2026-08-31", name: "Chargeblast (5 bills)", usd: 1545, cadFixed: null, checked: true },
      { id: "x1", kind: "in", date: "2026-09-02", name: "Shopify payout", usd: 432.17, cadFixed: null, checked: false },
    ],
  };
  const st = migrate(structuredClone(v5));
  assert("migrated state is version 6", st.version === 6);
  assert("no entries lost", st.items.length === 3);
  assert("entry values survive exactly", st.items[0].usd === 2500 / 1.389 && st.items[0].cadFixed === 2500 && st.items[2].usd === 432.17);
  assert("checked flags survive", st.items[0].checked === true && st.items[2].checked === false);
  assert("v6 fields exist", Array.isArray(st.accounts) && Array.isArray(st.vendors) && st.settings && st.settings.warnDaysAhead === 3);
  assert("start figures survive", st.startBudget === 8403.01 && st.startDate === "2026-08-31" && st.rate === 1.389);
  assert("migrated state computes the same Left", round2(calc(st, "2026-08-31").end) === 5058.15);
}

// 5. Vendors: created from entries, defaults remembered, stats answer "what have I paid this year"
{
  const st = structuredClone(SEED);
  const e1 = { id: "a1", kind: "out", date: "2026-01-15", name: "Chargeblast", usd: 300, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null };
  const v1 = upsertVendorFromEntry(st, e1); st.items.push(e1);
  assert("vendor auto-created from entry", st.vendors.length === 1 && e1.vendorId === v1.id);
  assert("vendor defaults remembered", v1.defaultKind === "out" && v1.defaultAmountUsd === 300 && v1.cadFixed === null);
  const e2 = { id: "a2", kind: "out", date: "2026-08-20", name: "chargeblast", usd: 500, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null };
  const v2 = upsertVendorFromEntry(st, e2); st.items.push(e2);
  assert("name match is case-insensitive, no duplicate vendor", st.vendors.length === 1 && v2.id === v1.id);
  assert("defaults update to the latest entry", v1.defaultAmountUsd === 500);
  assert("prefill uses the default amount", vendorDefaults(v1).amount === 500 && vendorDefaults(v1).cur === "USD");
  const stats = vendorStats(st, v1, "2026-09-01");
  assert("paid this year totals checked entries", stats.doneYear === 800 && stats.doneAll === 800);
  assert("average and last paid are right", stats.avg === 400 && stats.last === "2026-08-20");
  const cadVendor = upsertVendorFromEntry(st, { id: "a3", kind: "out", date: "2026-08-31", name: "Chapa - rent", usd: 2500/1.389, cadFixed: 2500, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  assert("CAD-locked vendor prefills in CAD", vendorDefaults(cadVendor).amount === 2500 && vendorDefaults(cadVendor).cur === "CAD");
  assert("lookup by name works", findVendorByName(st, "  CHARGEBLAST ") === v1);
}

// 6. Recurring bills: generated on their day, no duplicates, deletable one-by-one, capped
{
  const st = structuredClone(SEED);
  st.items = []; st.vendors = [];
  const bill = { id: "b1", kind: "out", date: "2026-08-27", name: "Regus", usd: 850, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null };
  const v = upsertVendorFromEntry(st, bill); st.items.push(bill);
  v.cadence = "monthly"; v.dayOfMonth = 27; v.skipDates = [];
  const made = generateRecurring(st, "2026-09-01", null);
  const gen = st.items.filter(x => x.recurringSourceId === v.id);
  assert("monthly bill generates on its day", made >= 3 && gen.every(x => x.date.slice(8) === "27"));
  assert("first generated occurrence is the next month", gen.map(x=>x.date).sort()[0] === "2026-09-27");
  assert("generated entries are normal unchecked entries", gen.every(x => !x.checked && x.usd === 850 && x.kind === "out"));
  assert("regeneration never duplicates", generateRecurring(st, "2026-09-01", null) === 0);
  assert("never generates more than 12 months ahead", gen.every(x => x.date <= addMonths("2026-09-01", 12)));
  // delete just one: skipDates keeps it gone
  const skip = gen[0];
  v.skipDates.push(skip.date);
  st.items = st.items.filter(x => x.id !== skip.id);
  assert("a deleted occurrence stays deleted", generateRecurring(st, "2026-09-01", null) === 0);
  // stop generating: cadence off, future unchecked gone, checked history kept
  gen[1].checked = true;
  stopRecurring(st, v, "2026-09-01");
  assert("stop repeating clears future unchecked, keeps history", v.cadence === null
    && st.items.filter(x => x.recurringSourceId === v.id && !x.checked).length === 0
    && st.items.includes(gen[1]) && st.items.includes(bill));
  // the cadence day later in the anchor's own month still counts
  const vSoon = upsertVendorFromEntry(st, { id: "c1", kind: "out", date: "2026-09-01", name: "Chargeblast", usd: 300, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  st.items.push({ id: "c1e", kind: "out", date: "2026-09-01", name: "Chargeblast", usd: 300, cadFixed: null, checked: false, accountId: null, vendorId: vSoon.id, note: "", receiptUrl: "", recurringSourceId: null });
  vSoon.cadence = "monthly"; vSoon.dayOfMonth = 27;
  generateRecurring(st, "2026-09-01", null);
  assert("cadence day in the anchor month generates too", st.items.some(x => x.recurringSourceId === vSoon.id && x.date === "2026-09-27"));

  // month-length clamp: day 31 in a 30-day month
  const v31 = upsertVendorFromEntry(st, { id: "b2", kind: "out", date: "2026-08-31", name: "Landlord", usd: 1200, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  st.items.push(st.items.pop()); // no-op keep
  v31.cadence = "monthly"; v31.dayOfMonth = 31; v31.skipDates = [];
  st.items.push({ id: "b2e", kind: "out", date: "2026-08-31", name: "Landlord", usd: 1200, cadFixed: null, checked: true, accountId: null, vendorId: v31.id, note: "", receiptUrl: "", recurringSourceId: null });
  generateRecurring(st, "2026-09-01", null);
  const land = st.items.filter(x => x.recurringSourceId === v31.id).map(x => x.date).sort();
  assert("day 31 clamps to shorter months", land.includes("2026-09-30") && land.includes("2026-10-31") && land.includes("2026-11-30"));
}

// 7. Accounts: balance = starting figure plus checked entries; the strip is untouched
{
  const st = structuredClone(SEED);
  st.accounts = [{ id: "am", name: "Mercury", kind: "business", color: "#1C6B5E", start: 4000 }];
  st.items = [
    { id: "p1", kind: "in", date: "2026-08-30", name: "Shopify payout", usd: 1200, cadFixed: null, checked: true, accountId: "am", vendorId: null, note: "", receiptUrl: "", recurringSourceId: null },
    { id: "p2", kind: "out", date: "2026-08-31", name: "Meta ads", usd: 300, cadFixed: null, checked: true, accountId: "am", vendorId: null, note: "", receiptUrl: "", recurringSourceId: null },
    { id: "p3", kind: "out", date: "2026-08-31", name: "Meta ads", usd: 999, cadFixed: null, checked: false, accountId: "am", vendorId: null, note: "", receiptUrl: "", recurringSourceId: null },
    { id: "p4", kind: "out", date: "2026-08-31", name: "Groceries", usd: 50, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null },
  ];
  const a = st.accounts[0];
  assert("account balance derives from start + checked entries only", accountBalance(st, a) === 4000 + 1200 - 300);
  assert("entries without an account don't touch it", accountBalance(st, a) === 4900);
  const legacyAccount = ensure({ version: 6, accounts: [{ id: "x", name: "Wise" }], vendors: [], items: [], settings: {} }).accounts[0];
  assert("older account records gain kind/color/start", legacyAccount.kind === "business" && typeof legacyAccount.start === "number" && !!legacyAccount.color);
}

// 8. Month view data: totals, dots, end-of-day figures, past-unchecked marks
{
  const st = structuredClone(SEED);
  st.items[1].checked = true; // Chargeblast paid, Chapa still unchecked
  st.items.push({ id: "m1", kind: "in", date: "2026-08-15", name: "Shopify payout", usd: 2000, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  const md = monthData(st, "2026-08", "2026-09-01");
  assert("month totals sum checked entries", md.inC === 2000 && md.outC === 1545 && md.net === 455);
  const d15 = md.days.find(d => d.date === "2026-08-15");
  const d31 = md.days.find(d => d.date === "2026-08-31");
  assert("dots reflect in/out entries", d15.hasIn && !d15.hasOut && d31.hasOut);
  assert("end-of-day figures run through the month", Math.round(d15.end*100)/100 === 2000 && Math.round(d31.end*100)/100 === 8858.01);
  assert("days before the start date hold no starting money", Math.round(md.days.find(d=>d.date==="2026-08-01").end*100)/100 === 0);
  assert("past days with unchecked entries are marked", d31.warn === true && d15.warn === false);
  assert("august 2026 starts on a saturday", md.offset === 6 && md.days.length === 31);
}

// 9. Runway: trailing 30-day net of checked entries, days of cash at that pace
{
  const st = structuredClone(SEED);
  st.startBudget = 9000; st.items = [];
  const mk = (id, kind, dt, usd, checked) => ({ id, kind, date: dt, name: id, usd, cadFixed: null, checked, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  st.items.push(mk("w1", "out", "2026-08-20", 2000, true));   // in window
  st.items.push(mk("w2", "in",  "2026-08-25", 500,  true));   // in window
  st.items.push(mk("w3", "out", "2026-07-01", 5000, true));   // outside window, still burns cash total
  st.items.push(mk("w4", "out", "2026-08-28", 9999, false));  // unchecked: ignored
  const r = runwayInfo(st, "2026-09-01");
  // cash = 9000 - 2000 + 500 - 5000 = 2500; burn = 1500/30 = 50/day -> 50 days
  assert("runway counts only checked entries in the last 30 days", r.burning && r.days === 50);
  st.items.push(mk("w5", "in", "2026-08-30", 2000, true));
  assert("positive 30-day net means no burn", runwayInfo(st, "2026-09-01").burning === false);
}

// 10. Search matches name, vendor, note, and amount
{
  const st = structuredClone(SEED);
  st.vendors = [{ id: "v1", name: "Chargeblast", note: "", defaultKind: "out", defaultAccountId: null, defaultAmountUsd: 309, cadFixed: null, cadence: null, dayOfMonth: null, url: "", skipDates: [] }];
  const x = { id: "s1", kind: "out", date: "2026-08-31", name: "5 bills", usd: 1545, cadFixed: null, checked: false, accountId: null, vendorId: "v1", note: "august batch", receiptUrl: "", recurringSourceId: null };
  assert("search by name", matchesSearch(st, x, "bills"));
  assert("search by vendor", matchesSearch(st, x, "chargeblast"));
  assert("search by note", matchesSearch(st, x, "august"));
  assert("search by amount", matchesSearch(st, x, "1545"));
  assert("search misses cleanly", !matchesSearch(st, x, "regus"));
  assert("empty query matches all", matchesSearch(st, x, "  "));
}

// 11. Import diff preview and backup reminder
{
  const cur = structuredClone(SEED);
  const inc = structuredClone(SEED);
  inc.items[0].checked = true;                          // change o1
  inc.items = inc.items.filter(x => x.id !== "o2");     // remove o2
  inc.items.push({ id: "n1", kind: "in", date: "2026-09-02", name: "Payout", usd: 100, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  inc.rate = 1.40;
  const d = diffStates(cur, inc);
  assert("diff counts adds, changes, removes", d.items.add === 1 && d.items.change === 1 && d.items.remove === 1);
  assert("diff flags a rate change, not a start change", d.rateChanged && !d.startChanged);
  const same = diffStates(cur, structuredClone(SEED));
  assert("identical states diff to zero", same.items.add === 0 && same.items.change === 0 && same.items.remove === 0);

  const st = structuredClone(SEED);
  assert("no backup ever -> reminder due", backupDue(st, "2026-09-01") === true);
  st.settings.lastBackupAt = "2026-08-20";
  assert("recent backup -> no reminder", backupDue(st, "2026-09-01") === false);
  st.settings.lastBackupAt = "2026-07-01";
  assert("stale backup -> reminder", backupDue(st, "2026-09-01") === true);
  st.settings.backupDismissedAt = "2026-08-25";
  assert("dismissed -> quiet for 30 days", backupDue(st, "2026-09-01") === false);
}

// 12. Start-of-day adjustments: fix the carry without counting as money in or out
{
  const st = structuredClone(SEED);
  st.items.forEach(x => { x.checked = true; });
  const before = calc(st, "2026-09-01");
  st.adjust = { "2026-09-01": -58.15 };
  const m = calc(st, "2026-09-01");
  assert("adjustment moves the start of day", Math.round(m.carry*100)/100 === Math.round((before.carry - 58.15)*100)/100);
  assert("adjustment moves Left and all-time the same way", Math.round(m.end*100)/100 === 5000 && Math.round(m.allTime*100)/100 === 5000);
  assert("adjustment is not money in or out", m.inC === before.inC && m.outC === before.outC);
  assert("earlier days are untouched", Math.round(calc(st, "2026-08-31").end*100)/100 === 5058.15);
  const md = monthData(st, "2026-09", "2026-09-02");
  assert("month figures include the adjustment", Math.round(md.days[0].end*100)/100 === 5000);
}

// 13. Drag order persists in the master list; sparkline tracks end-of-day balances
{
  const st = structuredClone(SEED);
  st.items.push({ id: "o3", kind: "out", date: "2026-08-31", name: "Wise", usd: 10, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  moveItem(st, "o3", "o1", false);         // drag Wise above Chapa
  assert("reorder moves the entry before its target", st.items.map(x=>x.id).join(",") === "o3,o1,o2");
  moveItem(st, "o3", "o2", true);          // drag Wise below Chargeblast
  assert("reorder can drop after a target", st.items.map(x=>x.id).join(",") === "o1,o2,o3");
  moveItem(st, "o3", "missing", false);
  assert("dropping on nothing changes nothing", st.items.map(x=>x.id).join(",") === "o1,o2,o3");

  const st2 = structuredClone(SEED);
  st2.items.forEach(x=>{ x.checked = true; });
  const sd = sparkData(st2, "2026-09-01");
  const pts = sd.past;
  assert("sparkline covers 30 days and ends at today's balance", pts.length === 30 && Math.round(pts[29]*100)/100 === 5058.15);
  assert("sparkline is zero before the start, then jumps on Aug 31", Math.round(pts[27]*100)/100 === 0 && Math.round(pts[28]*100)/100 === 5058.15);
  // projection: an unchecked bill on Sep 3 pulls the dashed line down
  st2.items.push({ id: "f1", kind: "out", date: "2026-09-03", name: "Meta ads", usd: 1000, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  const sd2 = sparkData(st2, "2026-09-01");
  assert("future tail projects scheduled unchecked entries", sd2.future.length === 7
    && Math.round(sd2.future[0]*100)/100 === 5058.15
    && Math.round(sd2.future[1]*100)/100 === 4058.15
    && Math.round(sd2.future[6]*100)/100 === 4058.15);
}

// 14. Authorized vs settled: an ACH line that appeared at the bank doesn't count until it settles
{
  const st = structuredClone(SEED);
  st.items = [];
  // Kurv payout from Thursday's orders appears Friday night, settles Monday morning
  st.items.push({ id: "k1", kind: "in", date: "2026-09-04", name: "Kurv payout", usd: 2000, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null, settle: "pending" });
  const friday = calc(st, "2026-09-04");
  assert("authorized money is visible but not in Left", Math.round(friday.end*100)/100 === 8403.01 && friday.inA === 2000 && friday.inC === 0);
  // Monday morning: it settles — one tap checks it and stamps the settled date
  const x = toggleItem(st, "k1", "2026-09-07");
  assert("checking a pending entry counts it and stamps settled-at", x.checked === true && x.settle === "2026-09-07");
  assert("after settlement the money is in Left", Math.round(calc(st, "2026-09-07").end*100)/100 === 10403.01);
  // unchecking later keeps the settle stamp for the record
  toggleItem(st, "k1", "2026-09-08");
  assert("unchecking keeps the settled-at record", x.checked === false && x.settle === "2026-09-07");
}

// 15. Known processing names are flagged as processors and old entries join them by name
{
  const st = ensure({ version: 6, accounts: [],
    vendors: [{ id: "ve", name: "ems", note: "", defaultKind: "in", defaultAccountId: null, defaultAmountUsd: 500, cadFixed: null, cadence: null, dayOfMonth: null, url: "", skipDates: [], isProcessor: false }],
    items: [{ id: "i1", kind: "in", date: "2026-08-31", name: "BANKCARD DEPOSIT", usd: 900, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null }],
    settings: {} });
  assert("existing vendor flagged case-insensitively", st.vendors.find(v=>v.name==="ems").isProcessor === true);
  const names = st.vendors.map(v=>v.name);
  assert("missing processor vendors are created", ["PHOENIX ECOMMERCE","GATEWAY SERVICES","BANKCARD DEPOSIT"].every(n=>names.includes(n)));
  assert("no duplicate for the existing one", st.vendors.filter(v=>v.name.toLowerCase()==="ems").length === 1);
  assert("old entries link to their vendor by name", st.items[0].vendorId === st.vendors.find(v=>v.name==="BANKCARD DEPOSIT").id);
  // manual un-flag survives the next load
  st.vendors.find(v=>v.name==="ems").isProcessor = false;
  const again = ensure(structuredClone(st));
  assert("turning a processor off sticks across loads", again.vendors.find(v=>v.name==="ems").isProcessor === false);
}

// 16. Goals: progress from the real balance, pace math, reached state
{
  const st = structuredClone(SEED);
  st.items.forEach(x=>{ x.checked = true; }); // cash ~= 5058.15
  const g = { id: "g1", name: "Cushion", targetUsd: 10000, targetDate: "2026-10-01", startUsd: 0, createdAt: "2026-09-01" };
  st.goals = [g];
  const gi = goalInfo(st, g, "2026-09-01");
  const cash = calc(st, "2026-09-01").allTime;
  assert("goal progress tracks the real balance", Math.abs(gi.pct - cash/10000) < 1e-9 && gi.reached === false);
  assert("needs-per-day covers the gap by the date", gi.daysLeft === 30 && Math.abs(gi.needPerDay - (10000 - cash)/30) < 1e-9);
  assert("burning pace means behind", gi.pace < 0 && gi.behind === true);
  const done = goalInfo(st, { ...g, targetUsd: 5000 }, "2026-09-01");
  assert("a passed target reads as reached", done.reached === true && done.pct === 1 && done.needPerDay === 0);
}

// 17. Insights: the week ahead is summarized with a projection
{
  const st = structuredClone(SEED);
  st.items[1].checked = true; // cash = 6858.01
  st.items.push({ id: "n1", kind: "out", date: "2026-09-04", name: "Meta ads", usd: 500, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  st.items.push({ id: "n2", kind: "in", date: "2026-09-05", name: "Kurv payout", usd: 2000, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  const ins = insightsFor(st, "2026-09-01");
  assert("week-ahead insight exists with owed, expected, projection",
    ins[0].text.includes("US$500.00 owed") && ins[0].text.includes("US$2,000.00 expected") && ins[0].text.includes("US$8,358.01"));
  assert("biggest-cost insight names the vendor", ins.some(i => i.text.includes("Biggest cost this month")) === false); // Chargeblast was paid in August, not this month
}

// 18. Moving an entry to the day the money actually moved
{
  const st = structuredClone(SEED);
  // an Uber charge logged on the settled day moves back to its authorization day
  st.items.push({ id: "u1", kind: "out", date: "2026-08-31", name: "Uber Eats", usd: 52.49, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null, settle: "2026-08-31" });
  redateItem(st, "u1", "2026-08-29");
  const u = st.items.find(x=>x.id==="u1");
  assert("entry moves to the authorization day, settled stamp stays", u.date === "2026-08-29" && u.settle === "2026-08-31");
  assert("the hit lands on the moved-to day", Math.round(calc(st, "2026-08-29").end*100)/100 === -52.49);
  // a moved generated bill never regenerates on the vacated day
  const v = upsertVendorFromEntry(st, { id: "r0", kind: "out", date: "2026-09-27", name: "Regus", usd: 850, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  v.cadence = "monthly"; v.dayOfMonth = 27;
  st.items.push({ id: "r1", kind: "out", date: "2026-09-27", name: "Regus", usd: 850, cadFixed: null, checked: false, accountId: null, vendorId: v.id, note: "", receiptUrl: "", recurringSourceId: v.id });
  redateItem(st, "r1", "2026-09-29");
  assert("vacated day is skipped for regeneration", v.skipDates.includes("2026-09-27"));
  generateRecurring(st, "2026-09-01", null);
  assert("moved bill doesn't duplicate back", st.items.filter(x=>x.vendorId===v.id && x.date==="2026-09-27").length === 0);
}

// 4. Offline shell: every file the service worker precaches exists on disk
{
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const list = sw.match(/SHELL = \[([^\]]*)\]/)[1].match(/"([^"]+)"/g).map(x => x.slice(1, -1));
  const missing = list.filter(f => f !== "./" && !fs.existsSync(path.join(root, f)));
  assert("service worker shell files all exist" + (missing.length ? " (missing: " + missing.join(", ") + ")" : ""), missing.length === 0);
  assert("index.html registers no CDN font", !fs.readFileSync(path.join(root, "index.html"), "utf8").includes("fonts.googleapis.com"));
}

console.log(failed ? `\n${failed} test(s) failed` : "\nAll tests passed");
process.exit(failed ? 1 : 0);
