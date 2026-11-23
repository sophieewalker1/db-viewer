import { formatType } from './tableDef.js'

const CODE_TYPES = ['V', 'P', 'FN', 'IF', 'TF', 'TR']

const CODE_SECTIONS = [
  { label: 'Views', types: ['V'] },
  { label: 'Stored Procedures', types: ['P'] },
  { label: 'Functions', types: ['FN', 'IF', 'TF'] },
  { label: 'Triggers', types: ['TR'] },
]

// Brackets only where needed: the output is read by people and LLMs, and
// bracketing every identifier adds a lot of noise to a large schema.
function ident(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `[${name.replace(/]/g, ']]')}]`
}

function qualified(schema, name) {
  return `${ident(schema)}.${ident(name)}`
}

function keyOf(schema, name) {
  return `${schema}.${name}`.toLowerCase()
}

function groupBy(rows, keyFn) {
  const map = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return map
}

async function loadSchema(pool) {
  const [columns, keys, foreignKeys, modules] = await Promise.all([
    pool.request().query(`
      SELECT
        s.name AS [schema],
        t.name AS [table],
        c.name AS column_name,
        ty.name AS type_name,
        c.max_length,
        c.precision,
        c.scale,
        c.is_nullable,
        c.is_identity,
        ic.seed_value,
        ic.increment_value,
        dc.definition AS default_definition,
        cc.definition AS computed_definition
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.columns c ON c.object_id = t.object_id
      INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      LEFT JOIN sys.identity_columns ic
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
      LEFT JOIN sys.computed_columns cc
        ON c.object_id = cc.object_id AND c.column_id = cc.column_id
      WHERE t.is_ms_shipped = 0
      ORDER BY s.name, t.name, c.column_id
    `),
    pool.request().query(`
      SELECT
        s.name AS [schema],
        t.name AS [table],
        kc.name AS constraint_name,
        RTRIM(kc.type) AS kind,
        col.name AS column_name
      FROM sys.key_constraints kc
      INNER JOIN sys.tables t ON kc.parent_object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.index_columns ic
        ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
      INNER JOIN sys.columns col
        ON col.object_id = ic.object_id AND col.column_id = ic.column_id
      WHERE t.is_ms_shipped = 0
      ORDER BY s.name, t.name, kc.type, kc.name, ic.key_ordinal
    `),
    pool.request().query(`
      SELECT
        s.name AS [schema],
        t.name AS [table],
        fk.name AS constraint_name,
        pc.name AS column_name,
        rs.name AS ref_schema,
        rt.name AS ref_table,
        rc.name AS ref_column,
        fk.delete_referential_action_desc AS on_delete,
        fk.update_referential_action_desc AS on_update
      FROM sys.foreign_keys fk
      INNER JOIN sys.tables t ON fk.parent_object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      INNER JOIN sys.columns pc
        ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
      INNER JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
      INNER JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
      INNER JOIN sys.columns rc
        ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
      WHERE t.is_ms_shipped = 0
      ORDER BY s.name, t.name, fk.name, fkc.constraint_column_id
    `),
    pool.request().query(`
      SELECT
        s.name AS [schema],
        o.name AS [name],
        RTRIM(o.type) AS [type],
        m.definition AS [definition]
      FROM sys.objects o
      INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
      LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
      WHERE o.type IN (${CODE_TYPES.map((t) => `'${t}'`).join(', ')})
        AND o.is_ms_shipped = 0
      ORDER BY s.name, o.name
    `),
  ])

  const tableKey = (r) => keyOf(r.schema, r.table)
  return {
    columns: groupBy(columns.recordset, tableKey),
    keys: groupBy(keys.recordset, tableKey),
    foreignKeys: groupBy(foreignKeys.recordset, tableKey),
    modules: modules.recordset,
  }
}

function columnLine(col) {
  if (col.computed_definition) {
    return `${ident(col.column_name)} AS ${col.computed_definition}`
  }
  const parts = [ident(col.column_name), formatType(col)]
  if (col.is_identity) {
    parts.push(`IDENTITY(${col.seed_value ?? 1}, ${col.increment_value ?? 1})`)
  }
  parts.push(col.is_nullable ? 'NULL' : 'NOT NULL')
  if (col.default_definition) parts.push(`DEFAULT ${col.default_definition}`)
  return parts.join(' ')
}

