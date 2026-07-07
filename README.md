# Oura Signal Lab

Local-first Oura Ring data ingestion and recovery analytics.

## Run

```bash
npm install
npm run dev
npm run check
```

Open `http://127.0.0.1:5173/`.

## Inputs

- Oura Trends CSV exports
- Oura API JSON exports
- Optional Oura OAuth code-flow sync through Vercel Functions

## Vercel Deployment

1. Import `loross14/oura-farm` in Vercel.
2. Use the Vite framework preset.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Add environment variables:
   - `VITE_OURA_CLIENT_ID`
   - `OURA_CLIENT_ID`
   - `OURA_CLIENT_SECRET`
6. In the Oura developer portal, add the production redirect URI:
   - `https://YOUR_DOMAIN/`

Preview deployments need their own redirect URI if OAuth is tested outside production.

## Production Notes

- `/api/oura-token` exchanges Oura authorization codes server-side so the client secret is never shipped to browsers.
- `/api/oura-sync` proxies Oura API reads with `Cache-Control: no-store`.
- `/api/health` is a no-data smoke-test endpoint.
- The app does not create accounts or persist raw Oura data.
- This is not medical advice; production onboarding should say that clearly.

## Data Boundary

Raw Oura data is parsed in the browser session. The app only exposes an aggregate contribution pack when the user enables both aggregate research and commercial license consent.
