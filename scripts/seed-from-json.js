import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SERVER_DIR = path.resolve(__dirname, '..')
const ROOT_DIR = path.resolve(SERVER_DIR, '..')

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

loadEnvFile(path.join(SERVER_DIR, '.env'))

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('Missing DATABASE_URL. Create server/.env first.')
}

const sourceProductsPath = process.env.SEED_PRODUCTS_PATH
  ? path.resolve(ROOT_DIR, process.env.SEED_PRODUCTS_PATH)
  : path.join(ROOT_DIR, 'src', 'data', 'products.json')

const sourceCategoriesPath = process.env.SEED_CATEGORIES_PATH
  ? path.resolve(ROOT_DIR, process.env.SEED_CATEGORIES_PATH)
  : path.join(ROOT_DIR, 'src', 'data', 'categories.json')

function readJsonArray(filePath, name) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${name} file: ${filePath}`)
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!Array.isArray(content)) throw new Error(`${name} must be an array`)
  return content
}

async function main() {
  const products = readJsonArray(sourceProductsPath, 'products')
  const categories = readJsonArray(sourceCategoriesPath, 'categories')

  const { Pool } = pg
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        slug TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    await client.query('DELETE FROM products')
    await client.query('DELETE FROM categories')

    let nextId = 1
    for (const item of products) {
      const productId = Number(item?.id) || nextId
      nextId = Math.max(nextId, productId + 1)
      const productData = { ...item, id: productId }
      await client.query(
        `INSERT INTO products (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())`,
        [productId, JSON.stringify(productData)],
      )
    }

    for (const item of categories) {
      const slug = String(item?.slug || '').trim()
      if (!slug) continue
      await client.query(
        `INSERT INTO categories (slug, data, updated_at) VALUES ($1, $2::jsonb, NOW())`,
        [slug, JSON.stringify(item)],
      )
    }

    await client.query('COMMIT')
    console.log(`Seeded ${products.length} products and ${categories.length} categories.`)
    console.log(`Products source: ${sourceProductsPath}`)
    console.log(`Categories source: ${sourceCategoriesPath}`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message)
  process.exit(1)
})
