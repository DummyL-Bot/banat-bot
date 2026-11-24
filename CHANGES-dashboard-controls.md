# Dashboard Controls update

Bagong tab sa dashboard: **Commands & GC**

1. **Command Toggles** — Banat ON / OFF / Toggle / Status / Help mula sa dashboard.
   Ang switch na "Pwede sa Messenger?" ay naka-OFF by default, kaya hindi na sasagot
   ang bot kapag may nag-type ng `!banat ...` sa Messenger.
2. **GC Auto Lock** — ilagay ang pangalan ng GC (o thread ID). Ang GC na iyon lang
   ang sasagutin ng bot. Habang hindi pa nakikita ang GC, walang sasagutin ang bot.
3. **Auto Change GC Name** — papalitan ang pangalan ng naka-lock na GC every 2 minutes
   (pwedeng baguhin). Dalawang mode: naming pattern (`{name}`, `{n}`, `{time}`, `{date}`)
   o rotation list.

Naka-save ang settings sa `banat-config.json` (o sa path na nasa `BANAT_CONFIG_PATH`).

Mga binago/bagong file:
- `bot/bot-config.js` (bago) — settings at rules
- `bot/bot-config.test.js` (bago) — tests (`npm test`)
- `bot/index.js` — gumagamit na ng dashboard settings
- `bot/dashboard-api.js` — bagong `/api/dashboard/controls/*` at `/api/dashboard/threads`
- `server.ts` — ikinabit ang bagong controls
- `src/components/CommandControls.tsx` (bago), `Dashboard.tsx`, `BotGuide.tsx`, `RepoExplorer.tsx`
- `src/api.ts`, `src/types.ts`, `package.json` (test script), `.gitignore`
