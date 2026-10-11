# Deployment

This repository contains two deployable pieces that can be hosted by the same Vercel project:

- **Checker backend:** `api/check.js`, a Vercel serverless function.
- **Marketplace frontend:** `index.html` and `down-detector.html`, static files served by Vercel, GitHub Pages, or any static host.

## Index

- [Prerequisites](#prerequisites)
- [Deploy locally](#deploy-locally)
- [Deploy the checker backend and frontend to Vercel](#deploy-the-checker-backend-and-frontend-to-vercel)
- [Deploy the marketplace frontend to GitHub Pages](#deploy-the-marketplace-frontend-to-github-pages)
- [Configure ignored extensions](#configure-ignored-extensions)
- [Updating the deployment](#updating-the-deployment)

## Prerequisites

- Node.js 20 or newer
- npm
- A Vercel account for the checker API
- A GitHub repository with Pages enabled if deploying the static marketplace through GitHub Pages

Install the backend dependencies from the repository root:

```bash
npm ci
```

## Deploy locally

### Run the complete application locally

To run both the static frontend and the serverless checker API together, use Vercel's local development server from the repository root:

```bash
npx vercel dev
```

Open the local URL printed by Vercel, usually:

```text
http://localhost:3000/
http://localhost:3000/marketplace
http://localhost:3000/detector
```

The detector uses the local same-origin `/api/check` endpoint when it is served by `vercel dev`. The first run may ask you to log in or link the directory to a Vercel project. Linking is only local CLI configuration and does not deploy or publish the repository.

### Run the static frontend only

For a frontend-only smoke test, serve the repository root with Python:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/` or `http://localhost:8080/marketplace`. This verifies static pages and marketplace asset loading. The detector's same-origin API request requires `vercel dev`; use the complete application instructions above for local checker tests.

## Deploy the checker backend and frontend to Vercel

From the repository root:

```bash
npx vercel login
npx vercel link
npx vercel deploy --prod
```

`vercel.json` configures `api/check.js` with a 60-second maximum duration and maps these frontend routes:

- `/` → `index.html` (Vercel's default root static file)
- `/marketplace` → `index.html`
- `/detector` → `down-detector.html`

No environment variables are required by the current implementation. The function reads the catalog and ignore configuration from the repository's raw GitHub URLs.

After deployment, the Vercel frontend is available at:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/
https://YOUR-VERCEL-DOMAIN.vercel.app/marketplace
https://YOUR-VERCEL-DOMAIN.vercel.app/detector
```

After deployment, verify the endpoint responds to `OPTIONS`:

```bash
curl -i -X OPTIONS https://YOUR-VERCEL-DOMAIN.vercel.app/api/check
```

A successful response should have HTTP status `204` and include the CORS headers. Test a small request with:

```bash
curl -sS https://YOUR-VERCEL-DOMAIN.vercel.app/api/check \\
  -H 'content-type: application/json' \\
  --data '{"query":"One Piece","ids":["shiro"]}'
```

## Deploy the marketplace frontend to GitHub Pages

1. Push the repository to GitHub.
2. Open **Settings → Pages** for the repository.
3. Select **Deploy from a branch**.
4. Select the publishing branch and `/ (root)` folder.
5. Save the setting and wait for the Pages deployment.

The marketplace page reads `marketplace/main.json` and `marketplace/ignore-check.json` using relative URLs, so both files must remain in the published repository. The checker page is available at `/down-detector.html`.

When served from GitHub Pages, the detector uses the configured production checker API URL. If deploying a fork with a different API, update `API_URL` near the top of `down-detector.html` before publishing.

## Configure ignored extensions

`marketplace/ignore-check.json` uses a global `ignoreAll` switch and a per-entry `ignore` flag:

```json
{
  "ignoreAll": true,
  "extensions": [
    {
      "id": "animeheaven",
      "ignore": true,
      "reason": "The website blocks shared IPs from hosting platforms such as Vercel."
    }
  ]
}
```

- `ignoreAll: true` skips every configured extension by default.
- `ignoreAll: false` uses each entry's `ignore` value individually.
- `ignore: true` marks an entry as ignored when `ignoreAll` is false.
- `ignore: false` leaves an entry available when `ignoreAll` is false.
- `reason` is displayed in the ignored-extension section and returned with ignored results.

The detector UI exposes a checkbox for every configured entry. Its selection is sent as `ignoreIds` in the request, so individual entries can be enabled or disabled for the current run without editing the file. When `ignoreAll` is true, the UI initially checks every configured entry; when it is false, it initially checks only entries with `ignore: true`.

The API request shape is:

```json
{
  "query": "One Piece",
  "ids": ["shiro", "animeheaven"],
  "ignoreIds": ["animeheaven"]
}
```

If `ignoreIds` is omitted, the backend uses `ignoreAll` and each entry's `ignore` value from `ignore-check.json`. If `ignoreIds` is supplied, only the listed configured entries are skipped. This makes automated checks and the web UI deterministic.

## Updating the deployment

After changing provider code, catalog metadata, `ignore-check.json`, or the frontend:

```bash
git diff --check
npm ci
npx vercel deploy --prod
```

Publish the repository changes so the raw catalog and ignore configuration URLs used by the backend update as well. If only the serverless function changed, redeploy Vercel; if the frontend or JSON configuration changed, republish the static site too.
