import sql from 'mssql'
import dotenv from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env') })

const pools = new Map()

// Prod uses the plain MSSQL_* vars, Dev uses the MSSQL_*_LOCAL vars.
const SERVER_PROFILES = [
  { id: 'dev', suffix: '_LOCAL', label: 'Dev' },
  { id: 'prod', suffix: '', label: 'Prod' },
]

function env(base, suffix) {
  return process.env[suffix ? `${base}${suffix}` : base]
}

function readProfileEnv(suffix) {
  const connectionString = env('MSSQL_CONNECTION_STRING', suffix)
  if (connectionString) return { connectionString }

  const server = env('MSSQL_SERVER', suffix)
  const user = env('MSSQL_USER', suffix)
  const password = env('MSSQL_PASSWORD', suffix)
  if (!server || !user || !password) return null

  return {
    server,
    port: parseInt(env('MSSQL_PORT', suffix) || '1433', 10),
    user,
    password,
    encrypt: process.env.MSSQL_ENCRYPT !== 'false',
    trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
  }
}

function getProfile(serverId) {
  const profile = SERVER_PROFILES.find((p) => p.id === serverId)
  if (!profile) throw new Error(`Unknown server "${serverId}"`)
  if (!readProfileEnv(profile.suffix)) {
    throw new Error(`Server "${serverId}" is not configured in .env`)
  }
  return profile
}

export function getServers() {
  return SERVER_PROFILES.filter((p) => readProfileEnv(p.suffix)).map((p) => ({
    id: p.id,
    label: p.label,
  }))
}

export function assertServer(serverId) {
  getProfile(serverId)
  return serverId
}

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

function getConfig(serverId, database) {
  const { suffix } = getProfile(serverId)
  const cfg = readProfileEnv(suffix)

  if (cfg.connectionString) {
    const base = cfg.connectionString
    if (base.includes('Database=')) {
      return base.replace(/Database=[^;]*/i, `Database=${database}`)
    }
    return `${base};Database=${database}`
  }

  return {
    server: cfg.server,
    port: cfg.port,
    database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: cfg.encrypt,
      trustServerCertificate: cfg.trustServerCertificate,
    },
  }
}

export async function getPool(serverId, database) {
  const server = assertServer(serverId)
  const db = assertDatabase(database)
  const key = `${server}:${db}`

  if (!pools.has(key)) {
    const pool = new sql.ConnectionPool(getConfig(server, db))
    await pool.connect()
    pools.set(key, pool)
  }
  return pools.get(key)
}

export async function closePools() {
  for (const pool of pools.values()) {
    await pool.close()
  }
  pools.clear()
}

export { sql }
