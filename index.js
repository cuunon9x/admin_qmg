import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { v2 as cloudinary } from 'cloudinary'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvFile(path.join(__dirname, '.env'))

const PORT = Number(process.env.PORT || 3001)
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ''
const DATABASE_URL = process.env.DATABASE_URL
const CLOUDINARY_URL = process.env.CLOUDINARY_URL
let CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
let CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY
let CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || 'qmg/products'
const UPLOAD_RATE_LIMIT_WINDOW_MS = Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 60_000)
const UPLOAD_RATE_LIMIT_MAX = Number(process.env.UPLOAD_RATE_LIMIT_MAX || 10)

if ((!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) && CLOUDINARY_URL) {
  try {
    const parsed = new URL(CLOUDINARY_URL)
    CLOUDINARY_CLOUD_NAME = parsed.hostname
    CLOUDINARY_API_KEY = decodeURIComponent(parsed.username)
    CLOUDINARY_API_SECRET = decodeURIComponent(parsed.password)
  } catch {
    throw new Error('Invalid CLOUDINARY_URL format')
  }
}

if (!DATABASE_URL) throw new Error('Missing DATABASE_URL in server/.env')
if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  throw new Error('Missing Cloudinary envs. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET')
}

const { Pool } = pg
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
})

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
})

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      slug TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}

const app = express()

app.use(cors({
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN,
}))
app.use(express.json({ limit: '2mb' }))

function requireAdminApiKey(req, res, next) {
  if (!ADMIN_API_KEY) return next()
  const incomingKey = req.headers['x-admin-api-key']
  if (incomingKey !== ADMIN_API_KEY) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ── Image upload ──────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Chỉ chấp nhận file ảnh'))
  },
})

function uploadToCloudinary(fileBuffer, originalName) {
  const ext = path.extname(originalName).replace('.', '') || 'jpg'
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        resource_type: 'image',
        format: ext,
      },
      (err, result) => {
        if (err) reject(err)
        else resolve(result)
      },
    )
    stream.end(fileBuffer)
  })
}

const uploadRateBucket = new Map()

function uploadRateLimit(req, res, next) {
  const now = Date.now()
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown'
  const bucket = uploadRateBucket.get(ip) || []
  const windowStart = now - UPLOAD_RATE_LIMIT_WINDOW_MS
  const recent = bucket.filter((ts) => ts > windowStart)

  if (recent.length >= UPLOAD_RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil((recent[0] + UPLOAD_RATE_LIMIT_WINDOW_MS - now) / 1000)
    res.setHeader('Retry-After', String(Math.max(retryAfterSec, 1)))
    return res.status(429).json({ error: 'Too many uploads, please try again later.' })
  }

  recent.push(now)
  uploadRateBucket.set(ip, recent)
  next()
}

// ── Routes ────────────────────────────────────────────────────

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1')
    res.json({
      ok: true,
      service: 'qmg-admin-api',
      db: 'up',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    next(err)
  }
})

app.use('/api', requireAdminApiKey)

// GET all products
app.get('/api/products', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT data FROM products ORDER BY id ASC')
    res.json(rows.map(r => r.data))
  } catch (err) {
    next(err)
  }
})

// PUT overwrite all products (admin saves)
app.put('/api/products', async (req, res, next) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM products')

    let nextId = 1
    for (const item of req.body) {
      const productId = Number(item?.id) || nextId
      nextId = Math.max(nextId, productId + 1)
      const productData = { ...item, id: productId }
      await client.query(
        `INSERT INTO products (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())`,
        [productId, JSON.stringify(productData)],
      )
    }

    await client.query('COMMIT')
    res.json({ ok: true, count: req.body.length })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

// POST upload image → Cloudinary
app.post('/api/upload', uploadRateLimit, upload.single('image'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file' })
  try {
    const result = await uploadToCloudinary(req.file.buffer, req.file.originalname)
    res.json({ url: result.secure_url, publicId: result.public_id })
  } catch (err) {
    next(err)
  }
})

// GET all categories
app.get('/api/categories', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT data FROM categories ORDER BY slug ASC')
    res.json(rows.map(r => r.data))
  } catch (err) {
    next(err)
  }
})

// PUT overwrite all categories
app.put('/api/categories', async (req, res, next) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM categories')

    for (const item of req.body) {
      const slug = String(item?.slug || '').trim()
      if (!slug) continue
      await client.query(
        `INSERT INTO categories (slug, data, updated_at) VALUES ($1, $2::jsonb, NOW())`,
        [slug, JSON.stringify(item)],
      )
    }

    await client.query('COMMIT')
    res.json({ ok: true, count: req.body.length })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Server error' })
})

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n✅  QMG Admin API  →  http://localhost:${PORT}`)
      console.log(`   CORS origin     →  ${CORS_ORIGIN}`)
      console.log(`   API key guard   →  ${ADMIN_API_KEY ? 'enabled' : 'disabled'}`)
      console.log(`   Upload limit    →  ${UPLOAD_RATE_LIMIT_MAX}/${UPLOAD_RATE_LIMIT_WINDOW_MS}ms`)
      console.log('   Storage         →  Postgres + Cloudinary\n')
    })
  })
  .catch((err) => {
    console.error('Failed to init DB:', err)
    process.exit(1)
  })