function keyLines(rows = []) {
  return [...groupBy(rows, (r) => r.constraint_name)].map(([name, cols]) => {
    const kind = cols[0].kind === 'PK' ? 'PRIMARY KEY' : 'UNIQUE'
    const list = cols.map((c) => ident(c.column_name)).join(', ')
    return `CONSTRAINT ${ident(name)} ${kind} (${list})`
  })
}

function foreignKeyLines(rows = []) {
  return [...groupBy(rows, (r) => r.constraint_name)].map(([name, cols]) => {
    const { ref_schema: refSchema, ref_table: refTable, on_delete: onDelete, on_update: onUpdate } =
      cols[0]
    const from = cols.map((c) => ident(c.column_name)).join(', ')
    const to = cols.map((c) => ident(c.ref_column)).join(', ')
    let line = `CONSTRAINT ${ident(name)} FOREIGN KEY (${from}) REFERENCES ${qualified(refSchema, refTable)} (${to})`
    if (onDelete && onDelete !== 'NO_ACTION') line += ` ON DELETE ${onDelete.replace(/_/g, ' ')}`
    if (onUpdate && onUpdate !== 'NO_ACTION') line += ` ON UPDATE ${onUpdate.replace(/_/g, ' ')}`
    return line
  })
}

function tableDdl(schema, name, columns, keys, foreignKeys) {
  const lines = [...columns.map(columnLine), ...keyLines(keys), ...foreignKeyLines(foreignKeys)]
  return `CREATE TABLE ${qualified(schema, name)} (\n  ${lines.join(',\n  ')}\n);`
}

function sqlBlock(heading, body) {
  return `#### ${heading}\n\n\`\`\`sql\n${body.trim()}\n\`\`\`\n`
}

// Returns the Markdown section for one database plus counts of what went in.
export async function exportDatabase(pool, database, excludedKeys = []) {
  const excluded = new Set(excludedKeys.map((k) => k.toLowerCase()))
  const schema = await loadSchema(pool)
  const out = [`## Database: ${database}\n`]
  const counts = { tables: 0, code: 0 }

  const tables = [...schema.columns.entries()]
    .filter(([key]) => !excluded.has(key))
    .sort(([a], [b]) => a.localeCompare(b))

  if (tables.length) {
    out.push(`### Tables (${tables.length})\n`)
    for (const [key, cols] of tables) {
      const { schema: s, table: t } = cols[0]
      out.push(
        sqlBlock(
          qualified(s, t),
          tableDdl(s, t, cols, schema.keys.get(key), schema.foreignKeys.get(key)),
        ),
      )
    }
    counts.tables = tables.length
  }

  const modules = schema.modules.filter((m) => !excluded.has(keyOf(m.schema, m.name)))
  for (const section of CODE_SECTIONS) {
    const items = modules.filter((m) => section.types.includes(m.type))
    if (!items.length) continue
    out.push(`### ${section.label} (${items.length})\n`)
    for (const m of items) {
      const body = m.definition ?? '-- Definition is encrypted or unavailable.'
      out.push(sqlBlock(qualified(m.schema, m.name), body.replace(/\r\n/g, '\n')))
    }
    counts.code += items.length
  }

  if (out.length === 1) out.push('_Nothing selected for export._\n')

  return { text: out.join('\n'), counts }
}

export function exportHeader(serverLabel, databases, partial) {
  return [
    `# SQL Server schema export (${serverLabel})`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Databases: ${databases.join(', ')}`,
    '',
    'Dialect is T-SQL. Tables are shown as CREATE TABLE statements including primary keys,',
    'unique constraints, and foreign keys. Views, procedures, functions, and triggers are',
    'shown with their full source.',
    ...(partial
      ? ['Some objects were intentionally left out, so references to missing objects are expected.']
      : []),
    '',
  ].join('\n')
}
