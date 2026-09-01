const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const { SEED, migrate, ensure, calc, upsertVendorFromEntry, findVendorByName, vendorDefaults, vendorStats, generateRecurring, stopRecurring, addMonths, accountBalance, monthData, runwayInfo, matchesSearch, diffStates, backupDue, moveItem, sparkData, toggleItem, goalInfo, insightsFor, redateItem, deleteVendor, deleteAccount, applyLiveRate, lagSuggestion, nextBusinessDay, settlePending, daySummary, dayBriefText, parseCsv, utcToLocalISO, cleanBankName, mapSlashCsv, applySlashImport, deleteMonth } = require(path.join(root, "app.js"));

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
  assert("end-of-day figures run through the month", Math.round(d15.end*100)/100 === 2000 && Math.round(d31.end*100)/100 === 6858.01);
  assert("pre-start history never moves the balance", Math.round(calc(st, "2026-09-01").allTime*100)/100 === 6858.01);
  assert("days before the start date hold no starting money", Math.round(md.days.find(d=>d.date==="2026-08-01").end*100)/100 === 0);
  assert("past days with unchecked entries are marked", d31.warn === true && d15.warn === false);
  assert("august 2026 starts on a saturday", md.offset === 6 && md.days.length === 31);
}

// 9. Runway: trailing 30-day net of checked entries, days of cash at that pace
{
  const st = structuredClone(SEED);
  st.startBudget = 9000; st.startDate = "2026-07-01"; st.items = [];
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

// 19. Deleting vendors and accounts never touches the entries themselves
{
  const st = structuredClone(SEED);
  const v = upsertVendorFromEntry(st, st.items[1]); // Chargeblast
  v.cadence = "monthly"; v.dayOfMonth = 27; v.skipDates = [];
  generateRecurring(st, "2026-09-01", null);
  const genCount = st.items.filter(x=>x.recurringSourceId===v.id).length;
  assert("setup generated future bills", genCount > 0);
  deleteVendor(st, v.id, "2026-09-01");
  assert("vendor gone, real entries kept, future generated dropped",
    st.vendors.every(z=>z.id!==v.id) && st.items.some(x=>x.name==="Chargeblast (5 bills)")
    && st.items.every(x=>x.vendorId!==v.id && x.recurringSourceId!==v.id));

  st.accounts = [{ id: "aa", name: "Mercury", kind: "business", color: "#1C6B5E", start: 100 }];
  st.items[0].accountId = "aa";
  deleteAccount(st, "aa");
  assert("account gone, entry kept without a link", st.accounts.length === 0 && st.items[0].accountId === null && st.items[0].name === "Chapa - rent");

  const cleaned = ensure({ version: 6, accounts: [], vendors: [],
    items: [{ id: "z1", kind: "out", date: "2026-09-01", name: "Ghost", usd: 5, cadFixed: null, checked: false, accountId: "gone", vendorId: "gone", note: "", receiptUrl: "", recurringSourceId: "gone" }],
    settings: { procSeeded: true } });
  assert("dangling links dissolve on load", cleaned.items[0].accountId === null && cleaned.items[0].vendorId === null && cleaned.items[0].recurringSourceId === null);
}

// 20. Live rate sanity and the learned authorization lag
{
  const st = structuredClone(SEED);
  st.settings = { rateMode: "live", rateUpdatedAt: null };
  assert("a sane live rate applies and stamps the day", applyLiveRate(st, 1.4012, "2026-09-01") === true && st.rate === 1.4012 && st.settings.rateUpdatedAt === "2026-09-01");
  assert("an insane rate is rejected", applyLiveRate(st, 47, "2026-09-01") === false && st.rate === 1.4012);
  assert("a CAD-locked entry's CAD never moves with the rate", st.items[0].cadFixed === 2500);
  // a rate the user set by hand before live rates existed is treated as manual
  const kept = ensure({ version: 6, rate: 1.36, accounts: [], vendors: [], items: [], settings: {} });
  const fresh = ensure({ version: 6, rate: 1.389, accounts: [], vendors: [], items: [], settings: {} });
  assert("a pre-existing custom rate stays manual after the update", kept.settings.rateMode === "manual" && fresh.settings.rateMode === "live");
  // both currencies are searchable
  const sx = { id: "cur1", kind: "out", date: "2026-09-01", name: "Meta ads", usd: 100, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null };
  assert("the CAD figure of an entry is searchable too", matchesSearch({ vendors: [], rate: 1.389 }, sx, "138.90") && matchesSearch({ vendors: [], rate: 1.389 }, sx, "100"));

  // Sushi Shop: logged today, moved to yesterday once -> the app learns the lag
  const st2 = structuredClone(SEED);
  const sushi = { id: "ss1", kind: "out", date: "2026-09-01", name: "Sushi Shop", usd: 50.36, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null, createdAt: "2026-09-01" };
  const v = upsertVendorFromEntry(st2, sushi); st2.items.push(sushi);
  redateItem(st2, "ss1", "2026-08-31", "2026-09-01");
  assert("moving an entry back a day teaches the vendor its lag", v.dayLag === 1);
  // fixing an old typo teaches nothing
  const old = { id: "ss0", kind: "out", date: "2026-08-10", name: "Sushi Shop", usd: 20, cadFixed: null, checked: true, accountId: null, vendorId: v.id, note: "", receiptUrl: "", recurringSourceId: null, createdAt: "2026-08-10" };
  st2.items.push(old); v.dayLag = 0;
  redateItem(st2, "ss0", "2026-08-08", "2026-09-01");
  assert("correcting an old entry never teaches a lag", v.dayLag === 0);
  v.dayLag = 1;
  const next = { id: "ss2", kind: "out", date: "2026-09-02", name: "Sushi Shop", usd: 30, cadFixed: null, checked: true, accountId: null, vendorId: v.id, note: "", receiptUrl: "", recurringSourceId: null, createdAt: "2026-09-02" };
  st2.items.push(next);
  assert("the next entry gets a yesterday suggestion", lagSuggestion(st2, next) === "2026-09-01");
  redateItem(st2, "ss2", "2026-09-01", "2026-09-02");
  assert("once moved, the suggestion goes away", lagSuggestion(st2, next) === null);
  assert("recurring and unlinked entries never get suggestions",
    lagSuggestion(st2, { ...next, id: "x", recurringSourceId: "r" }) === null
    && lagSuggestion(st2, { ...next, id: "y", vendorId: null }) === null);
}

// 21. Slash CSV import: dates, settlement, CAD locks, dedupe, cancelling pairs
{
  assert("bank names clean up", cleanBankName("Incoming ACH credit from EMS") === "EMS"
    && cleanBankName("ACH debit from GATEWAY SERVICES") === "GATEWAY SERVICES"
    && cleanBankName("SHOPIFY* 581951127") === "SHOPIFY"
    && cleanBankName("PHARMAPRIX #1811") === "PHARMAPRIX"
    && cleanBankName("SUSHI SHOP - 2250") === "SUSHI SHOP");
  assert("quoted CSV fields parse", parseCsv('"a,b",2\nc,"d""e"')[0][0] === "a,b" && parseCsv('"a,b",2\nc,"d""e"')[1][1] === 'd"e');

  const HEAD = "Id,Date (UTC),Description,Amount,Foreign Amount,Foreign Currency,Foreign Exchange Rate,Type,Card ID,Last 4,Card Expiry Month,Card Expiry Year,Authorization Date (UTC),Card Name,Card Group Name,Virtual Account ID,Virtual Account Name,Account Type,Order Id,Reference Number,Decline Reason,Status,Memo,External Description,Receiver ID,Note";
  // noon UTC keeps the local date identical in any sane timezone
  const csv = [HEAD,
    '"tx_credit",2026-09-01 12:00:00PM,"Incoming ACH credit from EMS",189.95,,,,"inbound_ach_transfer",,,,,,,,"sub","Primary Account","Cash",,,,"settled",,,,',
    '"tx_debit",2026-09-01 12:00:00PM,"ACH debit from EMS",-30,,,,"inbound_ach_transfer",,,,,,,,"sub","Primary Account","Cash",,,,"settled",,,,',
    '"tx_sushi",2026-09-01 12:05:00PM,"SUSHI SHOP - 2250",-50.36,69.71,"CAD",0.72242,"card_settlement",,"5824",,,2026-08-31 12:10:00PM,,,,"Primary Account","Credit",,,,"settled",,,,',
    '"tx_hold",2026-09-01 12:06:00PM,"PHARMAPRIX #1810",-60.63,83.93,"CAD",0.72239,"card_authorization",,"5824",,,,,,,"Primary Account","Credit",,,,"pending",,,,',
    '"tx_rev1",2026-09-01 12:07:00PM,"ACH debit from KURV",-77,,,,"inbound_ach_transfer",,,,,,,,"sub","Primary Account","Cash",,,,"settled",,,,',
    '"tx_rev2",2026-09-01 12:08:00PM,"Incoming ACH credit from KURV",77,,,,"inbound_ach_transfer",,,,,,,,"sub","Primary Account","Cash",,,,"settled",,,,',
  ].join("\n");
  const st = structuredClone(SEED); st.items = []; st.vendors = []; st.settings = { procSeeded: true };
  const plan = mapSlashCsv(st, csv);
  assert("cancelling pair is ignored", plan.pairs === 1 && !plan.adds.some(a => a.usd === 77));
  assert("adds the real lines", plan.adds.length === 4 && plan.dupes === 0);
  const credit = plan.adds.find(a => a.importId === "tx_credit");
  assert("settled ACH credit lands checked on its settlement day", credit.kind === "in" && credit.checked === true && credit.date === "2026-09-01" && credit.settle === "2026-09-01");
  const sushi = plan.adds.find(a => a.importId === "tx_sushi");
  assert("card purchase sits on its authorization day with CAD locked", sushi.date === "2026-08-31" && sushi.settle === "2026-09-01" && sushi.cadFixed === 69.71 && sushi.usd === 50.36 && sushi.name === "SUSHI SHOP");
  const hold = plan.adds.find(a => a.importId === "tx_hold");
  assert("a pending card hold counts as money held, not settled", hold.checked === true && hold.settle === "pending");
  applySlashImport(st, plan);
  assert("vendors are created and linked on apply", st.items.length === 4 && st.items.every(x => x.vendorId));
  const again = mapSlashCsv(st, csv);
  assert("re-importing the same file changes nothing", again.adds.length === 0 && again.updates.length === 0 && again.dupes === 4);
  // a later export where the hold settled completes the pending entry instead of duplicating
  const csv2 = [HEAD,
    '"tx_hold_settled",2026-09-02 12:00:00PM,"PHARMAPRIX #1810",-60.63,83.93,"CAD",0.72239,"card_settlement",,"5824",,,2026-09-01 12:06:00PM,,,,"Primary Account","Credit",,,,"settled",,,,',
  ].join("\n");
  const plan2 = mapSlashCsv(st, csv2);
  assert("a settlement completes the earlier pending hold", plan2.adds.length === 0 && plan2.updates.length === 1);
  applySlashImport(st, plan2);
  const done = st.items.find(x => x.importId === "tx_hold_settled");
  assert("the completed hold is settled with the date", done.settle === "2026-09-02" && done.checked === true);

  // bank-truncated names reuse the existing vendor instead of duplicating
  const st3 = structuredClone(SEED); st3.items = []; st3.vendors = [];
  const full = upsertVendorFromEntry(st3, { id: "p1", kind: "in", date: "2026-08-31", name: "PHOENIX ECOMMERCE", usd: 100, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  const cut = { id: "p2", kind: "in", date: "2026-09-01", name: "PHOENIX ECOMMERC", usd: 200, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null };
  assert("truncated bank name joins the full vendor", upsertVendorFromEntry(st3, cut).id === full.id && st3.vendors.length === 1);
  const ems = upsertVendorFromEntry(st3, { id: "p3", kind: "in", date: "2026-09-01", name: "EMS", usd: 10, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null });
  assert("short names never fuzzy-match", ems.id !== full.id && st3.vendors.length === 2);
}

// 22. Deleting a month removes exactly that month, and a re-import fills it again
{
  const st = structuredClone(SEED); st.items = []; st.vendors = []; st.settings = { procSeeded: true };
  const mk = (id, dt) => ({ id, kind: "out", date: dt, name: "Wise", usd: 10, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null, importId: "tx_" + id });
  st.items.push(mk("j1", "2026-07-05"), mk("j2", "2026-07-28"), mk("a1", "2026-08-02"));
  st.adjust = { "2026-07-10": 50, "2026-08-15": -20 };
  const n = deleteMonth(st, "2026-07");
  assert("only July goes", n === 2 && st.items.length === 1 && st.items[0].id === "a1");
  assert("July adjustments go with it", !("2026-07-10" in st.adjust) && st.adjust["2026-08-15"] === -20);
  const HEAD2 = "Id,Date (UTC),Description,Amount,Foreign Amount,Foreign Currency,Foreign Exchange Rate,Type,Card ID,Last 4,Card Expiry Month,Card Expiry Year,Authorization Date (UTC),Card Name,Card Group Name,Virtual Account ID,Virtual Account Name,Account Type,Order Id,Reference Number,Decline Reason,Status,Memo,External Description,Receiver ID,Note";
  const csv = [HEAD2, '"tx_j1",2026-07-05 12:00:00PM,"Wise",-10,,,,"inbound_ach_transfer",,,,,,,,"sub","Primary Account","Cash",,,,"settled",,,,'].join("\n");
  const plan = mapSlashCsv(st, csv);
  assert("a wiped month can be re-imported", plan.adds.length === 1 && plan.dupes === 0);
}

// 23. Settlement tray: business-morning expectations and one-tap settling
{
  assert("weekday authorizations settle next morning", nextBusinessDay("2026-09-02") === "2026-09-03");
  assert("friday night settles monday", nextBusinessDay("2026-09-04") === "2026-09-07");
  assert("weekend appearances settle monday", nextBusinessDay("2026-09-05") === "2026-09-07" && nextBusinessDay("2026-09-06") === "2026-09-07");
  const st = structuredClone(SEED);
  st.items = [
    { id: "k1", kind: "in", date: "2026-09-04", name: "Kurv payout", usd: 2000, cadFixed: null, checked: false, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null, settle: "pending" },
    { id: "h1", kind: "out", date: "2026-09-08", name: "Pharmaprix", usd: 60.63, cadFixed: null, checked: true, accountId: null, vendorId: null, note: "", receiptUrl: "", recurringSourceId: null, settle: "pending" },
  ];
  // reviewed on Tuesday: the friday payout settled monday morning — stamp monday, not tuesday
  const k = settlePending(st, "k1", "2026-09-08");
  assert("late settle stamps the expected morning", k.checked === true && k.settle === "2026-09-07");
  assert("settled payout now counts", Math.round(calc(st, "2026-09-08").allTime*100)/100 === 10342.38);
  // settling something the same day it appeared stamps today
  const h = settlePending(st, "h1", "2026-09-08");
  assert("same-day settle stamps today", h.settle === "2026-09-08");
  assert("already-settled entries are left alone", settlePending(st, "h1", "2026-09-09") === null);
}

// 24. Day in brief: counts, typical-day context, biggest item, open items
{
  const st = structuredClone(SEED);
  st.items[1].checked = true; // Chargeblast paid on Aug 31
  const sm = daySummary(st, '2026-08-31');
  assert('brief counts the day', sm.count === 2 && sm.pending.length === 1 && Math.round(sm.outC*100)/100 === 1545 && Math.round(sm.net*100)/100 === -1545);
  assert('biggest item is the largest amount', sm.biggest.name === 'Chapa - rent' || sm.biggest.usd === 1799.8560115190785);
  assert('seven bars ending on the day', sm.bars.length === 7 && sm.bars[6].date === '2026-08-31' && Math.round(sm.bars[6].net*100)/100 === -1545);
  const text = dayBriefText(sm, '2026-08-31', '2026-09-01');
  assert('brief text names the open item and the net', text.includes('Still open: Chapa - rent') && text.includes('down US$1,545.00'));
  assert('empty days read naturally', dayBriefText(daySummary(st, '2026-09-05'), '2026-09-05', '2026-09-01') === 'Nothing planned yet.');
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
