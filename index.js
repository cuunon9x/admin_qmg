import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(__dirname, process.env.DATA_DIR)
  : path.join(__dirname, 'data')

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(__dirname, process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads', 'products')

const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json')
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json')

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true })
fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, '[]', 'utf8')
if (!fs.existsSync(CATEGORIES_FILE)) fs.writeFileSync(CATEGORIES_FILE, '[]', 'utf8')

const app = express()

app.use(cors({
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN,
}))
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ── Image upload ──────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Chỉ chấp nhận file ảnh'))
  },
})

// ── Routes ────────────────────────────────────────────────────

// GET all products
app.get('/api/products', (_, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'))
    res.json(data)
  } catch {
    res.json([])
  }
})

// PUT overwrite all products (admin saves)
app.put('/api/products', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(req.body, null, 2), 'utf8')
  res.json({ ok: true, count: req.body.length })
})

// POST upload image → saved to public/images/products/
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file' })
  const publicPath = process.env.UPLOAD_PUBLIC_PATH || '/uploads/products'
  res.json({ url: `${publicPath}/${req.file.filename}` })
})

// GET all categories
app.get('/api/categories', (_, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8'))
    res.json(data)
  } catch {
    res.json([])
  }
})

// PUT overwrite all categories
app.put('/api/categories', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' })
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(req.body, null, 2), 'utf8')
  res.json({ ok: true, count: req.body.length })
})

// Error handler
app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message })
})

app.listen(PORT, () => {
  console.log(`\n✅  QMG Admin API  →  http://localhost:${PORT}`)
  console.log(`   CORS origin     →  ${CORS_ORIGIN}`)
  console.log(`   Data dir        →  ${DATA_DIR}`)
  console.log(`   Upload dir      →  ${UPLOAD_DIR}\n`)
})
