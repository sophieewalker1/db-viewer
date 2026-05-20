import express from 'express'
import cors from 'cors'
import { assertDatabase, getDatabases, getPool, sql } from './db.js'
import { buildTableDefinition } from './tableDef.js'

const app = express()
const PORT = parseInt(process.env.PORT || '3001', 10)

const PROC_TYPES = ['P', 'FN', 'IF', 'TF', 'TR']

app.use(cors())
app.use(express.json())

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

app.get('/api/databases', (_req, res) => {
  try {
    res.json({ databases: getDatabases() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/health', async (req, res) => {
  try {
    const database = parseDatabase(req)
    const pool = await getPool(database)
    const result = await pool.request().query('SELECT DB_NAME() AS databaseName')
    res.json({
      ok: true,
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
    const database = parseDatabase(req)
    const pool = await getPool(database)

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
    res.json({ database, groups: groupObjects(all) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/tables/:schema/:name/definition', async (req, res) => {
  const { schema, name } = req.params

  try {
    validateIdentifier(schema, 'schema')
    validateIdentifier(name, 'table name')
    const database = parseDatabase(req)
    const pool = await getPool(database)
    const definition = await buildTableDefinition(pool, schema, name)

    if (definition === null) {
      return res.status(404).json({ error: 'Table not found' })
    }

    res.json({
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
    const database = parseDatabase(req)
    const pool = await getPool(database)

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
