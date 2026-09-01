// Money relay — a tiny Cloudflare Worker that reads your Slash transactions
// with YOUR API key (kept as a Worker secret) and hands them to the Money app.
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
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if ((req.headers.get("Authorization") || "") !== `Bearer ${env.APP_TOKEN}`) return new Response("unauthorized", { status: 401, headers: cors });
    const u = new URL(req.url);
    if (u.pathname !== "/transactions") return new Response("not found", { status: 404, headers: cors });
    const since = u.searchParams.get("since");
    const items = [];
    let cursor = null;
    for (let page = 0; page < 25; page++) {
      const q = new URL("https://api.slash.com/transaction");
      if (since) q.searchParams.set("filter:from_date", since);
      if (cursor) q.searchParams.set("cursor", cursor);
      const r = await fetch(q, { headers: { "X-API-Key": env.SLASH_API_KEY, "Accept": "application/json", "User-Agent": "money-relay/1.0" } });
      if (!r.ok) return new Response(await r.text(), { status: r.status, headers: cors });
      const j = await r.json();
      items.push(...(j.items || []));
      cursor = j.metadata && j.metadata.nextCursor;
      if (!cursor) break;
    }
    return new Response(JSON.stringify({ items }), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  },
};
