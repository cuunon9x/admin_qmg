# QMG Admin API

## Local run

1. Copy env:
   - `cp .env.example .env`
2. Install:
   - `npm install`
3. Run:
   - `npm run dev`

Default API: `http://localhost:3001`

## Render deployment

- Runtime: `Node`
- Build command: `npm install`
- Start command: `npm start`
- Root Directory: `server`

Environment variables:
- `PORT` (Render set automatically)
- `CORS_ORIGIN` (ex: `https://your-frontend-domain.com`)
- `ADMIN_API_KEY` (optional but recommended; require `x-admin-api-key` on `/api/*`)
- `DATABASE_URL` (Postgres connection string)
- `DB_SSL` (`true` on Render/Supabase/Neon)
- `CLOUDINARY_URL` (recommended, single variable)
  - or use `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`
- `CLOUDINARY_FOLDER` (default `qmg/products`)
- `API_RATE_LIMIT_WINDOW_MS` (default `60000`)
- `API_RATE_LIMIT_MAX` (default `120`)
- `UPLOAD_RATE_LIMIT_WINDOW_MS` (default `60000`)
- `UPLOAD_RATE_LIMIT_MAX` (default `10`)

## Important note

This server now uses Postgres for products/categories and Cloudinary for images.
No local file persistence is required on Render.

## Quick setup checklist

1. Create Postgres project (Supabase or Neon) and copy `DATABASE_URL`.
2. Create Cloudinary account and copy API credentials.
3. Add all env vars on Render service.
4. Set frontend env:
   - `VITE_API_URL=https://admin-qmg.onrender.com`
   - `VITE_ADMIN_API_KEY=<same-as-ADMIN_API_KEY>`

## Health check

- `GET /api/health` (public, no API key) to verify server + DB are up.

## Seed data from existing JSON

From `server/` run:

- `npm run seed`

Default seed sources:
- `../src/data/products.json`
- `../src/data/categories.json`

Optional overrides via env:
- `SEED_PRODUCTS_PATH=relative/path/to/products.json`
- `SEED_CATEGORIES_PATH=relative/path/to/categories.json`
