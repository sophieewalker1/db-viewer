import express from 'express'
import cors from 'cors'
import { assertDatabase, assertServer, getDatabases, getPool, getServers, sql } from './db.js'
import { buildTableDefinition } from './tableDef.js'
import { buildComparison, getComparable } from './compare.js'
import { exportDatabase, exportHeader } from './export.js'
import { loadExclusions, sanitizeExclusions, saveExclusions } from './exportExclusions.js'

const app = express()
const PORT = parseInt(process.env.PORT || '3001', 10)

const PROC_TYPES = ['P', 'FN', 'IF', 'TF', 'TR']

app.use(cors())
app.use(express.json())

function parseServer(req) {
  const server = req.query.server || getServers()[0]?.id
  if (!server) {
    throw new Error('No SQL Server configured. Check your .env file.')
  }
  return assertServer(server)
}

function parseDatabase(req) {
  const database = req.query.database || getDatabases()[0]
  return assertDatabase(database)
}

function validateIdentifier(value, label) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
}

function groupObjects(rows) {
  const tables = []
  const procedures = []
  const views = []

  for (const row of rows) {
    const type = String(row.type ?? '').trim()
    const item = {
      schema: row.schema,
      name: row.name,
      type,
      typeDesc: row.typeDesc,
    }
    if (type === 'U') tables.push(item)
    else if (type === 'V') views.push(item)
    else if (PROC_TYPES.includes(type)) procedures.push(item)
  }

  const sort = (a, b) =>
    a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name)

  tables.sort(sort)
  procedures.sort(sort)
  views.sort(sort)

  return [
    { id: 'tables', label: 'Tables', items: tables },
    { id: 'procedures', label: 'Stored Procedures', items: procedures },
    { id: 'views', label: 'Views', items: views },
  ]
}

app.get('/api/servers', (_req, res) => {
  try {
    res.json({ servers: getServers() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/databases', (_req, res) => {
  try {
    res.json({ databases: getDatabases() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/health', async (req, res) => {
  try {
    const server = parseServer(req)
    const database = parseDatabase(req)
    const pool = await getPool(server, database)
    const result = await pool.request().query('SELECT DB_NAME() AS databaseName')
    res.json({
      ok: true,
      server,
      database: result.recordset[0]?.databaseName ?? database,
    })
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    })
  }
})

app.get('/api/objects', async (req, res) => {
  try {
    const server = parseServer(req)
    const database = parseDatabase(req)
    const pool = await getPool(server, database)

    const tables = await pool.request().query(`
      SELECT
        s.name AS [schema],
        t.name AS [name],
        'U' AS [type],
        'USER_TABLE' AS [typeDesc]
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE t.is_ms_shipped = 0
    `)

    const code = await pool.request().query(`
      SELECT
        s.name AS [schema],
        o.name AS [name],
        RTRIM(o.type) AS [type],
        o.type_desc AS [typeDesc]
      FROM sys.objects o
      INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
      WHERE o.type IN ('P', 'V', 'FN', 'IF', 'TF', 'TR')
        AND o.is_ms_shipped = 0
    `)

    const all = [...tables.recordset, ...code.recordset]
    res.json({ server, database, groups: groupObjects(all) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/compare', async (req, res) => {
  try {
    const servers = getServers()
    const dev = servers.find((s) => s.id === 'dev')
    const prod = servers.find((s) => s.id === 'prod')

    if (!dev || !prod) {
      throw new Error('Compare needs both Dev and Prod servers configured in .env')
    }

    const database = parseDatabase(req)

    const [devPool, prodPool] = await Promise.all([
      getPool(dev.id, database),
      getPool(prod.id, database),
    ])

    const [devMap, prodMap] = await Promise.all([
      getComparable(devPool),
      getComparable(prodPool),
    ])

    res.json({
      database,
      dev,
      prod,
      groups: buildComparison(devMap, prodMap),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/export/exclusions', async (_req, res) => {
  try {
    res.json(await loadExclusions())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/export/exclusions', async (req, res) => {
  try {
    res.json(await saveExclusions(req.body))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/export', async (req, res) => {
  try {
    const server = assertServer(req.body?.server)
    const label = getServers().find((s) => s.id === server)?.label ?? server
    const { excludedDatabases, excludedObjects } = sanitizeExclusions(req.body?.exclusions)
    const databases = getDatabases().filter((db) => !excludedDatabases.includes(db))

    if (!databases.length) {
      return res.status(400).json({ error: 'No databases selected for export.' })
    }

    const sections = []
    for (const database of databases) {
      try {
        const pool = await getPool(server, database)
        sections.push(await exportDatabase(pool, database, excludedObjects[database]))
      } catch (err) {
        throw new Error(`${database}: ${err.message}`, { cause: err })
      }
    }

    const partial =
      excludedDatabases.length > 0 ||
      databases.some((db) => excludedObjects[db]?.length)
    const text = [exportHeader(label, databases, partial), ...sections.map((s) => s.text)].join(
      '\n',
    )
    const stamp = new Date().toISOString().slice(0, 10)

    res.json({
      filename: `schema-${server}-${stamp}.md`,
      text,
      counts: sections.reduce(
        (sum, s) => ({ tables: sum.tables + s.counts.tables, code: sum.code + s.counts.code }),
        { tables: 0, code: 0 },
      ),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/tables/:schema/:name/definition', async (req, res) => {
  const { schema, name } = req.params

  try {
    validateIdentifier(schema, 'schema')
    validateIdentifier(name, 'table name')
    const server = parseServer(req)
    const database = parseDatabase(req)
    const pool = await getPool(server, database)
    const definition = await buildTableDefinition(pool, schema, name)

    if (definition === null) {
      return res.status(404).json({ error: 'Table not found' })
    }

    res.json({
      server,
      database,
      schema,
      name,
      typeDesc: 'USER_TABLE',
      definition,
      encrypted: false,
    })
  } catch (err) {
    const status = err.message.startsWith('Invalid') ? 400 : 500
    res.status(status).json({ error: err.message })
  }
})

app.get('/api/objects/:schema/:name/definition', async (req, res) => {
  const { schema, name } = req.params

  try {
    validateIdentifier(schema, 'schema')
    validateIdentifier(name, 'object name')
    const server = parseServer(req)
    const database = parseDatabase(req)
    const pool = await getPool(server, database)

    const found = await pool
      .request()
      .input('schema', sql.NVarChar, schema)
      .input('name', sql.NVarChar, name)
      .query(`
        SELECT o.object_id, o.type_desc AS typeDesc
        FROM sys.objects o
        INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
        WHERE s.name = @schema AND o.name = @name
          AND o.type IN ('P', 'V', 'FN', 'IF', 'TF', 'TR')
      `)

    if (!found.recordset.length) {
      return res.status(404).json({ error: 'Object not found' })
    }

    const { object_id: objectId, typeDesc } = found.recordset[0]

    const def = await pool
      .request()
      .input('objectId', sql.Int, objectId)
      .query(`
        SELECT definition
        FROM sys.sql_modules
        WHERE object_id = @objectId
      `)

    const definition = def.recordset[0]?.definition ?? null

    res.json({
      server,
      database,
      schema,
      name,
      typeDesc,
      definition,
      encrypted: definition === null,
    })
  } catch (err) {
    const status = err.message.startsWith('Invalid') ? 400 : 500
    res.status(status).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
})
