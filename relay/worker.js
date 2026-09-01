// Money relay — a tiny Cloudflare Worker that reads your Slash transactions and
// balances with YOUR API key (kept as a Worker secret) and hands them to the Money app.
// Secrets: SLASH_API_KEY (from the Slash dashboard), APP_TOKEN (any long random string).
// Var: ALLOWED_ORIGINS (comma-separated; "null" allows the desktop file:// copy).

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "https://kouvani.github.io,null").split(",").map(s => s.trim());
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if ((req.headers.get("Authorization") || "") !== `Bearer ${env.APP_TOKEN}`) return new Response("unauthorized", { status: 401, headers: cors });
    const slash = async (path) => fetch("https://api.slash.com" + path, { headers: { "X-API-Key": env.SLASH_API_KEY, "Accept": "application/json", "User-Agent": "money-relay/1.0" } });
    const u = new URL(req.url);

    if (u.pathname === "/transactions") {
      const since = u.searchParams.get("since");
      const items = [];
      let cursor = null;
      for (let page = 0; page < 25; page++) {
        const q = new URLSearchParams();
        if (since) q.set("filter:from_date", since);
        if (cursor) q.set("cursor", cursor);
        const r = await slash("/transaction?" + q.toString());
        if (!r.ok) return new Response(await r.text(), { status: r.status, headers: cors });
        const j = await r.json();
        items.push(...(j.items || []));
        cursor = j.metadata && j.metadata.nextCursor;
        if (!cursor) break;
      }
      return json({ items });
    }

    if (u.pathname === "/balance") {
      const ra = await slash("/account");
      if (!ra.ok) return new Response(await ra.text(), { status: ra.status, headers: cors });
      const accounts = ((await ra.json()).items || []).filter(a => a.status !== "closed");
      const out = [];
      let available = 0, posted = 0;
      for (const a of accounts) {
        const rb = await slash(`/account/${a.id}/balance`);
        if (!rb.ok) continue;
        for (const b of ((await rb.json()).balances || [])) {
          const av = (b.available && b.available.amountCents || 0) / 100, po = (b.posted && b.posted.amountCents || 0) / 100;
          out.push({ name: a.name, type: b.type, available: av, posted: po });
          if (b.type !== "credit") { available += av; posted += po; } // a credit limit isn't cash
        }
      }
      return json({ available, posted, accounts: out });
    }

    return new Response("not found", { status: 404, headers: cors });
  },
};
