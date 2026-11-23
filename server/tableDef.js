import { sql } from './db.js'

function quoteIdent(name) {
  return `[${name.replace(/]/g, ']]')}]`
}

export function formatType(row) {
  let type = row.type_name.toUpperCase()
  if (['varchar', 'char', 'varbinary', 'binary'].includes(row.type_name)) {
    const len = row.max_length === -1 ? 'MAX' : row.max_length
    type += `(${len})`
  } else if (['nvarchar', 'nchar'].includes(row.type_name)) {
    const len = row.max_length === -1 ? 'MAX' : row.max_length / 2
    type += `(${len})`
  } else if (['decimal', 'numeric'].includes(row.type_name)) {
    type += `(${row.precision}, ${row.scale})`
  }
  return type
}

export async function buildTableDefinition(pool, schema, name) {
  const exists = await pool
    .request()
    .input('schema', sql.NVarChar, schema)
    .input('name', sql.NVarChar, name)
    .query(`
      SELECT t.object_id
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE s.name = @schema AND t.name = @name AND t.is_ms_shipped = 0
    `)

  if (!exists.recordset.length) {
    return null
  }

  const objectId = exists.recordset[0].object_id

  const columns = await pool
    .request()
    .input('objectId', sql.Int, objectId)
    .query(`
      SELECT
        c.name AS column_name,
        ty.name AS type_name,
        c.max_length,
        c.precision,
        c.scale,
        c.is_nullable,
        c.is_identity,
        ic.seed_value,
        ic.increment_value,
        dc.definition AS default_definition
      FROM sys.columns c
      INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      LEFT JOIN sys.identity_columns ic
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
      WHERE c.object_id = @objectId
      ORDER BY c.column_id
    `)

  const pk = await pool
    .request()
    .input('objectId', sql.Int, objectId)
    .query(`
      SELECT col.name AS column_name
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns col
        ON ic.object_id = col.object_id AND ic.column_id = col.column_id
      WHERE i.object_id = @objectId AND i.is_primary_key = 1
      ORDER BY ic.key_ordinal
    `)

  const lines = columns.recordset.map((col) => {
    const parts = [quoteIdent(col.column_name), formatType(col)]
    if (col.is_identity) {
      parts.push(
        `IDENTITY(${col.seed_value ?? 1}, ${col.increment_value ?? 1})`,
      )
    }
    if (!col.is_nullable) parts.push('NOT NULL')
    if (col.default_definition) parts.push(`DEFAULT ${col.default_definition}`)
    return `  ${parts.join(' ')}`
  })

  let ddl = `CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(name)} (\n${lines.join(',\n')}\n)`
  if (pk.recordset.length) {
    const pkList = pk.recordset.map((r) => quoteIdent(r.column_name)).join(', ')
    ddl += `;\n\nALTER TABLE ${quoteIdent(schema)}.${quoteIdent(name)} ADD PRIMARY KEY (${pkList})`
  }

  return ddl
}
