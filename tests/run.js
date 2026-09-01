const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const { SEED, migrate, calc } = require(path.join(root, "app.js"));

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
