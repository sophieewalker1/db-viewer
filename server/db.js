import sql from 'mssql'
import dotenv from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env') })

const pools = new Map()

export function getDatabases() {
  const list = process.env.MSSQL_DATABASES || process.env.MSSQL_DATABASE
  if (!list) {
    throw new Error('Set MSSQL_DATABASE or MSSQL_DATABASES in .env')
  }
  return list.split(',').map((d) => d.trim()).filter(Boolean)
}

export function assertDatabase(database) {
  const allowed = getDatabases()
  if (!allowed.includes(database)) {
    throw new Error(`Unknown database "${database}". Allowed: ${allowed.join(', ')}`)
  }
  return database
}

function getConfig(database) {
  if (process.env.MSSQL_CONNECTION_STRING) {
    const base = process.env.MSSQL_CONNECTION_STRING
    if (base.includes('Database=')) {
      return base.replace(/Database=[^;]*/i, `Database=${database}`)
    }
    return `${base};Database=${database}`
  }

  const server = process.env.MSSQL_SERVER
  const user = process.env.MSSQL_USER
  const password = process.env.MSSQL_PASSWORD

  if (!server || !user || !password) {
    throw new Error(
      'Missing MSSQL env vars. Set MSSQL_SERVER, MSSQL_USER, MSSQL_PASSWORD (or MSSQL_CONNECTION_STRING).',
    )
  }

  return {
    server,
    port: parseInt(process.env.MSSQL_PORT || '1433', 10),
    database,
    user,
    password,
    options: {
      encrypt: process.env.MSSQL_ENCRYPT !== 'false',
      trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
    },
  }
}

export async function getPool(database) {
  const db = assertDatabase(database)
  if (!pools.has(db)) {
    const pool = new sql.ConnectionPool(getConfig(db))
    await pool.connect()
    pools.set(db, pool)
  }
  return pools.get(db)
}

export async function closePools() {
  for (const pool of pools.values()) {
    await pool.close()
  }
  pools.clear()
}

export { sql }
