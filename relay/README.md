# Money relay — auto-sync from Slash

The app can't call Slash directly from a browser (Slash blocks cross-origin calls), so this
60-line Cloudflare Worker (free) does it, holding your Slash API key as a secret.
The app talks only to the relay, using its own token. Your bank key never touches the app.

## One-time setup (~5 minutes)

1. **Slash API key** — Slash dashboard → Settings → API / Developers → create a key.
   If it offers a read-only scope, choose it. Copy it; you'll paste it into Cloudflare only.
2. **Cloudflare** — free account at dash.cloudflare.com → Workers & Pages → Create → "Hello World".
   Name it `money-relay`, click Edit code, replace everything with `worker.js` from this folder, Deploy.
3. **Secrets** — Worker → Settings → Variables and Secrets:
   - `SLASH_API_KEY` = the key from step 1 (type Secret)
   - `APP_TOKEN` = a long random string you make up (type Secret) — the app will use this
   - `ALLOWED_ORIGINS` = `https://kouvani.github.io,null` (type Text)
   Deploy again. Note the Worker URL, like `https://money-relay.<you>.workers.dev`.
4. **In the app** — Settings → Auto-sync with Slash: paste the Worker URL and your APP_TOKEN → Sync now.

From then on the app pulls new Slash transactions when it opens, when you come back to it, and
every 3 minutes while it's open. Each sync can be undone for 6 seconds. Cards land on their
authorization day, ACH on settlement, CAD locked from Slash's own figures — the CSV import, minus the CSV.

Terminal route instead: `npm i -g wrangler && wrangler login && cd relay && wrangler deploy`, then
`wrangler secret put SLASH_API_KEY` and `wrangler secret put APP_TOKEN`.
