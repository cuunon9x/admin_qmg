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
- `DATA_DIR` (default `./data`)
- `UPLOAD_DIR` (default `./uploads/products`)
- `UPLOAD_PUBLIC_PATH` (default `/uploads/products`)

## Important note

Filesystem on Render may be ephemeral on restart/redeploy.
For production, use a real database + cloud object storage for images.
