# AZTS Pickleball Tournament Portal

Schedule matches, manage brackets, and track scores for pickleball tournaments.
Hosted entirely on Cloudflare (Pages + Workers + D1).

- **Production Frontend**: https://pickleball-8ky.pages.dev (and `https://azts-pickleball.com`)
- **Production API**: https://aztspickleball-api.senthilponnappan.workers.dev

## Stack

- **Frontend**: React + Vite SPA, deployed to **Cloudflare Pages** (`apps/web`)
- **API**: **Cloudflare Worker** using Hono, deployed via `wrangler` (`apps/api`)
- **Database**: **Cloudflare D1** (SQLite, `pickleball_db`)
- **Auth**: username/password (bcrypt) + "Sign in with Google" (Google Identity Services),
  sessions stored as an HttpOnly JWT cookie

## Project layout

```
apps/
  api/   Cloudflare Worker (Hono API + D1)
  web/   React SPA (Cloudflare Pages)
```

## Prerequisites

- Node.js 20+
- A Cloudflare account (`wrangler login`)
- A Google Cloud project with an OAuth 2.0 Client ID (Web application) for "Sign in with Google"

## 1. Install dependencies

```bash
npm install
```

## 2. Create the D1 database

```bash
cd apps/api
npx wrangler d1 create pickleball_db
```

Copy the returned `database_id` into `apps/api/wrangler.toml` under `[[d1_databases]]`.

Apply the schema:

```bash
npm run db:migrate:local    # for local dev
npm run db:migrate:remote   # for production
```

## 3. Configure API secrets

```bash
cd apps/api
npx wrangler secret put JWT_SECRET        # any long random string
npx wrangler secret put GOOGLE_CLIENT_ID  # from Google Cloud Console OAuth client
```

For local dev, create `apps/api/.dev.vars`:

```
JWT_SECRET=dev-secret-change-me
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Update `APP_URL` in `apps/api/wrangler.toml` to your production frontend URL
(`https://azts-pickleball.com`).

## 4. Run locally

```bash
npm run dev:api    # http://localhost:8787
npm run dev:web    # http://localhost:5173
```

Create `apps/web/.env` (see `.env.example`) pointing `VITE_API_URL` at the API
and `VITE_GOOGLE_CLIENT_ID` at your Google OAuth client id.

## 5. Deploy

```bash
npm run deploy:api    # wrangler deploy (Worker)
npm run deploy:web    # builds and deploys to Cloudflare Pages
```

First-time Pages deploy will prompt to create the `aztspickleball` Pages project.
In the Cloudflare dashboard, set the Pages project's environment variables
(`VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`) for production builds, or pass them at
build time in CI.

After deploying the Worker, note its `*.workers.dev` URL (or bind it to a route/
custom domain in the Cloudflare dashboard under Workers Routes) so the Pages
frontend can reach it.

## 6. Point the IONOS domain at Cloudflare

Since `azts-pickleball.com` is registered at IONOS but should be served by
Cloudflare, use Cloudflare as the authoritative DNS (recommended, not just a
redirect) — this lets Cloudflare route both the API and the Pages site under
one domain with proper SSL:

1. **Add the site to Cloudflare**: Cloudflare dashboard → *Add a site* →
   enter `azts-pickleball.com` → select a plan (Free is fine).
2. Cloudflare scans existing DNS records and gives you **two nameservers**
   (e.g. `ns1.cloudflare.com`, `ns2.cloudflare.com`).
3. **In IONOS**: go to *Domains & SSL* → select `azts-pickleball.com` →
   *DNS* / *Nameservers* → change from IONOS nameservers to the two Cloudflare
   nameservers from step 2. Save.
4. Nameserver propagation typically takes anywhere from a few minutes up to
   24-48 hours. Cloudflare emails you once the domain is active.
5. **In Cloudflare DNS**, add records once the zone is active:
   - `CNAME  @    <your-pages-project>.pages.dev`  (proxied/orange-clouded) — root domain to the frontend
   - `CNAME  www  <your-pages-project>.pages.dev`  (proxied)
   - `CNAME  api  <your-worker-subdomain>.workers.dev` (proxied) — or add a
     Worker Route instead (see below)
6. In the Pages project settings → *Custom domains*, add `azts-pickleball.com`
   and `www.azts-pickleball.com` so Cloudflare issues certificates and routes
   traffic to your Pages deployment.
7. For the API, either:
   - Add a **Custom Domain** to the Worker (Workers & Pages → your Worker →
     Settings → Domains & Routes → Add `api.azts-pickleball.com`), or
   - Add a **Route** like `api.azts-pickleball.com/*` bound to the Worker.
   Then set `VITE_API_URL=https://api.azts-pickleball.com` for the frontend
   build, and `APP_URL=https://azts-pickleball.com` as the Worker's CORS origin.
8. In Google Cloud Console, add `https://azts-pickleball.com` (and
   `https://www.azts-pickleball.com`) to the OAuth client's **Authorized
   JavaScript origins**.

This gives you `azts-pickleball.com` fully served from Cloudflare (Pages +
Worker), with IONOS only handling registration/renewal of the domain name.

## Tournament formats

- **Single elimination** — fully auto-advancing bracket.
- **Round robin** — every team plays every team once; standings computed
  from wins/losses and point differential.
- **Pool play** — teams split into pools (round robin within each pool);
  generate a follow-up single-elimination bracket for playoffs once pool
  play concludes.
- **Double elimination** — winners bracket auto-advances; because correctly
  auto-wiring "loser drops into the losers bracket" for uneven bracket sizes
  is easy to get subtly wrong, that placement is a manual step for organizers
  (assign the dropped team via the match editor) while all other advancement
  is automatic.
